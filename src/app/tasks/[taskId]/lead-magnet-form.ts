/** P2E-UI-01 리드마그넷 폼 값 ↔ 서버 계약(leadMagnetInputSchema) 변환. 화면 없이 시험할 수 있게 따로 둔다 */
import type { LeadMagnetDelivery, LeadMagnetFormat, LeadMagnetStatus } from "@/domain/lead-magnet/constants";

export interface LeadMagnetFormValue {
  title: string;
  format: LeadMagnetFormat;
  stageId: string;
  delivery: LeadMagnetDelivery | "";
  status: LeadMagnetStatus;
  audience: string;
  promise: string;
  leadFields: string; // 한 줄에 하나
  outline: string; // 한 줄에 하나
}

export const emptyLeadMagnet = (stageId: string): LeadMagnetFormValue => ({
  title: "",
  format: "checklist",
  stageId,
  delivery: "",
  status: "planned",
  audience: "",
  promise: "",
  leadFields: "",
  outline: "",
});

/** 빈 줄은 빼고 앞뒤 공백을 지운다. 개수·길이는 자르지 않고 서버가 판단한다(조용한 잘림 방지) */
export const formLines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

/** 서버 계약에 맞는 payload(단계는 따로 stageId 칸으로 보낸다) */
export function toLeadMagnetPayload(v: LeadMagnetFormValue) {
  return {
    title: v.title,
    format: v.format,
    audience: v.audience,
    promise: v.promise,
    delivery: v.delivery === "" ? null : v.delivery,
    leadFields: formLines(v.leadFields),
    outline: formLines(v.outline),
    status: v.status,
  };
}

/** 서버 보기 → 폼 값 */
export function leadMagnetToForm(lm: {
  title: string;
  format: LeadMagnetFormat;
  stageId: string;
  delivery: LeadMagnetDelivery | null;
  status: LeadMagnetStatus;
  audience: string | null;
  promise: string | null;
  leadFields: string[];
  outline: string[];
}): LeadMagnetFormValue {
  return {
    title: lm.title,
    format: lm.format,
    stageId: lm.stageId,
    delivery: lm.delivery ?? "",
    status: lm.status,
    audience: lm.audience ?? "",
    promise: lm.promise ?? "",
    leadFields: lm.leadFields.join("\n"),
    outline: lm.outline.join("\n"),
  };
}
