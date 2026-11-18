/** P2D-FRONT-01 퍼널 카드 폼 값 ↔ 서버 계약(funnelItemInputSchema) 변환. 화면 없이 시험할 수 있게 따로 둔다 */
import type { FunnelItemKind, FunnelItemStatus } from "@/domain/funnel";

export interface FunnelItemFormValue {
  kind: FunnelItemKind;
  title: string;
  description: string;
  channel: string;
  status: FunnelItemStatus;
  targetNote: string;
  deliverable: string;
  leadFields: string; // 한 줄에 하나
  outline: string; // 한 줄에 하나
}

export const EMPTY_FUNNEL_ITEM: FunnelItemFormValue = {
  kind: "content",
  title: "",
  description: "",
  channel: "",
  status: "planned",
  targetNote: "",
  deliverable: "",
  leadFields: "",
  outline: "",
};

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

/** 서버 계약(funnelItemInputSchema)에 맞는 payload. 길이는 자르지 않고 서버가 판단한다(조용한 잘림 방지) */
export function toFunnelPayload(v: FunnelItemFormValue) {
  const base = { kind: v.kind, title: v.title, description: v.description, channel: v.channel, status: v.status, targetNote: v.targetNote };
  if (v.kind !== "lead_magnet") return { ...base, details: null };
  const details: Record<string, unknown> = {};
  if (v.deliverable.trim()) details.deliverable = v.deliverable.trim();
  if (lines(v.leadFields).length) details.leadFields = lines(v.leadFields);
  if (lines(v.outline).length) details.outline = lines(v.outline);
  return { ...base, details: Object.keys(details).length ? details : null };
}
