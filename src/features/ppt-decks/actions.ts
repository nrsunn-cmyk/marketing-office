"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import { archivePptDeck, createPptDeck, rebasePptDeck, restorePptDeckVersion, savePptDeck } from "./server";

/**
 * P3E-UI-CONNECT-01 PPT 구성안 동작(서버 P3E-BACKEND-IMPL-01 5절, 인계상 Front 몫 — Backend 검토 요청).
 * 만들기(첫 저장)·저장(새 판, 최대 20)·판 되돌리기·맞추기·보관은 폼 동작(FormState). 값 검사는 서버 zod 계약과 DB 가 한다.
 * 내보내기(.pptx·.md)는 동작이 아니라 경로 처리기 링크(GET /ppt-decks/[deckId]/export)다.
 * 성공 문구는 PPT_COPY(savedOk·restoredOk·archivedOk) 그대로.
 */
const uuid = z.uuid();
const INT_MAX = 2_147_483_647;
const revision = z.coerce.number().int().positive().max(INT_MAX);
const versionNo = z.coerce.number().int().positive().max(INT_MAX);
const BAD = { message: "잘못된 요청입니다." } as const;
// 40장 × (제목 100 + 요점 1,000 + 메모 1,000 + 자산 10개 id) + 제목 — 이모지·이스케이프 여유
const MAX_PAYLOAD = 400_000;

function readPayload(fd: FormData): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } {
  const text = String(fd.get("payload") ?? "");
  if (!text || text.length > MAX_PAYLOAD) return { ok: false, message: "입력이 비었거나 너무 깁니다." };
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, data: v as Record<string, unknown> } : { ok: false, message: "입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요." };
  } catch {
    return { ok: false, message: "입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요." };
  }
}
function deckIds(fd: FormData): { deckId: string; revision: number } | null {
  const id = uuid.safeParse(fd.get("deckId"));
  const rev = revision.safeParse(fd.get("revision"));
  return id.success && rev.success ? { deckId: id.data, revision: rev.data } : null;
}

/** 만들기(첫 저장): productionBriefId + payload { title, templateKey, slides } (편집기 값의 status 는 버린다 — 만들 때는 작성 중) */
export async function createPptDeckAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const briefId = uuid.safeParse(fd.get("productionBriefId"));
  if (!briefId.success) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const { title, templateKey, slides } = p.data;
  const r = await createPptDeck({ productionBriefId: briefId.data, title, templateKey, slides });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "PPT 구성안을 저장했습니다." };
}

/** 저장 = 새 판: payload { title, templateKey, status, slides } — 슬라이드 id 는 받은 그대로(새 장만 null) */
export async function savePptDeckAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = deckIds(fd);
  if (!ids) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await savePptDeck(ids.deckId, ids.revision, p.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "PPT 구성안을 저장했습니다." };
}

/** 판 되돌리기(빼기로 사라진 슬라이드도 원래 id 로 새 판에) */
export async function restorePptDeckVersionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = deckIds(fd);
  const v = versionNo.safeParse(fd.get("versionNo"));
  if (!ids || !v.success) return BAD;
  const r = await restorePptDeckVersion(ids.deckId, ids.revision, v.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "선택한 판의 PPT 구성안을 새 판으로 복원했습니다." };
}

export async function rebasePptDeckAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = deckIds(fd);
  if (!ids) return BAD;
  const r = await rebasePptDeck(ids.deckId, ids.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "최신 기준으로 맞췄습니다." };
}

export async function archivePptDeckAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = deckIds(fd);
  if (!ids) return BAD;
  const r = await archivePptDeck(ids.deckId, ids.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "PPT 구성안을 보관했습니다." };
}
