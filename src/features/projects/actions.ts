"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import { changeProjectStatus } from "./server";

export async function changeProjectStatusAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = z.uuid().safeParse(fd.get("id"));
  const revision = z.coerce.number().int().positive().safeParse(fd.get("revision"));
  const to = z.string().min(1).safeParse(fd.get("to"));
  if (!id.success || !revision.success || !to.success) return { message: "잘못된 요청입니다." };
  const r = await changeProjectStatus(id.data, revision.data, to.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "상태를 바꿨습니다." };
}
