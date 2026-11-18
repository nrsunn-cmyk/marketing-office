"use client";

import { createContext, useContext, type ReactNode } from "react";
import h from "./hydration-hint.module.css";

/**
 * 화면 준비(hydration) 전 안내를 화면마다 한 곳에서만 보인다(BUNDLE-D-FRONT-01 ①).
 *
 * 예전에는 폼마다 비활성 제출 버튼 옆에 "화면을 준비하는 중…"을 따로 그려서, 폼이 많은 화면에서는 같은 문장이
 * 5~7개 동시에 보이고 화면 읽기 프로그램도 여러 번 읽었다(Tester QA-FINAL-B2-01 관찰).
 * 이제 루트 layout 에 안내 하나를 두고, 준비 전 비활성 버튼은 aria-describedby 로 이 하나를 가리킨다.
 * - 안내 문단은 **늘 그려 둔다**. 보이기·숨기기는 CSS(:has)만 정한다: 이 안내를 가리키는 버튼이 화면에 있을 때만 보인다
 *   (BUNDLE-D-FRONT-02, Tester QA-FINAL-D-01 O1: 예전에는 이 장치가 먼저 준비되며 문단을 지워, 아직 준비 중인 본문 버튼이
 *   0.15~0.23초 동안 없는 id 를 가리켰다. 버튼마다 준비되는 때가 달라도 가리키는 대상은 늘 있다)
 * - 가리키는 버튼이 없으면 display:none 이라 화면 읽기 프로그램에도 나오지 않는다(랜딩·준비 후)
 * - 안내를 담는 role=status 영역도 늘 있다(flash.tsx 와 같은 원칙)
 * - 이 장치가 없으면(단위 시험 등) 각 폼이 예전처럼 자기 옆에 안내를 그린다
 */
export const HYDRATION_HINT_ID = "app-hydration-hint";
export const HYDRATION_HINT_TEXT = "화면을 준비하는 중…";

const HintContext = createContext<string | null>(null);
/** 공용 안내의 id. 공용 안내가 없으면 null(그때는 폼이 자기 안내를 그린다) */
export const useHydrationHint = () => useContext(HintContext);

export function HydrationHintProvider({ children }: { children: ReactNode }) {
  return (
    <HintContext.Provider value={HYDRATION_HINT_ID}>
      {children}
      <div className={h.hintRegion} role="status">
        <p id={HYDRATION_HINT_ID} className={h.hint}>
          {HYDRATION_HINT_TEXT}
        </p>
      </div>
    </HintContext.Provider>
  );
}
