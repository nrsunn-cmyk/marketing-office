"use server";

import { revalidatePath } from "next/cache";
import { setAdminPublicInquiryStatus } from "@/features/admin/server";
import { isPublicInquiryStatus } from "@/features/public-inquiries/contract";
import type { FormState } from "../../_components/form-state";
import { INQ_COPY } from "./inquiry-copy";

/**
 * NADAUM-BRAND-CONNECT-01: 공개 상담 처리 상태 바꾸기(관리자). 계약 함수 setAdminPublicInquiryStatus(51913d4)만 부른다.
 * 비관리자·없는 id 는 서버가 NOT_FOUND. 화면이 보던 상태(expectedStatus)와 다르면 CONFLICT → 새로 고침 안내.
 */
export async function setInquiryStatusAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("id") ?? "");
  const status = String(fd.get("status") ?? "");
  const expectedStatus = String(fd.get("expectedStatus") ?? "");
  if (!isPublicInquiryStatus(status) || !isPublicInquiryStatus(expectedStatus)) return { errors: { status: "알 수 없는 상담 상태입니다." } };
  const r = await setAdminPublicInquiryStatus({ id, status, expectedStatus });
  if (!r.ok) return { message: r.message };
  revalidatePath("/admin/inquiries");
  return { ok: true, message: INQ_COPY.statusDone };
}
