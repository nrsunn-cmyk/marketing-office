"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setAdminPublicInquiryStatus } from "@/features/admin/server";
import { isPublicInquiryStatus } from "@/features/public-inquiries/contract";
import { deletePublicInquiryAsAdmin } from "@/features/public-inquiries/server";
import type { FormState } from "../../_components/form-state";
import { cursorText, inquiriesHref, parseInquiryCursor } from "./inquiries-href";
import { INQ_COPY, INQ_DELETE_REASON_MAX } from "./inquiry-copy";

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

/**
 * NADAUM-INQUIRY-DELETE-FRONT-01: 공개 상담 1건 영구 삭제(관리자). 계약 함수 deletePublicInquiryAsAdmin(Backend)만 부른다.
 * 성공하면 상세를 닫은 같은 목록(상태·쪽 유지) 주소로 보내고, 주소의 deleted=참조 번호로 상단 안내를 띄운다.
 * 실패하면 { message } 로 돌려주어 화면이 role=alert 로 보인다. 사유는 서버 기록에 남기지 않는다.
 */
export async function deleteInquiryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("id") ?? "");
  const reason = String(fd.get("reason") ?? "");
  if ([...reason.trim()].length > INQ_DELETE_REASON_MAX) return { message: `삭제 사유는 ${INQ_DELETE_REASON_MAX}자 이하로 입력해 주세요.` };
  const status = fd.get("status");
  const before = cursorText(parseInquiryCursor(fd.get("before")));
  const r = await deletePublicInquiryAsAdmin({ id, reason });
  if (!r.ok) return { message: r.message };
  revalidatePath("/admin/inquiries");
  redirect(inquiriesHref({ status: isPublicInquiryStatus(status) ? status : null, before, deleted: r.data.refCode }));
}
