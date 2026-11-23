// NADAUM-BRAND-BACKEND-01 적용·접수 끄기·되돌림 자체 점검(20261123010000).
// 키트는 Plan/Claude-Backend-20261123/NADAUM-BRAND-BACKEND-01/ 에 있어 NADAUM_BRAND_KIT 가 있을 때만 돈다.
//   NADAUM_BRAND_KIT=C:/nadaum/Plan/Claude-Backend-20261123/NADAUM-BRAND-BACKEND-01 npx vitest run --maxWorkers=2 tests/db/public-inquiries-rollback.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { asUser, expectDbError, migrationFiles, seedOwner, type Db } from "./harness";

const KIT = process.env.NADAUM_BRAND_KIT;
const TARGET = "20261123010000_public_inquiries.sql";
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
const kit = (f: string) => readFileSync(join(KIT!, f), "utf8");

async function fingerprint(db: Db) {
  const q = async (sql: string) => JSON.stringify((await db.query(sql)).rows);
  return {
    fns: await q(`select p.oid::regprocedure::text as sig, md5(p.prosrc) as src, p.proacl::text as acl from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname in ('public', 'app') and (p.proname like '%public_inquir%') order by 1`),
    tables: await q(`select to_regclass('public.public_inquiries') is not null as t1, to_regclass('app.public_inquiry_nonces') is not null as t2`),
    secret: await q(`select count(*)::int as n from app.server_secrets where name = 'public_inquiry_signing'`),
    // 기존 것이 그대로인지(관리자 기록·비밀값 표·P4 문의)
    others: await q(`select count(*)::int as n from app.server_secrets where name <> 'public_inquiry_signing'`),
    p4: await q(`select to_regclass('public.inquiries') is not null as p4`),
  };
}

describe.skipIf(!KIT)("NADAUM-BRAND-BACKEND-01 적용·접수 끄기·되돌림 (키트)", () => {
  it("빈 상태: 적용 → 되돌림 = 적용 전, 다시 적용 = 같은 상태", async () => {
    const db = await baseDb();
    const s0 = await fingerprint(db);
    await db.exec(readFileSync(join(MIG, TARGET), "utf8"));
    const s1 = await fingerprint(db);
    expect(s1).not.toEqual(s0);
    await db.exec(kit("rollback_010000.sql"));
    expect(await fingerprint(db)).toEqual(s0);
    await db.exec(readFileSync(join(MIG, TARGET), "utf8"));
    const s2 = await fingerprint(db);
    expect(s2.fns).toBe(s1.fns);
    expect(s2.tables).toBe(s1.tables);
  }, 120_000);

  it("접수 끄기: 익명 접수는 권한 거절, 관리자 확인은 그대로. 데이터가 있으면 전체 되돌림은 확인 없이 멈춘다", async () => {
    const db = await baseDb();
    await db.exec(readFileSync(join(MIG, TARGET), "utf8"));
    await db.query(
      `insert into public.public_inquiries (ref_code, company_name, contact_name, phone, phone_digits, services, message, privacy_consent_at, consent_version, client_hash)
       values ('ND-261123-AAAAAA', '합성', '합성', '010-0000-0000', '01000000000', array['homepage'], '합성', now(), 'v', repeat('a', 64))`,
    );
    await db.exec(kit("disable_intake_010000.sql"));
    await expectDbError(
      asUser(db, null, (tx) => tx.query("select * from public.submit_public_inquiry('{}', repeat('a', 64), 0, gen_random_uuid(), 'x')")),
      /permission denied/,
    );
    const admin = await seedOwner(db, "rb-admin@example.test");
    await db.query("insert into app.admins (user_id, note) values ($1, '합성 관리자')", [admin.userId]);
    const list = await asUser(db, admin.userId, (tx) => tx.query("select ref_code from public.admin_list_public_inquiries()"));
    expect(list.rows).toHaveLength(1);

    await expectDbError(db.exec(kit("rollback_010000.sql")), /STOP: 공개 상담 1 건/);
    await db.exec("rollback"); // 멈춤으로 끊긴 거래 정리
    expect((await db.query("select count(*)::int as n from public.public_inquiries")).rows).toEqual([{ n: 1 }]);
    await db.exec("set nadaum.confirm_drop_public_inquiries = 'yes'");
    await db.exec(kit("rollback_010000.sql"));
    expect((await db.query("select to_regclass('public.public_inquiries') is null as gone")).rows).toEqual([{ gone: true }]);
  }, 120_000);
});
