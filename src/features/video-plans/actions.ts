"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import {
  archiveVideoPlan,
  cancelVideoUpload,
  createVideoPlan,
  finishVideoUpload,
  getVideoFileUrl,
  rebaseVideoPlan,
  restoreVideoFileVersion,
  restoreVideoPlanVersion,
  saveVideoPlan,
  startVideoUpload,
} from "./server";

/**
 * P3D-UI-CONNECT-01 영상 구성·파일 동작(서버 P3D-BACKEND-IMPL-01 4절, 인계상 Front 몫 — Backend 검토 요청).
 * 구성안: 만들기(첫 저장)·저장(새 판)·판 되돌리기·맞추기·보관은 폼 동작(FormState).
 * 파일 첨부는 화면이 단계별로 부른다: startVideoUploadAction → 브라우저 XHR PUT(실제 바이트) → finishVideoUploadAction,
 * 올리기 실패·취소면 cancelVideoUploadAction. 값 검사는 서버 zod 계약과 DB 가 한다.
 */
const uuid = z.uuid();
const INT_MAX = 2_147_483_647;
const revision = z.coerce.number().int().positive().max(INT_MAX);
const versionNo = z.coerce.number().int().positive().max(INT_MAX);
const BAD = { message: "잘못된 요청입니다." } as const;
// 장면 30개 × (이름 80 + 대사 1,000 + 자막 300 + 자산 10개 id) + 제목 — 이모지·이스케이프 여유
const MAX_PAYLOAD = 200_000;

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
function planIds(fd: FormData): { planId: string; revision: number } | null {
  const id = uuid.safeParse(fd.get("planId"));
  const rev = revision.safeParse(fd.get("revision"));
  return id.success && rev.success ? { planId: id.data, revision: rev.data } : null;
}

/** 만들기(첫 저장): productionBriefId + payload { title, aspectRatio, scenes } (편집기 값의 status 는 버린다) */
export async function createVideoPlanAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const briefId = uuid.safeParse(fd.get("productionBriefId"));
  if (!briefId.success) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const { title, aspectRatio, scenes } = p.data;
  const r = await createVideoPlan({ productionBriefId: briefId.data, title, aspectRatio, scenes });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "영상 구성안을 저장했습니다." };
}

/** 저장 = 새 판: payload { title, aspectRatio, status, scenes } — 장면 id 는 받은 그대로(새 장면만 null) */
export async function saveVideoPlanAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = planIds(fd);
  if (!ids) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await saveVideoPlan(ids.planId, ids.revision, p.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "영상 구성안을 저장했습니다." };
}

/** 구성안 판 되돌리기(빼기로 사라진 장면도 원래 id 로 새 판에) */
export async function restoreVideoPlanVersionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = planIds(fd);
  const v = versionNo.safeParse(fd.get("versionNo"));
  if (!ids || !v.success) return BAD;
  const r = await restoreVideoPlanVersion(ids.planId, ids.revision, v.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "선택한 판의 영상 구성안을 새 버전으로 복원했습니다." };
}

export async function rebaseVideoPlanAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = planIds(fd);
  if (!ids) return BAD;
  const r = await rebaseVideoPlan(ids.planId, ids.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "최신 기준으로 맞췄습니다." };
}

export async function archiveVideoPlanAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = planIds(fd);
  if (!ids) return BAD;
  const r = await archiveVideoPlan(ids.planId, ids.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "영상 구성안을 보관했습니다." };
}

/** 파일 판 되돌리기(같은 저장소 객체를 가리키는 새 파일 판) */
export async function restoreVideoFileVersionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = planIds(fd);
  const v = versionNo.safeParse(fd.get("version"));
  if (!ids || !v.success) return BAD;
  const r = await restoreVideoFileVersion(ids.planId, ids.revision, v.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "선택한 영상 파일 버전을 새 버전으로 복원했습니다." };
}

// ── 파일 첨부(단계별) ──
export type VideoStepResult<T> = { ok: true; data: T } | { ok: false; message: string };

function signedUploadUrl(path: string, token: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  if (!base) return null;
  const u = new URL(`${base}/storage/v1/object/upload/sign/video-files/${path.split("/").map(encodeURIComponent).join("/")}`);
  u.searchParams.set("token", token);
  return u.toString();
}

/** 1단계: 예약 + 서명 업로드 주소. raw = { planId, fileName, size, mime } */
export async function startVideoUploadAction(raw: unknown): Promise<VideoStepResult<{ uploadId: string; path: string; uploadUrl: string; mime: string; expiresAt: string }>> {
  const r = await startVideoUpload(raw);
  if (!r.ok) return { ok: false, message: r.message };
  const uploadUrl = signedUploadUrl(r.data.path, r.data.token);
  if (!uploadUrl) {
    await cancelVideoUpload(r.data.uploadId);
    return { ok: false, message: "업로드를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  return { ok: true, data: { uploadId: r.data.uploadId, path: r.data.path, uploadUrl, mime: r.data.mime, expiresAt: r.data.expiresAt } };
}

/** 3단계: 확정(서버가 앞 4KB 형식 표식 확인) */
export async function finishVideoUploadAction(planId: string, rev: number, path: string, raw: unknown): Promise<VideoStepResult<{ revision: number }>> {
  const id = uuid.safeParse(planId);
  const rv = revision.safeParse(rev);
  if (!id.success || !rv.success || typeof path !== "string" || path.length > 300) return { ok: false, ...BAD };
  const r = await finishVideoUpload(id.data, rv.data, path, raw);
  if (!r.ok) return { ok: false, message: r.message };
  refresh();
  return { ok: true, data: r.data };
}

/** 올리기 실패·취소면 예약을 닫는다 */
export async function cancelVideoUploadAction(uploadId: string): Promise<VideoStepResult<null>> {
  const id = uuid.safeParse(uploadId);
  if (!id.success) return { ok: false, ...BAD };
  const r = await cancelVideoUpload(id.data);
  return r.ok ? { ok: true, data: null } : { ok: false, message: r.message };
}

/** 내려받기 주소(60초, attachment) */
export async function videoDownloadUrlAction(planId: string, version: number): Promise<VideoStepResult<{ url: string }>> {
  const id = uuid.safeParse(planId);
  const v = versionNo.safeParse(version);
  if (!id.success || !v.success) return { ok: false, ...BAD };
  const r = await getVideoFileUrl(id.data, v.data);
  return r.ok ? { ok: true, data: { url: r.data.url } } : { ok: false, message: r.message };
}
