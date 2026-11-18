/** 퍼널 보드 상수(zod 없음). 화면이 상수만 가져올 때 zod 가 브라우저 묶음에 실리지 않게 따로 둔다(BUNDLE-D-FRONT-01 ③). 값은 DB 규칙과 같게 둔다 */
export const FUNNEL_STAGES = [
  { key: "inflow", position: 1, label: "유입" },
  { key: "awareness", position: 2, label: "인지" },
  { key: "consideration", position: 3, label: "고려" },
  { key: "conversion", position: 4, label: "전환" },
  { key: "retention", position: 5, label: "유지" },
] as const;
export type FunnelStageKey = (typeof FUNNEL_STAGES)[number]["key"];
export const FUNNEL_STAGE_KEYS = FUNNEL_STAGES.map((s) => s.key) as unknown as readonly [FunnelStageKey, ...FunnelStageKey[]];
export const funnelStageLabel = (key: string) => FUNNEL_STAGES.find((s) => s.key === key)?.label ?? key;

export const FUNNEL_ITEM_KINDS = { content: "콘텐츠", lead_magnet: "리드마그넷", cta: "전환 오퍼" } as const;
export type FunnelItemKind = keyof typeof FUNNEL_ITEM_KINDS;
export const FUNNEL_ITEM_STATUSES = { planned: "기획 완료", drafting: "작성 중", reviewed: "검토 완료", published: "발행 완료" } as const;
export type FunnelItemStatus = keyof typeof FUNNEL_ITEM_STATUSES;

export const FUNNEL_LIMITS = {
  title: 200,
  description: 2000,
  channel: 100,
  targetNote: 200,
  focus: 300,
  deliverable: 200,
  leadFields: 10,
  leadField: 50,
  outline: 20,
  outlineLine: 300,
  itemsPerStage: 50,
} as const;
