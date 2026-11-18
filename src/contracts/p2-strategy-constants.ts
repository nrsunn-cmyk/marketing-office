/**
 * 전략 계약의 상수(zod 없음). 화면(클라이언트)이 상수만 가져올 때 zod 전체가 브라우저 묶음에 실리지 않게 따로 둔다(BUNDLE-D-FRONT-01 ③).
 * 계약 본체는 p2-strategy.ts, 이 값들은 거기서도 그대로 다시 내보낸다.
 */
export const STRATEGY_TEMPLATE_VERSION = "strategy-template@1";

export const STRATEGY_SECTIONS = ["goals", "offers", "audiences", "positioning", "problems", "opportunities", "priorities"] as const;
export type StrategySection = (typeof STRATEGY_SECTIONS)[number];

/** 비어 있으면 확인 질문을 만드는 영역(전략의 뼈대). 나머지는 비어 있어도 질문하지 않는다 */
export const STRATEGY_REQUIRED_SECTIONS: readonly StrategySection[] = ["goals", "offers", "audiences", "positioning"];

export const STRATEGY_LIMITS = {
  textMax: 500,
  topicMax: 200,
  questionMax: 300,
  itemsPerKind: 20,
  sourcesPerFact: 10,
  unknownsMax: 30,
} as const;
