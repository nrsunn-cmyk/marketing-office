// P4-R3-LIMITS-BACKEND-01: 문의·후속 작업·예약 개수 한도와 보관 함수(20261123006000, 합성 데이터)
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, expectDbError, one, seedOwner, type Db, type Fixture } from "./harness";

let db: Db;
beforeAll(async () => {
  db = await createDb();
}, 60_000);

const limit = async (name: string) => (await one<{ n: number }>(db, "select app.p4_r3_limit($1) as n", [name])).n;

/** 시험 준비용: 실행 건 한 줄을 관리자 권한으로 직접 넣는다(RPC 흐름은 p4b 시험이 따로 확인) */
async function insertJob(f: Fixture, status = "pending_approval"): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      `with g as (select gen_random_uuid() as id)
       insert into public.execution_jobs (id, workspace_id, project_id, source_kind, source_id, source_revision, source_hash, payload,
                                          channel, idempotency_key, status, created_by)
       select g.id, $1, $2, 'channel_draft', gen_random_uuid(), 1, repeat('a', 64), '{}'::jsonb, 'crm', 'exec-' || g.id, $3, $4 from g
       returning id`,
      [f.workspaceId, f.projectA, status, f.userId],
    )
  ).id;
}

const createInquiry = (f: Fixture, projectId = f.projectA) =>
  asUser(db, f.userId, async (tx) =>
    (await one<{ id: string }>(tx, "select public.create_inquiry($1, 'manual', null, '합성문의자', '', '', '') as id", [projectId])).id,
  );
const createFollowup = (f: Fixture, inquiryId: string) =>
  asUser(db, f.userId, async (tx) =>
    (await one<{ id: string }>(tx, "select public.create_crm_followup($1, '합성담당', '2026-12-01') as id", [inquiryId])).id,
  );
const schedule = (f: Fixture, jobId: string) =>
  asUser(db, f.userId, async (tx) =>
    (await one<{ id: string }>(tx, "select public.schedule_execution($1, '2026-12-01T10:00:00+09:00') as id", [jobId])).id,
  );
const cancel = (f: Fixture, scheduleId: string) =>
  asUser(db, f.userId, (tx) => tx.query("select public.cancel_execution_schedule($1)", [scheduleId]));

