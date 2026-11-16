"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import { decideProfileVersion } from "./server";

const schema = z.strictObject({
  clientId: z.uuid(),
  versionId: z.uuid(),
  decision: z.enum(["approved", "revoked"]),
  expectedLastSeq: z.coerce.number().int().min(0),
  contentHash: z.string().regex(/^[0-9a-f]{16}$/),
  comment: z.string().max(1000).optional(),
});

/** 프로필 버전 승인·철회 */
export async function decideProfileAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = schema.safeParse({
    clientId: fd.get("clientId"),
    versionId: fd.get("versionId"),
    decision: fd.get("decision"),
    expectedLastSeq: fd.get("expectedLastSeq"),
    contentHash: fd.get("contentHash"),
    comment: String(fd.get("comment") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { message: "잘못된 요청입니다. 화면을 새로 고쳐 주세요." };
  const r = await decideProfileVersion({ ...parsed.data, comment: parsed.data.comment ?? null });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: r.data.status === "approved" ? "이 버전을 승인했습니다." : "이 버전의 승인을 철회했습니다." };
}
