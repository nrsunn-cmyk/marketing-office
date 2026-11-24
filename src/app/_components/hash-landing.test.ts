import { describe, expect, it, vi } from "vitest";
import { hashTarget, landOnHash, type LandingEnv } from "./hash-landing";

/** UX-HASH-SCROLL-GLOBAL-01: 해시 도착 규칙(가짜 환경으로 DOM·타이머·사용자 입력을 흉내) */
function fakeEnv(hash: string, opts: { present?: boolean; top?: number; reduce?: boolean; resting?: number } = {}) {
  const el = { getBoundingClientRect: () => ({ top: opts.top ?? 500 }), scrollIntoView: vi.fn() };
  let present = opts.present ?? false;
  let onChange: (() => void) | null = null;
  let timerFn: (() => void) | null = null;
  let userFn: (() => void) | null = null;
  const released = { observe: 0, timer: 0, user: 0 };
  const env: LandingEnv = {
    hash,
    getElementById: (id) => (present && id === "p4b-ops" ? el : null),
    restingTop: () => opts.resting ?? 0,
    reducedMotion: () => Boolean(opts.reduce),
    observe: (fn) => {
      onChange = fn;
      return () => void released.observe++;
    },
    setTimer: (fn) => {
      timerFn = fn;
      return () => void released.timer++;
    },
    onUserScroll: (fn) => {
      userFn = fn;
      return () => void released.user++;
    },
  };
  return {
    env,
    el,
    released,
    appear: () => {
      present = true;
      onChange?.();
    },
    mutateWithoutTarget: () => onChange?.(),
    timeout: () => timerFn?.(),
    userScrolls: () => userFn?.(),
  };
}

describe("해시 도착(UX-HASH-SCROLL-GLOBAL-01)", () => {
  it("해시 해독: # 빼기·퍼센트 해독·빈 값·잘못된 값", () => {
    expect(hashTarget("#p4b-ops")).toBe("p4b-ops");
    expect(hashTarget("#%ED%95%9C")).toBe("한");
    expect(hashTarget("")).toBeNull();
    expect(hashTarget("#")).toBeNull();
    expect(hashTarget("#%E0%A4%A")).toBeNull();
  });

  it("해시가 없으면 아무것도 지켜보지 않는다", () => {
    const f = fakeEnv("");
    const observe = vi.spyOn(f.env, "observe");
    landOnHash(f.env)();
    expect(observe).not.toHaveBeenCalled();
  });

  it("대상이 이미 맨 위면 두 번 움직이지 않고, 맨 위가 아니면 바로 한 번", () => {
    const top = fakeEnv("#p4b-ops", { present: true, top: 1 });
    landOnHash(top.env);
    expect(top.el.scrollIntoView).not.toHaveBeenCalled();
    const far = fakeEnv("#p4b-ops", { present: true, top: 800 });
    landOnHash(far.env);
    expect(far.el.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(far.el.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  });

  it("제자리는 scroll-margin·scroll-padding 을 더한 위치(예: 머리글 아래 80px)", () => {
    const resting = fakeEnv("#p4b-ops", { present: true, top: 80, resting: 80 });
    landOnHash(resting.env);
    expect(resting.el.scrollIntoView).not.toHaveBeenCalled();
    const off = fakeEnv("#p4b-ops", { present: true, top: 0, resting: 80 });
    landOnHash(off.env);
    expect(off.el.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("늦게 나타나면 그때 한 번 옮기고 지켜보기·타이머·입력 감시를 모두 푼다", () => {
    const f = fakeEnv("#p4b-ops");
    landOnHash(f.env);
    f.mutateWithoutTarget();
    expect(f.el.scrollIntoView).not.toHaveBeenCalled();
    f.appear();
    f.appear();
    expect(f.el.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(f.released).toEqual({ observe: 1, timer: 1, user: 1 });
  });

  it("움직임 줄이기면 behavior auto", () => {
    const f = fakeEnv("#p4b-ops", { reduce: true });
    landOnHash(f.env);
    f.appear();
    expect(f.el.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
  });

  it("5초가 지나거나 사용자가 직접 움직이면 그만두고, 뒤에 나타나도 옮기지 않는다", () => {
    const t = fakeEnv("#p4b-ops");
    landOnHash(t.env);
    t.timeout();
    t.appear();
    expect(t.el.scrollIntoView).not.toHaveBeenCalled();
    expect(t.released).toEqual({ observe: 1, timer: 1, user: 1 });
    const u = fakeEnv("#p4b-ops");
    landOnHash(u.env);
    u.userScrolls();
    u.appear();
    expect(u.el.scrollIntoView).not.toHaveBeenCalled();
  });

  it("돌려준 정리 함수(다음 이동·화면 떠남)는 한 번만 푼다", () => {
    const f = fakeEnv("#p4b-ops");
    const stop = landOnHash(f.env);
    stop();
    stop();
    expect(f.released).toEqual({ observe: 1, timer: 1, user: 1 });
    f.appear();
    expect(f.el.scrollIntoView).not.toHaveBeenCalled();
  });
});
