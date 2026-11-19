/**
 * P3A-BACKEND-01: 공통 제작 브리프(P3-a) 상수. 화면(클라이언트)에서도 가져다 쓸 수 있게 서버 전용 코드를 두지 않는다.
 * DB 규칙: supabase/migrations/20261121001000_p3a_production_briefs.sql 과 값이 같아야 한다(글자 수는 코드 포인트).
 * 화면 문구(라벨)는 AGY 인계표 C:/nadaum/Design/p3-production/P3A-HANDOFF.md 를 따른다.
 */

/** 칸별 상한(코드 포인트). 선택 칸(톤·참고)은 비우면 null 로 저장한다 */
export const PRODUCTION_BRIEF_LIMITS = {
  title: 120,
  targetAudience: 500,
  coreMessage: 1000,
  scopeSummary: 2000,
  brandToneConstraints: 1000,
  referenceNotes: 1000,
  /** 포함 산출물 종류 최소·최대 */
  deliverableMin: 1,
  deliverableMax: 4,
  /** 프로젝트당 보관 안 된 제작 브리프 */
  perProject: 10,
} as const;

/** 포함 산출물 종류(뒤 단계 표 이름과 같다 — 설계 D4) */
export const DELIVERABLE_TYPES = ["web_copy", "design_assets", "video_plan", "ppt_deck"] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];
export const DELIVERABLE_TYPE_LABELS: Record<DeliverableType, string> = {
  web_copy: "홈페이지 구조·문구",
  design_assets: "디자인 자산",
  video_plan: "영상 구성",
  ppt_deck: "PPT",
};

/** 저장 상태. 화면 문구는 '작성 중'·'확정' */
export const PRODUCTION_BRIEF_STATUSES = ["drafting", "ready"] as const;
export type ProductionBriefStatus = (typeof PRODUCTION_BRIEF_STATUSES)[number];

/** 화면 표시 상태: 저장 상태 + 보관 */
export const PRODUCTION_BRIEF_DISPLAY = {
  drafting: "작성 중",
  ready: "확정",
  archived: "보관",
} as const;
export type ProductionBriefDisplayStatus = keyof typeof PRODUCTION_BRIEF_DISPLAY;

export function productionBriefDisplayStatus(x: { archived: boolean; status: ProductionBriefStatus }): ProductionBriefDisplayStatus {
  return x.archived ? "archived" : x.status;
}

/** 승인본과 다른 판을 바탕으로 하면 경고(막지 않음, DEC-P2-01-A). 승인본이 없어진 경우도 경고한다(Tester R-Q3) */
export const STALE_LABEL = "이전 전략 기준";
export function isStaleStrategy(briefVersionId: string, approvedVersionId: string | null): boolean {
  return briefVersionId !== approvedVersionId;
}

/** 코드 포인트 글자 수(DB length() 와 같다) */
export const charLength = (s: string) => Array.from(s).length;
