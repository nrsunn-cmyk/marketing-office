/**
 * P2D-BACKEND-01: 마케팅 퍼널 보드(P2-d) 순수 모듈.
 * 단계 정의, 카드 입력 계약, 보드 상태(병목·빈 보드·이전 전략 기준) 계산, DB 오류 → 안내 문구.
 * DB 규칙: supabase/migrations/20261118001000_p2d_funnel_board.sql (값 범위는 DB와 같게 둔다)
 */
import { z } from "zod";
import { FUNNEL_STAGES, FUNNEL_STAGE_KEYS, funnelStageLabel, FUNNEL_ITEM_KINDS, FUNNEL_ITEM_STATUSES, FUNNEL_LIMITS, type FunnelStageKey, type FunnelItemKind, type FunnelItemStatus } from "./constants";

// 상수는 constants.ts 에 있다(BUNDLE-D-FRONT-01). 기존 import 경로는 그대로 쓸 수 있다
export { FUNNEL_STAGES, FUNNEL_STAGE_KEYS, funnelStageLabel, FUNNEL_ITEM_KINDS, FUNNEL_ITEM_STATUSES, FUNNEL_LIMITS, type FunnelStageKey, type FunnelItemKind, type FunnelItemStatus };


const L = FUNNEL_LIMITS;
const optionalText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label}은(는) ${max}자 이하여야 합니다.`)
    .transform((s) => s.trim())
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional()
    .transform((s) => s ?? null);

export const leadMagnetDetailsSchema = z.strictObject({
  deliverable: z.string().max(L.deliverable, `전달물 형태는 ${L.deliverable}자 이하여야 합니다.`).optional(),
  leadFields: z
    .array(z.string().trim().min(1, "수집할 정보 항목이 비어 있습니다.").max(L.leadField, `수집할 정보 항목은 ${L.leadField}자 이하여야 합니다.`))
    .max(L.leadFields, `수집할 정보는 ${L.leadFields}개까지입니다.`)
    .optional(),
  outline: z
    .array(z.string().trim().min(1, "기획 아웃라인 줄이 비어 있습니다.").max(L.outlineLine, `아웃라인 한 줄은 ${L.outlineLine}자 이하여야 합니다.`))
    .max(L.outline, `아웃라인은 ${L.outline}줄까지입니다.`)
    .optional(),
});
export type LeadMagnetDetails = z.infer<typeof leadMagnetDetailsSchema>;

export const funnelItemInputSchema = z
  .strictObject({
    kind: z.enum(Object.keys(FUNNEL_ITEM_KINDS) as [FunnelItemKind, ...FunnelItemKind[]], "카드 유형을 골라 주세요."),
    title: z.string().trim().min(1, "제목을 입력해 주세요.").max(L.title, `제목은 ${L.title}자 이하여야 합니다.`),
    description: optionalText(L.description, "설명"),
    channel: optionalText(L.channel, "채널"),
    status: z.enum(Object.keys(FUNNEL_ITEM_STATUSES) as [FunnelItemStatus, ...FunnelItemStatus[]], "진행 상태를 골라 주세요.").default("planned"),
    targetNote: optionalText(L.targetNote, "목표 메모"),
    details: leadMagnetDetailsSchema.nullable().optional().transform((d) => d ?? null),
  })
  .refine((v) => v.kind === "lead_magnet" || v.details === null, { message: "리드마그넷 카드에만 기획 내용을 넣을 수 있습니다.", path: ["details"] });
export type FunnelItemInput = z.infer<typeof funnelItemInputSchema>;

export const funnelStageFocusSchema = optionalText(L.focus, "단계 타깃 문구");

/** 보드 상태: 시안(funnel-board.html)의 정상·병목 경고·빈 보드. 이전 전략 기준은 따로 stale 로 준다 */
export type FunnelBoardWarning =
  | { kind: "empty" }
  | { kind: "bottleneck"; stages: FunnelStageKey[] };

/** 보관하지 않은 카드 수로 경고를 계산한다. 고려·전환이 비면 병목(리드마그넷·전환 오퍼 부재), 전부 비면 빈 보드 */
export function funnelWarnings(activeCountByStage: Partial<Record<FunnelStageKey, number>>): FunnelBoardWarning[] {
  const n = (k: FunnelStageKey) => activeCountByStage[k] ?? 0;
  const total = FUNNEL_STAGES.reduce((sum, s) => sum + n(s.key), 0);
  if (total === 0) return [{ kind: "empty" }];
  const missing = (["consideration", "conversion"] as const).filter((k) => n(k) === 0);
  return missing.length ? [{ kind: "bottleneck", stages: [...missing] }] : [];
}

/** 전략 결과(strategy-template@1)에서 퍼널이 이어받는 목표·제안·타깃 문장 */
export interface FunnelStrategyBasis {
  goals: string[];
  offers: string[];
  audiences: string[];
}
const BASIS_SECTIONS = ["goals", "offers", "audiences"] as const;
export function strategyBasisOf(content: unknown): FunnelStrategyBasis {
  const out: FunnelStrategyBasis = { goals: [], offers: [], audiences: [] };
  if (!content || typeof content !== "object") return out;
  const c = content as { facts?: unknown; inferences?: unknown };
  for (const list of [c.facts, c.inferences]) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      const section = (e as { section?: unknown })?.section;
      const text = (e as { text?: unknown })?.text;
      if (typeof text !== "string" || !text.trim()) continue;
      if ((BASIS_SECTIONS as readonly unknown[]).includes(section)) out[section as (typeof BASIS_SECTIONS)[number]].push(text.trim());
    }
  }
  return out;
}

export const FUNNEL_ERROR_MESSAGES = {
  NOT_AUTHENTICATED: "로그인이 필요합니다. 다시 로그인해 주세요.",
  NOT_FOUND: "퍼널이나 카드를 찾을 수 없습니다. 화면을 새로 고쳐 주세요.",
  STRATEGY_NOT_APPROVED: "승인된 전략이 있어야 퍼널을 만들거나 전략 기준을 다시 맞출 수 있습니다.",
  CONFLICT: "다른 곳에서 먼저 수정되었습니다. 화면을 새로 고친 뒤 다시 저장해 주세요.",
  INVALID_TRANSITION: "지금 상태에서는 할 수 없는 동작입니다.",
  VALIDATION: "입력값이 규칙에 맞지 않습니다.",
} as const;
export type FunnelErrorCode = keyof typeof FUNNEL_ERROR_MESSAGES;
export const FUNNEL_ERROR_FALLBACK = "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";

/**
 * DB 오류 "CODE: 설명" → 안내 문구. VALIDATION·INVALID_TRANSITION 은 퍼널 migration 이 쓴 한국어 설명을 그대로 보여 준다
 * (내부 정보 없음, 무엇을 고칠지 구체적). 그 밖의 코드는 고정 문구, 모르는 오류는 일반 문구(원문 노출 없음).
 */
export function funnelErrorFromDb(message: string | null | undefined): { code: FunnelErrorCode | "ERROR"; message: string } {
  const m = /^\s*([A-Z_]+):\s*(.*)$/s.exec(message ?? "");
  const head = m?.[1];
  if (head && head in FUNNEL_ERROR_MESSAGES) {
    const code = head as FunnelErrorCode;
    const detail = m?.[2]?.trim() ?? "";
    if ((code === "VALIDATION" || code === "INVALID_TRANSITION") && /[가-힣]/.test(detail) && detail.length <= 200) {
      return { code, message: /[.다요]$/.test(detail) ? `${detail}` : `${detail}.` };
    }
    return { code, message: FUNNEL_ERROR_MESSAGES[code] };
  }
  return { code: "ERROR", message: FUNNEL_ERROR_FALLBACK };
}

/** 계약 검사 실패 첫 문구. 한국어 문구만 보여 주고 Zod 기본(영어) 문구는 일반 문구로 바꾼다 */
export function funnelIssueMessage(issue: { message: string } | undefined): string {
  if (issue && /[가-힣]/.test(issue.message)) return issue.message;
  return "입력값이 규칙에 맞지 않습니다.";
}
