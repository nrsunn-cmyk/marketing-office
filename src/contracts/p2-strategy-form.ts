/**
 * P2-STRATEGY-APP-01: 전략 화면 폼이 서버로 보내는 값(JSON 한 덩어리).
 * 출처는 종류와 대상만 받는다. 프로필 출처의 id·version, 자료 출처의 projectId 는 서버가 DB 값으로 채운다.
 * 최종 검증은 strategyInputSchema(계약)와 DB RPC 가 한다. 이 스키마는 모양과 크기만 막는다.
 */
import { z } from "zod";
import { STRATEGY_LIMITS, STRATEGY_SECTIONS } from "./p2-strategy";

const formText = (max: number) => z.string().max(max * 2); // 공백 정리 전 여유. 길이 규칙은 계약이 최종 판단

export const strategyFormSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("profile") }),
  z.strictObject({ kind: z.literal("asset"), assetId: z.string().max(100) }),
  z.strictObject({ kind: z.literal("url"), url: z.string().max(2000) }),
]);
export type StrategyFormSource = z.infer<typeof strategyFormSourceSchema>;

const formSection = z.strictObject({
  facts: z.array(z.strictObject({ text: formText(STRATEGY_LIMITS.textMax), source: strategyFormSourceSchema })).max(STRATEGY_LIMITS.itemsPerKind),
  inferences: z
    .array(z.strictObject({ text: formText(STRATEGY_LIMITS.textMax), rationale: formText(STRATEGY_LIMITS.textMax).optional() }))
    .max(STRATEGY_LIMITS.itemsPerKind),
});
export type StrategyFormSection = z.infer<typeof formSection>;

export const strategyFormPayloadSchema = z.strictObject({
  profileVersionId: z.uuid("회사 프로필 버전을 골라 주세요."),
  sections: z.strictObject(
    Object.fromEntries(STRATEGY_SECTIONS.map((s) => [s, formSection])) as Record<(typeof STRATEGY_SECTIONS)[number], typeof formSection>,
  ),
  unknowns: z
    .array(z.strictObject({ topic: formText(STRATEGY_LIMITS.topicMax), question: formText(STRATEGY_LIMITS.questionMax).optional() }))
    .max(STRATEGY_LIMITS.unknownsMax),
});
export type StrategyFormPayload = z.infer<typeof strategyFormPayloadSchema>;

/** 빈 폼 값 */
export function emptyStrategyForm(profileVersionId = ""): StrategyFormPayload {
  return {
    profileVersionId,
    sections: Object.fromEntries(
      STRATEGY_SECTIONS.map((s): [string, StrategyFormSection] => [s, { facts: [], inferences: [] }]),
    ) as StrategyFormPayload["sections"],
    unknowns: [],
  };
}
