// NADAUM-BRAND-BACKEND-01 (20261123010000): 공개 상담 저장·서명·제출 제한·관리자 계약(합성 데이터)
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
import { PUBLIC_INQUIRY_CONSENT_VERSION } from "@/features/public-inquiries/contract";
import { clientHashOf, signPublicInquiry } from "@/features/public-inquiries/server";
import { DENIED, asUser, createDb, expectDbError, one, seedOwner, type Db } from "./harness";

let db: Db;
let key: string;
beforeAll(async () => {
  db = await createDb();
  key = (await one<{ v: string }>(db, "select value as v from app.server_secrets where name = 'public_inquiry_signing'")).v;
}, 60_000);

const base = () => ({
  company_name: "합성 상회",
  contact_name: "합성 담당",
  phone: "010-1234-5678",
  services: ["홈페이지 제작", "로고 제작"],
  other_service: "",
  message: "합성 요청 내용입니다.",
  reference_url: "",
  desired_timeline: "",
  budget_range: "",
  privacy_consent: true,
  consent_version: PUBLIC_INQUIRY_CONSENT_VERSION,
});

type Payload = ReturnType<typeof base>;
let ipSeq = 0;
const freshClient = () => clientHashOf(key, `198.51.100.${++ipSeq}`);

/** 서버와 같은 방식으로 서명해 RPC 를 부른다. role 기본 익명 */
async function submit(
  d: Partial<Payload> | string,
  o: { client?: string; signedAt?: number; nonce?: string; sig?: string; userId?: string | null; on?: Db } = {},
) {
  const target = o.on ?? db;
  const payload = typeof d === "string" ? d : JSON.stringify({ ...base(), ...d });
  const client = o.client ?? freshClient();
  const at = o.signedAt ?? Date.now();
  const nonce = o.nonce ?? randomUUID();
  const sig = o.sig ?? signPublicInquiry(key, at, nonce, client, payload);
  return asUser(target, o.userId ?? null, (tx) =>
    one<{ ref_code: string; created_at: string }>(tx, "select * from public.submit_public_inquiry($1, $2, $3, $4, $5)", [payload, client, at, nonce, sig]),
  );
}

describe("공개 상담 표 접근", () => {
  it("익명·로그인 역할은 표를 직접 읽거나 쓸 수 없다", async () => {
    const owner = await seedOwner(db, "pi-direct@example.test");
    for (const uid of [null, owner.userId]) {
      await expectDbError(asUser(db, uid, (tx) => tx.query("select id from public.public_inquiries")), DENIED);
      await expectDbError(
        asUser(db, uid, (tx) => tx.query("insert into public.public_inquiries (ref_code) values ('ND-000000-000000')")),
        DENIED,
      );
    }
  });

  it("내부 도우미·일회용 번호 표·비밀값은 익명·로그인 역할이 쓸 수 없다", async () => {
    for (const sql of [
      "select app.public_inquiry_limit('global_hour')",
      "select app.public_inquiry_service_code('기타')",
      "select * from app.public_inquiry_nonces",
      "select * from app.server_secrets",
    ]) {
      await expectDbError(asUser(db, null, (tx) => tx.query(sql)), /permission denied/);
    }
  });
});

describe("접수 서명", () => {
  it("정상: 익명·로그인 모두 접수되고 참조 번호·코드·동의 시각이 저장된다", async () => {
    const r = await submit({ services: ["로고 제작", "홈페이지 제작", "로고 제작"], company_name: "  합성 상회  " });
    expect(r.ref_code).toMatch(/^ND-\d{6}-[0-9A-F]{6}$/);
    const row = await one<Record<string, unknown>>(
      db,
      "select company_name, services, other_service, privacy_consent_at is not null as consent, consent_version, status, phone_digits from public.public_inquiries where ref_code = $1",
      [r.ref_code],
    );
    expect(row).toEqual({
      company_name: "합성 상회",
      services: ["homepage", "logo"],
      other_service: null,
      consent: true,
      consent_version: PUBLIC_INQUIRY_CONSENT_VERSION,
      status: "new",
      phone_digits: "01012345678",
    });
    const owner = await seedOwner(db, "pi-logged-in@example.test");
    await submit({ phone: "010-2222-0001" }, { userId: owner.userId });
  });

  it("서명이 없거나 틀리거나, 오래됐거나, 같은 요청을 다시 보내면 거절", async () => {
    await expectDbError(submit({ phone: "010-2222-0002" }, { sig: "" }), /BAD_SIGNATURE/);
    await expectDbError(submit({ phone: "010-2222-0002" }, { sig: "0".repeat(64) }), /BAD_SIGNATURE/);
    // 내용을 바꾸면 서명이 맞지 않는다
    const client = freshClient();
    const at = Date.now();
    const nonce = randomUUID();
    const sig = signPublicInquiry(key, at, nonce, client, JSON.stringify(base()));
    await expectDbError(submit({ ...base(), message: "바뀐 내용" }, { client, signedAt: at, nonce, sig }), /BAD_SIGNATURE/);
    await expectDbError(submit({ phone: "010-2222-0003" }, { signedAt: Date.now() - 6 * 60_000 }), /BAD_SIGNATURE: 서명 시각/);
    const once = randomUUID();
    const c2 = freshClient();
    await submit({ phone: "010-2222-0004" }, { nonce: once, client: c2 });
    await expectDbError(submit({ phone: "010-2222-0004" }, { nonce: once, client: c2 }), /BAD_SIGNATURE: 이미 처리한 요청/);
  });
});

