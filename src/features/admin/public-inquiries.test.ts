import { beforeEach, describe, expect, it, vi } from "vitest";

/** NADAUM-BRAND-BACKEND-01 관리자 공개 상담 함수: RPC 결과 변환·거절 숨김·충돌(흉내 클라이언트). DB 규칙은 tests/db/public-inquiries.test.ts */
const st = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
  result: {} as Record<string, { data: unknown; error: unknown }>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      st.calls.push({ fn, args });
      return st.result[fn] ?? { data: null, error: null };
    },
  }),
}));
const { listAdminPublicInquiries, countAdminPublicInquiries, countAdminNewPublicInquiries, setAdminPublicInquiryStatus } = await import("./server");

const row = (i: number) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  ref_code: `ND-261123-00000${i}`,
  created_at: `2026-11-23T0${i}:00:00.123456+00:00`,
  status: "new",
  company_name: "합성",
  contact_name: "합성",
  phone: "010-0000-0000",
  services: ["homepage", "other"],
  other_service: "기타 내용",
  message: "내용",
  reference_url: null,
  desired_timeline: null,
  budget_range: "100만 원",
  privacy_consent_at: "2026-11-23T00:00:00+00:00",
  consent_version: "privacy-v1-20261123",
  status_changed_at: null,
  updated_at: "2026-11-23T00:00:00+00:00",
});

beforeEach(() => {
  st.calls.length = 0;
  st.result = {};
});

describe("listAdminPublicInquiries", () => {
  it("행 변환·표시값·다음 쪽 커서(마이크로초 글자 그대로)", async () => {
    st.result.admin_list_public_inquiries = { data: [row(1), row(2)], error: null };
    const r = await listAdminPublicInquiries({ status: "new", limit: 2 });
    expect(st.calls[0]).toEqual({
      fn: "admin_list_public_inquiries",
      args: { p_status: "new", p_limit: 2, p_before_created: null, p_before_id: null },
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.data.rows[0]).toMatchObject({ refCode: "ND-261123-000001", serviceLabels: ["홈페이지 제작", "기타"], referenceUrl: null, budgetRange: "100만 원" });
    expect(r.data.next).toEqual({ beforeCreated: "2026-11-23T02:00:00.123456+00:00", beforeId: row(2).id });
  });
  it("한 쪽이 덜 차면 다음 쪽 없음, 모르는 상태는 DB 를 부르지 않는다", async () => {
    st.result.admin_list_public_inquiries = { data: [row(1)], error: null };
    const r = await listAdminPublicInquiries({ limit: 2 });
    expect(r.ok && r.data.next).toBe(null);
    const bad = await listAdminPublicInquiries({ status: "bogus" as never });
    expect(bad).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(st.calls).toHaveLength(1);
  });
  it("관리자가 아니면 NOT_FOUND(화면이 있다는 것도 숨김)", async () => {
    st.result.admin_list_public_inquiries = { data: null, error: { code: "42501", message: "FORBIDDEN: 관리자만 볼 수 있습니다" } };
    expect(await listAdminPublicInquiries()).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("countAdminPublicInquiries", () => {
  it("없는 상태도 0", async () => {
    st.result.admin_public_inquiry_counts = { data: [{ status: "new", total: 3 }, { status: "closed", total: 1 }], error: null };
    const r = await countAdminPublicInquiries();
    expect(r).toEqual({ ok: true, data: { new: 3, contacted: 0, quoted: 0, closed: 1 } });
  });
});

describe("countAdminNewPublicInquiries (배지, 기록 없는 함수)", () => {
  it("숫자 변환, 비정상 값은 0, 오류는 ERROR", async () => {
    st.result.admin_public_inquiry_new_count = { data: 5, error: null };
    expect(await countAdminNewPublicInquiries()).toEqual({ ok: true, data: 5 });
    expect(st.calls.at(-1)).toEqual({ fn: "admin_public_inquiry_new_count", args: undefined });
    for (const v of [null, -3, "x"]) {
      st.result.admin_public_inquiry_new_count = { data: v, error: null };
      expect(await countAdminNewPublicInquiries()).toEqual({ ok: true, data: 0 });
    }
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    st.result.admin_public_inquiry_new_count = { data: null, error: { code: "XX000", message: "boom" } };
    expect(await countAdminNewPublicInquiries()).toMatchObject({ ok: false });
    err.mockRestore();
  });
});

describe("setAdminPublicInquiryStatus", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("성공 변환", async () => {
    st.result.admin_set_public_inquiry_status = { data: [{ status: "contacted", status_changed_at: "t1", updated_at: "t2" }], error: null };
    const r = await setAdminPublicInquiryStatus({ id, status: "contacted", expectedStatus: "new" });
    expect(r).toEqual({ ok: true, data: { status: "contacted", statusChangedAt: "t1", updatedAt: "t2" } });
    expect(st.calls[0]!.args).toEqual({ p_id: id, p_status: "contacted", p_expected_status: "new" });
  });
  it("CONFLICT·NOT_FOUND·FORBIDDEN 변환, 잘못된 입력은 DB 호출 없음", async () => {
    st.result.admin_set_public_inquiry_status = { data: null, error: { code: "P0001", message: "CONFLICT: 다른 관리자가 먼저 상태를 바꿨습니다" } };
    expect(await setAdminPublicInquiryStatus({ id, status: "closed", expectedStatus: "new" })).toMatchObject({ ok: false, code: "CONFLICT" });
    st.result.admin_set_public_inquiry_status = { data: null, error: { code: "P0002", message: "NOT_FOUND: 상담 접수를 찾을 수 없습니다" } };
    expect(await setAdminPublicInquiryStatus({ id, status: "closed", expectedStatus: "new" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    st.result.admin_set_public_inquiry_status = { data: null, error: { code: "42501", message: "FORBIDDEN: 관리자만 볼 수 있습니다" } };
    expect(await setAdminPublicInquiryStatus({ id, status: "closed", expectedStatus: "new" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const n = st.calls.length;
    expect(await setAdminPublicInquiryStatus({ id: "x", status: "closed", expectedStatus: "new" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await setAdminPublicInquiryStatus({ id, status: "bogus" as never, expectedStatus: "new" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(st.calls.length).toBe(n);
  });
});
