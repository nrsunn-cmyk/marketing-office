/**
 * P2E-BACKEND-01: 리드마그넷 기획(P2-e) 순수 모듈. 입력 계약과 DB 오류 → 안내 문구.
 * DB 규칙: supabase/migrations/20261119004000_p2e_lead_magnets.sql (값 범위는 DB와 같게 둔다)
 */
import { z } from "zod";
import { funnelErrorFromDb, funnelIssueMessage } from "@/domain/funnel";
import {
  LEAD_MAGNET_DELIVERIES,
  LEAD_MAGNET_FORMATS,
  LEAD_MAGNET_LIMITS,
  LEAD_MAGNET_LINKABLE_KINDS,
  LEAD_MAGNET_STATUSES,
  type LeadMagnetDelivery,
  type LeadMagnetFormat,
  type LeadMagnetStatus,
} from "./constants";

// 상수는 constants.ts 에 둔다(화면 import 경계는 client-imports.test.ts 가 검사)
export {
  LEAD_MAGNET_DELIVERIES,
  LEAD_MAGNET_FORMATS,
  LEAD_MAGNET_LIMITS,
  LEAD_MAGNET_LINKABLE_KINDS,
  LEAD_MAGNET_STATUSES,
  type LeadMagnetDelivery,
  type LeadMagnetFormat,
  type LeadMagnetStatus,
};

const L = LEAD_MAGNET_LIMITS;
const optionalText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label}은(는) ${max}자 이하여야 합니다.`)
    .transform((s) => s.trim())
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional()
    .transform((s) => s ?? null);

export const leadMagnetInputSchema = z.strictObject({
  title: z.string().trim().min(1, "제목을 입력해 주세요.").max(L.title, `제목은 ${L.title}자 이하여야 합니다.`),
  format: z.enum(Object.keys(LEAD_MAGNET_FORMATS) as [LeadMagnetFormat, ...LeadMagnetFormat[]], "리드마그넷 형식을 골라 주세요."),
  audience: optionalText(L.audience, "대상"),
  promise: optionalText(L.promise, "약속하는 가치"),
  delivery: z
    .enum(Object.keys(LEAD_MAGNET_DELIVERIES) as [LeadMagnetDelivery, ...LeadMagnetDelivery[]], "전달 방식을 골라 주세요.")
    .nullable()
    .optional()
    .transform((d) => d ?? null),
  leadFields: z
    .array(z.string().trim().min(1, "수집할 정보 항목이 비어 있습니다.").max(L.leadField, `수집할 정보 항목은 ${L.leadField}자 이하여야 합니다.`))
    .max(L.leadFields, `수집할 정보는 ${L.leadFields}개까지입니다.`)
    .default([]),
  outline: z
    .array(z.string().trim().min(1, "구성 줄이 비어 있습니다.").max(L.outlineLine, `구성 한 줄은 ${L.outlineLine}자 이하여야 합니다.`))
    .max(L.outline, `구성은 ${L.outline}줄까지입니다.`)
    .default([]),
  status: z.enum(Object.keys(LEAD_MAGNET_STATUSES) as [LeadMagnetStatus, ...LeadMagnetStatus[]], "진행 상태를 골라 주세요.").default("planned"),
});
export type LeadMagnetInput = z.infer<typeof leadMagnetInputSchema>;

/** 리드마그넷을 가리킬 수 있는 카드 유형인지 */
export const isLeadMagnetLinkable = (kind: string) => (LEAD_MAGNET_LINKABLE_KINDS as readonly string[]).includes(kind);

/** DB 오류 → 안내 문구. 코드 체계가 퍼널과 같아 퍼널 변환을 그대로 쓰고, NOT_FOUND 고정 문구만 리드마그넷용으로 바꾼다 */
export function leadMagnetErrorFromDb(message: string | null | undefined) {
  const e = funnelErrorFromDb(message);
  if (e.code === "NOT_FOUND") return { code: e.code, message: "리드마그넷이나 퍼널 카드를 찾을 수 없습니다. 화면을 새로 고쳐 주세요." };
  if (e.code === "STRATEGY_NOT_APPROVED") return { code: e.code, message: "승인된 전략이 있어야 전략 기준을 다시 맞출 수 있습니다." };
  return e;
}

export const leadMagnetIssueMessage = funnelIssueMessage;