describe("입력 검증(칸 이름이 오류에 붙는다, 입력값은 문구에 없다)", () => {
  const cases: Array<[string, Partial<Payload> | Record<string, unknown>, RegExp]> = [
    ["업체명 빈칸", { company_name: "   " }, /VALIDATION: company_name:/],
    ["업체명 81자", { company_name: "가".repeat(81) }, /VALIDATION: company_name:/],
    ["담당자 41자", { contact_name: "가".repeat(41) }, /VALIDATION: contact_name:/],
    ["전화 글자", { phone: "공일공-1234" }, /VALIDATION: phone:/],
    ["전화 7자리", { phone: "123-4567" }, /VALIDATION: phone:/],
    ["전화 16자리", { phone: "1234567890123456" }, /VALIDATION: phone:/],
    ["URL 형식", { reference_url: "javascript:alert(1)" }, /VALIDATION: reference_url:/],
    ["URL 301자", { reference_url: "https://a.test/" + "a".repeat(290) }, /VALIDATION: reference_url:/],
    ["서비스 없음", { services: [] }, /VALIDATION: services:/],
    ["서비스 배열 아님", { services: "홈페이지 제작" }, /VALIDATION: services:/],
    ["모르는 서비스", { services: ["홈페이지 제작", "해킹"] }, /VALIDATION: services: 알 수 없는/],
    ["기타인데 내용 없음", { services: ["기타"], other_service: " " }, /VALIDATION: other_service:/],
    ["내용 없음", { message: "" }, /VALIDATION: message:/],
    ["내용 2001자", { message: "가".repeat(2001) }, /VALIDATION: message:/],
    ["일정 81자", { desired_timeline: "가".repeat(81) }, /VALIDATION: desired_timeline:/],
    ["예산 81자", { budget_range: "가".repeat(81) }, /VALIDATION: budget_range:/],
    ["동의 안 함", { privacy_consent: false }, /VALIDATION: privacy_consent:/],
    ["동의 글자 true", { privacy_consent: "true" }, /VALIDATION: privacy_consent:/],
    ["동의 판 없음", { consent_version: "" }, /VALIDATION: consent_version:/],
  ];
  for (const [name, patch, re] of cases) {
    it(name, async () => {
      await expectDbError(submit(patch as Partial<Payload>), re);
    });
  }

  it("JSON 아님·객체 아님", async () => {
    await expectDbError(submit("not json"), /VALIDATION: 접수 내용 형식/);
    await expectDbError(submit("[1,2]"), /VALIDATION: 접수 내용 형식/);
  });

  it("기타를 고르면 기타 내용 저장, 기타를 안 고르면 기타 내용은 버린다. 선택 칸 빈칸은 null", async () => {
    const a = await submit({ services: ["기타", "SNS 콘텐츠"], other_service: " 브로슈어 " });
    const b = await submit({ services: ["SNS 콘텐츠"], other_service: "무시될 값", reference_url: "https://ref.example.test/a" });
    const rows = await db.query<Record<string, unknown>>(
      "select ref_code, services, other_service, reference_url, desired_timeline from public.public_inquiries where ref_code = any($1) order by ref_code",
      [[a.ref_code, b.ref_code]],
    );
    const byRef = Object.fromEntries(rows.rows.map((r) => [r.ref_code, r]));
    expect(byRef[a.ref_code]).toMatchObject({ services: ["sns_content", "other"], other_service: "브로슈어", reference_url: null, desired_timeline: null });
    expect(byRef[b.ref_code]).toMatchObject({ services: ["sns_content"], other_service: null, reference_url: "https://ref.example.test/a" });
  });

  it("오류 문구에 입력값(전화·이름)이 들어가지 않는다", async () => {
    try {
      await submit({ contact_name: "가".repeat(41), phone: "010-9999-0000" });
      throw new Error("거절되어야 함");
    } catch (e) {
      const m = (e as Error).message;
      expect(m).not.toContain("010-9999-0000");
      expect(m).not.toContain("가".repeat(41));
    }
  });
});

