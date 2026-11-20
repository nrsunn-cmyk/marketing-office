import { beforeEach, describe, expect, it, vi } from "vitest";

/** P3C-UI-CONNECT-01 디자인 자산 동작: 형식 검사 → 서버 함수 → refresh. 서버 함수는 가짜 */
const m = vi.hoisted(() => ({
  prepare: vi.fn(),
  confirmCreate: vi.fn(),
  confirmReplace: vi.fn(),
  fileUrl: vi.fn(),
  update: vi.fn(),
  restore: vi.fn(),
  rebase: vi.fn(),
  archive: vi.fn(),
  usages: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./server", () => ({
  prepareDesignAssetUpload: (...a: unknown[]) => m.prepare(...a),
  confirmDesignAssetCreate: (...a: unknown[]) => m.confirmCreate(...a),
  confirmDesignAssetReplace: (...a: unknown[]) => m.confirmReplace(...a),
  getDesignAssetFileUrl: (...a: unknown[]) => m.fileUrl(...a),
  updateDesignAsset: (...a: unknown[]) => m.update(...a),
  restoreDesignAssetVersion: (...a: unknown[]) => m.restore(...a),
  rebaseDesignAsset: (...a: unknown[]) => m.rebase(...a),
  archiveDesignAsset: (...a: unknown[]) => m.archive(...a),
  setDesignAssetUsages: (...a: unknown[]) => m.usages(...a),
}));
vi.mock("next/cache", () => ({ refresh: () => m.refresh() }));

const A = await import("./actions");
const ID = "44444444-4444-4444-8444-444444444444";
const D = "55555555-5555-4555-8555-555555555555";
const S = "66666666-6666-4666-8666-666666666666";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const OK = { ok: true, data: { revision: 4 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.example.co/");
});

