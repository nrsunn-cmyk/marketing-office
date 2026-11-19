/**
 * P2G-BACKEND-01: 채널 초안(P2-g) 순수 모듈. 입력 계약, 게시 주소·시각 정리, DB 오류 → 안내 문구.
 * DB 규칙: supabase/migrations/20261120001000_p2g_channel_drafts.sql (값 범위는 DB와 같게 둔다. 글자 수는 코드 포인트)
 */
import { z } from "zod";
import { funnelErrorFromDb, funnelIssueMessage } from "@/domain/funnel";
import {
  CHANNEL_DRAFT_LIMITS,
  CHANNEL_DRAFT_STATUSES,
  PUBLICATION_MIN_AT,
  PUBLICATION_URL_RE,
  charLength,
  type ChannelDraftStatus,
} from "./constants";

// 상수는 constants.ts 에 둔다(화면 import 경계는 client-imports.test.ts 가 검사)
export * from "./constants";

const L = CHANNEL_DRAFT_LIMITS;

/** DB app.funnel_trim 과 같은 정리(공백류 + NBSP·BOM) */
export const draftTrim = (s: string) => s.replace(/^[\s ﻿]+|[\s ﻿]+$/g, "");
/** DB app.draft_body 와 같은 정리: 줄바꿈을 \n 으로, 앞뒤 공백류 제거 */
export const normalizeDraftBody = (s: string) => draftTrim(s.replace(/\r\n?/g, "\n"));

const optionalText = (max: number, label: string) =>
  z
    .string()
    .transform(draftTrim)
    .refine((s) => charLength(s) <= max, `${label}은(는) ${max}자 이하여야 합니다.`)
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional()
    .transform((s) => s ?? null);

export const channelDraftInputSchema = z.strictObject({
  title: z
    .string()
    .transform(draftTrim)
    .refine((s) => s.length > 0, "제목을 입력해 주세요.")
    .refine((s) => charLength(s) <= L.title, `제목은 ${L.title}자 이하여야 합니다.`),
  body: z
    .string()
    .default("")
    .transform(normalizeDraftBody)
    .refine((s) => charLength(s) <= L.body, `본문은 ${L.body}자 이하여야 합니다.`),
  tags: z
    .array(
      z
        .string()
        .transform(draftTrim)
        .refine((s) => s.length > 0, "빈 태그가 있습니다.")
        .refine((s) => charLength(s) <= L.tag, `태그는 각 ${L.tag}자 이하여야 합니다.`),
    )
    .max(L.tags, `태그는 ${L.tags}개까지입니다.`)
    .refine((t) => new Set(t.map((x) => x.toLowerCase())).size === t.length, "같은 태그가 두 번 있습니다.")
    .default([]),
  imageNote: optionalText(L.imageNote, "대표 이미지 안내"),
  metaDescription: optionalText(L.metaDescription, "메타 설명"),
  status: z.enum(Object.keys(CHANNEL_DRAFT_STATUSES) as [ChannelDraftStatus, ...ChannelDraftStatus[]], "진행 상태를 골라 주세요.").default("drafting"),
});
export type ChannelDraftInput = z.infer<typeof channelDraftInputSchema>;

/** 쉼표·줄바꿈으로 나눈 태그 입력 → 배열(빈 칸 제거). 화면 입력칸용 */
export const splitTags = (raw: string) =>
  raw
    .split(/[,\n]/)
    .map(draftTrim)
    .filter((t) => t.length > 0);

export type UrlCheck = { ok: true; url: string } | { ok: false; message: string };
const URL_MESSAGE = "게시 주소는 https:// 로 시작하는 올바른 주소여야 합니다.";
/**
 * 게시 주소 정리: 앞뒤 공백 제거 → 가운데 공백·제어 문자 거절(URL 해석기가 조용히 지우는 것을 막는다) →
 * https:// 로 시작해야 함(https:host 같은 생략형 거절) → new URL 로 정규화(퓨니코드·소문자 호스트) → 사용자 정보 거절 → DB 와 같은 식·길이.
 */
export function normalizePublicationUrl(raw: unknown): UrlCheck {
  if (typeof raw !== "string") return { ok: false, message: URL_MESSAGE };
  const t = draftTrim(raw);
  // 공백·제어 문자(Cc)·서식 문자(Cf: ZWSP·RLO 등, QA D2)는 어디에 있든 거절한다(URL 해석기가 %인코딩해 통과시키지 않도록 먼저 본다)
  if (!t || /[\s\p{Cc}\p{Cf}]/u.test(t) || !/^https:\/\//i.test(t)) return { ok: false, message: URL_MESSAGE };
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { ok: false, message: URL_MESSAGE };
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return { ok: false, message: URL_MESSAGE };
  const href = u.href;
  if (href.length > L.publicationUrl) return { ok: false, message: `게시 주소는 ${L.publicationUrl}자 이하여야 합니다.` };
  if (!PUBLICATION_URL_RE.test(href)) return { ok: false, message: URL_MESSAGE };
  return { ok: true, url: href };
}

export type TimeCheck = { ok: true; iso: string } | { ok: false; message: string };
/**
 * 게시 시각 해석. 시간대가 없는 값(datetime-local "YYYY-MM-DDTHH:mm[:ss]")은 한국 시간(+09:00)으로 본다.
 * Z·±hh:mm 이 붙은 ISO 값도 받는다. 미래 5분 초과·2000년 이전은 거절(DB 와 같음).
 */
export function parsePublishedAt(raw: unknown, now: Date = new Date()): TimeCheck {
  if (typeof raw !== "string") return { ok: false, message: "게시 시각을 입력해 주세요." };
  const t = raw.trim();
  let iso: string;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t)) iso = `${t.length === 16 ? `${t}:00` : t}+09:00`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(t)) iso = t;
  else return { ok: false, message: "게시 시각 형식이 올바르지 않습니다." };
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return { ok: false, message: "게시 시각 형식이 올바르지 않습니다." };
  if (ms > now.getTime() + L.futureSkewMs) return { ok: false, message: "게시 시각이 미래입니다." };
  if (ms < Date.parse(PUBLICATION_MIN_AT)) return { ok: false, message: "게시 시각이 너무 이릅니다(2000년 이후만)." };
  return { ok: true, iso: new Date(ms).toISOString() };
}

export const publicationInputSchema = z.strictObject({
  url: z.string(),
  publishedAt: z.string(),
  note: optionalText(L.publicationNote, "메모"),
});
export const voidInputSchema = z.strictObject({
  reason: z
    .string()
    .transform(draftTrim)
    .refine((s) => s.length > 0, "취소 이유를 입력해 주세요.")
    .refine((s) => charLength(s) <= L.publicationNote, `취소 이유는 ${L.publicationNote}자 이하여야 합니다.`),
});

/** DB 오류 → 안내 문구. 코드 체계가 퍼널과 같아 퍼널 변환을 쓰고, 고정 문구만 초안용으로 바꾼다 */
export function channelDraftErrorFromDb(message: string | null | undefined) {
  const e = funnelErrorFromDb(message);
  if (e.code === "NOT_FOUND") return { code: e.code, message: "초안이나 브리프를 찾을 수 없습니다. 화면을 새로 고쳐 주세요." };
  if (e.code === "STRATEGY_NOT_APPROVED") return { code: e.code, message: "승인된 전략이 있어야 전략 기준을 다시 맞출 수 있습니다." };
  return e;
}

export const channelDraftIssueMessage = funnelIssueMessage;
