"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import type { DesignUploadErrorCode } from "@/domain/design-assets";
import {
  archiveDesignAsset,
  confirmDesignAssetCreate,
  confirmDesignAssetReplace,
  getDesignAssetFileUrl,
  prepareDesignAssetUpload,
  rebaseDesignAsset,
  restoreDesignAssetVersion,
  setDesignAssetUsages,
  updateDesignAsset,
} from "./server";

/**
 * P3C-UI-CONNECT-01 디자인 자산 동작(서버 P3C-BACKEND-IMPL-01, 인계상 Front 몫 — Backend 검토 요청).
 *
 * 올리기는 폼이 아니라 화면이 단계별로 부른다(Backend 보고서 6절):
 *   prepareDesignUploadAction → 브라우저가 uploadUrl 로 PUT(실제 바이트 진행) → confirmDesignCreateAction / confirmDesignReplaceAction
 * 실패하면 uploadCode·copyKey 를 그대로 돌려줘 화면이 AGY DA_COPY 문구를 고른다.
 * 그 밖의 쓰기는 폼 동작(FormState). 값 검사는 서버 함수의 zod 계약과 DB 가 한다.
 */
const uuid = z.uuid();
const INT_MAX = 2_147_483_647;
const revision = z.coerce.number().int().positive().max(INT_MAX);
const versionNo = z.coerce.number().int().positive().max(INT_MAX);
const BAD = { message: "잘못된 요청입니다." } as const;
const MAX_PAYLOAD = 8_000;

export type UploadStepResult<T> = { ok: true; data: T } | { ok: false; message: string; uploadCode?: DesignUploadErrorCode; copyKey?: string };

function stepFail(r: { message: string; errors?: { uploadCode?: DesignUploadErrorCode; copyKey?: string } }): { ok: false; message: string; uploadCode?: DesignUploadErrorCode; copyKey?: string } {
  return { ok: false, message: r.message, uploadCode: r.errors?.uploadCode, copyKey: r.errors?.copyKey };
}

/** 저장소 서명 업로드 주소(supabase-js uploadToSignedUrl 과 같은 경로). 공개 주소만 쓴다 */
function signedUploadUrl(path: string, token: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  if (!base) return null;
  const u = new URL(`${base}/storage/v1/object/upload/sign/design-assets/${path.split("/").map(encodeURIComponent).join("/")}`);
  u.searchParams.set("token", token);
  return u.toString();
}

/** 1단계: 예약 + 서명 업로드 주소. raw = { productionBriefId, assetId|null, kind, fileName, size, mime } */
export async function prepareDesignUploadAction(raw: unknown): Promise<UploadStepResult<{ uploadId: string; path: string; uploadUrl: string; mime: string; expiresAt: string }>> {
  const r = await prepareDesignAssetUpload(raw);
  if (!r.ok) return stepFail(r);
  const uploadUrl = signedUploadUrl(r.data.path, r.data.token);
  if (!uploadUrl) return { ok: false, message: "업로드를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  return { ok: true, data: { uploadId: r.data.uploadId, path: r.data.path, uploadUrl, mime: r.data.mime, expiresAt: r.data.expiresAt } };
}

/** 3단계(새 자산): raw = { uploadId, title, licenseNote, origin: "external_upload" } */
export async function confirmDesignCreateAction(path: string, raw: unknown): Promise<UploadStepResult<{ assetId: string }>> {
  if (typeof path !== "string" || path.length > 300) return { ok: false, ...BAD };
  const r = await confirmDesignAssetCreate(path, raw);
  if (!r.ok) return stepFail(r);
  refresh();
  return { ok: true, data: r.data };
}

/** 3단계(파일 교체): raw = { uploadId, changeNote } */
export async function confirmDesignReplaceAction(assetId: string, rev: number, path: string, raw: unknown): Promise<UploadStepResult<{ revision: number }>> {
  const id = uuid.safeParse(assetId);
  const rv = revision.safeParse(rev);
  if (!id.success || !rv.success || typeof path !== "string" || path.length > 300) return { ok: false, ...BAD };
  const r = await confirmDesignAssetReplace(id.data, rv.data, path, raw);
  if (!r.ok) return stepFail(r);
  refresh();
  return { ok: true, data: r.data };
}

/** 내려받기 주소(60초, attachment). 화면은 받은 주소로 바로 이동한다 */
export async function designDownloadUrlAction(assetId: string, version: number): Promise<UploadStepResult<{ url: string }>> {
  const id = uuid.safeParse(assetId);
  const v = versionNo.safeParse(version);
  if (!id.success || !v.success) return { ok: false, ...BAD };
  const r = await getDesignAssetFileUrl(id.data, v.data, "download");
  if (!r.ok) return { ok: false, message: r.message };
  return { ok: true, data: { url: r.data.url } };
}

// ── 폼 동작 ──
function assetIds(fd: FormData): { assetId: string; revision: number } | null {
  const id = uuid.safeParse(fd.get("assetId"));
  const rev = revision.safeParse(fd.get("revision"));
  return id.success && rev.success ? { assetId: id.data, revision: rev.data } : null;
}
function readPayload(fd: FormData): { ok: true; data: unknown } | { ok: false; message: string } {
  const text = String(fd.get("payload") ?? "");
  if (!text || text.length > MAX_PAYLOAD) return { ok: false, message: "입력이 비었거나 너무 깁니다." };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, message: "입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요." };
  }
}

/** 정보 저장: payload = { title, licenseNote, status } */
export async function updateDesignAssetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = assetIds(fd);
  if (!ids) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await updateDesignAsset(ids.assetId, ids.revision, p.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "디자인 자산 정보를 저장했습니다." };
}

export async function restoreDesignAssetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = assetIds(fd);
  const v = versionNo.safeParse(fd.get("version"));
  if (!ids || !v.success) return BAD;
  const r = await restoreDesignAssetVersion(ids.assetId, ids.revision, v.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "선택한 파일 버전을 새 버전으로 복원했습니다." };
}

export async function rebaseDesignAssetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = assetIds(fd);
  if (!ids) return BAD;
  const r = await rebaseDesignAsset(ids.assetId, ids.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "최신 기준으로 맞췄습니다." };
}

export async function archiveDesignAssetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = assetIds(fd);
  if (!ids) return BAD;
  const r = await archiveDesignAsset(ids.assetId, ids.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "디자인 자산을 보관했습니다." };
}

/** 사용처 전체 교체: payload = [{ docId, sectionId }] (0~20) */
export async function setDesignAssetUsagesAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = assetIds(fd);
  if (!ids) return BAD;
  const p = readPayload(fd);
  if (!p.ok) return { message: p.message };
  const r = await setDesignAssetUsages(ids.assetId, ids.revision, p.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "디자인 자산 정보를 저장했습니다." };
}
