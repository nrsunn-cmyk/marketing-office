/**
 * P3A-BACKEND-01: 공통 제작 브리프(P3-a) 순수 모듈. 입력 계약, DB 오류 → 안내 문구.
 * DB 규칙: supabase/migrations/20261121001000_p3a_production_briefs.sql (값 범위는 DB 와 같게 둔다. 글자 수는 코드 포인트)
 */
import { z } from "zod";
import { funnelErrorFromDb, funnelIssueMessage } from "@/domain/funnel";
import { DELIVERABLE_TYPES, PRODUCTION_BRIEF_LIMITS, PRODUCTION_BRIEF_STATUSES, charLength } from "./constants";

// 상수는 constants.ts 에 둔다(화면 import 경계는 client-imports.test.ts 가 검사)
export * from "./constants";

const L = PRODUCTION_BRIEF_LIMITS;

/** DB app.funnel_trim 과 같은 정리(공백류 + NBSP·BOM) */
export const briefTrim = (s: string) => s.replace(/^[\s ﻿]+|[\s ﻿]+$/g, "");

const requiredText = (max: number, label: string) =>
  z
    .string()
    .transform(briefTrim)
    .refine((s) => s.length > 0, `${label}을(를) 입력해 주세요.`)
    .refine((s) => charLength(s) <= max, `${label}은(는) ${max}자 이하여야 합니다.`);

const optionalText = (max: number, label: string) =>
  z
    .string()
    .transform(briefTrim)
    .refine((s) => charLength(s) <= max, `${label}은(는) ${max}자 이하여야 합니다.`)
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional()
    .transform((s) => s ?? null);

const deliverables = z
  .array(z.enum(DELIVERABLE_TYPES, "알 수 없는 산출물 종류입니다."))
  .min(L.deliverableMin, "포함 산출물을 1개 이상 골라 주세요.")
  .max(L.deliverableMax, `포함 산출물은 ${L.deliverableMax}개까지 고를 수 있습니다.`)
  .refine((a) => new Set(a).size === a.length, "같은 산출물을 두 번 고를 수 없습니다.");

/** 만들기·수정 공통 칸 */
const fields = {
  title: requiredText(L.title, "제목"),
  targetAudience: requiredText(L.targetAudience, "핵심 대상"),
  coreMessage: requiredText(L.coreMessage, "핵심 전달 메시지"),
  deliverableTypes: deliverables,
  scopeSummary: requiredText(L.scopeSummary, "제작 범위"),
  brandToneConstraints: optionalText(L.brandToneConstraints, "브랜드 톤·금기 사항"),
  referenceNotes: optionalText(L.referenceNotes, "참고 자료 안내"),
};

export const productionBriefCreateSchema = z.strictObject(fields);
export const productionBriefUpdateSchema = z.strictObject({
  ...fields,
  status: z.enum(PRODUCTION_BRIEF_STATUSES, "알 수 없는 진행 상태입니다."),
});
export type ProductionBriefCreateInput = z.infer<typeof productionBriefCreateSchema>;
export type ProductionBriefUpdateInput = z.infer<typeof productionBriefUpdateSchema>;

export const productionBriefIssueMessage = funnelIssueMessage;

/** DB 오류 → 안내 문구. 코드 체계는 퍼널과 같고, 한도(LIMIT_REACHED)와 고정 문구만 제작 브리프용으로 바꾼다 */
export function productionBriefErrorFromDb(message: string | null | undefined): { code: string; message: string } {
  const m = /^\s*LIMIT_REACHED:\s*(.*)$/s.exec(message ?? "");
  if (m) return { code: "VALIDATION", message: `한 프로젝트에는 제작 브리프를 ${L.perProject}개까지 둘 수 있습니다. 쓰지 않는 것을 보관해 주세요.` };
  const e = funnelErrorFromDb(message);
  if (e.code === "NOT_FOUND") return { code: e.code, message: "제작 브리프나 프로젝트·전략을 찾을 수 없습니다. 화면을 새로 고쳐 주세요." };
  if (e.code === "STRATEGY_NOT_APPROVED") return { code: e.code, message: "승인된 전략이 있어야 합니다. 전략을 먼저 승인해 주세요." };
  return e;
}
