// P4-PRIVACY-BACKEND-01: 문의 원문 직접 읽기 차단(R1) · CRM 후속 성과 연결 같은 프로젝트만(R2)
// 모든 값은 합성 데이터다.
import { beforeAll, describe, expect, it } from "vitest";
import { asSetup, asUser, createDb, DENIED, expectDbError, one, seedOwner, type Db, type Fixture } from "./harness";

let db: Db;

beforeAll(async () => {
  db = await createDb();
}, 60_000);

async function newInquiry(owner: Fixture, projectId = owner.projectA): Promise<string> {
  return asUser(db, owner.userId, async (tx) =>
    (await one<{ id: string }>(
      tx,
      "select public.create_inquiry($1, 'manual', null, '합성문의자', '01000000000', 'synthetic@example.test', '합성 메모') as id",
      [projectId],
    )).id,
  );
}

async function newResult(owner: Fixture, projectId: string): Promise<string> {
  return asUser(db, owner.userId, (tx) =>
    asSetup(tx, async () =>
      (await one<{ id: string }>(
        tx,
        `insert into public.execution_results (workspace_id, project_id, metric_name, value, unit, source_note, period_start, period_end, collection_mode, created_by)
         values ($1, $2, '합성 지표', 1, 'count', '합성', date '2026-11-01', date '2026-11-02', 'manual_entry', $3) returning id`,
        [owner.workspaceId, projectId, owner.userId],
      )).id,
    ),
  );
}

async function newFollowup(owner: Fixture, projectId = owner.projectA): Promise<string> {
  const inq = await newInquiry(owner, projectId);
  return asUser(db, owner.userId, async (tx) =>
    (await one<{ id: string }>(tx, "select public.create_crm_followup($1, '합성담당', '2026-11-30') as id", [inq])).id,
  );
}

describe("R1 문의 원문 직접 읽기 차단 (20261123004000)", () => {
  it("로그인 역할: 원문 열(이름·전화·메일·메모)과 select * 는 권한 오류", async () => {
    const owner = await seedOwner(db, "priv-r1a@example.test");
    await newInquiry(owner);
    for (const col of ["contact_name", "contact_phone", "contact_email", "note", "*"]) {
      await expectDbError(
        asUser(db, owner.userId, (tx) => tx.query(`select ${col} from public.inquiries`)),
        /permission denied/,
      );
    }
  });

  it("로그인 역할: 원문이 아닌 열은 자기 업무실 행만 읽힌다(RLS 유지)", async () => {
    const a = await seedOwner(db, "priv-r1b@example.test");
    const b = await seedOwner(db, "priv-r1c@example.test");
    const aInq = await newInquiry(a);
    await newInquiry(b);
    const rows = await asUser(db, a.userId, async (tx) =>
      (await tx.query<{ id: string; status: string }>("select id, status, source_kind, project_id, created_at from public.inquiries")).rows,
    );
    expect(rows.map((r) => r.id)).toEqual([aInq]);
    expect(rows[0].status).toBe("new");
  });

  it("익명 역할: 어떤 열도 읽을 수 없다", async () => {
    await expectDbError(asUser(db, null, (tx) => tx.query("select id from public.inquiries")), DENIED);
  });

  it("가린 목록(list_masked_inquiries)과 문의 등록(create_inquiry)은 그대로 된다", async () => {
    const owner = await seedOwner(db, "priv-r1d@example.test");
    await newInquiry(owner);
    const list = await asUser(db, owner.userId, (tx) =>
      one<{ j: Array<{ masked_name: string; masked_phone: string; masked_email: string }> }>(
        tx,
        "select public.list_masked_inquiries($1) as j",
        [owner.projectA],
      ),
    );
    expect(list.j).toHaveLength(1);
    expect(list.j[0].masked_phone).toBe("010-****-0000");
    expect(list.j[0].masked_email).toBe("s***@example.test");
    expect(JSON.stringify(list.j)).not.toContain("01000000000");
  });

  it("권한 목록: authenticated 는 원문 열에 SELECT 권한이 없고 나머지 9열만 있다", async () => {
    const r = await one<{ cols: string[] }>(
      db,
      `select array_agg(column_name::text order by column_name) as cols from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'inquiries' and grantee = 'authenticated' and privilege_type = 'SELECT'`,
    );
    expect(r.cols).toEqual(["archived_at", "created_at", "created_by", "id", "project_id", "source_id", "source_kind", "status", "workspace_id"]);
  });
});

describe("R2 CRM 후속 성과 연결은 같은 프로젝트만 (20261123004000)", () => {
  it("다른 업무실의 성과는 NOT_FOUND 로 거절되고 값이 바뀌지 않는다", async () => {
    const a = await seedOwner(db, "priv-r2a@example.test");
    const b = await seedOwner(db, "priv-r2b@example.test");
    const fu = await newFollowup(a);
    const bResult = await newResult(b, b.projectA);
    await expectDbError(
      asUser(db, a.userId, (tx) => tx.query("select public.update_crm_followup($1, 'done', $2)", [fu, bResult])),
      /같은 프로젝트의 성과 기록만/,
    );
    const row = await asUser(db, a.userId, (tx) =>
      one<{ status: string; linked_result_id: string | null }>(tx, "select status, linked_result_id from public.crm_followups where id = $1", [fu]),
    );
    expect(row).toEqual({ status: "todo", linked_result_id: null });
  });

  it("같은 업무실이라도 다른 프로젝트의 성과는 거절된다", async () => {
    const a = await seedOwner(db, "priv-r2c@example.test");
    const fu = await newFollowup(a, a.projectA);
    const otherProject = await newResult(a, a.projectB);
    await expectDbError(
      asUser(db, a.userId, (tx) => tx.query("select public.update_crm_followup($1, 'done', $2)", [fu, otherProject])),
      /같은 프로젝트의 성과 기록만/,
    );
  });

  it("없는 성과 id 도 거절된다", async () => {
    const a = await seedOwner(db, "priv-r2d@example.test");
    const fu = await newFollowup(a);
    await expectDbError(
      asUser(db, a.userId, (tx) => tx.query("select public.update_crm_followup($1, 'done', gen_random_uuid())", [fu])),
      /같은 프로젝트의 성과 기록만/,
    );
  });

  it("같은 프로젝트의 성과는 연결되고, null 이면 기존 연결을 유지한다", async () => {
    const a = await seedOwner(db, "priv-r2e@example.test");
    const fu = await newFollowup(a);
    const same = await newResult(a, a.projectA);
    await asUser(db, a.userId, (tx) => tx.query("select public.update_crm_followup($1, 'in_progress', $2)", [fu, same]));
    await asUser(db, a.userId, (tx) => tx.query("select public.update_crm_followup($1, 'done', null)", [fu]));
    const row = await asUser(db, a.userId, (tx) =>
      one<{ status: string; linked_result_id: string }>(tx, "select status, linked_result_id from public.crm_followups where id = $1", [fu]),
    );
    expect(row).toEqual({ status: "done", linked_result_id: same });
  });

  it("DB 수준: 함수를 거치지 않은 다른 프로젝트 연결도 복합 외래 키가 거절한다", async () => {
    const a = await seedOwner(db, "priv-r2f@example.test");
    const fu = await newFollowup(a, a.projectA);
    const otherProject = await newResult(a, a.projectB);
    await expectDbError(
      asUser(db, a.userId, (tx) =>
        asSetup(tx, () => tx.query("update public.crm_followups set linked_result_id = $2 where id = $1", [fu, otherProject])),
      ),
      /crm_followups_project_linked_result_fkey|foreign key/,
    );
  });
});