describe("디자인 자산 올리기 단계 동작", () => {
  it("예약: 서버 결과에 공개 저장소 서명 업로드 주소를 붙인다(토큰은 주소에만, 서버 키 없음)", async () => {
    m.prepare.mockResolvedValue({ ok: true, data: { uploadId: ID, path: `ws/design-assets/${ID}.png`, token: "tok", mime: "image/png", expiresAt: "2026-11-20T01:00:00Z" } });
    const raw = { productionBriefId: ID, assetId: null, kind: "image", fileName: "a.png", size: 10, mime: "image/png" };
    const r = await A.prepareDesignUploadAction(raw);
    expect(m.prepare).toHaveBeenCalledWith(raw);
    expect(r).toEqual({ ok: true, data: { uploadId: ID, path: `ws/design-assets/${ID}.png`, uploadUrl: `https://sb.example.co/storage/v1/object/upload/sign/design-assets/ws/design-assets/${ID}.png?token=tok`, mime: "image/png", expiresAt: "2026-11-20T01:00:00Z" } });
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("예약·확정 실패는 uploadCode·copyKey 를 그대로 넘긴다(화면이 확정 문구를 고름)", async () => {
    m.prepare.mockResolvedValue({ ok: false, code: "UPLOAD_FAILED", message: "파일 크기가 한도(10MB)를 넘어 올릴 수 없습니다.", errors: { uploadCode: "TOO_LARGE", copyKey: "uploadErrSize" } });
    expect(await A.prepareDesignUploadAction({})).toEqual({ ok: false, message: "파일 크기가 한도(10MB)를 넘어 올릴 수 없습니다.", uploadCode: "TOO_LARGE", copyKey: "uploadErrSize" });
    m.confirmCreate.mockResolvedValue({ ok: false, code: "UPLOAD_FAILED", message: "m", errors: { uploadCode: "UNSAFE_SVG", copyKey: "uploadErrType" } });
    expect(await A.confirmDesignCreateAction("p", {})).toEqual({ ok: false, message: "m", uploadCode: "UNSAFE_SVG", copyKey: "uploadErrType" });
    m.prepare.mockResolvedValue({ ok: false, code: "VALIDATION", message: "제작 브리프를 확정해야 디자인 자산을 올릴 수 있습니다." });
    expect(await A.prepareDesignUploadAction({})).toEqual({ ok: false, message: "제작 브리프를 확정해야 디자인 자산을 올릴 수 있습니다.", uploadCode: undefined, copyKey: undefined });
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("공개 저장소 주소가 없으면 예약 성공이어도 실패로", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    m.prepare.mockResolvedValue({ ok: true, data: { uploadId: ID, path: "p.png", token: "t", mime: "image/png", expiresAt: "x" } });
    expect((await A.prepareDesignUploadAction({})).ok).toBe(false);
  });

  it("확정(새 자산·교체): 성공하면 새로 고침, 교체는 id·revision 형식 검사", async () => {
    m.confirmCreate.mockResolvedValue({ ok: true, data: { assetId: ID } });
    expect(await A.confirmDesignCreateAction("ws/p.png", { uploadId: ID, title: "t", licenseNote: "", origin: "external_upload" })).toEqual({ ok: true, data: { assetId: ID } });
    expect(m.confirmCreate).toHaveBeenCalledWith("ws/p.png", { uploadId: ID, title: "t", licenseNote: "", origin: "external_upload" });
    m.confirmReplace.mockResolvedValue(OK);
    expect(await A.confirmDesignReplaceAction(ID, 3, "ws/p.png", { uploadId: ID, changeNote: "" })).toEqual(OK);
    expect(m.confirmReplace).toHaveBeenCalledWith(ID, 3, "ws/p.png", { uploadId: ID, changeNote: "" });
    expect(m.refresh).toHaveBeenCalledTimes(2);
    for (const [id, rev, path] of [["x", 3, "p"], [ID, 0, "p"], [ID, 2147483648, "p"], [ID, 3, "p".repeat(301)]] as const) expect((await A.confirmDesignReplaceAction(id, rev, path, {})).ok).toBe(false);
    expect(m.confirmReplace).toHaveBeenCalledTimes(1);
  });

  it("내려받기 주소: 판 번호 검사 후 download 용(60초)", async () => {
    m.fileUrl.mockResolvedValue({ ok: true, data: { url: "https://signed", expiresIn: 60 } });
    expect(await A.designDownloadUrlAction(ID, 2)).toEqual({ ok: true, data: { url: "https://signed" } });
    expect(m.fileUrl).toHaveBeenCalledWith(ID, 2, "download");
    expect((await A.designDownloadUrlAction(ID, 0)).ok).toBe(false);
    expect((await A.designDownloadUrlAction("x", 1)).ok).toBe(false);
  });
});

describe("디자인 자산 폼 동작", () => {
  it("정보 저장: assetId·revision·payload JSON, 서버 오류 문구는 그대로", async () => {
    const payload = JSON.stringify({ title: "로고", licenseNote: "", status: "reviewed" });
    m.update.mockResolvedValueOnce(OK);
    expect(await A.updateDesignAssetAction({}, fd({ assetId: ID, revision: "3", payload }))).toEqual({ ok: true, message: "디자인 자산 정보를 저장했습니다." });
    expect(m.update).toHaveBeenCalledWith(ID, 3, JSON.parse(payload));
    m.update.mockResolvedValueOnce({ ok: false, code: "CONFLICT", message: "다른 곳에서 먼저 수정되었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요." });
    expect(await A.updateDesignAssetAction({}, fd({ assetId: ID, revision: "3", payload }))).toEqual({ message: "다른 곳에서 먼저 수정되었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요." });
    expect((await A.updateDesignAssetAction({}, fd({ assetId: ID, revision: "3", payload: "{" }))).message).toBe("입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요.");
    expect((await A.updateDesignAssetAction({}, fd({ assetId: ID, revision: "3", payload: "x".repeat(8_001) }))).message).toBe("입력이 비었거나 너무 깁니다.");
    expect(await A.updateDesignAssetAction({}, fd({ assetId: "x", revision: "3", payload }))).toEqual({ message: "잘못된 요청입니다." });
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("되돌리기(version)·맞추기·보관: id·revision 검사", async () => {
    m.restore.mockResolvedValue(OK);
    m.rebase.mockResolvedValue(OK);
    m.archive.mockResolvedValue(OK);
    expect(await A.restoreDesignAssetAction({}, fd({ assetId: ID, revision: "3", version: "1" }))).toEqual({ ok: true, message: "선택한 파일 버전을 새 버전으로 복원했습니다." });
    expect(m.restore).toHaveBeenCalledWith(ID, 3, 1);
    expect(await A.restoreDesignAssetAction({}, fd({ assetId: ID, revision: "3", version: "0" }))).toEqual({ message: "잘못된 요청입니다." });
    expect(await A.rebaseDesignAssetAction({}, fd({ assetId: ID, revision: "3" }))).toEqual({ ok: true, message: "최신 기준으로 맞췄습니다." });
    expect(await A.archiveDesignAssetAction({}, fd({ assetId: ID, revision: "3" }))).toEqual({ ok: true, message: "디자인 자산을 보관했습니다." });
    for (const revision of ["0", "-1", "1.5", "x", "2147483648"]) expect(await A.archiveDesignAssetAction({}, fd({ assetId: ID, revision }))).toEqual({ message: "잘못된 요청입니다." });
    expect(m.archive).toHaveBeenCalledTimes(1);
  });

  it("사용처: payload 배열 그대로 서버로(전체 교체)", async () => {
    m.usages.mockResolvedValue(OK);
    const payload = JSON.stringify([{ docId: D, sectionId: S }]);
    expect((await A.setDesignAssetUsagesAction({}, fd({ assetId: ID, revision: "3", payload }))).ok).toBe(true);
    expect(m.usages).toHaveBeenCalledWith(ID, 3, [{ docId: D, sectionId: S }]);
  });
});
