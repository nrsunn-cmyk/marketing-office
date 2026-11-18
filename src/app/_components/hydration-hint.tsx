"use client";

import { createContext, useContext, type ReactNode } from "react";
import h from "./hydration-hint.module.css";
import { useHydrated } from "./use-hydrated";

/**
 * 화면 준비(hydration) 전 안내를 화면마다 한 곳에서만 보인다(BUNDLE-D-FRONT-01 ①).
 *
 * 예전에는 폼마다 비활성 제출 버튼 옆에 "화면을 준비하는 중…"을 따로 그려서, 폼이 많은 화면에서는 같은 문장이
 * 5~7개 동시에 보이고 화면 읽기 프로그램도 여러 번 읽었다(Tester QA-FINAL-B2-01 관찰).
 * 이제 루트 layout 에 안내 하나를 두고, 준비 전 비활성 버튼은 aria-describedby 로 이 하나를 가리킨다.
 * - 안내를 담는 role=status 영역은 늘 두고 글만 바꾼다(flash.tsx 와 같은 원칙)
 * - 준비를 기다리는 버튼이 화면에 하나도 없으면(랜딩 등) CSS(:has)가 안내를 숨긴다
 * - 이 장치가 없으면(단위 시험 등) 각 폼이 예전처럼 자기 옆에 안내를 그린다
 */
export const HYDRATION_HINT_ID = "app-hydration-hint";
export const HYDRATION_HINT_TEXT = "화면을 준비하는 중…";

const HintContext = createContext<string | null>(null);
/** 공용 안내의 id. 공용 안내가 없으면 null(그때는 폼이 자기 안내를 그린다) */
export const useHydrationHint = () => useContext(HintContext);

export function HydrationHintProvider({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  return (
    <HintContext.Provider value={HYDRATION_HINT_ID}>
      {children}
      <div className={h.hintRegion} role="status">
        {!hydrated && (
          <p id={HYDRATION_HINT_ID} className={h.hint}>
            {HYDRATION_HINT_TEXT}
          </p>
        )}
      </div>
    </HintContext.Provider>
  );
}
