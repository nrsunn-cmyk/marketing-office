"use server";

import { submitPublicInquiryFromRequest } from "@/features/public-inquiries/server";
import type { ContactErrors, ContactInput, ContactSubmitMeta, ContactSubmitResult } from "../_components/nadaum-brand/contact-model";
import { FIELD_ORDER } from "../_components/nadaum-brand/contact-model";

/**
 * NADAUM-BRAND-CONNECT-01: 공개 상담 폼(#contact) → Backend 계약 함수(51913d4) 연결.
 * 계약 함수만 부른다(서명·제한·사람 확인·DB 는 features/public-inquiries/server.ts). 입력값은 기록하지 않는다.
 * 저장 확인(ok)일 때만 'sent'. 그 밖은 서버 문구를 그대로 돌려주고 화면은 입력을 보존한다.
 */
/** 지난 시간(브라우저) → 서버 시계 기준 시작 시각. 이상한 값은 null(시간 검사 건너뜀), 0~하루로 자른다(Backend 검토 V1) */
const DAY_MS = 86_400_000;
function startedAtFrom(elapsedMs: unknown): number | null {
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs)) return null;
  return Date.now() - Math.min(DAY_MS, Math.max(0, elapsedMs));
}

export async function submitNadaumInquiry(input: ContactInput, meta: ContactSubmitMeta): Promise<ContactSubmitResult> {
  const r = await submitPublicInquiryFromRequest(input, {
    honeypot: typeof meta?.honeypot === "string" ? meta.honeypot : "",
    startedAt: startedAtFrom(meta?.elapsedMs),
  });
  if (r.ok) return { status: "sent", refCode: r.refCode };
  if (r.reason === "validation") {
    const errors: ContactErrors = {};
    for (const f of FIELD_ORDER) {
      const m = r.fieldErrors[f];
      if (m) errors[f] = m;
    }
    return { status: "failed", reason: "validation", message: r.message, errors };
  }
  return { status: "failed", reason: r.reason, message: r.message };
}
