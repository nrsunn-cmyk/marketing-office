import { beforeEach, describe, expect, it, vi } from "vitest";

/** P3B-UI-CONNECT-01 홈페이지 구조·문구 폼 동작: 형식 검사 → 서버 함수 → refresh. 서버 함수는 가짜 */
const m = vi.hoisted(() => ({
  create: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  rebase: vi.fn(),
  archive: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./server", () => ({
  createWebCopyDoc: (...a: unknown[]) => m.create(...a),
  saveWebCopy: (...a: unknown[]) => m.save(...a),
  restoreWebCopyVersion: (...a: unknown[]) => m.restore(...a),
  rebaseWebCopy: (...a: unknown[]) => m.rebase(...a),
  archiveWebCopy: (...a: unknown[]) => m.archive(...a),
}));
vi.mock("next/cache", () => ({ refresh: () => m.refresh() }));

const { createWebCopyDocAction, saveWebCopyAction, restoreWebCopyVersionAction, rebaseWebCopyAction, archiveWebCopyAction } = await import("./actions");

const B = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const D2 = "55555555-5555-4555-8555-555555555555";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const payload = JSON.stringify({ status: "drafting", pages: [{ id: null, title: "홈", slug: "/", sortOrder: 1, sections: [] }] });
const OK = { ok: true, data: { revision: 9 } };

beforeEach(() => vi.clearAllMocks());

describe("홈페이지 구조·문구 폼 동작", () => {
  it("만들기: 브리프 id 만(기본 4페이지), 고르면 복사할 문서 id 도 넘기고 새로 고친다", async () => {
    m.create.mockResolvedValue({ ok: true, data: { docId: D } });
    expect(await createWebCopyDocAction({}, fd({ briefId: B }))).toEqual({ ok: true, message: "홈페이지 구조·문구 문서를 만들었습니다." });
    expect(m.create).toHaveBeenLastCalledWith(B, null);
    await createWebCopyDocAction({}, fd({ briefId: B, copyFromDocId: "" }));
    expect(m.create).toHaveBeenLastCalledWith(B, null);
    await createWebCopyDocAction({}, fd({ briefId: B, copyFromDocId: D2 }));
    expect(m.create).toHaveBeenLastCalledWith(B, D2);
    expect(m.refresh).toHaveBeenCalledTimes(3);
  });

  it("만들기: id 형식이 틀리면 서버를 부르지 않는다", async () => {
    expect(await createWebCopyDocAction({}, fd({ briefId: "x" }))).toEqual({ message: "잘못된 요청입니다." });
    expect(await createWebCopyDocAction({}, fd({ briefId: B, copyFromDocId: "x" }))).toEqual({ message: "잘못된 요청입니다." });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("저장: docId·revision·payload(JSON 그대로)를 넘기고, 서버 오류 문구는 그대로(새로 고치지 않음)", async () => {
    m.save.mockResolvedValueOnce(OK);
    expect(await saveWebCopyAction({}, fd({ docId: D, revision: "4", payload }))).toEqual({ ok: true, message: "홈페이지 구조·문구를 저장했습니다." });
    expect(m.save).toHaveBeenCalledWith(D, 4, JSON.parse(payload));
    expect(m.refresh).toHaveBeenCalledTimes(1);
    m.save.mockResolvedValueOnce({ ok: false, code: "VALIDATION", message: "2번째 페이지 경로는 / 로 시작하고 영소문자·숫자·- 만 쓸 수 있습니다." });
    expect(await saveWebCopyAction({}, fd({ docId: D, revision: "4", payload }))).toEqual({ message: "2번째 페이지 경로는 / 로 시작하고 영소문자·숫자·- 만 쓸 수 있습니다." });
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("저장: payload 가 비었거나 너무 길거나 JSON 이 아니면, id·revision 이 틀리면 거절", async () => {
    expect((await saveWebCopyAction({}, fd({ docId: D, revision: "4", payload: "" }))).message).toBe("입력이 비었거나 너무 깁니다.");
    expect((await saveWebCopyAction({}, fd({ docId: D, revision: "4", payload: "x".repeat(700_001) }))).message).toBe("입력이 비었거나 너무 깁니다.");
    expect((await saveWebCopyAction({}, fd({ docId: D, revision: "4", payload: "{" }))).message).toBe("입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요.");
    for (const revision of ["0", "-1", "1.5", "x", "", "2147483648", "1e12"]) expect(await saveWebCopyAction({}, fd({ docId: D, revision, payload }))).toEqual({ message: "잘못된 요청입니다." });
    expect(await saveWebCopyAction({}, fd({ docId: "x", revision: "4", payload }))).toEqual({ message: "잘못된 요청입니다." });
    expect(m.save).not.toHaveBeenCalled();
  });

  it("한도 끝까지 채운 문서(섹션 60개, 칸마다 상한, 이모지)도 payload 상한 안에 든다", async () => {
    m.save.mockResolvedValue(OK);
    const e = "😀";
    const sec = (i: number) => ({ id: null, sectionName: e.repeat(80), purpose: e.repeat(200), headline: e.repeat(160), body: e.repeat(2000), ctaLabel: e.repeat(60), ctaTarget: "/contact", citationIds: [], sortOrder: i + 1, excluded: false });
    const pages = Array.from({ length: 5 }, (_, p) => ({ id: null, title: e.repeat(60), slug: `/p${p}`, sortOrder: p + 1, sections: Array.from({ length: 12 }, (_, i) => sec(i)) }));
    const big = JSON.stringify({ status: "drafting", pages });
    expect(big.length).toBeLessThanOrEqual(700_000);
    expect((await saveWebCopyAction({}, fd({ docId: D, revision: "1", payload: big }))).ok).toBe(true);
  });

  it("되돌리기: versionNo(양의 정수)를 넘긴다", async () => {
    m.restore.mockResolvedValue(OK);
    expect(await restoreWebCopyVersionAction({}, fd({ docId: D, revision: "5", versionNo: "2" }))).toEqual({ ok: true, message: "2번 판의 내용으로 새 판을 만들었습니다." });
    expect(m.restore).toHaveBeenCalledWith(D, 5, 2);
    for (const versionNo of ["0", "x", "", "2147483648"]) expect(await restoreWebCopyVersionAction({}, fd({ docId: D, revision: "5", versionNo }))).toEqual({ message: "잘못된 요청입니다." });
    expect(m.restore).toHaveBeenCalledTimes(1);
  });

  it("맞추기·보관: docId·revision 만", async () => {
    m.rebase.mockResolvedValue(OK);
    m.archive.mockResolvedValue({ ok: false, code: "CONFLICT", message: "다른 곳에서 먼저 고쳤습니다. 화면을 새로 고쳐 주세요." });
    expect(await rebaseWebCopyAction({}, fd({ docId: D, revision: "6" }))).toEqual({ ok: true, message: "최신 제작 브리프 기준으로 맞췄습니다." });
    expect(m.rebase).toHaveBeenCalledWith(D, 6);
    expect(await archiveWebCopyAction({}, fd({ docId: D, revision: "6" }))).toEqual({ message: "다른 곳에서 먼저 고쳤습니다. 화면을 새로 고쳐 주세요." });
    expect(m.archive).toHaveBeenCalledWith(D, 6);
    expect(await archiveWebCopyAction({}, fd({ docId: D }))).toEqual({ message: "잘못된 요청입니다." });
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });
});
