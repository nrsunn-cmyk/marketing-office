import { beforeEach, describe, expect, it, vi } from "vitest";

/** P3A-UI-CONNECT-01 제작 브리프 폼 동작: 형식 검사 → 서버 함수 → refresh. 서버 함수는 가짜 */
const m = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  rebase: vi.fn(),
  archive: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./server", () => ({
  createProductionBrief: (...a: unknown[]) => m.create(...a),
  updateProductionBrief: (...a: unknown[]) => m.update(...a),
  rebaseProductionBrief: (...a: unknown[]) => m.rebase(...a),
  archiveProductionBrief: (...a: unknown[]) => m.archive(...a),
}));
vi.mock("next/cache", () => ({ refresh: () => m.refresh() }));

const { createProductionBriefAction, updateProductionBriefAction, rebaseProductionBriefAction, archiveProductionBriefAction } = await import("./actions");

const P = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const payload = JSON.stringify({ title: "t", targetAudience: "a", coreMessage: "m", deliverableTypes: ["web_copy"], scopeSummary: "s", brandToneConstraints: "", referenceNotes: "" });

beforeEach(() => vi.clearAllMocks());

describe("제작 브리프 폼 동작", () => {
  it("만들기: 프로젝트·전략 id 와 payload 를 서버에 넘기고 새로 고친다", async () => {
    m.create.mockResolvedValue({ ok: true, data: { briefId: B } });
    const r = await createProductionBriefAction({}, fd({ projectId: P, strategyArtifactId: S, payload }));
    expect(r).toEqual({ ok: true, message: "공통 제작 브리프를 만들었습니다." });
    expect(m.create).toHaveBeenCalledWith(P, S, JSON.parse(payload));
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("만들기: id 형식이 틀리면 서버를 부르지 않는다", async () => {
    expect(await createProductionBriefAction({}, fd({ projectId: "x", strategyArtifactId: S, payload }))).toEqual({ message: "잘못된 요청입니다." });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("payload 가 비었거나 너무 길거나 JSON 이 아니면 거절", async () => {
    expect((await createProductionBriefAction({}, fd({ projectId: P, strategyArtifactId: S, payload: "" }))).message).toBe("입력이 비었거나 너무 깁니다.");
    expect((await createProductionBriefAction({}, fd({ projectId: P, strategyArtifactId: S, payload: "x".repeat(32_001) }))).message).toBe("입력이 비었거나 너무 깁니다.");
    expect((await createProductionBriefAction({}, fd({ projectId: P, strategyArtifactId: S, payload: "{" }))).message).toBe("입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요.");
    expect(m.create).not.toHaveBeenCalled();
  });

  it("고치기: id·revision(양의 정수) 검사 후 서버 오류 문구는 그대로 보인다(새로 고치지 않음)", async () => {
    m.update.mockResolvedValue({ ok: false, code: "CONFLICT", message: "다른 곳에서 먼저 고쳤습니다." });
    const r = await updateProductionBriefAction({}, fd({ briefId: B, revision: "3", payload }));
    expect(r).toEqual({ message: "다른 곳에서 먼저 고쳤습니다." });
    expect(m.update).toHaveBeenCalledWith(B, 3, JSON.parse(payload));
    expect(m.refresh).not.toHaveBeenCalled();
    for (const revision of ["0", "-1", "1.5", "x"]) expect(await updateProductionBriefAction({}, fd({ briefId: B, revision, payload }))).toEqual({ message: "잘못된 요청입니다." });
  });

  it("맞추기·보관: id·revision 만 넘긴다", async () => {
    m.rebase.mockResolvedValue({ ok: true, data: { revision: 4 } });
    m.archive.mockResolvedValue({ ok: true, data: { revision: 5 } });
    expect(await rebaseProductionBriefAction({}, fd({ briefId: B, revision: "3" }))).toEqual({ ok: true, message: "지금 승인된 전략 기준으로 다시 맞췄습니다." });
    expect(m.rebase).toHaveBeenCalledWith(B, 3);
    expect(await archiveProductionBriefAction({}, fd({ briefId: B, revision: "4" }))).toEqual({ ok: true, message: "제작 브리프를 보관했습니다." });
    expect(m.archive).toHaveBeenCalledWith(B, 4);
    expect(await archiveProductionBriefAction({}, fd({ briefId: "nope", revision: "4" }))).toEqual({ message: "잘못된 요청입니다." });
  });
});
