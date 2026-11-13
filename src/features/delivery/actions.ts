"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import { DELIVERY_METHODS, recordDelivery, type DeliveryMethod } from "./server";

export async function recordDeliveryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const artifactId = z.uuid().safeParse(fd.get("artifactId"));
  const method = z.enum(Object.keys(DELIVERY_METHODS) as [DeliveryMethod, ...DeliveryMethod[]]).safeParse(fd.get("method"));
  if (!artifactId.success) return { message: "잘못된 요청입니다." };
  if (!method.success) return { errors: { method: "전달 방법을 골라 주세요." } };
  // 브라우저의 datetime-local 값(시간대 없음)과 브라우저 시간대 차이(분)를 함께 받아 정확한 시각으로 바꾼다
  const local = String(fd.get("deliveredAt") ?? "");
  const offset = Number(fd.get("tzOffset") ?? "0");
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m || !Number.isFinite(offset)) return { errors: { deliveredAt: "전달 시각을 입력해 주세요." } };
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + offset * 60_000;
  const note = String(fd.get("note") ?? "").trim().slice(0, 1000) || null;
  const r = await recordDelivery(artifactId.data, method.data, new Date(utc), note);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "전달 기록을 남겼습니다." };
}
