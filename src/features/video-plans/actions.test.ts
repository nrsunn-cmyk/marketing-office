import { beforeEach, describe, expect, it, vi } from "vitest";

/** P3D-UI-CONNECT-01 영상 구성 동작: 형식 검사 → 서버 함수 → refresh. 서버 함수는 가짜 */
const m = vi.hoisted(() => ({
  create: vi.fn(),
  save: vi.fn(),
  restorePlan: vi.fn(),
  rebase: vi.fn(),
  archive: vi.fn(),
  restoreFile: vi.fn(),
  start: vi.fn(),
  finish: vi.fn(),
  cancel: vi.fn(),
  url: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./server", () => ({
  createVideoPlan: (...a: unknown[]) => m.create(...a),
  saveVideoPlan: (...a: unknown[]) => m.save(...a),
  restoreVideoPlanVersion: (...a: unknown[]) => m.restorePlan(...a),
  rebaseVideoPlan: (...a: unknown[]) => m.rebase(...a),
  archiveVideoPlan: (...a: unknown[]) => m.archive(...a),
  restoreVideoFileVersion: (...a: unknown[]) => m.restoreFile(...a),
  startVideoUpload: (...a: unknown[]) => m.start(...a),
  finishVideoUpload: (...a: unknown[]) => m.finish(...a),
  cancelVideoUpload: (...a: unknown[]) => m.cancel(...a),
  getVideoFileUrl: (...a: unknown[]) => m.url(...a),
}));
vi.mock("next/cache", () => ({ refresh: () => m.refresh() }));

const A = await import("./actions");
const B = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const PL = "44444444-4444-4444-8444-444444444444";
const U = "11111111-1111-4111-8111-111111111111";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const SCENES = [{ id: null, sceneTitle: "오프닝", durationSec: 10, narration: "", subtitle: "", assetIds: [] }];
const payload = JSON.stringify({ title: "소개 영상", aspectRatio: "16:9", status: "drafting", scenes: SCENES });
const OK = { ok: true, data: { revision: 6 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.example.co");
});

describe("영상 구성 폼 동작", () => {
  it("만들기(첫 저장): productionBriefId + title·aspectRatio·scenes(status 는 버림)", async () => {
    m.create.mockResolvedValue({ ok: true, data: { planId: PL } });
    expect(await A.createVideoPlanAction({}, fd({ productionBriefId: B, payload }))).toEqual({ ok: true, message: "영상 구성안을 저장했습니다." });
    expect(m.create).toHaveBeenCalledWith({ productionBriefId: B, title: "소개 영상", aspectRatio: "16:9", scenes: SCENES });
    expect(await A.createVideoPlanAction({}, fd({ productionBriefId: "x", payload }))).toEqual({ message: "잘못된 요청입니다." });
    expect((await A.createVideoPlanAction({}, fd({ productionBriefId: B, payload: "[1]" }))).message).toBe("입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요.");
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it("저장 = 새 판: planId·revision·payload 그대로, 서버 오류 문구는 그대로", async () => {
    m.save.mockResolvedValueOnce(OK);
    expect(await A.saveVideoPlanAction({}, fd({ planId: PL, revision: "5", payload }))).toEqual({ ok: true, message: "영상 구성안을 저장했습니다." });
    expect(m.save).toHaveBeenCalledWith(PL, 5, JSON.parse(payload));
    m.save.mockResolvedValueOnce({ ok: false, code: "VALIDATION", message: "장면은 30개까지 둘 수 있습니다. 불필요한 장면을 제외한 뒤 추가해 주세요." });
    expect(await A.saveVideoPlanAction({}, fd({ planId: PL, revision: "5", payload }))).toEqual({ message: "장면은 30개까지 둘 수 있습니다. 불필요한 장면을 제외한 뒤 추가해 주세요." });
    for (const revision of ["0", "x", "2147483648"]) expect(await A.saveVideoPlanAction({}, fd({ planId: PL, revision, payload }))).toEqual({ message: "잘못된 요청입니다." });
  });

  it("판 되돌리기(versionNo)·맞추기·보관·파일 되돌리기(version)", async () => {
    for (const k of ["restorePlan", "rebase", "archive", "restoreFile"] as const) m[k].mockResolvedValue(OK);
    expect(await A.restoreVideoPlanVersionAction({}, fd({ planId: PL, revision: "5", versionNo: "2" }))).toEqual({ ok: true, message: "선택한 판의 영상 구성안을 새 버전으로 복원했습니다." });
    expect(m.restorePlan).toHaveBeenCalledWith(PL, 5, 2);
    expect(await A.rebaseVideoPlanAction({}, fd({ planId: PL, revision: "5" }))).toEqual({ ok: true, message: "최신 기준으로 맞췄습니다." });
    expect(await A.archiveVideoPlanAction({}, fd({ planId: PL, revision: "5" }))).toEqual({ ok: true, message: "영상 구성안을 보관했습니다." });
    expect(await A.restoreVideoFileVersionAction({}, fd({ planId: PL, revision: "5", version: "1" }))).toEqual({ ok: true, message: "선택한 영상 파일 버전을 새 버전으로 복원했습니다." });
    expect(m.restoreFile).toHaveBeenCalledWith(PL, 5, 1);
    expect(await A.restoreVideoPlanVersionAction({}, fd({ planId: PL, revision: "5", versionNo: "0" }))).toEqual({ message: "잘못된 요청입니다." });
  });
});

describe("영상 파일 첨부 단계 동작", () => {
  it("예약: 서명 업로드 주소(video-files)를 붙인다, 주소를 못 만들면 예약을 닫는다", async () => {
    m.start.mockResolvedValue({ ok: true, data: { uploadId: U, path: `ws/video-files/${U}.mp4`, token: "tok", mime: "video/mp4", expiresAt: "x" } });
    const r = await A.startVideoUploadAction({ planId: PL, fileName: "a.mp4", size: 10, mime: "video/mp4" });
    expect(r).toEqual({ ok: true, data: { uploadId: U, path: `ws/video-files/${U}.mp4`, uploadUrl: `https://sb.example.co/storage/v1/object/upload/sign/video-files/ws/video-files/${U}.mp4?token=tok`, mime: "video/mp4", expiresAt: "x" } });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect((await A.startVideoUploadAction({})).ok).toBe(false);
    expect(m.cancel).toHaveBeenCalledWith(U);
  });

  it("확정: 형식 검사 후 서버로, 성공하면 새로 고침 / 취소·내려받기 주소", async () => {
    m.finish.mockResolvedValue(OK);
    expect(await A.finishVideoUploadAction(PL, 5, "ws/p.mp4", { uploadId: U, changeNote: "" })).toEqual(OK);
    expect(m.finish).toHaveBeenCalledWith(PL, 5, "ws/p.mp4", { uploadId: U, changeNote: "" });
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect((await A.finishVideoUploadAction("x", 5, "p", {})).ok).toBe(false);
    m.cancel.mockResolvedValue({ ok: true, data: null });
    expect(await A.cancelVideoUploadAction(U)).toEqual({ ok: true, data: null });
    expect((await A.cancelVideoUploadAction("x")).ok).toBe(false);
    m.url.mockResolvedValue({ ok: true, data: { url: "https://signed", expiresIn: 60 } });
    expect(await A.videoDownloadUrlAction(PL, 2)).toEqual({ ok: true, data: { url: "https://signed" } });
    expect(m.url).toHaveBeenCalledWith(PL, 2);
  });
});
