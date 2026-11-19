"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import { archiveWebCopy, createWebCopyDoc, rebaseWebCopy, restoreWebCopyVersion, saveWebCopy } from "./server";

/**
 * P3B-UI-CONNECT-01 홈페이지 구조·문구 폼 동작(서버 P3B-BACKEND-IMPL-01, 인계상 Front 몫 — Backend 검토 요청).
 * 폼 필드:
 * - 만들기: briefId(+ 고르면 copyFromDocId)
 * - 저장: docId·revision, payload = JSON { status, pages } (화면 toWebCopyPayload 그대로, 기존 페이지·섹션은 id 를 꼭 담는다)
 * - 되돌리기: docId·revision·versionNo / 맞추기·보관: docId·revision
 * 값 검사는 서버 함수의 zod 계약(webCopySaveSchema)과 DB 가 한다.
 */
const uuid = z.uuid();
const revision = z.coerce.number().int().positive();
const versionNo = z.coerce.number().int().positive();
// 한도 끝까지 채운 문서(섹션 60개 × 칸 상한 합 2,700자 = 162,000자)가 이모지·이스케이프로 늘어나도 들어가는 여유.
// 칸별·개수 상한은 서버 zod·DB 가 막는다
const MAX_PAYLOAD = 700_000;
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

function docIds(fd: FormData): { docId: string; revision: number } | null {
  const id = uuid.safeParse(fd.get("docId"));
  const rev = revision.safeParse(fd.get("revision"));
  return id.success && rev.success ? { docId: id.data, revision: rev.data } : null;
}

export async function createWebCopyDocAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const briefId = uuid.safeParse(fd.get("briefId"));
  if (!briefId.success) return BAD;
  const rawCopy = fd.get("copyFromDocId");
  let copyFrom: string | null = null;
  if (rawCopy !== null && rawCopy !== "") {
    const c = uuid.safeParse(rawCopy);
    if (!c.success) return BAD;
    copyFrom = c.data;
  }
  const r = await createWebCopyDoc(briefId.data, copyFrom);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "홈페이지 구조·문구 문서를 만들었습니다." };
}

export async function saveWebCopyAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = docIds(fd);
  if (!ids) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await saveWebCopy(ids.docId, ids.revision, p.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "홈페이지 구조·문구를 저장했습니다." };
}

export async function restoreWebCopyVersionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = docIds(fd);
  const v = versionNo.safeParse(fd.get("versionNo"));
  if (!ids || !v.success) return BAD;
  const r = await restoreWebCopyVersion(ids.docId, ids.revision, v.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: `${v.data}번 판의 내용으로 새 판을 만들었습니다.` };
}

export async function rebaseWebCopyAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = docIds(fd);
  if (!ids) return BAD;
  const r = await rebaseWebCopy(ids.docId, ids.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "최신 제작 브리프 기준으로 맞췄습니다." };
}

export async function archiveWebCopyAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = docIds(fd);
  if (!ids) return BAD;
  const r = await archiveWebCopy(ids.docId, ids.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "홈페이지 구조·문구 문서를 보관했습니다." };
}
