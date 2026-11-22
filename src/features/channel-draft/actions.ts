"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import { splitTags } from "@/domain/channel-draft";
import {
  archiveChannelDraft,
  createChannelDraft,
  rebaseChannelDraft,
  recordChannelPublication,
  updateChannelDraft,
  voidChannelPublication,
} from "./server";

/**
 * P2G-UI-01 채널 초안 폼 동작(서버 P2G-BACKEND-01, 인계 5절: actions.ts 는 Front 몫). 리드마그넷 actions 와 같은 모양.
 * 폼 필드:
 * - 만들기: briefId
 * - 고치기: draftId·revision + title·body·tags(쉼표·줄바꿈 글)·imageNote·metaDescription·status
 * - 맞추기·보관: draftId·revision
 * - 게시 기록: draftId + url·publishedAt(datetime-local 값 그대로, 서버가 한국 시간으로 해석)·note
 * - 기록 취소: publicationId + reason
 * 값 검사는 서버 함수의 zod 계약이 한다. 여기서는 id·revision 모양과 글 길이 상한만 본다.
 */
const uuid = z.uuid();
const revision = z.coerce.number().int().positive();
const BAD = { message: "잘못된 요청입니다." } as const;
// 폼 한 칸이 받는 글 상한(본문 20000자 + 여유). 넘으면 서버 계약까지 가지 않고 거절한다
const MAX_FIELD = 40_000;

function text(fd: FormData, name: string): string | null {
  const v = fd.get(name);
  if (v === null) return "";
  if (typeof v !== "string" || v.length > MAX_FIELD) return null;
  return v;
}

export async function createChannelDraftAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const briefId = uuid.safeParse(fd.get("briefId"));
  if (!briefId.success) return BAD;
  const r = await createChannelDraft(briefId.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "티스토리 초안을 만들었습니다." };
}

export async function updateChannelDraftAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("draftId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!id.success || !rev.success) return BAD;
  const fields = ["title", "body", "tags", "imageNote", "metaDescription", "status"].map((n) => text(fd, n));
  if (fields.some((v) => v === null)) return { message: "입력이 너무 깁니다." };
  const [title, body, tags, imageNote, metaDescription, status] = fields as string[];
  const r = await updateChannelDraft(id.data, rev.data, { title, body, tags: splitTags(tags), imageNote, metaDescription, status });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "초안을 저장했습니다." };
}

export async function rebaseChannelDraftAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("draftId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!id.success || !rev.success) return BAD;
  const r = await rebaseChannelDraft(id.data, rev.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "지금 승인된 전략 기준으로 다시 맞췄습니다." };
}

export async function archiveChannelDraftAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("draftId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!id.success || !rev.success) return BAD;
  const r = await archiveChannelDraft(id.data, rev.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "초안을 보관했습니다." };
}

export async function recordChannelPublicationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("draftId"));
  if (!id.success) return BAD;
  const [url, publishedAt, note] = ["url", "publishedAt", "note"].map((n) => text(fd, n));
  if (url === null || publishedAt === null || note === null) return { message: "입력이 너무 깁니다." };
  const r = await recordChannelPublication(id.data, { url, publishedAt, note });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "게시 기록을 남겼습니다." };
}

export async function voidChannelPublicationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("publicationId"));
  if (!id.success) return BAD;
  const reason = text(fd, "reason");
  if (reason === null) return { message: "입력이 너무 깁니다." };
  const r = await voidChannelPublication(id.data, { reason });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "게시 기록을 취소했습니다." };
}