describe("제출 제한", () => {
  it("같은 접속자: 10분에 3건까지", async () => {
    const client = freshClient();
    for (let i = 0; i < 3; i++) await submit({ phone: `010-3000-000${i}` }, { client });
    await expectDbError(submit({ phone: "010-3000-0009" }, { client }), /RATE_LIMITED: 잠시 후/);
    await submit({ phone: "010-3000-0010" }); // 다른 접속자는 된다
  });

  it("같은 접속자: 하루 10건까지(10분 넘은 것 포함)", async () => {
    const client = freshClient();
    await db.query(
      `insert into public.public_inquiries (ref_code, company_name, contact_name, phone, phone_digits, services, message, privacy_consent_at, consent_version, client_hash, created_at)
       select 'ND-000000-' || upper(lpad(to_hex(g + 4096), 6, '0')), '합성', '합성', '010-4000-' || lpad(g::text, 4, '0'), '0104000' || lpad(g::text, 4, '0'),
              array['homepage'], '합성', now(), 'v', $1, now() - interval '2 hours'
         from generate_series(1, 10) g`,
      [client],
    );
    await expectDbError(submit({ phone: "010-4000-9999" }, { client }), /RATE_LIMITED: 오늘은/);
  });

  it("같은 전화번호(숫자 기준): 하루 3건까지, 표기가 달라도 같은 번호", async () => {
    for (const p of ["010-5000-0001", "01050000001", "010 5000 0001"]) await submit({ phone: p });
    await expectDbError(submit({ phone: "(010)5000-0001" }), /RATE_LIMITED: 같은 연락처/);
  });

  it("잠금 순서: 접속자 → 전화 → 전역, 전역 잠금이 전체 건수 세기보다 앞(F1 r2, 동시성 자체는 PG17 Tester 재검)", async () => {
    const src = (await one<{ s: string }>(
      db,
      "select prosrc as s from pg_proc where oid = 'public.submit_public_inquiry(text, text, bigint, uuid, text)'::regprocedure",
    )).s;
    const at = (needle: string) => src.indexOf(needle);
    const client = at("'public_inquiry_client:'");
    const phone = at("'public_inquiry_phone:'");
    const global = at("'public_inquiry_global'");
    const globalCount = at("interval '1 hour'");
    expect(client).toBeGreaterThan(0);
    expect(phone).toBeGreaterThan(client);
    expect(global).toBeGreaterThan(phone);
    expect(globalCount).toBeGreaterThan(global);
  });

  it("전체: 1시간 60건까지 — 별도 DB, 서명 키가 없으면 NOT_CONFIGURED", async () => {
    const own = await createDb();
    const ownKey = (await one<{ v: string }>(own, "select value as v from app.server_secrets where name = 'public_inquiry_signing'")).v;
    await own.query(
      `insert into public.public_inquiries (ref_code, company_name, contact_name, phone, phone_digits, services, message, privacy_consent_at, consent_version, client_hash, created_at)
       select 'ND-000000-' || upper(lpad(to_hex(g), 6, '0')), '합성', '합성', '010-6000-' || lpad(g::text, 4, '0'), '0106000' || lpad(g::text, 4, '0'),
              array['homepage'], '합성', now(), 'v', repeat('a', 64), now() - interval '10 minutes'
         from generate_series(1, 60) g`,
    );
    const payload = JSON.stringify(base());
    const client = clientHashOf(ownKey, "203.0.113.1");
    const at = Date.now();
    const nonce = randomUUID();
    await expectDbError(
      asUser(own, null, (tx) =>
        tx.query("select * from public.submit_public_inquiry($1, $2, $3, $4, $5)", [payload, client, at, nonce, signPublicInquiry(ownKey, at, nonce, client, payload)]),
      ),
      /RATE_LIMITED: 지금 접수가 많습니다/,
    );
    await own.query("delete from app.server_secrets where name = 'public_inquiry_signing'");
    await expectDbError(
      asUser(own, null, (tx) => tx.query("select * from public.submit_public_inquiry($1, $2, $3, $4, $5)", [payload, client, at, randomUUID(), "x"])),
      /NOT_CONFIGURED/,
    );
  }, 120_000);
});

