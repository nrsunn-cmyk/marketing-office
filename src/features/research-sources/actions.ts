"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { fieldErrors, type FormState } from "@/app/_components/form-state";
import { researchSourceInputSchema, reviewStatusSchema } from "@/domain/research-source/input";
import { addResearchSource, setResearchSourceReview } from "./server";

const uuid = z.uuid();
const text = (fd: FormData, name: string) => String(fd.get(name) ?? "");

/**
 * 출처 추가 폼. 칸 이름: projectId, url, title, publisher, retrievedAt, quotedExcerpt
 * 칸별 오류는 errors[칸 이름], 그 밖의 오류는 message 로 돌려준다.
 */
export async function addResearchSourceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const projectId = uuid.safeParse(fd.get("projectId"));
  if (!projectId.success) return { message: "잘못된 요청입니다." };
  const parsed = researchSourceInputSchema().safeParse({
    url: text(fd, "url"),
    title: text(fd, "title"),
    publisher: text(fd, "publisher"),
    retrievedAt: text(fd, "retrievedAt"),
    quotedExcerpt: text(fd, "quotedExcerpt"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error.issues) };
  const r = await addResearchSource(projectId.data, parsed.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "출처를 추가했습니다. 아직 '확인 전' 상태입니다." };
}

/** 검토 상태 변경 폼. 칸 이름: sourceId, status(unverified|verified), revision */
export async function setResearchSourceReviewAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const sourceId = uuid.safeParse(fd.get("sourceId"));
  const status = reviewStatusSchema.safeParse(fd.get("status"));
  const revision = z.coerce.number().int().positive().safeParse(fd.get("revision"));
  if (!sourceId.success || !status.success || !revision.success) return { message: "잘못된 요청입니다." };
  const r = await setResearchSourceReview(sourceId.data, status.data, revision.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: status.data === "verified" ? "출처를 '확인함'으로 바꿨습니다." : "출처를 '확인 전'으로 되돌렸습니다." };
}
