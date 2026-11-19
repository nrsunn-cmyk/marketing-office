/**
 * P3A 공통 제작 브리프 — 화면 쪽 모델(P3A-UI-PREP-01 → P3A-UI-CONNECT-01 서버 연결).
 * 서버 계약: src/features/production-brief/server.ts(getProductionBriefsFor·create·update·rebase·archive),
 * 상수·라벨: @/domain/production-brief/constants(브라우저에서 값으로 가져올 수 있는 상수 파일만. zod 는 서버 동작에서).
 * AGY 인계표 C:/nadaum/Design/p3-production/P3A-HANDOFF.md(R1): 코드 4종·drafting/ready + 보관(archived_at)·프로젝트당 10개.
 */
import {
  DELIVERABLE_TYPES,
  DELIVERABLE_TYPE_LABELS,
  PRODUCTION_BRIEF_DISPLAY,
  PRODUCTION_BRIEF_LIMITS,
  PRODUCTION_BRIEF_STATUSES,
  charLength,
  type DeliverableType,
  type ProductionBriefStatus,
} from "@/domain/production-brief/constants";
import type { ProductionBriefView } from "@/features/production-brief/server";

export { DELIVERABLE_TYPES, DELIVERABLE_TYPE_LABELS, PRODUCTION_BRIEF_DISPLAY, PRODUCTION_BRIEF_LIMITS, PRODUCTION_BRIEF_STATUSES, charLength };
export type { DeliverableType, ProductionBriefStatus };

/**
 * 서버(briefTrim = DB app.funnel_trim)와 같은 앞뒤 정리. JS 의 \s 는 공백·탭·줄바꿈·NBSP·BOM·전각 공백을 모두 포함한다.
 * 글자 수 표시·점검은 이 값으로 잰다(Tester QA-P3A-UI-01 U1: 끝 줄바꿈 하나로 '넘침'이 뜨던 문제).
 */
export const briefTrim = (s: string) => s.replace(/^[\s\u00a0\ufeff]+|[\s\u00a0\ufeff]+$/g, "");
/** 서버가 받는 글자 수(정리한 뒤 코드 포인트) */
export const countChars = (s: string) => charLength(briefTrim(s));

/** "1,234 / 2,000자" */
export function counterText(n: number, max: number): string {
  return `${n.toLocaleString("ko-KR")} / ${max.toLocaleString("ko-KR")}자`;
}
/** 화면 읽기 프로그램에 알릴 때: 한도의 90% 이상이거나 넘쳤을 때만(QA-P3A-UI-01 R2) */
export const nearLimit = (n: number, max: number) => n >= Math.ceil(max * 0.9);

