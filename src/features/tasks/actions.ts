"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logoBriefInputSchema } from "@/contracts";
import { fieldErrors, type FormState } from "@/app/_components/form-state";
import { createTask, decideVersion, generateLogoBrief, saveLogoEdit } from "./server";

const uuid = z.uuid();
const key = z.string().min(8).max(100);
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const lines = (fd: FormData, k: string) =>
  text(fd, k)
    .split(/\r?\n|,/)
    .map((l) => l.trim())
    .filter(Boolean);

export async function createTaskAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const projectId = uuid.safeParse(fd.get("projectId"));
  const k = key.safeParse(fd.get("idempotencyKey"));
  const type = z.enum(["logo_brief", "quote"]).safeParse(fd.get("type"));
  if (!projectId.success || !k.success || !type.success) return { message: "잘못된 요청입니다." };
  const r = await createTask(projectId.data, type.data, k.data);
  if (!r.ok) return { message: r.message };
  redirect(`/tasks/${r.data.id}`);
}

export async function generateLogoAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const taskId = uuid.safeParse(fd.get("taskId"));
  const k = key.safeParse(fd.get("idempotencyKey"));
  if (!taskId.success || !k.success) return { message: "잘못된 요청입니다." };
  const parsed = logoBriefInputSchema.safeParse({
    companyName: text(fd, "companyName"),
    industry: text(fd, "industry"),
    description: text(fd, "description"),
    mainCustomers: text(fd, "mainCustomers"),
    strengths: lines(fd, "strengths"),
    preferredStyles: lines(fd, "preferredStyles"),
    colors: lines(fd, "colors"),
    references: lines(fd, "references"),
    forbidden: lines(fd, "forbidden"),
    extraNotes: text(fd, "extraNotes"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error.issues) };
  const r = await generateLogoBrief(taskId.data, k.data, parsed.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return {
    ok: true,
    message: r.data.reused ? "이미 같은 요청으로 만든 결과입니다." : `브리프 ${r.data.version}번 버전을 만들었습니다.`,
  };
}

export async function saveEditAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const artifactId = uuid.safeParse(fd.get("artifactId"));
  const revision = z.coerce.number().int().positive().safeParse(fd.get("revision"));
  if (!artifactId.success || !revision.success) return { message: "잘못된 요청입니다." };
  const brief = text(fd, "brief").trim();
  const imagePrompt = text(fd, "imagePrompt").trim();
  if (!brief || !imagePrompt) return { errors: { brief: "브리프와 이미지 프롬프트는 비워 둘 수 없습니다." } };
  if (brief.length > 20_000 || imagePrompt.length > 5_000) return { errors: { brief: "내용이 너무 깁니다." } };
  const r = await saveLogoEdit(artifactId.data, revision.data, { brief, imagePrompt });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: `고친 내용을 ${r.data.version}번 버전으로 저장했습니다.` };
}

export async function decideAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const artifactId = uuid.safeParse(fd.get("artifactId"));
  const versionId = uuid.safeParse(fd.get("versionId"));
  const decision = z.enum(["approved", "changes_requested"]).safeParse(fd.get("decision"));
  if (!artifactId.success || !versionId.success || !decision.success) return { message: "잘못된 요청입니다." };
  const comment = text(fd, "comment").trim().slice(0, 2000) || null;
  const r = await decideVersion(artifactId.data, versionId.data, decision.data, comment);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: decision.data === "approved" ? "승인했습니다." : "수정 요청으로 표시했습니다." };
}
