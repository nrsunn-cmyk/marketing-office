import type { AdminPublicInquiryCursor } from "@/features/admin/server";
import type { PublicInquiryStatus } from "@/features/public-inquiries/contract";

/**
 * /admin/inquiries 주소 도우미(화면·서버 동작이 함께 쓴다). NADAUM-INQUIRY-DELETE-FRONT-01 에서 inquiries-view.tsx 밖으로 옮겼다
 * (서버 동작 파일이 화면 부품을 가져오지 않게).
 */

/** 커서는 '접수 시각|id' 한 값으로 주소에 싣는다(시각 글자는 받은 그대로 — 마이크로초 유지, Backend 계약 3-2) */
export function parseInquiryCursor(v: unknown): AdminPublicInquiryCursor | undefined {
  if (typeof v !== "string") return undefined;
  const i = v.lastIndexOf("|");
  if (i <= 0) return undefined;
  const beforeCreated = v.slice(0, i);
  const beforeId = v.slice(i + 1);
  return Number.isNaN(Date.parse(beforeCreated)) || !/^[0-9a-f-]{36}$/i.test(beforeId) ? undefined : { beforeCreated, beforeId };
}
export const cursorText = (c: AdminPublicInquiryCursor | null | undefined) => (c ? `${c.beforeCreated}|${c.beforeId}` : null);

/** 주소 만들기(상태·쪽·고른 상담, 삭제 직후 안내용 참조 번호) */
export function inquiriesHref(p: { status?: PublicInquiryStatus | null; before?: string | null; id?: string | null; deleted?: string | null }): string {
  const q = new URLSearchParams();
  if (p.status) q.set("status", p.status);
  if (p.before) q.set("before", p.before);
  if (p.id) q.set("id", p.id);
  if (p.deleted) q.set("deleted", p.deleted);
  const s = q.toString();
  return s ? `/admin/inquiries?${s}` : "/admin/inquiries";
}
