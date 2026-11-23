import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/server/supabase/server";
import {
  PUBLIC_INQUIRY_CONSENT_VERSION,
  PUBLIC_INQUIRY_SERVICES,
  isPublicInquiryField,
  normalizePublicInquiryInput,
  validatePublicInquiry,
  type PublicInquiryFieldErrors,
  type PublicInquirySubmitResult,
} from "./contract";

/**
 * NADAUM-BRAND-BACKEND-01 (3B): 공개 상담 접수 서버 함수.
 * - 서명 키 PUBLIC_INQUIRY_SIGNING_KEY = DB app.server_secrets 'public_inquiry_signing'(migration 20261123010000 이 만든 값).
 *   키가 없으면 접수를 끈다(unavailable). 서명 없는 직접 RPC 호출은 DB 가 BAD_SIGNATURE 로 거절한다.
 * - 접속자 구분값 client_hash = HMAC(키, "client|" + IP). IP 원문은 DB 로 보내지 않는다.
 * - 개인정보(이름·전화·내용)는 서버 기록(console)에 남기지 않는다. 오류 코드만 남긴다.
 * - 화면(Front)은 서버 동작에서 submitPublicInquiryFromRequest(입력, { honeypot, startedAt }) 를 부른다.
 */

const signingKey = () => process.env.PUBLIC_INQUIRY_SIGNING_KEY?.trim() || "";

/** 사람이 폼을 채우는 데 걸리는 최소 시간(ms). 이보다 빠르면 자동 제출로 본다 */
export const MIN_FILL_MS = 2500;

const MSG = {
  unavailable: "지금은 온라인 상담 접수를 받을 수 없습니다. 잠시 후 다시 시도해 주세요.",
  error: "상담 신청을 저장하지 못했습니다. 입력하신 내용은 그대로 있으니 잠시 후 다시 시도해 주세요.",
  tooFast: "잠시 후 다시 시도해 주세요.",
  validation: "입력 내용을 확인해 주세요.",
} as const;

export function signPublicInquiry(key: string, signedAt: number, nonce: string, clientHash: string, payload: string): string {
  return createHmac("sha256", key).update(`public_inquiry_submit|${signedAt}|${nonce}|${clientHash}|${payload}`, "utf8").digest("hex");
}

export function clientHashOf(key: string, ip: string): string {
  return createHmac("sha256", key).update(`client|${ip}`, "utf8").digest("hex");
}

/** 요청 머리글에서 접속 IP. Vercel 은 x-forwarded-for 첫 값이 실제 접속자다. 없으면 "unknown"(모두 한 묶음으로 제한된다) */
export function clientIpFrom(h: Pick<Headers, "get">): string {
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (xff || h.get("x-real-ip")?.trim() || "unknown").slice(0, 100);
}

type RpcCaller = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
};

/** DB 오류 → 화면 결과. "VALIDATION: 칸: 문구" 는 그 칸에 단다 */
export function submitErrorFromDb(error: { code?: string; message: string }): PublicInquirySubmitResult {
  const m = /^\s*([A-Z_]+):\s*(.*)$/s.exec(error.message ?? "");
  const head = m?.[1] ?? "";
  const detail = (m?.[2] ?? "").trim();
  if (head === "VALIDATION") {
    const f = /^([a-z_]+):\s*(.+)$/s.exec(detail);
    const fieldErrors: PublicInquiryFieldErrors = {};
    if (f && isPublicInquiryField(f[1]!)) fieldErrors[f[1] as keyof PublicInquiryFieldErrors] = /[.다요]$/.test(f[2]!) ? f[2]! : `${f[2]}.`;
    return { ok: false, reason: "validation", message: MSG.validation, fieldErrors };
  }
  if (head === "RATE_LIMITED") {
    return { ok: false, reason: "rate_limited", message: /[가-힣]/.test(detail) ? (/[.다요]$/.test(detail) ? detail : `${detail}.`) : MSG.tooFast };
  }
  console.error("[submitPublicInquiry]", error.code, head || "UNKNOWN");
  if (head === "NOT_CONFIGURED" || head === "BAD_SIGNATURE") return { ok: false, reason: "unavailable", message: MSG.unavailable };
  return { ok: false, reason: "error", message: MSG.error };
}

/**
 * 접수. 순서: 키 확인 → 사람 확인(허니팟·작성 시간) → 입력 검사 → 서명 → DB.
 * 허니팟·너무 빠른 제출은 저장하지 않고 rate_limited 로 돌려준다(가짜 성공은 주지 않는다).
 */
export async function submitPublicInquiry(
  raw: unknown,
  meta: { ip: string; honeypot?: string | null; startedAt?: number | null; now?: number },
): Promise<PublicInquirySubmitResult> {
  const key = signingKey();
  if (!key) return { ok: false, reason: "unavailable", message: MSG.unavailable };
  const now = meta.now ?? Date.now();
  if ((meta.honeypot ?? "").trim() !== "") return { ok: false, reason: "rate_limited", message: MSG.tooFast };
  if (typeof meta.startedAt === "number" && Number.isFinite(meta.startedAt) && now - meta.startedAt < MIN_FILL_MS) {
    return { ok: false, reason: "rate_limited", message: MSG.tooFast };
  }

  const input = normalizePublicInquiryInput(raw);
  const fieldErrors = validatePublicInquiry(input);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, reason: "validation", message: MSG.validation, fieldErrors };

  const payload = JSON.stringify({
    company_name: input.company_name,
    contact_name: input.contact_name,
    phone: input.phone,
    services: input.services.filter((s) => (PUBLIC_INQUIRY_SERVICES as readonly string[]).includes(s)),
    other_service: input.other_service,
    message: input.message,
    reference_url: input.reference_url,
    desired_timeline: input.desired_timeline,
    budget_range: input.budget_range,
    privacy_consent: true,
    consent_version: PUBLIC_INQUIRY_CONSENT_VERSION,
  });
  const clientHash = clientHashOf(key, meta.ip);
  const nonce = randomUUID();
  const signedAt = now;
  const sb = (await createSupabaseServerClient()) as unknown as RpcCaller;
  const { data, error } = await sb.rpc("submit_public_inquiry", {
    p_payload: payload,
    p_client_hash: clientHash,
    p_signed_at: signedAt,
    p_nonce: nonce,
    p_signature: signPublicInquiry(key, signedAt, nonce, clientHash, payload),
  });
  if (error) return submitErrorFromDb(error);
  const row = (Array.isArray(data) ? data[0] : data) as { ref_code?: unknown; created_at?: unknown } | undefined;
  if (!row || typeof row.ref_code !== "string") {
    console.error("[submitPublicInquiry]", "EMPTY_RESULT");
    return { ok: false, reason: "error", message: MSG.error };
  }
  return { ok: true, refCode: row.ref_code, receivedAt: String(row.created_at ?? "") };
}

/** 서버 동작용: 요청 머리글에서 IP 를 읽어 submitPublicInquiry 를 부른다 */
export async function submitPublicInquiryFromRequest(
  raw: unknown,
  opts: { honeypot?: string | null; startedAt?: number | null } = {},
): Promise<PublicInquirySubmitResult> {
  const h = await headers();
  return submitPublicInquiry(raw, { ip: clientIpFrom(h), honeypot: opts.honeypot, startedAt: opts.startedAt });
}
