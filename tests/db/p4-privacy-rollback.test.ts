// P4-PRIVACY-BACKEND-01 적용·되돌림 자체 점검.
// 되돌림 SQL 은 배포 키트(Plan/Claude-Backend-20261123/P4-PRIVACY-BACKEND-01/)에 있어 P4_PRIVACY_KIT 가 있을 때만 돈다.
//   P4_PRIVACY_KIT=C:/nadaum/Plan/Claude-Backend-20261123/P4-PRIVACY-BACKEND-01 npx vitest run tests/db/p4-privacy-rollback.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { asSetup, asUser, migrationFiles, one, seedOwner, type Db } from "./harness";

const KIT = process.env.P4_PRIVACY_KIT;
const TARGET = "20261123004000_p4_inquiry_privacy.sql";
const MIG = join(import.meta.dirname, "..", "..", "supabase", "migrations");

async function baseDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, "supabase-shim.sql"), "utf8"));
  for (const f of migrationFiles()) {
    if (f >= TARGET) break;
    await db.exec(readFileSync(join(MIG, f), "utf8"));
  }
  return db;
}

const target = () => readFileSync(join(MIG, TARGET), "utf8");

async function fingerprint(db: Db) {
  const q = async (sql: string) => JSON.stringify((await db.query(sql)).rows);
  return {
    tableSelect: await q("select has_table_privilege('authenticated', 'public.inquiries', 'SELECT') as v"),
    colPrivs: await q(`select column_name, privilege_type from information_schema.column_privileges
                        where table_schema = 'public' and table_name = 'inquiries' and grantee = 'authenticated' order by 1, 2`),
    constraints: await q(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
                           where conrelid in ('public.crm_followups'::regclass, 'public.execution_results'::regclass) order by 1, 2`),
    fn: await q(`select md5(regexp_replace(prosrc, '\\s+', ' ', 'g')) as src, proacl::text as acl, prosecdef from pg_proc
                  where oid = 'public.update_crm_followup(uuid, text, uuid)'::regprocedure`),
  };
}

describe.skipIf(!KIT)("P4-PRIVACY-BACKEND-01 적용·되돌림 (키트)", () => {
  it("003000 상태 → 004000 적용 → 되돌림 = 003000 상태 → 다시 적용 = 004000 상태", async () => {
    const db = await baseDb();
    const before = await fingerprint(db);
    await db.exec(target());
    const after = await fingerprint(db);
    expect(after).not.toEqual(before);
    expect(after.tableSelect).toBe('[{"v":false}]');

    await db.exec(readFileSync(join(KIT!, "rollback_004000.sql"), "utf8"));
    expect(await fingerprint(db)).toEqual(before);

    await db.exec(target());
    expect(await fingerprint(db)).toEqual(after);
  }, 120_000);

  it("적용 전 대조: 어긋난 연결이 있으면 precheck bad_links=1 이고 004000 적용이 실패한다(자동 정리 없음)", async () => {
    const db = await baseDb();
    const a = await seedOwner(db, "priv-kit@example.test");
    const fu = await asUser(db, a.userId, async (tx) => {
      const inq = (await one<{ id: string }>(tx, "select public.create_inquiry($1, 'manual', null, '합성', '', '', '') as id", [a.projectA])).id;
      const f = (await one<{ id: string }>(tx, "select public.create_crm_followup($1, '합성담당', '2026-11-30') as id", [inq])).id;
      const otherProjectResult = await asSetup(tx, async () =>
        (await one<{ id: string }>(
          tx,
          `insert into public.execution_results (workspace_id, project_id, metric_name, value, unit, source_note, period_start, period_end, collection_mode, created_by)
           values ($1, $2, '합성', 1, 'count', '합성', date '2026-11-01', date '2026-11-02', 'manual_entry', $3) returning id`,
          [a.workspaceId, a.projectB, a.userId],
        )).id,
      );
      // 001000 함수는 다른 프로젝트 성과도 받아 들인다(이전 결함 재현)
      await tx.query("select public.update_crm_followup($1, 'done', $2)", [f, otherProjectResult]);
      return f;
    });
    expect(fu).toBeTruthy();

    const pre = await one<{ bad_links: string; old_fk_exists: string; new_constraints_exist: string; auth_table_select_before: boolean }>(
      db,
      readFileSync(join(KIT!, "precheck_004000.sql"), "utf8"),
    );
    expect(Number(pre.bad_links)).toBe(1);
    expect(pre.auth_table_select_before).toBe(true);
    expect(Number(pre.old_fk_exists)).toBe(1);
    expect(Number(pre.new_constraints_exist)).toBe(0);

    await expect(db.exec(target())).rejects.toThrow(/crm_followups_project_linked_result_fkey|foreign key/);
  }, 120_000);
});