describe("관리자 계약", () => {
  it("관리자만: 익명은 권한 없음, 일반 로그인은 FORBIDDEN", async () => {
    const owner = await seedOwner(db, "pi-not-admin@example.test");
    for (const sql of [
      "select * from public.admin_list_public_inquiries()",
      "select * from public.admin_public_inquiry_counts()",
      `select * from public.admin_set_public_inquiry_status('${randomUUID()}', 'closed', 'new')`,
    ]) {
      await expectDbError(asUser(db, null, (tx) => tx.query(sql)), /permission denied/);
      await expectDbError(asUser(db, owner.userId, (tx) => tx.query(sql)), /FORBIDDEN/);
    }
  });

  it("목록·상태별 개수·상태 변경·충돌·열람 기록(개인정보 없음)", async () => {
    const admin = await seedOwner(db, "pi-admin@example.test");
    await db.query("insert into app.admins (user_id, note) values ($1, '합성 관리자')", [admin.userId]);
    const mine = await submit({ phone: "010-7000-0001", contact_name: "기록검사", message: "기록에 남으면 안 되는 내용" });

    const list = await asUser(db, admin.userId, (tx) =>
      tx.query<Record<string, unknown>>("select * from public.admin_list_public_inquiries('new', 200)"),
    );
    const hit = list.rows.find((r) => r.ref_code === mine.ref_code)!;
    expect(hit).toMatchObject({ status: "new", contact_name: "기록검사", phone: "010-7000-0001", services: ["homepage", "logo"] });
    expect(Object.keys(hit)).not.toContain("client_hash");
    expect(Object.keys(hit)).not.toContain("phone_digits");

    const before = await asUser(db, admin.userId, (tx) => tx.query<{ status: string; total: number }>("select * from public.admin_public_inquiry_counts()"));
    expect(before.rows.map((r) => r.status)).toEqual(["new", "contacted", "quoted", "closed"]);

    const id = String(hit.id);
    await expectDbError(
      asUser(db, admin.userId, (tx) => tx.query("select * from public.admin_set_public_inquiry_status($1, 'contacted', 'quoted')", [id])),
      /CONFLICT/,
    );
    const changed = await asUser(db, admin.userId, (tx) =>
      one<{ status: string; status_changed_at: string | null }>(tx, "select * from public.admin_set_public_inquiry_status($1, 'contacted', 'new')", [id]),
    );
    expect(changed.status).toBe("contacted");
    expect(changed.status_changed_at).not.toBeNull();
    await expectDbError(
      asUser(db, admin.userId, (tx) => tx.query("select * from public.admin_set_public_inquiry_status($1, 'bogus', 'contacted')", [id])),
      /VALIDATION/,
    );
    await expectDbError(
      asUser(db, admin.userId, (tx) => tx.query("select * from public.admin_set_public_inquiry_status($1, 'closed', 'new')", [randomUUID()])),
      /NOT_FOUND/,
    );
    const after = await asUser(db, admin.userId, (tx) => tx.query<{ status: string; total: number }>("select * from public.admin_public_inquiry_counts()"));
    const n = (rows: Array<{ status: string; total: number }>, s: string) => rows.find((r) => r.status === s)!.total;
    expect(n(after.rows, "contacted")).toBe(n(before.rows, "contacted") + 1);

    const logs = await db.query<{ rpc: string; params: unknown }>(
      "select rpc, params from public.admin_access_log where admin_id = $1 order by seq",
      [admin.userId],
    );
    expect(logs.rows.map((r) => r.rpc)).toEqual(
      expect.arrayContaining(["admin_list_public_inquiries", "admin_public_inquiry_counts", "admin_set_public_inquiry_status"]),
    );
    const all = JSON.stringify(logs.rows);
    for (const pii of ["기록검사", "010-7000-0001", "01070000001", "기록에 남으면"]) expect(all).not.toContain(pii);
  });

  it("목록 쪽 나눔: 커서 다음 쪽은 겹치지 않는다", async () => {
    const admin = await seedOwner(db, "pi-admin-page@example.test");
    await db.query("insert into app.admins (user_id, note) values ($1, '합성 관리자')", [admin.userId]);
    const page1 = await asUser(db, admin.userId, (tx) =>
      tx.query<{ id: string; created_at: string }>("select id, created_at::text as created_at from public.admin_list_public_inquiries(null, 2)"),
    );
    expect(page1.rows).toHaveLength(2);
    const last = page1.rows[1]!;
    const page2 = await asUser(db, admin.userId, (tx) =>
      tx.query<{ id: string }>("select id from public.admin_list_public_inquiries(null, 2, $1, $2)", [last.created_at, last.id]),
    );
    expect(page2.rows.length).toBeGreaterThan(0);
    expect(page2.rows.map((r) => r.id)).not.toContain(page1.rows[0]!.id);
    expect(page2.rows.map((r) => r.id)).not.toContain(last.id);
  });
});
