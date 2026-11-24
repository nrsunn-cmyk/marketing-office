// NADAUM-INQUIRY-DELETE-BACKEND-01 (20261123011000): 공개 상담 관리자 건별 영구 삭제(합성 데이터)
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
import { PUBLIC_INQUIRY_CONSENT_VERSION } from "@/features/public-inquiries/contract";
import { clientHashOf, signPublicInquiry } from "@/features/public-inquiries/server";
import { asUser, createDb, expectDbError, migrationFiles, one, seedOwner, type Db } from "./harness";

const FN = "public.admin_delete_public_inquiry(uuid, text)";
let db: Db;
let key: string;
let adminId: string;
let ownerId: string;
beforeAll(async () => {
  db = await createDb();
  key = (await one<{ v: string }>(db, "select value as v from app.server_secrets where name = 'public_inquiry_signing'")).v;
  adminId = (await seedOwner(db, "pid-admin@example.test")).userId;
  await db.query("insert into app.admins (user_id, note) values ($1, '합성 관리자')", [adminId]);
  ownerId = (await seedOwner(db, "pid-owner@example.test")).userId;
}, 60_000);

let seq = 0;
/** 서버와 같은 방식으로 서명해 익명 접수 1건. 개인정보 흉내 값은 감사 기록 검사에 쓴다 */
async function submit(contact = "삭제검사", phone = `010-8100-${String(++seq).padStart(4, "0")}`) {
  const payload = JSON.stringify({
    company_name: "삭제 합성 상회", contact_name: contact, phone, services: ["로고 제작"], other_service: "",
    message: "감사 기록에 남으면 안 되는 요청 내용", reference_url: "", desired_timeline: "", budget_range: "",
    privacy_consent: true, consent_version: PUBLIC_INQUIRY_CONSENT_VERSION,
  });
  const client = clientHashOf(key, `203.0.113.${seq}`);
  const at = Date.now();
  const nonce = randomUUID();
  const r = await asUser(db, null, (tx) =>
    one<{ ref_code: string }>(tx, "select * from public.submit_public_inquiry($1, $2, $3, $4, $5)", [payload, client, at, nonce, signPublicInquiry(key, at, nonce, client, payload)]),
  );
  const { id } = await one<{ id: string }>(db, "select id from public.public_inquiries where ref_code = $1", [r.ref_code]);
  return { id, ref: r.ref_code, phone };
}
const del = (who: string | null, id: string | null, reason?: string | null) =>
  asUser(db, who, (tx) =>
    reason === undefined
      ? one<{ id: string; ref_code: string }>(tx, "select * from public.admin_delete_public_inquiry($1)", [id])
      : one<{ id: string; ref_code: string }>(tx, "select * from public.admin_delete_public_inquiry($1, $2)", [id, reason]),
  );
const exists = async (id: string) => (await one<{ n: number }>(db, "select count(*)::int as n from public.public_inquiries where id = $1", [id])).n === 1;
const logs = async () =>
  (await db.query<{ rpc: string; params: Record<string, unknown>; row_count: number }>(
    "select rpc, params, row_count from public.admin_access_log where admin_id = $1 and rpc = 'admin_delete_public_inquiry' order by seq",
    [adminId],
  )).rows;

describe("권한", () => {
  it("함수 속성: 정의자·search_path 고정, 익명·PUBLIC 실행 불가, 로그인 역할만 실행 가능", async () => {
    const p = await one<{ definer: boolean; cfg: string[]; pub: boolean; anon: boolean; auth: boolean }>(
      db,
      `select p.prosecdef as definer, p.proconfig as cfg,
              exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') or p.proacl is null as pub,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
         from pg_proc p where p.oid = to_regprocedure($1)`,
      [FN],
    );
    expect(p).toEqual({ definer: true, cfg: ['search_path=""'], pub: false, anon: false, auth: true });
  });

  it("익명은 권한 없음, 일반 로그인은 FORBIDDEN — 행은 그대로, 기록 없음", async () => {
    const a = await submit();
    await expectDbError(del(null, a.id), /permission denied/);
    await expectDbError(del(ownerId, a.id), /FORBIDDEN/);
    await expectDbError(del(ownerId, a.id, "사유"), /FORBIDDEN/);
    expect(await exists(a.id)).toBe(true);
    // 표를 직접 지우는 길도 없다(기존 010000 권한)
    await expectDbError(asUser(db, ownerId, (tx) => tx.query("delete from public.public_inquiries where id = $1", [a.id])), /permission denied/);
    expect(await exists(a.id)).toBe(true);
  });
});

