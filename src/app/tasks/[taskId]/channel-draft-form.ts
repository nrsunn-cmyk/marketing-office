import { CHANNEL_DRAFT_LIMITS, charLength, type ChannelDraftStatus } from "@/domain/channel-draft/constants";
import type { ChannelPublicationView } from "@/features/channel-draft/server";

/**
 * P2G-UI-01 채널 초안 화면 순수 도우미(브라우저·서버 공용, zod 없음).
 * 글자 수는 서버와 같이 코드 포인트로 센다. 값은 자르지 않고 표시만 한다(최종 판단은 서버).
 */

export interface ChannelDraftFormValue {
  title: string;
  body: string;
  /** 쉼표·줄바꿈으로 나눈 태그 글 */
  tags: string;
  imageNote: string;
  metaDescription: string;
  status: ChannelDraftStatus;
}

export function draftToForm(d: { title: string; body: string; tags: string[]; imageNote: string | null; metaDescription: string | null; status: ChannelDraftStatus }): ChannelDraftFormValue {
  return { title: d.title, body: d.body, tags: d.tags.join(", "), imageNote: d.imageNote ?? "", metaDescription: d.metaDescription ?? "", status: d.status };
}

/** 화면 표시용 태그 나누기(서버 splitTags 와 같은 규칙: 쉼표·줄바꿈, 앞뒤 공백 제거, 빈 칸 제거) */
export const formTags = (raw: string) =>
  raw
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

export type TagCheck = { count: number; tooMany: boolean; tooLong: string[]; duplicate: string[] };
/** 태그 안내: 개수·긴 태그·대소문자 무시 중복(서버 계약과 같은 기준) */
export function checkTags(raw: string): TagCheck {
  const tags = formTags(raw);
  const seen = new Set<string>();
  const duplicate: string[] = [];
  for (const t of tags) {
    const k = t.toLowerCase();
    if (seen.has(k) && !duplicate.includes(t)) duplicate.push(t);
    seen.add(k);
  }
  return { count: tags.length, tooMany: tags.length > CHANNEL_DRAFT_LIMITS.tags, tooLong: tags.filter((t) => charLength(t) > CHANNEL_DRAFT_LIMITS.tag), duplicate };
}

/** 게시 기록 목록: record 행만 보이고, 취소 행의 이유(note)를 그 기록에 붙인다 */
export interface PublicationRow {
  id: string;
  url: string | null;
  nonTistoryHost: boolean;
  publishedAt: string | null;
  note: string | null;
  voided: boolean;
  voidReason: string | null;
}
export function publicationRows(list: ChannelPublicationView[]): PublicationRow[] {
  const reasons = new Map<string, string | null>();
  for (const p of list) if (p.kind === "void" && p.voidsId) reasons.set(p.voidsId, p.note);
  return list
    .filter((p) => p.kind === "record")
    .map((p) => ({ id: p.id, url: p.url, nonTistoryHost: p.nonTistoryHost, publishedAt: p.publishedAt, note: p.note, voided: p.voided, voidReason: p.voided ? (reasons.get(p.id) ?? null) : null }))
    .reverse(); // 최근 기록이 위
}

/** 취소하지 않은 기록 수(한도 50은 이 수로 센다, QA D3) */
export const activePublicationCount = (list: ChannelPublicationView[]) => list.filter((p) => p.kind === "record" && !p.voided).length;

/** 게시 시각 입력의 기본값: 지금 한국 시간(datetime-local 모양 YYYY-MM-DDTHH:mm). 서버도 시간대 없는 값을 한국 시간으로 본다 */
export function kstLocalNow(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

/** 한국 시간 표시(게시 시각을 한국 시간으로 받으므로 보여 줄 때도 한국 시간) */
export function formatKst(iso: string | null): string {
  if (!iso) return "시각 없음";
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
