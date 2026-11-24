// P4-LOW-FIXES-R3-BACKEND-01 적용·되돌림 자체 점검(006000·007000).
// 되돌림 SQL 은 배포 키트(Plan/Claude-Backend-20261123/P4-LOW-FIXES-R3-BACKEND-01/)에 있어 P4_LOWFIX_KIT 가 있을 때만 돈다.
//   P4_LOWFIX_KIT=C:/nadaum/Plan/Claude-Backend-20261123/P4-LOW-FIXES-R3-BACKEND-01 npx vitest run --maxWorkers=2 tests/db/p4-low-fixes-r3-rollback.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { asUser, expectDbError, migrationFiles, seedOwner, type Db } from "./harness";

const KIT = process.env.P4_LOWFIX_KIT;
const M6 = "20261124006000_p4_low_fixes.sql";
const M7 = "20261124007000_p4_r3_limits.sql";
const MIG = join(import.meta.dirname, "..", "..", "supabase", "migrations");

const SIGS = [
  "public.create_inquiry(uuid, text, uuid, text, text, text, text)",
  "public.schedule_execution(uuid, timestamptz)",
  "public.create_crm_followup(uuid, text, date)",
  "public.upsert_channel_connection(text, text, text, text, bigint, bigint, text)",
  "public.disconnect_channel_connection(text)",
  "public.archive_inquiry(uuid)",
  "public.archive_crm_followup(uuid)",
  "app.p4_r3_limit(text)",
  "app.channel_url_ok(text)",
  "app.channel_url_host(text)",
  "app.channel_connection_audit(uuid, uuid, text, jsonb)",
];

async function baseDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, "supabase-shim.sql"), "utf8"));
  for (const f of migrationFiles()) {
    if (f >= M6) break;
    await db.exec(readFileSync(join(MIG, f), "utf8"));
  }
  return db;
}

const mig = (f: string) => readFileSync(join(MIG, f), "utf8");
const kit = (f: string) => readFileSync(join(KIT!, f), "utf8");

async function fingerprint(db: Db) {
  const fns = [];
  for (const sig of SIGS) {
    const r = await db.query<Record<string, unknown>>(
      String.raw`select md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) as src, p.proacl::text as acl, p.prosecdef as secdef
                   from pg_proc p where p.oid = to_regprocedure($1)`,
      [sig],
    );
    fns.push([sig, r.rows[0] ?? null]);
  }
  const idx = await db.query(
    `select tablename, indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename in ('inquiries', 'crm_followups', 'execution_schedules') order by 1, 2`,
  );
  return JSON.stringify({ fns, idx: idx.rows });
}

describe.skipIf(!KIT)("P4-LOW-FIXES-R3-BACKEND-01 적용·되돌림 (키트)", () => {
  it("005000 상태 → 006000 → 007000 → 되돌림 007000 = 006000 상태 → 되돌림 006000 = 005000 상태 → 다시 적용 = 같은 상태", async () => {
    const db = await baseDb();
    const s5 = await fingerprint(db);
    await db.exec(mig(M6));
    const s6 = await fingerprint(db);
    await db.exec(mig(M7));
    const s7 = await fingerprint(db);
    expect(s6).not.toBe(s5);
    expect(s7).not.toBe(s6);

    await db.exec(kit("rollback_007000.sql"));
    expect(await fingerprint(db)).toBe(s6);

    // 007000 을 되돌려도 R4 는 남는다
    const owner = await seedOwner(db, "rb-r4@example.test");
    await expectDbError(
      asUser(db, owner.userId, (tx) =>
        tx.query("select public.create_inquiry($1, 'manual', gen_random_uuid(), '합성', '', '', '')", [owner.projectA]),
      ),
      /VALIDATION: 직접 등록한 문의에는 출처를 지정할 수 없습니다/,
    );

    await db.exec(kit("rollback_006000.sql"));
    expect(await fingerprint(db)).toBe(s5);

    await db.exec(mig(M6));
    expect(await fingerprint(db)).toBe(s6);
    await db.exec(mig(M7));
    expect(await fingerprint(db)).toBe(s7);
  }, 120_000);
});
