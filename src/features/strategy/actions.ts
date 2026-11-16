"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { strategyFormPayloadSchema } from "@/contracts/p2-strategy-form";
import type { FormState } from "@/app/_components/form-state";
import { generateStrategy, saveStrategyEdit } from "./server";

const uuid = z.uuid();
const key = z.string().min(8).max(100);
const MAX_PAYLOAD = 200_000; // 글자 수. 사실·추정 각 20개 × 영역 7개 × 500자에 여유

/** 폼의 JSON 한 덩어리를 읽는다. 모양이 틀리면 첫 안내 문구 */
function readPayload(fd: FormData) {
  const text = String(fd.get("payload") ?? "");
  if (!text || text.length > MAX_PAYLOAD) return { ok: false as const, message: "입력이 비었거나 너무 깁니다." };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false as const, message: "입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요." };
  }
  const parsed = strategyFormPayloadSchema.safeParse(json);
  if (!parsed.success) {
    const m = parsed.error.issues[0]?.message ?? "";
    return { ok: false as const, message: /[가-힣]/.test(m) ? m : "입력 형식이 올바르지 않습니다." };
  }
  return { ok: true as const, data: parsed.data };
}

export async function generateStrategyAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const taskId = uuid.safeParse(fd.get("taskId"));
  const k = key.safeParse(fd.get("idempotencyKey"));
  if (!taskId.success || !k.success) return { message: "잘못된 요청입니다." };
  const payload = readPayload(fd);
  if (!payload.ok) return { message: payload.message };
  const r = await generateStrategy(taskId.data, k.data, payload.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: r.data.reused ? "이미 같은 요청으로 만든 결과입니다." : `전략 초안 ${r.data.version}번 버전을 만들었습니다.` };
}

export async function saveStrategyEditAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const taskId = uuid.safeParse(fd.get("taskId"));
  const artifactId = uuid.safeParse(fd.get("artifactId"));
  const revision = z.coerce.number().int().positive().safeParse(fd.get("revision"));
  if (!taskId.success || !artifactId.success || !revision.success) return { message: "잘못된 요청입니다." };
  const payload = readPayload(fd);
  if (!payload.ok) return { message: payload.message };
  const r = await saveStrategyEdit(taskId.data, artifactId.data, revision.data, payload.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: `고친 내용을 ${r.data.version}번 버전으로 저장했습니다.` };
}
