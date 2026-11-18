"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import {
  addBriefClaim,
  archiveBriefClaim,
  archiveContentBrief,
  createContentBrief,
  linkClaimSource,
  rebaseContentBrief,
  unlinkClaimSource,
  updateBriefClaim,
  updateContentBrief,
} from "./server";

/**
 * P2F-BACKEND-01 브리프 폼 동작. 폼 필드:
 * - 대상 id(taskId·funnelItemId·briefId·claimId·sourceId), revision(고칠 때), channel(만들 때)
 * - payload = JSON. 브리프 수정은 briefUpdateSchema, 주장은 claimInputSchema, 근거 연결은 sourceLinkSchema
 */
const uuid = z.uuid();
const revision = z.coerce.number().int().positive();
const MAX_PAYLOAD = 40_000; // 글자 수. 카피 초안 5000 + 이미지 가이드 2000 + 채널 spec 에 여유
const BAD = { message: "잘못된 요청입니다." } as const;

function readPayload(fd: FormData): { ok: true; data: unknown } | { ok: false; message: string } {
  const text = String(fd.get("payload") ?? "");
  if (!text || text.length > MAX_PAYLOAD) return { ok: false, message: "입력이 비었거나 너무 깁니다." };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, message: "입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요." };
  }
}
const done = (message: string): FormState => {
  refresh();
  return { ok: true, message };
};

export async function createContentBriefAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const taskId = uuid.safeParse(fd.get("taskId"));
  const itemId = uuid.safeParse(fd.get("funnelItemId"));
  if (!taskId.success || !itemId.success) return BAD;
  const r = await createContentBrief(taskId.data, itemId.data, fd.get("channel"));
  if (!r.ok) return { message: r.message };
  return done(r.data.reused ? "이미 만든 브리프입니다." : "브리프를 만들었습니다.");
}

export async function updateContentBriefAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const briefId = uuid.safeParse(fd.get("briefId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!briefId.success || !rev.success) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await updateContentBrief(briefId.data, rev.data, p.data);
  if (!r.ok) return { message: r.message };
  return done("브리프를 저장했습니다.");
}

export async function rebaseContentBriefAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const briefId = uuid.safeParse(fd.get("briefId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!briefId.success || !rev.success) return BAD;
  const r = await rebaseContentBrief(briefId.data, rev.data);
  if (!r.ok) return { message: r.message };
  return done("지금 승인된 전략 기준으로 다시 맞췄습니다.");
}

export async function archiveContentBriefAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const briefId = uuid.safeParse(fd.get("briefId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!briefId.success || !rev.success) return BAD;
  const r = await archiveContentBrief(briefId.data, rev.data);
  if (!r.ok) return { message: r.message };
  return done("브리프를 보관했습니다.");
}

export async function addBriefClaimAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const briefId = uuid.safeParse(fd.get("briefId"));
  if (!briefId.success) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await addBriefClaim(briefId.data, p.data);
  if (!r.ok) return { message: r.message };
  return done("주장을 추가했습니다.");
}

export async function updateBriefClaimAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const claimId = uuid.safeParse(fd.get("claimId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!claimId.success || !rev.success) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await updateBriefClaim(claimId.data, rev.data, p.data);
  if (!r.ok) return { message: r.message };
  return done("주장을 저장했습니다.");
}

export async function archiveBriefClaimAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const claimId = uuid.safeParse(fd.get("claimId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!claimId.success || !rev.success) return BAD;
  const r = await archiveBriefClaim(claimId.data, rev.data);
  if (!r.ok) return { message: r.message };
  return done("주장을 보관했습니다.");
}

export async function linkClaimSourceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const claimId = uuid.safeParse(fd.get("claimId"));
  if (!claimId.success) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await linkClaimSource(claimId.data, p.data);
  if (!r.ok) return { message: r.message };
  return done("근거를 연결했습니다.");
}

export async function unlinkClaimSourceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const sourceId = uuid.safeParse(fd.get("sourceId"));
  if (!sourceId.success) return BAD;
  const r = await unlinkClaimSource(sourceId.data);
  if (!r.ok) return { message: r.message };
  return done("근거 연결을 해제했습니다. 근거가 없는 주장은 [미확인 주장]으로 표시됩니다.");
}
