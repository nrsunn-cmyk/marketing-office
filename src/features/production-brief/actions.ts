"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import { archiveProductionBrief, createProductionBrief, rebaseProductionBrief, updateProductionBrief } from "./server";

/**
 * P3A-UI-CONNECT-01 공통 제작 브리프 폼 동작(서버 P3A-BACKEND-01, 인계상 Front 몫 — Backend 검토 요청).
 * 폼 필드:
 * - 만들기: projectId·strategyArtifactId, payload = JSON {title, targetAudience, coreMessage, deliverableTypes[], scopeSummary, brandToneConstraints, referenceNotes}
 * - 고치기: briefId·revision, payload = 위 + status(drafting·ready)
 * - 맞추기·보관: briefId·revision
 * 값 검사·정리(앞뒤 공백)는 서버 함수의 zod 계약(productionBriefCreateSchema·UpdateSchema)이 한다.
 */
const uuid = z.uuid();
const revision = z.coerce.number().int().positive();
// 글자 수 상한 합(120+500+1000+2000+1000+1000 = 5,620 코드 포인트)이 모두 이모지(UTF-16 2단위)이고 따옴표·역슬래시가
// JSON 이스케이프로 두 배가 되어도 들어가는 여유(Backend 검토 낮음 의견). 칸별 상한은 서버 zod 가 막는다
const MAX_PAYLOAD = 32_000;
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

export async function createProductionBriefAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const projectId = uuid.safeParse(fd.get("projectId"));
  const strategyId = uuid.safeParse(fd.get("strategyArtifactId"));
  if (!projectId.success || !strategyId.success) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await createProductionBrief(projectId.data, strategyId.data, p.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "공통 제작 브리프를 만들었습니다." };
}

export async function updateProductionBriefAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("briefId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!id.success || !rev.success) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await updateProductionBrief(id.data, rev.data, p.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "공통 제작 브리프를 저장했습니다." };
}

export async function rebaseProductionBriefAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("briefId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!id.success || !rev.success) return BAD;
  const r = await rebaseProductionBrief(id.data, rev.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "지금 승인된 전략 기준으로 다시 맞췄습니다." };
}

export async function archiveProductionBriefAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("briefId"));
  const rev = revision.safeParse(fd.get("revision"));
  if (!id.success || !rev.success) return BAD;
  const r = await archiveProductionBrief(id.data, rev.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "제작 브리프를 보관했습니다." };
}
