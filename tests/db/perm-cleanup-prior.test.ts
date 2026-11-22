/**
 * PERM-CLEANUP-01(RELEASE-PLAN-02 고침): 권한 정리가 회수 직전 표별 REFERENCES·TRIGGER·TRUNCATE 여부를 app.perm_cleanup_prior 에 남기는지.
 * 되돌림(Plan/.../rollback_perm.sql)은 이 기록대로만 돌려준다 — 전체 순서 적용·되돌림은 PG 17 전용 스택에서 확인(RELEASE-PLAN-02 chain-check).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, expectDbError, seedOwner, type Db, type Fixture } from "./harness";

let db: Db;
let a: Fixture;
beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "perm-prior@example.test");
}, 60_000);

describe("권한 정리 회수 전 기록", () => {
  it("public 표마다 한 행, 회수 전에는 REFERENCES·TRIGGER 가 있었고(Supabase 기본 권한) 지금은 없다", async () => {
    const rows = (await db.query<{ relname: string; had_references: boolean; had_trigger: boolean; had_truncate: boolean }>("select * from app.perm_cleanup_prior order by 1")).rows;
    const postCleanupTables = new Set(["channel_connections", "crm_followups", "execution_schedules", "inquiries"]);
    const tables = (await db.query<{ relname: string }>("select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1")).rows
      .map((r) => r.relname)
      .filter((name) => !postCleanupTables.has(name));
    expect(rows.map((r) => r.relname)).toEqual(tables);
    expect(rows.find((r) => r.relname === "clients")).toMatchObject({ had_references: true, had_trigger: true, had_truncate: false });
    const now = (await db.query<{ n: number }>("select count(*)::int as n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and (has_table_privilege('authenticated', c.oid, 'REFERENCES') or has_table_privilege('authenticated', c.oid, 'TRIGGER'))")).rows[0].n;
    expect(now).toBe(0);
  });
  it("로그인·익명은 기록 표를 읽을 수 없다", async () => {
    await expectDbError(asUser(db, a.userId, (tx) => tx.query("select * from app.perm_cleanup_prior")), /permission denied/);
    await expectDbError(asUser(db, null, (tx) => tx.query("select * from app.perm_cleanup_prior")), /permission denied/);
  });
});
