import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** NADAUM-BRAND-BACKEND-01 공개 상담 서버 함수: 사람 확인·입력 검사·서명·오류 변환(흉내 클라이언트). DB 규칙은 tests/db/public-inquiries.test.ts */
const st = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  result: { data: null as unknown, error: null as unknown },
  headers: new Map<string, string>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => st.headers.get(k) ?? null }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      st.calls.push({ fn, args });
      return st.result;
    },
  }),
}));
const { submitPublicInquiry, submitPublicInquiryFromRequest, submitErrorFromDb, clientIpFrom, clientHashOf, MIN_FILL_MS } = await import("./server");
const { normalizePublicInquiryInput, validatePublicInquiry, serviceLabel, PUBLIC_INQUIRY_CONSENT_VERSION } = await import("./contract");

const KEY = "unit-test-signing-key-0123456789abcdef";
const input = () => ({
  company_name: " 합성 상회 ",
  contact_name: "합성 담당",
  phone: "010-1234-5678",
  services: ["로고 제작", "홈페이지 제작"],
  other_service: "무시될 값",
  message: "합성 요청",
  reference_url: "",
  desired_timeline: "",
  budget_range: "",
  privacy_consent: true,
});
const NOW = 1_800_000_000_000;

beforeEach(() => {
  process.env.PUBLIC_INQUIRY_SIGNING_KEY = KEY;
  st.calls.length = 0;
  st.result = { data: [{ ref_code: "ND-261123-ABC123", created_at: "2026-11-23T12:00:00+00:00" }], error: null };
  st.headers = new Map();
});
afterEach(() => {
  delete process.env.PUBLIC_INQUIRY_SIGNING_KEY;
  vi.restoreAllMocks();
});

describe("submitPublicInquiry", () => {
  it("서명 키가 없으면 접수하지 않는다(unavailable, DB 호출 없음)", async () => {
    delete process.env.PUBLIC_INQUIRY_SIGNING_KEY;
    const r = await submitPublicInquiry(input(), { ip: "198.51.100.1", now: NOW });
    expect(r).toMatchObject({ ok: false, reason: "unavailable" });
    expect(st.calls).toHaveLength(0);
  });

  it("허니팟이 차 있거나 너무 빨리 제출하면 저장하지 않는다(가짜 성공 없음)", async () => {
    expect(await submitPublicInquiry(input(), { ip: "x", honeypot: "bot", now: NOW })).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(await submitPublicInquiry(input(), { ip: "x", startedAt: NOW - MIN_FILL_MS + 1, now: NOW })).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(st.calls).toHaveLength(0);
    expect(await submitPublicInquiry(input(), { ip: "x", startedAt: NOW - MIN_FILL_MS, now: NOW })).toMatchObject({ ok: true });
  });

  it("입력 오류는 DB 를 부르지 않고 칸별 문구를 돌려준다", async () => {
    const r = await submitPublicInquiry({ ...input(), phone: "123", services: [], privacy_consent: false }, { ip: "x", now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "validation") expect(Object.keys(r.fieldErrors).sort()).toEqual(["phone", "privacy_consent", "services"]);
    else throw new Error("validation 이어야 함");
    expect(st.calls).toHaveLength(0);
  });

  it("정상: 정리된 payload·접속자 구분값·서명을 보내고 참조 번호를 돌려준다", async () => {
    const r = await submitPublicInquiry(input(), { ip: "198.51.100.7", now: NOW });
    expect(r).toEqual({ ok: true, refCode: "ND-261123-ABC123", receivedAt: "2026-11-23T12:00:00+00:00" });
    expect(st.calls).toHaveLength(1);
    const { fn, args } = st.calls[0]!;
    expect(fn).toBe("submit_public_inquiry");
    const payload = JSON.parse(String(args.p_payload));
    expect(payload).toEqual({
      company_name: "합성 상회",
      contact_name: "합성 담당",
      phone: "010-1234-5678",
      services: ["홈페이지 제작", "로고 제작"],
      other_service: "",
      message: "합성 요청",
      reference_url: "",
      desired_timeline: "",
      budget_range: "",
      privacy_consent: true,
      consent_version: PUBLIC_INQUIRY_CONSENT_VERSION,
    });
    const clientHash = createHmac("sha256", KEY).update("client|198.51.100.7").digest("hex");
    expect(args.p_client_hash).toBe(clientHash);
    expect(String(args.p_client_hash)).not.toContain("198.51.100.7");
    expect(args.p_signed_at).toBe(NOW);
    const expected = createHmac("sha256", KEY)
      .update(`public_inquiry_submit|${NOW}|${String(args.p_nonce)}|${clientHash}|${String(args.p_payload)}`)
      .digest("hex");
    expect(args.p_signature).toBe(expected);
  });

  it("DB 결과가 비면 error", async () => {
    st.result = { data: [], error: null };
    expect(await submitPublicInquiry(input(), { ip: "x", now: NOW })).toMatchObject({ ok: false, reason: "error" });
  });

  it("DB 오류 변환, 서버 기록에 개인정보가 남지 않는다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    st.result = { data: null, error: { code: "42501", message: "BAD_SIGNATURE: 서버 서명이 맞지 않습니다" } };
    expect(await submitPublicInquiry(input(), { ip: "x", now: NOW })).toMatchObject({ ok: false, reason: "unavailable" });
    const logged = JSON.stringify(spy.mock.calls);
    for (const pii of ["합성 상회", "합성 담당", "010-1234-5678", "합성 요청"]) expect(logged).not.toContain(pii);
  });

  it("요청 머리글의 첫 x-forwarded-for 를 접속자로 쓴다", async () => {
    st.headers = new Map([["x-forwarded-for", "203.0.113.9, 10.0.0.1"]]);
    await submitPublicInquiryFromRequest(input());
    expect(st.calls[0]!.args.p_client_hash).toBe(clientHashOf(KEY, "203.0.113.9"));
  });
});

