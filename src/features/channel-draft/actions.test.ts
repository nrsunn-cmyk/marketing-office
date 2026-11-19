import { beforeEach, describe, expect, it, vi } from "vitest";

/** P2G-UI-01 채널 초안 폼 동작: 폼 칸 → 서버 함수 인자. 서버 함수는 가짜(외부 호출 없음) */
const server = vi.hoisted(() => ({
  createChannelDraft: vi.fn(),
  updateChannelDraft: vi.fn(),
  rebaseChannelDraft: vi.fn(),
  archiveChannelDraft: vi.fn(),
  recordChannelPublication: vi.fn(),
  voidChannelPublication: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("./server", () => server);
vi.mock("next/cache", () => ({ refresh }));

const a = await import("./actions");
const ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const OK = { ok: true, data: {} };

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(server)) fn.mockResolvedValue(OK);
});

describe("채널 초안 폼 동작", () => {
  it("만들기: briefId 를 넘기고 성공하면 새로 고침", async () => {
    expect(await a.createChannelDraftAction({}, fd({ briefId: ID }))).toEqual({ ok: true, message: "티스토리 초안을 만들었습니다." });
    expect(server.createChannelDraft).toHaveBeenCalledWith(ID);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("고치기: 태그 글을 나누고 나머지 칸은 그대로 서버 계약으로", async () => {
    await a.updateChannelDraftAction({}, fd({ draftId: ID, revision: "3", title: " 제목 ", body: "본문", tags: "커피, 정기배송,\n출근길,,", imageNote: "", metaDescription: "요약", status: "reviewed" }));
    expect(server.updateChannelDraft).toHaveBeenCalledWith(ID, 3, { title: " 제목 ", body: "본문", tags: ["커피", "정기배송", "출근길"], imageNote: "", metaDescription: "요약", status: "reviewed" });
  });

  it("잘못된 id·revision 은 서버를 부르지 않는다", async () => {
    expect(await a.updateChannelDraftAction({}, fd({ draftId: "x", revision: "3" }))).toEqual({ message: "잘못된 요청입니다." });
    expect(await a.rebaseChannelDraftAction({}, fd({ draftId: ID, revision: "0" }))).toEqual({ message: "잘못된 요청입니다." });
    expect(await a.archiveChannelDraftAction({}, fd({ draftId: ID }))).toEqual({ message: "잘못된 요청입니다." });
    expect(await a.voidChannelPublicationAction({}, fd({ publicationId: "1", reason: "r" }))).toEqual({ message: "잘못된 요청입니다." });
    expect(await a.createChannelDraftAction({}, fd({ briefId: "" }))).toEqual({ message: "잘못된 요청입니다." });
    for (const fn of Object.values(server)) expect(fn).not.toHaveBeenCalled();
  });

  it("너무 긴 칸은 서버까지 가지 않는다", async () => {
    expect(await a.updateChannelDraftAction({}, fd({ draftId: ID, revision: "1", title: "t", body: "가".repeat(40_001) }))).toEqual({ message: "입력이 너무 깁니다." });
    expect(server.updateChannelDraft).not.toHaveBeenCalled();
  });

  it("게시 기록: url·publishedAt(datetime-local 그대로)·note 를 넘긴다", async () => {
    expect(await a.recordChannelPublicationAction({}, fd({ draftId: ID, url: "https://a.tistory.com/1", publishedAt: "2026-11-19T21:20", note: "" }))).toEqual({ ok: true, message: "게시 기록을 남겼습니다." });
    expect(server.recordChannelPublication).toHaveBeenCalledWith(ID, { url: "https://a.tistory.com/1", publishedAt: "2026-11-19T21:20", note: "" });
  });

  it("기록 취소: reason 을 넘긴다", async () => {
    await a.voidChannelPublicationAction({}, fd({ publicationId: ID, reason: "주소를 잘못 적음" }));
    expect(server.voidChannelPublication).toHaveBeenCalledWith(ID, { reason: "주소를 잘못 적음" });
  });

  it("서버가 거절하면 그 안내를 그대로, 새로 고치지 않는다", async () => {
    server.rebaseChannelDraft.mockResolvedValueOnce({ ok: false, code: "CONFLICT", message: "다른 곳에서 먼저 수정되었습니다." });
    expect(await a.rebaseChannelDraftAction({}, fd({ draftId: ID, revision: "2" }))).toEqual({ message: "다른 곳에서 먼저 수정되었습니다." });
    expect(refresh).not.toHaveBeenCalled();
  });
});
