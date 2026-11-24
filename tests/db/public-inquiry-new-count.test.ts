// ADMIN-INQUIRY-COUNT-LITE-01 (20261123012000): 관리자 배지용 신규 건수 함수 — 기록 없음·관리자만(합성 데이터)
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
import { PUBLIC_INQUIRY_CONSENT_VERSION } from "@/features/public-inquiries/contract";
import { clientHashOf, signPublicInquiry } from "@/features/public-inquiries/server";
import { asUser, createDb, expectDbError, one, seedOwner, type Db } from "./harness";

const FN = "public.admin_public_inquiry_new_count()";
let db: Db;
let key: string;
let adminId: string;
let ownerId: string;
beforeAll(async () => {
  db = await createDb();
  key = (await one<{ v: string }>(db, "select value as v from app.server_secrets where name = 'public_inquiry_signing'")).v;
  adminId = (await seedOwner(db, "pinc-admin@example.test")).userId;
  await db.query("insert into app.admins (user_id, note) values ($1, '합성 관리자')", [adminId]);
  ownerId = (await seedOwner(db, "pinc-owner@example.test")).userId;
}, 60_000);

let seq = 0;
/** 서버와 같은 방식으로 서명해 익명 접수 1건(합성 값) */
async function submit() {
  seq++;
  const payload = JSON.stringify({
    company_name: "건수 합성 상회", contact_name: "건수검사", phone: `010-8200-${String(seq).padStart(4, "0")}`, services: ["로고 제작"], other_service: "",
    message: "합성 요청 내용", reference_url: "", desired_timeline: "", budget_range: "",
    privacy_consent: true, consent_version: PUBLIC_INQUIRY_CONSENT_VERSION,
  });
  const client = clientHashOf(key, `198.51.100.${seq}`);
  const at = Date.now();
  const nonce = randomUUID();
  const r = await asUser(db, null, (tx) =>
    one<{ ref_code: string }>(tx, "select * from public.submit_public_inquiry($1, $2, $3, $4, $5)", [payload, client, at, nonce, signPublicInquiry(key, at, nonce, client, payload)]),
  );
  return (await one<{ id: string }>(db, "select id from public.public_inquiries where ref_code = $1", [r.ref_code])).id;
}
const newCount = (who: string | null) => asUser(db, who, (tx) => one<{ n: number }>(tx, "select public.admin_public_inquiry_new_count() as n"));
const logRows = async () => (await one<{ n: number }>(db, "select count(*)::int as n from public.admin_access_log")).n;

describe("admin_public_inquiry_new_count", () => {
  it("함수 속성: 정의자·search_path 고정·stable, 익명·PUBLIC 실행 불가, 로그인 역할만", async () => {
    const p = await one<{ definer: boolean; cfg: string[]; vol: string; pub: boolean; anon: boolean; auth: boolean; ret: string }>(
      db,
      `select p.prosecdef as definer, p.proconfig as cfg, p.provolatile as vol, pg_get_function_result(p.oid) as ret,
              exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub,
              has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.oid = '${FN}'::regprocedure`,
    );
    expect(p).toEqual({ definer: true, cfg: ['search_path=""'], vol: "s", ret: "integer", pub: false, anon: false, auth: true });
  });

  it("관리자: 신규(new) 건수만 센다(상태 4종 섞음)", async () => {
    const base = (await newCount(adminId)).n;
    const ids = [await submit(), await submit(), await submit(), await submit(), await submit()];
    await db.query("update public.public_inquiries set status = 'contacted' where id = $1", [ids[0]]);
    await db.query("update public.public_inquiries set status = 'quoted' where id = $1", [ids[1]]);
    await db.query("update public.public_inquiries set status = 'closed' where id = $1", [ids[2]]);
    expect((await newCount(adminId)).n).toBe(base + 2);
    // 상태별 건수 함수의 new 와 같다
    const counts = await asUser(db, adminId, (tx) => tx.query<{ status: string; total: number }>("select * from public.admin_public_inquiry_counts()"));
    expect(counts.rows.find((r) => r.status === "new")!.total).toBe(base + 2);
  });

  it("감사 기록을 남기지 않는다(부르기 전후 admin_access_log 행 수 같음), 기존 상태별 건수 함수는 그대로 1줄", async () => {
    const before = await logRows();
    for (let i = 0; i < 3; i++) await newCount(adminId);
    expect(await logRows()).toBe(before);
    await asUser(db, adminId, (tx) => tx.query("select * from public.admin_public_inquiry_counts()"));
    expect(await logRows()).toBe(before + 1);
  });

  it("관리자 아님·익명은 거절", async () => {
    await expectDbError(newCount(ownerId), /FORBIDDEN/);
    await expectDbError(newCount(null), /permission denied/);
  });
});