describe("submitErrorFromDb", () => {
  it("VALIDATION 칸 이름 → 그 칸 문구", () => {
    expect(submitErrorFromDb({ message: "VALIDATION: phone: 연락 가능한 전화번호를 숫자로 입력해 주세요" })).toEqual({
      ok: false,
      reason: "validation",
      message: "입력 내용을 확인해 주세요.",
      fieldErrors: { phone: "연락 가능한 전화번호를 숫자로 입력해 주세요" },
    });
    expect(submitErrorFromDb({ message: "VALIDATION: 접수 내용 형식이 올바르지 않습니다" })).toMatchObject({ reason: "validation", fieldErrors: {} });
  });
  it("RATE_LIMITED → 한국어 문구 그대로, 그 밖은 일반 문구", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(submitErrorFromDb({ message: "RATE_LIMITED: 같은 연락처로는 오늘 더 접수할 수 없습니다" })).toEqual({
      ok: false,
      reason: "rate_limited",
      message: "같은 연락처로는 오늘 더 접수할 수 없습니다",
    });
    expect(submitErrorFromDb({ message: "NOT_CONFIGURED: x" })).toMatchObject({ reason: "unavailable" });
    expect(submitErrorFromDb({ code: "XX000", message: "boom" })).toMatchObject({ reason: "error" });
  });
});

describe("contract", () => {
  it("clientIpFrom: x-forwarded-for → x-real-ip → unknown", () => {
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
    expect(clientIpFrom(h({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientIpFrom(h({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIpFrom(h({}))).toBe("unknown");
  });
  it("normalize: 서비스 중복 제거·화면 순서, 기타를 안 고르면 기타 내용 비움, 동의는 true 만", () => {
    const v = normalizePublicInquiryInput({ services: ["기타", "홈페이지 제작", "기타"], other_service: " x ", privacy_consent: "true" });
    expect(v.services).toEqual(["홈페이지 제작", "기타"]);
    expect(v.other_service).toBe("x");
    expect(v.privacy_consent).toBe(false);
    expect(normalizePublicInquiryInput(null).services).toEqual([]);
  });
  it("validate: 모르는 서비스, 경계 길이", () => {
    const ok = normalizePublicInquiryInput({ ...input(), company_name: "가".repeat(80), message: "가".repeat(2000) });
    expect(validatePublicInquiry(ok)).toEqual({});
    const bad = normalizePublicInquiryInput({ ...input(), services: ["해킹"], reference_url: "ftp://x" });
    expect(Object.keys(validatePublicInquiry(bad)).sort()).toEqual(["reference_url", "services"]);
  });
  it("상태 표시 이름은 AGY 확정값(r2)", async () => {
    const { PUBLIC_INQUIRY_STATUS_LABELS } = await import("./contract");
    expect(PUBLIC_INQUIRY_STATUS_LABELS).toEqual({ new: "신규", contacted: "연락함", quoted: "견적 발송", closed: "종료" });
  });
  it("serviceLabel: 코드 → 표시값", () => {
    expect(serviceLabel("ad_image")).toBe("광고·상품 이미지");
    expect(serviceLabel("unknown")).toBe("unknown");
  });
});
