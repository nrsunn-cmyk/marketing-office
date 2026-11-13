"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import type { QuoteFormText } from "@/domain/quote/form";
import { finalizeQuote, saveQuoteDraft } from "./server";

const rowSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  description: z.string().max(1000),
  quantity: z.string().max(40),
  unitPrice: z.string().max(40),
  freeItemConfirmed: z.boolean(),
  zeroAmountConfirmed: z.boolean(),
});

const formSchema = z.object({
  taxMode: z.enum(["EXCLUSIVE", "INCLUSIVE", "NO_TAX"]),
  taxRate: z.string().max(20),
  issueDate: z.string().max(10),
  validUntil: z.string().max(10),
  paymentTerms: z.string().max(2000),
  notes: z.string().max(4000),
  rows: z.array(rowSchema).max(201),
}) satisfies z.ZodType<QuoteFormText>;

export async function saveQuoteDraftAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const taskId = z.uuid().safeParse(fd.get("taskId"));
  const revRaw = String(fd.get("revision") ?? "");
  const revision = revRaw === "" ? null : Number(revRaw);
  if (!taskId.success || (revision !== null && !Number.isInteger(revision))) return { message: "잘못된 요청입니다." };
  let payload: unknown;
  try {
    payload = JSON.parse(String(fd.get("payload") ?? ""));
  } catch {
    return { message: "잘못된 요청입니다." };
  }
  const form = formSchema.safeParse(payload);
  if (!form.success) return { message: "입력 형식이 올바르지 않습니다." };

  const r = await saveQuoteDraft(taskId.data, revision, form.data);
  if (!r.ok) return { message: r.message, errors: r.errors };
  refresh();
  return { ok: true, message: `견적 초안 ${r.data.version}번 버전을 저장했습니다.` };
}

export async function finalizeQuoteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const taskId = z.uuid().safeParse(fd.get("taskId"));
  const versionId = z.uuid().safeParse(fd.get("versionId"));
  if (!taskId.success || !versionId.success) return { message: "잘못된 요청입니다." };
  const r = await finalizeQuote(taskId.data, versionId.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: `견적을 확정했습니다. 견적 번호 ${r.data.quoteNumber}` };
}
