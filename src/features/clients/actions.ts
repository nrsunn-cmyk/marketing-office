"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clientInputSchema, companyProfileInputSchema, projectInputSchema } from "@/contracts";
import { parseWon } from "@/domain/quote/parse";
import { fieldErrors, type FormState } from "@/app/_components/form-state";
import { createProjectRecord } from "@/features/projects/server";
import { addProfileVersion, createClientRecord, setClientArchived, updateClientRecord } from "./server";

const idSchema = z.uuid();
const revisionSchema = z.coerce.number().int().positive();

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "");
/** 여러 줄 입력 → 목록 (빈 줄 제외) */
const lines = (fd: FormData, key: string) =>
  text(fd, key)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export async function createClientAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = clientInputSchema.safeParse({
    name: text(fd, "name"),
    industry: text(fd, "industry"),
    description: text(fd, "description"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error.issues) };
  const r = await createClientRecord(parsed.data);
  if (!r.ok) return { message: r.message };
  redirect(`/clients/${r.data.id}`);
}

export async function updateClientAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = idSchema.safeParse(fd.get("id"));
  const revision = revisionSchema.safeParse(fd.get("revision"));
  if (!id.success || !revision.success) return { message: "잘못된 요청입니다." };
  const parsed = clientInputSchema.safeParse({
    name: text(fd, "name"),
    industry: text(fd, "industry"),
    description: text(fd, "description"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error.issues) };
  const r = await updateClientRecord(id.data, revision.data, parsed.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "저장했습니다." };
}

export async function archiveClientAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = idSchema.safeParse(fd.get("id"));
  const revision = revisionSchema.safeParse(fd.get("revision"));
  if (!id.success || !revision.success) return { message: "잘못된 요청입니다." };
  const archived = fd.get("archived") === "1";
  const r = await setClientArchived(id.data, revision.data, archived);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: archived ? "보관했습니다." : "보관을 해제했습니다." };
}

export async function addProfileVersionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const clientId = idSchema.safeParse(fd.get("clientId"));
  if (!clientId.success) return { message: "잘못된 요청입니다." };
  const parsed = companyProfileInputSchema.safeParse({
    products: text(fd, "products"),
    audience: text(fd, "audience"),
    strengths: lines(fd, "strengths"),
    brandRules: text(fd, "brandRules"),
    channelUrls: lines(fd, "channelUrls"),
  });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error.issues);
    if (errors.channelUrls) errors.channelUrls = "채널 주소는 http:// 또는 https:// 로 시작해야 합니다.";
    return { errors };
  }
  const r = await addProfileVersion(clientId.data, parsed.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: `회사 프로필 ${r.data.version}번 버전을 저장했습니다.` };
}

export async function createProjectAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const budget = parseWon(text(fd, "budget"));
  if (!budget.ok) return { errors: { budgetWon: "예산은 원 단위 숫자로 입력해 주세요." } };
  const kind = text(fd, "kind");
  const parsed = projectInputSchema.safeParse({
    kind,
    clientId: kind === "client" ? text(fd, "clientId") || undefined : null,
    title: text(fd, "title"),
    budgetWon: budget.value,
    dueAt: text(fd, "dueAt") || null,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error.issues) };
  const r = await createProjectRecord(parsed.data);
  if (!r.ok) return { message: r.message };
  redirect(`/projects/${r.data.id}`);
}
