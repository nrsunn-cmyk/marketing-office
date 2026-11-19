/**
 * PERM-CLEANUP-01: 로그인 역할(authenticated)의 public 표 쓰기 권한 고정 시험(20261121006000_perm_cleanup).
 * 앱이 직접 쓰는 8개 표의 해당 명령만 남고, 나머지 쓰기는 정의자 RPC 로만 한다(RPC 동작은 다른 DB 시험 전체가 확인).
 * 새 표를 만들 때 이 목록에 넣지 않으면 시험이 실패한다(직접 쓰기 권한이 실수로 남는 것을 막는다).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, expectDbError, one, seedOwner, type Db, type Fixture } from "./harness";

let db: Db;
let f: Fixture;
beforeAll(async () => {
  db = await createDb();
  f = await seedOwner(db, "perm-owner@example.test");
}, 60_000);

/** 앱(src)이 사용자 토큰으로 직접 쓰는 표와 명령. 이것 말고는 쓰기 권한이 없어야 한다 */
const APP_DIRECT_WRITES: Record<string, string[]> = {
  clients: ["INSERT", "UPDATE"],
  projects: ["INSERT", "UPDATE"],
  source_assets: ["INSERT", "UPDATE"],
  company_profile_versions: ["INSERT"],
  project_profiles: ["INSERT"],
  supplier_profiles: ["INSERT"],
  tasks: ["INSERT"],
};

describe("authenticated 쓰기 권한", () => {
  it("모든 public 표: 앱 직접 쓰기 목록 밖의 INSERT·UPDATE·DELETE·TRUNCATE·REFERENCES·TRIGGER 없음", async () => {
    const rows = (
      await db.query<{ t: string; p: string }>(
        `select c.relname as t, x.p
           from pg_class c, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x(p)
          where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
            and has_table_privilege('authenticated', c.oid, x.p)
          order by 1, 2`,
      )
    ).rows;
    const got: Record<string, string[]> = {};
    for (const r of rows) (got[r.t] ??= []).push(r.p);
    for (const k of Object.keys(got)) got[k].sort();
    const want = Object.fromEntries(Object.entries(APP_DIRECT_WRITES).map(([k, v]) => [k, [...v].sort()]));
    expect(got).toEqual(want);
  });

  it("anon 은 public 표에 아무 권한도 없다", async () => {
    const n = await one<{ n: number }>(
      db,
      `select count(*)::int as n from pg_class c, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x(p)
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and has_table_privilege('anon', c.oid, x.p)`,
    );
    expect(n).toEqual({ n: 0 });
  });

  it("직접 쓰기 거절은 RLS 0행이 아니라 권한 오류(42501)로 끝난다", async () => {
    await expectDbError(asUser(db, f.userId, (tx) => tx.query("update workspaces set name = 'x' where id = $1", [f.workspaceId])), /permission denied for table workspaces/);
    await expectDbError(asUser(db, f.userId, (tx) => tx.query("delete from clients where id = $1", [f.clientA])), /permission denied for table clients/);
    await expectDbError(asUser(db, f.userId, (tx) => tx.query("update tasks set status = status where project_id = $1", [f.projectA])), /permission denied for table tasks/);
    await expectDbError(asUser(db, f.userId, (tx) => tx.query("insert into quote_number_sequences (workspace_id, year, last_number) values ($1, 2026, 999)", [f.workspaceId])), /permission denied for table quote_number_sequences/);
  });

  it("앱이 직접 쓰는 길은 그대로: 고객 만들기·고치기, 프로젝트 만들기, 글 자료 저장", async () => {
    await asUser(db, f.userId, async (tx) => {
      const c = await one<{ id: string }>(tx, "insert into clients (workspace_id, name) values ($1, '권한 시험 고객') returning id", [f.workspaceId]);
      await tx.query("update clients set name = '권한 시험 고객 2' where id = $1", [c.id]);
      await tx.query("insert into projects (workspace_id, client_id, kind, title) values ($1, $2, 'client', '권한 시험')", [f.workspaceId, c.id]);
      await tx.query("insert into source_assets (workspace_id, project_id, kind, text_content, upload_status) values ($1, $2, 'text', '메모', 'stored')", [f.workspaceId, f.projectA]);
    });
  });
});
