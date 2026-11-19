import { beforeEach, describe, expect, it, vi } from "vitest";

/** SOURCE-UPLOAD-UI-01 자료 직접 업로드 동작: 형식 검사 → 서버 함수 → refresh. 파일 본문은 받지 않는다. 서버 함수는 가짜 */
const m = vi.hoisted(() => ({ prepare: vi.fn(), confirm: vi.fn(), refresh: vi.fn() }));
vi.mock("./server", () => ({
  prepareSourceUpload: (...a: unknown[]) => m.prepare(...a),
  confirmSourceUpload: (...a: unknown[]) => m.confirm(...a),
  addTextAsset: vi.fn(),
  addUrlAsset: vi.fn(),
  confirmPendingUpload: vi.fn(),
  uploadFileAsset: vi.fn(),
}));
vi.mock("next/cache", () => ({ refresh: () => m.refresh() }));

const { prepareSourceUploadAction, confirmSourceUploadAction } = await import("./actions");
const P = "22222222-2222-4222-8222-222222222222";
const U = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.example.co");
});

describe("자료 직접 업로드 동작", () => {
  it("준비: 이름·크기만 서버로, 결과에 공개 저장소 서명 업로드 주소를 붙인다(토큰은 주소에만)", async () => {
    m.prepare.mockResolvedValue({ ok: true, data: { uploadId: U, path: `ws/${U}/original.pdf`, token: "tok", mime: "application/pdf", expiresAt: "2026-11-20T02:00:00Z" } });
    const r = await prepareSourceUploadAction({ clientId: null, projectId: P }, { name: "회사소개서.pdf", size: 8 * 1024 * 1024 });
    expect(m.prepare).toHaveBeenCalledWith({ clientId: null, projectId: P }, { name: "회사소개서.pdf", size: 8 * 1024 * 1024 });
    expect(r).toEqual({
      ok: true,
      data: { uploadId: U, path: `ws/${U}/original.pdf`, uploadUrl: `https://sb.example.co/storage/v1/object/upload/sign/source-assets/ws/${U}/original.pdf?token=tok`, mime: "application/pdf", expiresAt: "2026-11-20T02:00:00Z" },
    });
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("준비: 주인 없음·id 형식·이상한 크기는 서버를 부르지 않는다, 서버 실패는 uploadCode 그대로", async () => {
    for (const [owner, file] of [
      [{ clientId: null, projectId: null }, { name: "a.pdf", size: 1 }],
      [{ clientId: "x", projectId: null }, { name: "a.pdf", size: 1 }],
      [{ clientId: null, projectId: P }, { name: "", size: 1 }],
      [{ clientId: null, projectId: P }, { name: "a.pdf", size: 1.5 }],
    ] as const)
      expect(await prepareSourceUploadAction(owner as never, file as never)).toEqual({ ok: false, message: "잘못된 요청입니다." });
    expect(m.prepare).not.toHaveBeenCalled();
    m.prepare.mockResolvedValue({ ok: false, code: "UPLOAD_FAILED", message: "파일은 10MB까지 올릴 수 있습니다.", errors: { uploadCode: "TOO_LARGE" } });
    expect(await prepareSourceUploadAction({ clientId: P, projectId: null }, { name: "a.pdf", size: 99 })).toEqual({ ok: false, message: "파일은 10MB까지 올릴 수 있습니다.", uploadCode: "TOO_LARGE" });
  });

  it("공개 저장소 주소가 없으면 예약 성공이어도 실패로", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    m.prepare.mockResolvedValue({ ok: true, data: { uploadId: U, path: "p", token: "t", mime: "application/pdf", expiresAt: "x" } });
    expect((await prepareSourceUploadAction({ clientId: null, projectId: P }, { name: "a.pdf", size: 1 })).ok).toBe(false);
  });

  it("확정: id·경로 검사 후 서버로, 성공·실패 모두 목록을 새로 고친다(실패 행 표시)", async () => {
    m.confirm.mockResolvedValueOnce({ ok: true, data: { id: "a1" } });
    expect(await confirmSourceUploadAction(U, `ws/${U}/original.pdf`)).toEqual({ ok: true, data: { id: "a1" } });
    expect(m.confirm).toHaveBeenCalledWith(U, `ws/${U}/original.pdf`);
    m.confirm.mockResolvedValueOnce({ ok: false, code: "UPLOAD_FAILED", message: "m", errors: { uploadCode: "TYPE_MISMATCH" } });
    expect(await confirmSourceUploadAction(U, "p")).toEqual({ ok: false, message: "m", uploadCode: "TYPE_MISMATCH" });
    expect(m.refresh).toHaveBeenCalledTimes(2);
    expect((await confirmSourceUploadAction("x", "p")).ok).toBe(false);
    expect((await confirmSourceUploadAction(U, "p".repeat(301))).ok).toBe(false);
    expect(m.confirm).toHaveBeenCalledTimes(2);
  });
});
