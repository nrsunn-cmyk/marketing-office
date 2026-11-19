"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import { archiveLeadMagnet, createLeadMagnet, rebaseLeadMagnet, setFunnelItemLeadMagnet, updateLeadMagnet } from "./server";

/**
 * P2E-UI-01 리드마그넷 폼 동작(서버 P2E-BACKEND-01). 폼 필드:
 * - 공통: 대상 id(stageId·leadMagnetId·itemId), revision(고칠 때)
 * - 내용: payload = JSON {title, format, audience?, promise?, delivery?, leadFields[], outline[], status} (계약 leadMagnetInputSchema)
 * - 카드 연결: itemId·revision(카드의 revision)·leadMagnetId(빈 값 = 연결 해제)
 */
const uuid = z.uuid();
const revision = z.coerce.number().int().positive();
// 글자 수. 제목 200 + 대상·가치 500×2 + 수집할 정보 10×50 + 구성 20×300 에 여유
const MAX_PAYLOAD = 20_000;
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

export async function createLeadMagnetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const stageId = uuid.safeParse(fd.get("stageId"));
  if (!stageId.success) return { message: "연결할 퍼널 단계를 골라 주세요." };
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await createLeadMagnet(stageId.data, p.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "리드마그넷을 추가했습니다." };
}

export async function updateLeadMagnetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("leadMagnetId"));
  const stageId = uuid.safeParse(fd.get("stageId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!id.success || !stageId.success || !rev.success) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await updateLeadMagnet(id.data, rev.data, stageId.data, p.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "리드마그넷을 저장했습니다." };
}

export async function rebaseLeadMagnetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("leadMagnetId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!id.success || !rev.success) return BAD;
  const r = await rebaseLeadMagnet(id.data, rev.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "지금 승인된 전략 기준으로 다시 맞췄습니다." };
}

export async function archiveLeadMagnetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("leadMagnetId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!id.success || !rev.success) return BAD;
  const r = await archiveLeadMagnet(id.data, rev.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "리드마그넷을 보관했습니다." };
}

export async function setFunnelItemLeadMagnetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const itemId = uuid.safeParse(fd.get("itemId"));
  const rev = revision.safeParse(fd.get("revision"));
  const raw = String(fd.get("leadMagnetId") ?? "");
  const lm = raw === "" ? null : uuid.safeParse(raw);
  if (!itemId.success || !rev.success || (lm && !lm.success)) return BAD;
  const r = await setFunnelItemLeadMagnet(itemId.data, rev.data, lm ? lm.data! : null);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: lm ? "리드마그넷을 연결했습니다." : "리드마그넷 연결을 풀었습니다." };
}
