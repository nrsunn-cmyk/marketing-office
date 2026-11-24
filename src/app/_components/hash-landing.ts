/**
 * UX-HASH-SCROLL-GLOBAL-01(Tester QA-ANCHOR-LANDING-SCOPE-01): 주소의 #해시 대상이 스트리밍(Suspense)으로 늦게 그려지면
 * 브라우저·Next 의 기본 해시 이동이 이미 지나가 화면이 맨 위에 멈춘다. 이 함수가 대상이 나타날 때까지 기다렸다가 한 번 옮긴다.
 *
 * - 대상이 이미 제자리(맨 위 + 그 요소의 scroll-margin-top + 페이지 scroll-padding-top, ±2px)면 아무것도 안 한다
 *   (기본 이동이 이미 했으므로 두 번 움직이지 않는다. 예: 나다움 홈 #contact 는 머리글 높이 + 8px 아래가 제자리)
 * - 대상이 이미 있는데 제자리가 아니면 바로 옮긴다
 * - 아직 없으면 DOM 변화를 지켜보다(MutationObserver) 나타나는 즉시 한 번 옮긴다. 최대 timeoutMs(기본 5초)
 * - 기다리는 동안 사용자가 직접 움직이면(휠·터치·키·마우스) 기다림을 그만둔다(손으로 하는 스크롤을 빼앗지 않음)
 * - 움직임 줄이기 설정이면 behavior "auto", 아니면 "smooth"
 * 돌려주는 함수를 부르면 지켜보기·타이머·이벤트를 모두 정리한다.
 */
export interface LandingEnv {
  hash: string;
  getElementById: (id: string) => { getBoundingClientRect: () => { top: number }; scrollIntoView: (o: ScrollIntoViewOptions) => void } | null;
  /** 그 요소가 해시로 도착했을 때 화면 위에서 떨어져 있어야 할 거리(scroll-margin-top + 페이지 scroll-padding-top) */
  restingTop: (el: NonNullable<ReturnType<LandingEnv["getElementById"]>>) => number;
  reducedMotion: () => boolean;
  observe: (onChange: () => void) => () => void;
  setTimer: (fn: () => void, ms: number) => () => void;
  onUserScroll: (fn: () => void) => () => void;
}

const NOOP = () => {};

/** 해시 → 대상 id(앞의 # 빼고 퍼센트 해독, 비었거나 잘못된 해독은 null) */
export function hashTarget(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function landOnHash(env: LandingEnv, timeoutMs = 5000): () => void {
  const id = hashTarget(env.hash);
  if (!id) return NOOP;
  const go = (el: NonNullable<ReturnType<LandingEnv["getElementById"]>>) => el.scrollIntoView({ block: "start", behavior: env.reducedMotion() ? "auto" : "smooth" });

  const now = env.getElementById(id);
  if (now) {
    if (Math.abs(now.getBoundingClientRect().top - env.restingTop(now)) > 2) go(now);
    return NOOP;
  }

  let done = false;
  const stops: Array<() => void> = [];
  const stop = () => {
    if (done) return;
    done = true;
    for (const s of stops) s();
  };
  stops.push(
    env.observe(() => {
      if (done) return;
      const el = env.getElementById(id);
      if (!el) return;
      stop();
      go(el);
    }),
  );
  stops.push(env.setTimer(stop, timeoutMs));
  stops.push(env.onUserScroll(stop));
  return stop;
}

/** 브라우저 환경 연결 */
export function browserLandingEnv(): LandingEnv {
  return {
    hash: window.location.hash,
    getElementById: (id) => document.getElementById(id),
    restingTop: (el) => {
      const px = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
      return px(getComputedStyle(el as Element).scrollMarginTop) + px(getComputedStyle(document.documentElement).scrollPaddingTop);
    },
    reducedMotion: () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    observe: (onChange) => {
      const mo = new MutationObserver(onChange);
      mo.observe(document.body, { childList: true, subtree: true });
      return () => mo.disconnect();
    },
    setTimer: (fn, ms) => {
      const t = window.setTimeout(fn, ms);
      return () => window.clearTimeout(t);
    },
    onUserScroll: (fn) => {
      const kinds = ["wheel", "touchstart", "keydown", "mousedown"] as const;
      for (const k of kinds) window.addEventListener(k, fn, { passive: true, once: true });
      return () => {
        for (const k of kinds) window.removeEventListener(k, fn);
      };
    },
  };
}
