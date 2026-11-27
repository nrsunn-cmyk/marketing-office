import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROFILE-AUTOLINK-BACKEND-01(AUDIT-05 C1-2, 주인님 결정: 자동 연결): 회사 프로필 저장 동작.
 * 저장 성공 → 연결 없는 고객 프로젝트에 최신 판 연결 → refresh. 연결 실패·예외는 저장 성공 그대로(기록만).
 * 서버 함수는 가짜다.
 */
const m = vi.hoisted(() => ({ add: vi.fn(), link: vi.fn(), refresh: vi.fn() }));
vi.mock("./server", () => ({
  addProfileVersion: (...a: unknown[]) => m.add(...a),
  createClientRecord: vi.fn(),
  setClientArchived: vi.fn(),
  updateClientRecord: vi.fn(),
}));
vi.mock("@/features/projects/server", () => ({
  createProjectRecord: vi.fn(),
  linkLatestProfileToUnlinkedProjects: (...a: unknown[]) => m.link(...a),
}));
vi.mock("next/cache", () => ({ refresh: () => m.refresh() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { addProfileVersionAction } = await import("./actions");
const C = "22222222-2222-4222-8222-222222222222";
const form = (clientId = C) => {
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("products", "브랜드 컨설팅");
  fd.set("audience", "소상공인");
  fd.set("strengths", "빠른 대응\n정직한 견적");
  fd.set("brandRules", "");
  fd.set("channelUrls", "https://example.com");
  return fd;
};
const SAVED = "회사 프로필 3번 버전을 저장했습니다.";

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  m.add.mockResolvedValue({ ok: true, data: { version: 3 } });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("회사 프로필 저장 뒤 자동 연결", () => {
  it("연결한 프로젝트가 있으면 개수를 덧붙인다(AGY 확정 문구), 이 고객 id 로 한 번 부른다", async () => {
    m.link.mockResolvedValue({ ok: true, data: { linked: 2, versionId: "v-3" } });
    const r = await addProfileVersionAction({}, form());
    expect(r).toEqual({ ok: true, message: `${SAVED} 프로필이 연결되지 않았던 프로젝트 2개에도 연결했습니다.` });
    expect(m.link).toHaveBeenCalledTimes(1);
    expect(m.link).toHaveBeenCalledWith(C);
    expect(m.refresh).toHaveBeenCalledTimes(1);
    // 저장이 먼저, 연결이 나중
    expect(m.add.mock.invocationCallOrder[0]).toBeLessThan(m.link.mock.invocationCallOrder[0]);
  });

  it("연결한 프로젝트가 없으면 지금 문구 그대로", async () => {
    m.link.mockResolvedValue({ ok: true, data: { linked: 0, versionId: "v-3" } });
    expect(await addProfileVersionAction({}, form())).toEqual({ ok: true, message: SAVED });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("연결 실패·예외는 저장 성공 그대로, 기록에는 코드만 남고 화면에 오류 원문이 없다", async () => {
    m.link.mockResolvedValue({ ok: false, code: "ERROR", message: "내부 오류 원문" });
    expect(await addProfileVersionAction({}, form())).toEqual({ ok: true, message: SAVED });
    expect(errSpy).toHaveBeenCalledWith("[addProfileVersionAction.link]", "ERROR");

    m.link.mockRejectedValue(new Error("연결 끊김"));
    const r = await addProfileVersionAction({}, form());
    expect(r).toEqual({ ok: true, message: SAVED });
    expect(JSON.stringify(r)).not.toContain("연결 끊김");
    expect(m.refresh).toHaveBeenCalledTimes(2);
  });

  it("저장이 실패하면 연결하지 않고 refresh 도 하지 않는다", async () => {
    m.add.mockResolvedValue({ ok: false, code: "VALIDATION", message: "저장하지 못했습니다." });
    expect(await addProfileVersionAction({}, form())).toEqual({ message: "저장하지 못했습니다." });
    expect(m.link).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("잘못된 고객 id·입력 오류는 저장도 연결도 부르지 않는다", async () => {
    expect(await addProfileVersionAction({}, form("x"))).toEqual({ message: "잘못된 요청입니다." });
    const bad = form();
    bad.set("channelUrls", "ftp://example.com");
    const r = await addProfileVersionAction({}, bad);
    expect(r.errors?.channelUrls).toBeTruthy();
    expect(m.add).not.toHaveBeenCalled();
    expect(m.link).not.toHaveBeenCalled();
  });
});
