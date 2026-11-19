/**
 * P3A-UI-PREP-01 공통 제작 브리프 — 화면 쪽 모델(서버 없이 먼저 만든 자리).
 * 근거: AGY Design/p3-production/P3A-HANDOFF.md(필드 8종·글자 수·상태), production-brief.html.
 *
 * 서버(Backend P3A)가 오면:
 * - 아래 한도·허용값은 서버 도메인 상수(@/domain/... )로 바꿔 가져온다(같은 값이어야 한다).
 * - ProductionBriefView·ProductionBriefSectionData 는 서버 보기 타입으로 바꾼다.
 * - toProductionBriefPayload 의 칸 이름은 서버 입력 계약에 맞춘다.
 * zod·서버 모듈을 가져오지 않는다(브라우저 묶음에 서버 코드가 들어가지 않게).
 */

/** 글자 수 한도(유니코드 코드 포인트 기준, 인계표 1절·3절 3) */
export const PRODUCTION_BRIEF_LIMITS = {
  title: 120,
  targetAudience: 500,
  coreMessage: 1000,
  scopeSummary: 2000,
  brandToneConstraints: 1000,
  referenceNotes: 1000,
  deliverableTypesMin: 1,
  deliverableTypesMax: 4,
} as const;

/** 포함 산출물 종류(허용값 4개, 순서 = 화면 순서) */
export const DELIVERABLE_TYPES = {
  web_copy: "홈페이지 구조·문구",
  design_asset: "디자인 자산 (로고·배너)",
  video_script: "영상 구성·파일",
  ppt_template: "PPT 템플릿",
} as const;
export type DeliverableType = keyof typeof DELIVERABLE_TYPES;
export const DELIVERABLE_TYPE_KEYS = Object.keys(DELIVERABLE_TYPES) as DeliverableType[];

/** 저장 상태 3종(인계표 2절) */
export const PRODUCTION_BRIEF_STATUSES = {
  drafting: "작성 중",
  confirmed: "확정",
  archived: "보관",
} as const;
export type ProductionBriefStatus = keyof typeof PRODUCTION_BRIEF_STATUSES;
/** 폼에서 고를 수 있는 상태(보관은 별도 단추로만) */
export const EDITABLE_STATUSES = ["drafting", "confirmed"] as const satisfies readonly ProductionBriefStatus[];
export type EditableStatus = (typeof EDITABLE_STATUSES)[number];

/** 자리용 보기 타입 — 서버 보기 타입이 오면 바꾼다 */
export interface ProductionBriefView {
  id: string;
  title: string;
  targetAudience: string;
  coreMessage: string;
  deliverableTypes: DeliverableType[];
  scopeSummary: string;
  brandToneConstraints: string;
  referenceNotes: string;
  status: ProductionBriefStatus;
  revision: number;
  /** 기준 전략 버전(서버 관리) */
  strategyVersion: { id: string; version: number | null };
  /** 계산 표시: 기준 전략이 지금 승인본보다 앞섬 */
  stale: boolean;
}

export interface ProductionBriefSectionData {
  /** 활성(또는 보관한) 제작 브리프. 없으면 null(빈 상태) */
  brief: ProductionBriefView | null;
  canCreate: boolean;
  createBlockedReason: string | null;
  /** 지금 승인된 전략 버전 번호(없으면 null) */
  approvedVersion: number | null;
}

/** 글자 수(코드 포인트). 서버 char_length 와 같은 기준 */
export function charLength(s: string): number {
  return Array.from(s).length;
}

/** "1,234 / 2,000자" */
export function counterText(n: number, max: number): string {
  return `${n.toLocaleString("ko-KR")} / ${max.toLocaleString("ko-KR")}자`;
}

export interface ProductionBriefFormValue {
  title: string;
  targetAudience: string;
  coreMessage: string;
  deliverableTypes: DeliverableType[];
  scopeSummary: string;
  brandToneConstraints: string;
  referenceNotes: string;
  status: EditableStatus;
}

