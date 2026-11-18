/** 전략 영역 이름표(zod 없음). 화면이 이것만 가져올 때 계약의 zod 가 브라우저 묶음에 실리지 않게 따로 둔다(BUNDLE-D-FRONT-01 ③). */
import type { StrategySection } from "@/contracts/p2-strategy-constants";

export const STRATEGY_SECTION_LABELS: Record<StrategySection, string> = {
  goals: "목표",
  offers: "상품·제안",
  audiences: "타깃 고객",
  positioning: "포지셔닝",
  problems: "고객 문제",
  opportunities: "기회",
  priorities: "우선순위",
};