describe("관리자 삭제", () => {
  it("1건만 영구 삭제하고 id·참조 번호를 돌려준다. 다른 건과 상태별 개수는 그대로 맞다", async () => {
    const a = await submit();
    const b = await submit();
    const count = async () => (await asUser(db, adminId, (tx) => tx.query<{ status: string; total: number }>("select * from public.admin_public_inquiry_counts()"))).rows.find((r) => r.status === "new")!.total;
    const before = await count();
    const r = await del(adminId, a.id, "고객 삭제 요청");
    expect(r).toEqual({ id: a.id, ref_code: a.ref });
    expect(await exists(a.id)).toBe(false);
    expect(await exists(b.id)).toBe(true);
    expect(await count()).toBe(before - 1);
    const list = await asUser(db, adminId, (tx) => tx.query<{ ref_code: string }>("select ref_code from public.admin_list_public_inquiries(null, 200)"));
    expect(list.rows.map((x) => x.ref_code)).not.toContain(a.ref);
    expect(list.rows.map((x) => x.ref_code)).toContain(b.ref);
  });

  it("없는 id·이미 지운 id·null 은 NOT_FOUND", async () => {
    const a = await submit();
    await del(adminId, a.id);
    await expectDbError(del(adminId, a.id), /NOT_FOUND/);
    await expectDbError(del(adminId, randomUUID()), /NOT_FOUND/);
    await expectDbError(del(adminId, null), /NOT_FOUND/);
  });

  it("사유: 200자까지 저장, 201자는 VALIDATION(행 그대로), 빈칸·공백은 없음(null), 앞뒤 공백은 뗀다", async () => {
    const a = await submit();
    await expectDbError(del(adminId, a.id, "가".repeat(201)), /VALIDATION: 삭제 사유는 200자/);
    expect(await exists(a.id)).toBe(true);
    await del(adminId, a.id, ` ${"가".repeat(200)} `);
    const b = await submit();
    await del(adminId, b.id, "   ");
    const c = await submit();
    await del(adminId, c.id, null);
    const rows = await logs();
    const byRef = (ref: string) => rows.find((r) => r.params.ref_code === ref)!;
    expect(byRef(a.ref).params.reason).toBe("가".repeat(200));
    expect(byRef(b.ref).params.reason).toBeNull();
    expect(byRef(c.ref).params.reason).toBeNull();
  });

  it("감사 기록: action·참조 번호·사유만, 개인정보(이름·전화·내용·업체) 없음, 1건씩, 지울 수 없다", async () => {
    const a = await submit("감사이름검사", "010-8199-7777");
    const n0 = (await logs()).length;
    await del(adminId, a.id, "중복 접수");
    const rows = await logs();
    expect(rows).toHaveLength(n0 + 1);
    const last = rows.at(-1)!;
    expect(last.params).toEqual({ action: "public_inquiry_delete", ref_code: a.ref, reason: "중복 접수" });
    expect(last.row_count).toBe(1);
    const all = JSON.stringify(rows);
    for (const pii of ["감사이름검사", "010-8199-7777", "01081997777", "감사 기록에 남으면", "삭제 합성 상회"]) expect(all).not.toContain(pii);
    // 실패한 시도(권한 없음·NOT_FOUND)는 기록하지 않는다(트랜잭션이 함께 취소된다)
    await expectDbError(del(adminId, randomUUID()), /NOT_FOUND/);
    expect(await logs()).toHaveLength(n0 + 1);
    // 감사 기록은 관리자라도 바꾸거나 지울 수 없다(기존 트리거)
    await expectDbError(db.query("delete from public.admin_access_log where rpc = 'admin_delete_public_inquiry'"), /IMMUTABLE_ROW/);
  });
});

describe("기존 객체 무변경", () => {
  it("011000 은 010000 함수·표·권한을 바꾸지 않는다(적용 전·후 지문 동일)", async () => {
    const MIG = join(import.meta.dirname, "..", "..", "supabase", "migrations");
    const TARGET = "20261123011000_public_inquiry_admin_delete.sql";
    const pg = new PGlite();
    await pg.exec(readFileSync(join(import.meta.dirname, "supabase-shim.sql"), "utf8"));
    for (const f of migrationFiles()) {
      if (f >= TARGET) break;
      await pg.exec(readFileSync(join(MIG, f), "utf8"));
    }
    const print = async () =>
      JSON.stringify(
        (await pg.query(
          `select p.oid::regprocedure::text as sig, md5(p.prosrc) as src, coalesce(p.proacl::text, '-') as acl, p.prosecdef as d
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'app') and p.proname <> 'admin_delete_public_inquiry'
           union all
           select n.nspname || '.' || c.relname, coalesce(c.relacl::text, '-'), c.relrowsecurity::text, false
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname in ('public', 'app') and c.relkind in ('r', 'v', 'p')
           order by 1`,
        )).rows,
      );
    const before = await print();
    expect(await pg.query("select to_regprocedure($1) as f", [FN]).then((r) => (r.rows[0] as { f: unknown }).f)).toBeNull();
    await pg.exec(readFileSync(join(MIG, TARGET), "utf8"));
    expect(await print()).toBe(before);
    // 한 번 더 적용해도 오류 없이 같은 상태(create or replace)
    await pg.exec(readFileSync(join(MIG, TARGET), "utf8"));
    expect(await print()).toBe(before);
    expect(await pg.query("select to_regprocedure($1) as f", [FN]).then((r) => (r.rows[0] as { f: unknown }).f)).not.toBeNull();

    // 되돌림 키트(INQUIRY_DELETE_KIT=Plan/Claude-Backend-20261123/NADAUM-INQUIRY-DELETE-BACKEND-01 일 때만): 함수만 사라지고 나머지·데이터는 그대로
    const KIT = process.env.INQUIRY_DELETE_KIT;
    if (KIT) {
      await pg.query(
        `insert into public.public_inquiries (ref_code, company_name, contact_name, phone, phone_digits, services, message, privacy_consent_at, consent_version, client_hash)
         values ('ND-261124-BBBBBB', '합성', '합성', '010-0000-0000', '01000000000', array['homepage'], '합성', now(), 'v', repeat('b', 64))`,
      );
      await pg.exec(readFileSync(join(KIT, "rollback_011000.sql"), "utf8"));
      expect(await pg.query("select to_regprocedure($1) as f", [FN]).then((r) => (r.rows[0] as { f: unknown }).f)).toBeNull();
      expect(await print()).toBe(before);
      expect((await pg.query<{ n: number }>("select count(*)::int as n from public.public_inquiries")).rows[0]!.n).toBe(1);
      // 되돌린 뒤 다시 적용해도 같다
      await pg.exec(readFileSync(join(MIG, TARGET), "utf8"));
      expect(await print()).toBe(before);
    }
    await pg.close();
  }, 120_000);
});
