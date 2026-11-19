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
import { acceptBriefCopy, generateBriefCopy, type BriefCopyVariant } from "./ai-copy";

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

/** DEC08-AI-COPY-01: AI 초안 결과(화면이 변형을 보여 주고 고르게 한다). 브리프에는 아직 저장되지 않은 상태 */
export interface BriefCopyFormState extends FormState {
  runId?: string;
  reused?: boolean;
  variants?: BriefCopyVariant[];
}

/** AI 문구 초안 만들기. 폼 필드: taskId, briefId, revision, (선택) variants 1~3, maxChars 50~5000. 키가 없으면 꺼짐 문구 */
export async function generateBriefCopyAction(_prev: BriefCopyFormState, fd: FormData): Promise<BriefCopyFormState> {
  const taskId = uuid.safeParse(fd.get("taskId"));
  const briefId = uuid.safeParse(fd.get("briefId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!taskId.success || !briefId.success || !rev.success) return BAD;
  const opt = (name: string, min: number, max: number) => {
    const v = fd.get(name);
    if (v === null || v === "") return undefined;
    const n = z.coerce.number().int().min(min).max(max).safeParse(v);
    return n.success ? n.data : null;
  };
  const variants = opt("variants", 1, 3);
  const maxChars = opt("maxChars", 50, 5000);
  if (variants === null || maxChars === null) return BAD;
  const r = await generateBriefCopy(taskId.data, briefId.data, rev.data, { variants, maxChars });
  if (!r.ok) return { message: r.message };
  return {
    ok: true,
    message: r.data.reused ? "같은 내용으로 방금 만든 초안을 다시 보여 드립니다." : "AI 초안을 만들었습니다. 마음에 드는 것을 골라 카피 초안으로 쓰세요.",
    ...r.data,
  };
}

/** AI 초안 채택. 폼 필드: runId, variant(1부터), revision. 카피 초안에 저장되고 작성 방식은 'AI 초안'이 된다 */
export async function acceptBriefCopyAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const runId = uuid.safeParse(fd.get("runId"));
  const variant = z.coerce.number().int().min(1).max(3).safeParse(fd.get("variant"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!runId.success || !variant.success || !rev.success) return BAD;
  const r = await acceptBriefCopy(runId.data, variant.data, rev.data);
  if (!r.ok) return { message: r.message };
  return done("고른 AI 초안을 카피 초안에 넣었습니다. 쓰기 전에 사실을 한 번 더 확인해 주세요.");
}
