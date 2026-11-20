import { beforeEach, describe, expect, it, vi } from "vitest";

/** P3E-UI-CONNECT-01 PPT 구성안 동작: 형식 검사 → 서버 함수 → refresh. 서버 함수는 가짜 */
const m = vi.hoisted(() => ({
  create: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  rebase: vi.fn(),
  archive: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./server", () => ({
  createPptDeck: (...a: unknown[]) => m.create(...a),
  savePptDeck: (...a: unknown[]) => m.save(...a),
  restorePptDeckVersion: (...a: unknown[]) => m.restore(...a),
  rebasePptDeck: (...a: unknown[]) => m.rebase(...a),
  archivePptDeck: (...a: unknown[]) => m.archive(...a),
}));
vi.mock("next/cache", () => ({ refresh: () => m.refresh() }));

const A = await import("./actions");
const B = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const D = "dddddddd-dddd-4ddd-8ddd-000000000001";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const SLIDES = [{ id: null, slideTitle: "표지", bulletPoints: "", speakerNotes: "", assetIds: [] }];
const payload = JSON.stringify({ title: "제안서", templateKey: "royal_grid", status: "reviewed", slides: SLIDES });
const OK = { ok: true, data: { revision: 6 } };

beforeEach(() => vi.clearAllMocks());

describe("PPT 구성안 폼 동작", () => {
  it("만들기(첫 저장): productionBriefId + title·templateKey·slides(status 는 버림)", async () => {
    m.create.mockResolvedValue({ ok: true, data: { deckId: D } });
    expect(await A.createPptDeckAction({}, fd({ productionBriefId: B, payload }))).toEqual({ ok: true, message: "PPT 구성안을 저장했습니다." });
    expect(m.create).toHaveBeenCalledWith({ productionBriefId: B, title: "제안서", templateKey: "royal_grid", slides: SLIDES });
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect(await A.createPptDeckAction({}, fd({ productionBriefId: "x", payload }))).toEqual({ message: "잘못된 요청입니다." });
    expect((await A.createPptDeckAction({}, fd({ productionBriefId: B, payload: "[1]" }))).message).toBe("입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요.");
    expect((await A.createPptDeckAction({}, fd({ productionBriefId: B, payload: "x".repeat(400_001) }))).message).toBe("입력이 비었거나 너무 깁니다.");
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it("저장 = 새 판: deckId·revision·payload 그대로, 서버 오류 문구는 그대로", async () => {
    m.save.mockResolvedValueOnce(OK);
    expect(await A.savePptDeckAction({}, fd({ deckId: D, revision: "5", payload }))).toEqual({ ok: true, message: "PPT 구성안을 저장했습니다." });
    expect(m.save).toHaveBeenCalledWith(D, 5, JSON.parse(payload));
    m.save.mockResolvedValueOnce({ ok: false, code: "CONFLICT", message: "다른 곳에서 먼저 고쳤습니다. 화면을 새로 고쳐 주세요." });
    expect(await A.savePptDeckAction({}, fd({ deckId: D, revision: "5", payload }))).toEqual({ message: "다른 곳에서 먼저 고쳤습니다. 화면을 새로 고쳐 주세요." });
    for (const revision of ["0", "x", "2147483648"]) expect(await A.savePptDeckAction({}, fd({ deckId: D, revision, payload }))).toEqual({ message: "잘못된 요청입니다." });
  });

  it("판 되돌리기(versionNo)·맞추기·보관: PPT_COPY 성공 문구", async () => {
    for (const k of ["restore", "rebase", "archive"] as const) m[k].mockResolvedValue(OK);
    expect(await A.restorePptDeckVersionAction({}, fd({ deckId: D, revision: "5", versionNo: "2" }))).toEqual({ ok: true, message: "선택한 판의 PPT 구성안을 새 판으로 복원했습니다." });
    expect(m.restore).toHaveBeenCalledWith(D, 5, 2);
    expect(await A.rebasePptDeckAction({}, fd({ deckId: D, revision: "5" }))).toEqual({ ok: true, message: "최신 기준으로 맞췄습니다." });
    expect(m.rebase).toHaveBeenCalledWith(D, 5);
    expect(await A.archivePptDeckAction({}, fd({ deckId: D, revision: "5" }))).toEqual({ ok: true, message: "PPT 구성안을 보관했습니다." });
    expect(m.archive).toHaveBeenCalledWith(D, 5);
    expect(await A.restorePptDeckVersionAction({}, fd({ deckId: D, revision: "5", versionNo: "0" }))).toEqual({ message: "잘못된 요청입니다." });
    expect(await A.archivePptDeckAction({}, fd({ deckId: "x", revision: "5" }))).toEqual({ message: "잘못된 요청입니다." });
  });
});