/** 글 칸 6개(화면 순서). 산출물 종류·상태는 따로 그린다 */
export const TEXT_FIELDS = [
  { key: "title", label: "제작 브리프 제목", required: true, multiline: false, rows: 1 },
  { key: "targetAudience", label: "핵심 대상(타깃)", required: true, multiline: true, rows: 3 },
  { key: "coreMessage", label: "핵심 전달 메시지", required: true, multiline: true, rows: 4 },
  { key: "scopeSummary", label: "제작 범위 및 제외 사항", required: true, multiline: true, rows: 6 },
  { key: "brandToneConstraints", label: "브랜드 톤·금기 사항", required: false, multiline: true, rows: 3 },
  { key: "referenceNotes", label: "참고 자료·링크 안내", required: false, multiline: true, rows: 3 },
] as const satisfies ReadonlyArray<{ key: keyof typeof PRODUCTION_BRIEF_LIMITS & keyof ProductionBriefFormValue; label: string; required: boolean; multiline: boolean; rows: number }>;
export type TextFieldKey = (typeof TEXT_FIELDS)[number]["key"];

/** 입력 예시(시안 문구) */
export const FIELD_PLACEHOLDERS: Record<TextFieldKey, string> = {
  title: "예: 동네 카페 홈페이지·로고 제작 기준",
  targetAudience: "예: 외부 대행사 없이 직접 브랜드와 견적 기준을 정리하려는 1인·소규모 서비스 대표",
  coreMessage: "예: 복잡한 마케팅 기획과 제작 파일을 승인된 버전 기준으로 한 번에 정리해 중간 혼선 없이 납품까지 이어집니다.",
  scopeSummary: "포함: 홈페이지 5개 섹션 구조 및 최종 문구, 로고 SVG/PNG 패키지\n제외: 외부 광고 집행, 결제 연동",
  brandToneConstraints: "예: 쉬운 한국어, 과장·허위 성과 수치 금지",
  referenceNotes: "예: 고객 자료실 업로드 문서, 승인된 로고 프롬프트 v2 기준",
};

export function emptyProductionBrief(): ProductionBriefFormValue {
  return { title: "", targetAudience: "", coreMessage: "", deliverableTypes: [], scopeSummary: "", brandToneConstraints: "", referenceNotes: "", status: "drafting" };
}

/** 보기 → 폼 값(보관 상태는 폼으로 오지 않는다. 혹시 오면 작성 중으로 둔다) */
export function productionBriefToForm(b: ProductionBriefView): ProductionBriefFormValue {
  return {
    title: b.title,
    targetAudience: b.targetAudience,
    coreMessage: b.coreMessage,
    deliverableTypes: DELIVERABLE_TYPE_KEYS.filter((k) => b.deliverableTypes.includes(k)),
    scopeSummary: b.scopeSummary,
    brandToneConstraints: b.brandToneConstraints,
    referenceNotes: b.referenceNotes,
    status: b.status === "confirmed" ? "confirmed" : "drafting",
  };
}

/** 산출물 종류 켜기·끄기(허용값만, 화면 순서 유지, 중복 없음) */
export function toggleDeliverable(list: readonly DeliverableType[], key: DeliverableType, on: boolean): DeliverableType[] {
  const set = new Set(list.filter((k) => k in DELIVERABLE_TYPES));
  if (on) set.add(key);
  else set.delete(key);
  return DELIVERABLE_TYPE_KEYS.filter((k) => set.has(k));
}

export type ProductionBriefIssues = Partial<Record<TextFieldKey | "deliverableTypes", string>>;

/**
 * 화면에서 미리 알려 줄 문제(저장은 서버가 최종 판단, 값을 자르지 않는다).
 * 필수 칸은 앞뒤 공백을 뺀 뒤 1자 이상, 모든 칸은 한도 이하, 산출물 종류는 1~4개.
 */