export interface ProductionBriefFormValue {
  title: string;
  targetAudience: string;
  coreMessage: string;
  deliverableTypes: DeliverableType[];
  scopeSummary: string;
  brandToneConstraints: string;
  referenceNotes: string;
  status: ProductionBriefStatus;
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

/** 서버 보기 → 폼 값(선택 칸 null 은 빈 글) */
export function productionBriefToForm(b: ProductionBriefView): ProductionBriefFormValue {
  return {
    title: b.title,
    targetAudience: b.targetAudience,
    coreMessage: b.coreMessage,
    deliverableTypes: DELIVERABLE_TYPES.filter((k) => b.deliverableTypes.includes(k)),
    scopeSummary: b.scopeSummary,
    brandToneConstraints: b.brandToneConstraints ?? "",
    referenceNotes: b.referenceNotes ?? "",
    status: b.status,
  };
}

/** 산출물 종류 켜기·끄기(허용값만, 화면 순서 유지, 중복 없음) */
export function toggleDeliverable(list: readonly DeliverableType[], key: DeliverableType, on: boolean): DeliverableType[] {
  const set = new Set(list.filter((k) => (DELIVERABLE_TYPES as readonly string[]).includes(k)));
  if (on) set.add(key);
  else set.delete(key);
  return DELIVERABLE_TYPES.filter((k) => set.has(k));
}

export type ProductionBriefIssues = Partial<Record<TextFieldKey | "deliverableTypes", string>>;

/** 화면에서 미리 알려 줄 문제(저장은 서버가 최종 판단, 값을 자르지 않는다). 서버처럼 정리한 뒤 잰다 */
export function checkProductionBrief(v: ProductionBriefFormValue): ProductionBriefIssues {
  const issues: ProductionBriefIssues = {};
  for (const f of TEXT_FIELDS) {
    const n = countChars(v[f.key]);
    const max = PRODUCTION_BRIEF_LIMITS[f.key];
    if (f.required && n === 0) issues[f.key] = `${f.label}을(를) 입력해 주세요.`;
    else if (n > max) issues[f.key] = `${f.label}은(는) ${max.toLocaleString("ko-KR")}자까지 쓸 수 있습니다.`;
  }
  const n = new Set(v.deliverableTypes).size;
  if (n < PRODUCTION_BRIEF_LIMITS.deliverableMin) issues.deliverableTypes = "포함 산출물 종류를 1개 이상 선택해 주세요.";
  else if (n > PRODUCTION_BRIEF_LIMITS.deliverableMax) issues.deliverableTypes = `포함 산출물 종류는 ${PRODUCTION_BRIEF_LIMITS.deliverableMax}개까지 고를 수 있습니다.`;
  return issues;
}

/** 만들기 payload — 서버 productionBriefCreateSchema(strictObject, status 없음). 값은 자르지 않는다(정리는 서버) */
export function toCreatePayload(v: ProductionBriefFormValue) {
  return {
    title: v.title,
    targetAudience: v.targetAudience,
    coreMessage: v.coreMessage,
    deliverableTypes: DELIVERABLE_TYPES.filter((k) => v.deliverableTypes.includes(k)),
    scopeSummary: v.scopeSummary,
    brandToneConstraints: v.brandToneConstraints,
    referenceNotes: v.referenceNotes,
  };
}
/** 고치기 payload — productionBriefUpdateSchema(만들기 칸 + status) */
export function toUpdatePayload(v: ProductionBriefFormValue) {
  return { ...toCreatePayload(v), status: v.status };
}

/** 산출물 목록 글("홈페이지 구조·문구, 디자인 자산") */
export const deliverableText = (list: readonly DeliverableType[]) => list.map((k) => DELIVERABLE_TYPE_LABELS[k] ?? k).join(", ");

/** 확정 문구(AGY 시안 production-brief.html·task-detail-entry.html, DESIGN-REVIEW-P3A-UI-01 3절 확정 2건) */
export const PB_COPY = {
  heading: "공통 제작 브리프",
  intro: "승인된 전략을 바탕으로 홈페이지·디자인 자산·영상·PPT 제작 기준을 관리합니다. 보관하지 않은 브리프는 프로젝트당 10개까지 만들 수 있습니다.",
  emptyTitle: "아직 공통 제작 브리프가 없습니다.",
  // 시안의 "전략 내용을 바탕으로 처음 입력값을 채워 둡니다"는 서버가 채우지 않아 뺐다(사실과 다른 안내 방지)
  emptyDesc: "승인된 전략이 있으면 바로 제작 브리프를 만들 수 있습니다.",
  createFirst: "+ 공통 제작 브리프 만들기",
  createMore: "+ 새 제작 브리프 만들기",
  createSubmit: "제작 브리프 만들기",
  createBlockedLead: "새 제작 브리프를 만들 수 없습니다:",
  noApprovedStrategy: "P2에서 승인된 전략이 아직 없습니다. 먼저 위 전략 구역에서 승인본을 확정해 주세요.",
  projectReadOnly: "보관한 프로젝트이거나 취소한 작업이라 제작 브리프를 만들거나 고칠 수 없습니다.",
  open: "열기 · 고치기",
  view: "열어 보기",
  rebase: "지금 승인본 기준으로 맞추기",
  deliverableHint: "선택한 종류에 따라 이후 P3 제작·검수 단계가 열립니다.",
  statusHint: "보관은 아래 ‘이 제작 브리프 보관’ 단추로만 전환할 수 있습니다.",
  readyOption: "확정 (후속 제작 단계에서 기준본으로 사용)",
  readyNote: "확정한 제작 브리프는 이후 홈페이지·디자인 자산 단계의 기준본으로 씁니다. 고치면 그 단계에서도 바뀐 내용을 다시 확인해 주세요.",
  save: "제작 브리프 저장",
  archive: "이 제작 브리프 보관",
  archiveNote: "보관하면 내용만 볼 수 있고 고칠 수 없습니다. 보관은 되돌릴 수 없습니다.",
  archiveConfirm: "보관 확인",
  loadError: "공통 제작 브리프를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
} as const;

/** 이전 전략 기준 안내. 고칠 수 없을 때는 "맞추지 않아도 고칠 수 있습니다"를 뺀다(QA-P3A-UI-01 U2) */
export function staleText(briefVersion: number | null, approvedVersion: number | null, editable = true): string {
  const now = approvedVersion ? `지금 승인본(${approvedVersion}번 버전)` : "지금 승인본";
  const old = briefVersion ? `앞선 전략(${briefVersion}번 버전)` : "앞선 전략";
  const base = approvedVersion === null ? "바탕 전략의 승인본이 지금 없습니다. 대상과 메시지가 지금 전략과 맞는지 확인해 주세요." : `${now}보다 ${old}으로 만든 제작 브리프입니다. 대상과 메시지가 지금 전략과 맞는지 확인해 주세요.`;
  return editable ? `${base} 맞추지 않아도 고칠 수 있습니다.` : base;
}