describe("P4 R3 한도 (20261123006000)", () => {
  it("한도 숫자는 한 곳(app.p4_r3_limit)에 있고, 로그인·익명 역할은 직접 부를 수 없다", async () => {
    expect(await limit("inquiries_per_project")).toBe(500);
    expect(await limit("followups_per_inquiry")).toBe(20);
    expect(await limit("schedules_per_job")).toBe(20);
    const owner = await seedOwner(db, "r3-limit-acl@example.test");
    await expectDbError(asUser(db, owner.userId, (tx) => tx.query("select app.p4_r3_limit('inquiries_per_project')")), /permission denied/);
    await expectDbError(asUser(db, null, (tx) => tx.query("select app.p4_r3_limit('inquiries_per_project')")), /permission denied/);
  });

  it("L1 문의: 프로젝트당 한도에서 멈추고, 다른 프로젝트는 영향이 없으며, 보관하면 다시 등록된다", async () => {
    const owner = await seedOwner(db, "r3-inquiry@example.test");
    const n = await limit("inquiries_per_project");
    // 한도 - 1 개는 준비용으로 직접 넣고, 마지막 1개는 RPC 로 넣는다
    await db.query(
      `insert into public.inquiries (workspace_id, project_id, source_kind, contact_name, created_by)
       select $1, $2, 'manual', '합성' || g, $3 from generate_series(1, $4::int) g`,
      [owner.workspaceId, owner.projectA, owner.userId, n - 1],
    );
    const last = await createInquiry(owner);
    await expectDbError(createInquiry(owner), new RegExp(`LIMIT_REACHED: 문의는 프로젝트당 ${n}개까지입니다`));
    expect((await one<{ c: number }>(db, "select count(*)::int as c from public.inquiries where project_id = $1", [owner.projectA])).c).toBe(n);

    await createInquiry(owner, owner.projectB); // 다른 프로젝트는 그대로 된다

    await asUser(db, owner.userId, (tx) => tx.query("select public.archive_inquiry($1)", [last]));
    await createInquiry(owner); // 보관한 만큼 다시 등록
    await expectDbError(createInquiry(owner), /LIMIT_REACHED/);
  });

  it("L2 후속 작업: 문의당 한도에서 멈추고, 다른 문의는 영향이 없으며, 보관하면 다시 등록된다", async () => {
    const owner = await seedOwner(db, "r3-followup@example.test");
    const n = await limit("followups_per_inquiry");
    const inq = await createInquiry(owner);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(await createFollowup(owner, inq));
    await expectDbError(createFollowup(owner, inq), new RegExp(`LIMIT_REACHED: 후속 작업은 문의 하나에 ${n}개까지입니다`));

    const inq2 = await createInquiry(owner);
    await createFollowup(owner, inq2);

    await asUser(db, owner.userId, (tx) => tx.query("select public.archive_crm_followup($1)", [ids[0]]));
    await createFollowup(owner, inq);
    await expectDbError(createFollowup(owner, inq), /LIMIT_REACHED/);
  });

  it("L3 실행 건당 열린 예약은 하나: 두 번째는 거절, 취소한 뒤에는 다시 된다, 다른 실행 건은 영향 없음", async () => {
    const owner = await seedOwner(db, "r3-schedule-open@example.test");
    const job = await insertJob(owner);
    const s1 = await schedule(owner, job);
    await expectDbError(schedule(owner, job), /INVALID_TRANSITION: 이 실행 건에는 이미 예약이 있습니다/);

    const job2 = await insertJob(owner, "queued");
    await schedule(owner, job2);

    await cancel(owner, s1);
    await schedule(owner, job);
    const open = await one<{ c: number }>(
      db,
      "select count(*)::int as c from public.execution_schedules where execution_job_id = $1 and status = 'scheduled'",
      [job],
    );
    expect(open.c).toBe(1);
  });

  it("L3 마지막 방어선: 함수를 거치지 않고 열린 예약을 하나 더 넣어도 고유 색인이 막는다", async () => {
    const owner = await seedOwner(db, "r3-schedule-index@example.test");
    const job = await insertJob(owner);
    await schedule(owner, job);
    await expectDbError(
      db.query(
        `insert into public.execution_schedules (workspace_id, project_id, execution_job_id, scheduled_at, status, created_by)
         values ($1, $2, $3, now() + interval '1 day', 'paused_version_changed', $4)`,
        [owner.workspaceId, owner.projectA, job, owner.userId],
      ),
      /execution_schedules_one_open_per_job|duplicate key/,
    );
  });

  it("L4 예약 누적(취소 포함): 실행 건당 한도에서 멈춘다", async () => {
    const owner = await seedOwner(db, "r3-schedule-total@example.test");
    const n = await limit("schedules_per_job");
    const job = await insertJob(owner);
    for (let i = 0; i < n; i++) await cancel(owner, await schedule(owner, job));
    await expectDbError(schedule(owner, job), new RegExp(`LIMIT_REACHED: 한 실행 건의 예약은 취소 포함 ${n}번까지입니다`));
  });

  it("보관: 문의를 보관하면 그 후속 작업도 보관되고, 목록·후속 작업 추가·수정에서 빠진다", async () => {
    const owner = await seedOwner(db, "r3-archive@example.test");
    const inq = await createInquiry(owner);
    const f = await createFollowup(owner, inq);
    await asUser(db, owner.userId, (tx) => tx.query("select public.archive_inquiry($1)", [inq]));

    const row = await one<{ fa: boolean }>(db, "select archived_at is not null as fa from public.crm_followups where id = $1", [f]);
    expect(row.fa).toBe(true);
    const list = await asUser(db, owner.userId, (tx) =>
      one<{ j: unknown[] }>(tx, "select public.list_masked_inquiries($1) as j", [owner.projectA]),
    );
    expect(list.j).toHaveLength(0);
    await expectDbError(createFollowup(owner, inq), /NOT_FOUND/);
    await expectDbError(
      asUser(db, owner.userId, (tx) => tx.query("select public.update_crm_followup($1, 'done', null)", [f])),
      /NOT_FOUND/,
    );
    // 두 번 보관은 NOT_FOUND
    await expectDbError(asUser(db, owner.userId, (tx) => tx.query("select public.archive_inquiry($1)", [inq])), /NOT_FOUND/);
    await expectDbError(asUser(db, owner.userId, (tx) => tx.query("select public.archive_crm_followup($1)", [f])), /NOT_FOUND/);
  });

  it("보관: 다른 업무실의 문의·후속 작업은 보관할 수 없고, 익명은 부를 수 없다", async () => {
    const owner = await seedOwner(db, "r3-archive-owner@example.test");
    const other = await seedOwner(db, "r3-archive-other@example.test");
    const inq = await createInquiry(owner);
    const f = await createFollowup(owner, inq);
    await expectDbError(asUser(db, other.userId, (tx) => tx.query("select public.archive_inquiry($1)", [inq])), /NOT_FOUND/);
    await expectDbError(asUser(db, other.userId, (tx) => tx.query("select public.archive_crm_followup($1)", [f])), /NOT_FOUND/);
    await expectDbError(asUser(db, null, (tx) => tx.query("select public.archive_inquiry($1)", [inq])), /permission denied/);
    await expectDbError(asUser(db, null, (tx) => tx.query("select public.archive_crm_followup($1)", [f])), /permission denied/);
    const still = await one<{ a: boolean }>(db, "select archived_at is null as a from public.inquiries where id = $1", [inq]);
    expect(still.a).toBe(true);
  });

  it("화면 안내: LIMIT_REACHED 한국어 설명이 그대로 보인다", async () => {
    const { executionErrorFromDb } = await import("@/domain/execution");
    expect(executionErrorFromDb("LIMIT_REACHED: 문의는 프로젝트당 500개까지입니다. 끝난 문의를 보관한 뒤 다시 등록해 주세요")).toEqual({
      code: "VALIDATION",
      message: "문의는 프로젝트당 500개까지입니다. 끝난 문의를 보관한 뒤 다시 등록해 주세요.",
    });
  });
});
