"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import { addFunnelItem, archiveFunnelItem, createFunnel, rebaseFunnel, updateFunnelItem, updateFunnelStage } from "./server";

/**
 * P2D-BACKEND-01 퍼널 보드 폼 동작. 폼 필드:
 * - 공통: 대상 id(taskId·funnelId·stageId·itemId), revision(고칠 때)
 * - 카드: payload = JSON {kind, title, description?, channel?, status?, targetNote?, details?} (계약 funnelItemInputSchema)
 */
const uuid = z.uuid();
const revision = z.coerce.number().int().positive();
const MAX_PAYLOAD = 20_000; // 글자 수. 설명 2000자 + 리드마그넷 아웃라인 20줄×300자에 여유

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

export async function createFunnelAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const taskId = uuid.safeParse(fd.get("taskId"));
  if (!taskId.success) return BAD;
  const r = await createFunnel(taskId.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: r.data.reused ? "이미 만든 퍼널 보드입니다." : "퍼널 보드를 만들었습니다." };
}

export async function rebaseFunnelAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const funnelId = uuid.safeParse(fd.get("funnelId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!funnelId.success || !rev.success) return BAD;
  const r = await rebaseFunnel(funnelId.data, rev.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "지금 승인된 전략 기준으로 다시 맞췄습니다." };
}

export async function updateFunnelStageAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const stageId = uuid.safeParse(fd.get("stageId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!stageId.success || !rev.success) return BAD;
  const r = await updateFunnelStage(stageId.data, rev.data, String(fd.get("focus") ?? ""));
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "단계 타깃을 저장했습니다." };
}

export async function addFunnelItemAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const stageId = uuid.safeParse(fd.get("stageId"));
  if (!stageId.success) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await addFunnelItem(stageId.data, p.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "카드를 추가했습니다." };
}

export async function updateFunnelItemAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const itemId = uuid.safeParse(fd.get("itemId"));
  const stageId = uuid.safeParse(fd.get("stageId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!itemId.success || !stageId.success || !rev.success) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await updateFunnelItem(itemId.data, rev.data, stageId.data, p.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "카드를 저장했습니다." };
}

export async function archiveFunnelItemAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const itemId = uuid.safeParse(fd.get("itemId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!itemId.success || !rev.success) return BAD;
  const r = await archiveFunnelItem(itemId.data, rev.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "카드를 보관했습니다." };
}
