import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 문의·후속 작업 보관(AUDIT-04 A1, P4-ARCHIVE-ACTIONS-BACKEND-01).
 * - 서버 함수: 잘못된 id 는 DB 를 부르지 않고 NOT_FOUND, RPC 이름·인자, DB 한국어 설명은 그대로·모르는 오류 원문은 숨김
 * - 서버 동작: 형식 검사 → 서버 함수 → 성공이면 refresh, 실패면 서버 문구
 */
const h = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  error: null as { code?: string; message: string } | null,
  refresh: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => h.refresh() }));
vi.mock("@/server/auth/session", () => ({
  requireWorkspace: async () => ({ workspace: { id: "ws-1" } }),
  requireUser: async () => ({ userId: "u-1" }),
}));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.calls.push({ fn, args });
      return { data: h.error ? null : true, error: h.error };
    },
  }),
}));

const C = await import("./channels");
const A = await import("./actions");
const I = "eeeeeeee-eeee-4eee-8eee-000000000001";
const F = "ffffffff-ffff-4fff-8fff-000000000001";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  h.calls = [];
  h.error = null;
  h.refresh.mockClear();
});

describe("보관 서버 함수", () => {
  it("문의 보관: archive_inquiry(p_inquiry_id), 후속 작업 보관: archive_crm_followup(p_followup_id)", async () => {
    expect(await C.archiveInquiry(I)).toEqual({ ok: true, data: true });
    expect(await C.archiveCrmFollowup(F)).toEqual({ ok: true, data: true });
    expect(h.calls).toEqual([
      { fn: "archive_inquiry", args: { p_inquiry_id: I } },
      { fn: "archive_crm_followup", args: { p_followup_id: F } },
    ]);
  });

  it("잘못된 id 는 DB 를 부르지 않고 NOT_FOUND", async () => {
    for (const bad of ["", "x", `${I}'`]) {
      expect(await C.archiveInquiry(bad)).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await C.archiveCrmFollowup(bad)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    }
    expect(h.calls).toHaveLength(0);
  });

  it("이미 보관했거나 남의 것(NOT_FOUND)은 DB 한국어 설명 그대로, 모르는 오류 원문은 숨긴다", async () => {
    h.error = { code: "P0002", message: "NOT_FOUND: 상담·문의 건을 찾을 수 없습니다" };
    expect(await C.archiveInquiry(I)).toEqual({ ok: false, code: "NOT_FOUND", message: "상담·문의 건을 찾을 수 없습니다" });
    h.error = { code: "P0002", message: "NOT_FOUND: CRM 후속 작업을 찾을 수 없습니다" };
    expect(await C.archiveCrmFollowup(F)).toEqual({ ok: false, code: "NOT_FOUND", message: "CRM 후속 작업을 찾을 수 없습니다" });
    h.error = { code: "42883", message: "function public.archive_inquiry(uuid) does not exist" };
    const r = await C.archiveInquiry(I);
    expect(r).toMatchObject({ ok: false, code: "ERROR" });
    expect(JSON.stringify(r)).not.toContain("does not exist");
  });
});

describe("보관 서버 동작", () => {
  it("성공하면 새로 고침", async () => {
    expect(await A.archiveInquiryAction({}, fd({ inquiryId: I }))).toEqual({ ok: true });
    expect(await A.archiveCrmFollowupAction({}, fd({ followupId: F }))).toEqual({ ok: true });
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("형식이 틀리면 서버를 부르지 않는다", async () => {
    expect(await A.archiveInquiryAction({}, fd({ inquiryId: "x" }))).toEqual({ message: "잘못된 요청입니다." });
    expect(await A.archiveCrmFollowupAction({}, fd({}))).toEqual({ message: "잘못된 요청입니다." });
    expect(h.calls).toHaveLength(0);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("실패하면 서버 문구를 그대로, 새로 고치지 않는다", async () => {
    h.error = { code: "P0002", message: "NOT_FOUND: 상담·문의 건을 찾을 수 없습니다" };
    expect(await A.archiveInquiryAction({}, fd({ inquiryId: I }))).toEqual({ message: "상담·문의 건을 찾을 수 없습니다" });
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
