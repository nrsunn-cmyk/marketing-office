"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import { addTextAsset, addUrlAsset, uploadFileAsset, type AssetOwner } from "./server";

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

export async function uploadAssetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const owner = ownerFrom(fd);
  if (!owner) return { message: "잘못된 요청입니다." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { errors: { file: "올릴 파일을 선택해 주세요." } };
  const r = await uploadFileAsset(owner, file);
  refresh();
  if (!r.ok) return { message: r.message };
  return { ok: true, message: "파일을 보관했습니다. (내용은 아직 읽지 않았습니다)" };
}

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