export function checkProductionBrief(v: ProductionBriefFormValue): ProductionBriefIssues {
  const issues: ProductionBriefIssues = {};
  for (const f of TEXT_FIELDS) {
    const value = v[f.key];
    const max = PRODUCTION_BRIEF_LIMITS[f.key];
    if (f.required && value.trim() === "") issues[f.key] = `${f.label}을(를) 입력해 주세요.`;
    else if (charLength(value) > max) issues[f.key] = `${f.label}은(는) ${max.toLocaleString("ko-KR")}자까지 쓸 수 있습니다.`;
  }
  const n = new Set(v.deliverableTypes).size;
  if (n < PRODUCTION_BRIEF_LIMITS.deliverableTypesMin) issues.deliverableTypes = "포함 산출물 종류를 1개 이상 선택해 주세요.";
  else if (n > PRODUCTION_BRIEF_LIMITS.deliverableTypesMax) issues.deliverableTypes = `포함 산출물 종류는 ${PRODUCTION_BRIEF_LIMITS.deliverableTypesMax}개까지 고를 수 있습니다.`;
  return issues;
}

/** 서버로 보낼 값(자리용 이름 — 서버 계약이 오면 맞춘다). 값은 자르지 않는다 */
export function toProductionBriefPayload(v: ProductionBriefFormValue) {
  return {
    title: v.title,
    targetAudience: v.targetAudience,
    coreMessage: v.coreMessage,
    deliverableTypes: DELIVERABLE_TYPE_KEYS.filter((k) => v.deliverableTypes.includes(k)),
    scopeSummary: v.scopeSummary,
    brandToneConstraints: v.brandToneConstraints,
    referenceNotes: v.referenceNotes,
    status: v.status,
  };
}

/** 확정 문구(AGY 시안 production-brief.html) */
export const PB_COPY = {
  heading: "공통 제작 브리프",
  intro: "승인된 전략을 바탕으로 홈페이지·디자인·영상·PPT 제작에 공통으로 쓸 기준을 정리합니다.",
  emptyTitle: "아직 공통 제작 브리프가 없습니다.",
  emptyDesc: "승인된 전략이 있으면 바로 제작 브리프를 만들 수 있습니다. 전략 내용을 바탕으로 처음 입력값을 채워 둡니다.",
  create: "+ 공통 제작 브리프 만들기",
  archivedNote: "보관한 제작 브리프입니다. 내용만 볼 수 있고, 고치기·상태 변경은 할 수 없습니다. 보관을 되돌릴 수는 없습니다.",
  projectReadOnly: "보관한 프로젝트이거나 취소한 작업이라 제작 브리프를 고칠 수 없습니다.",
  rebase: "지금 승인본 기준으로 맞추기",
  deliverableHint: "선택한 종류에 따라 이후 P3 제작·검수 단계가 열립니다.",
  statusHint: "보관은 아래 ‘이 제작 브리프 보관’ 단추로만 전환할 수 있습니다.",
  confirmedOption: "확정 (후속 제작 단계에서 기준본으로 사용)",
  save: "제작 브리프 저장",
  archive: "이 제작 브리프 보관",
  notConnected: "아직 서버와 연결되지 않아 저장할 수 없습니다. (P3-a 서버 작업 뒤 연결)",
  loadError: "공통 제작 브리프를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
} as const;

/** 이전 전략 기준 안내(시안 문구, 버전 번호만 끼움) */
export function staleText(briefVersion: number | null, approvedVersion: number | null): string {
  const now = approvedVersion ? `지금 승인본(${approvedVersion}번 버전)` : "지금 승인본";
  const old = briefVersion ? `앞선 전략(${briefVersion}번 버전)` : "앞선 전략";
  return `${now}보다 ${old}으로 만든 제작 브리프입니다. 대상과 메시지가 지금 전략과 맞는지 확인해 주세요. 맞추지 않아도 고칠 수 있습니다.`;
}
