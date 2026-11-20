"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import type { SourceUploadErrorCode } from "@/domain/assets/direct-upload";
import { addTextAsset, addUrlAsset, confirmPendingUpload, confirmSourceUpload, prepareSourceUpload, type AssetOwner } from "./server";

function ownerFrom(fd: FormData): AssetOwner | null {
  const id = z.uuid();
  const clientId = fd.get("clientId");
  const projectId = fd.get("projectId");
  const c = clientId ? id.safeParse(clientId) : null;
  const p = projectId ? id.safeParse(projectId) : null;
  if ((c && !c.success) || (p && !p.success) || (!c && !p)) return null;
  return { clientId: c?.success ? c.data : null, projectId: p?.success ? p.data : null };
}

const title = (fd: FormData) => String(fd.get("title") ?? "").trim().slice(0, 200) || null;

export async function addTextAssetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const owner = ownerFrom(fd);
  if (!owner) return { message: "잘못된 요청입니다." };
  const body = String(fd.get("text") ?? "").trim();
  if (!body) return { errors: { text: "메모 내용을 입력해 주세요." } };
  if (body.length > 20_000) return { errors: { text: "메모는 2만 자까지 입력할 수 있습니다." } };
  const r = await addTextAsset(owner, title(fd), body);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "메모를 저장했습니다." };
}

export async function addUrlAssetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const owner = ownerFrom(fd);
  if (!owner) return { message: "잘못된 요청입니다." };
  const url = z.url({ protocol: /^https?$/ }).max(2000).safeParse(String(fd.get("url") ?? "").trim());
  if (!url.success) return { errors: { url: "http:// 또는 https:// 로 시작하는 주소를 입력해 주세요." } };
  const r = await addUrlAsset(owner, title(fd), url.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "링크를 저장했습니다. (서버가 그 주소에 접속하지는 않습니다)" };
}

export async function confirmUploadAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const assetId = z.uuid().safeParse(fd.get("assetId"));
  if (!assetId.success) return { message: "잘못된 요청입니다." };
  const r = await confirmPendingUpload(assetId.data);
  refresh();
  if (!r.ok) return { message: r.message };
  return r.data.status === "stored"
    ? { ok: true, message: "파일이 저장소에 있어 보관 완료로 표시했습니다." }
    : { message: "저장소에 파일이 없어 실패로 표시했습니다. 파일을 다시 올려 주세요." };
}

// ─────────────────────────────────────────────
// SOURCE-UPLOAD-UI-01: 브라우저 직접 업로드(Backend SOURCE-UPLOAD-FIX-01 5절, Front 몫 — Backend 검토 요청).
// 파일 본문은 받지 않는다(운영 Vercel 함수 본문 4.5MB 한도). 이름·크기·id·경로 글자만 받는다.
//   prepareSourceUploadAction → 브라우저가 uploadUrl 로 XHR PUT(실제 바이트 진행) → confirmSourceUploadAction
// ─────────────────────────────────────────────
export type SourceStepResult<T> = { ok: true; data: T } | { ok: false; message: string; uploadCode?: SourceUploadErrorCode };

const uuid = z.uuid();
const prepareInput = z.strictObject({
  owner: z.strictObject({ clientId: uuid.nullable(), projectId: uuid.nullable() }),
  file: z.strictObject({ name: z.string().min(1).max(1000), size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }),
});

/** 저장소 서명 업로드 주소(supabase-js uploadToSignedUrl 과 같은 경로). 공개 주소만 쓴다 */
function signedUploadUrl(path: string, token: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  if (!base) return null;
  const u = new URL(`${base}/storage/v1/object/upload/sign/source-assets/${path.split("/").map(encodeURIComponent).join("/")}`);
  u.searchParams.set("token", token);
  return u.toString();
}

/** 1단계: 예약 + 서명 업로드 주소. owner = { clientId, projectId }(하나 이상), file = { name, size } */
export async function prepareSourceUploadAction(
  owner: { clientId: string | null; projectId: string | null },
  file: { name: string; size: number },
): Promise<SourceStepResult<{ uploadId: string; path: string; uploadUrl: string; mime: string; expiresAt: string }>> {
  const p = prepareInput.safeParse({ owner, file });
  if (!p.success || (!p.data.owner.clientId && !p.data.owner.projectId)) return { ok: false, message: "잘못된 요청입니다." };
  const r = await prepareSourceUpload(p.data.owner, p.data.file);
  if (!r.ok) return { ok: false, message: r.message, uploadCode: r.errors?.uploadCode };
  const uploadUrl = signedUploadUrl(r.data.path, r.data.token);
  if (!uploadUrl) return { ok: false, message: "파일을 저장하지 못했습니다. 다시 올려 주세요." };
  return { ok: true, data: { uploadId: r.data.uploadId, path: r.data.path, uploadUrl, mime: r.data.mime, expiresAt: r.data.expiresAt } };
}

/** 3단계: 서버가 저장소의 실제 바이트를 검사해 확정. 성공하면 자료 목록을 새로 고친다 */
export async function confirmSourceUploadAction(uploadId: string, path: string): Promise<SourceStepResult<{ id: string }>> {
  const id = uuid.safeParse(uploadId);
  if (!id.success || typeof path !== "string" || path.length > 300) return { ok: false, message: "잘못된 요청입니다." };
  const r = await confirmSourceUpload(id.data, path);
  if (!r.ok) {
    refresh(); // 거절도 목록 상태(실패)를 바꿀 수 있다
    return { ok: false, message: r.message, uploadCode: r.errors?.uploadCode };
  }
  refresh();
  return { ok: true, data: r.data };
}
