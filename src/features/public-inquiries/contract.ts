/**
 * NADAUM-BRAND-BACKEND-01 (3B): 나다움 공개 상담(#contact) 계약 — 화면(Front)과 서버가 함께 쓰는 순수 모듈.
 * - 서버 전용 코드(서명 키·DB 호출)는 ./server.ts 에 있다. 이 파일은 브라우저에서 불러도 된다.
 * - 칸 이름·서비스 표시값·글자 수 한도는 Front 8d8accd contact-model.ts·brand-copy.ts 와 같다.
 * - DB 검증(20261123010000_public_inquiries.sql)과 같은 규칙이다. 화면 검사는 편의, 최종 판단은 DB.
 * - P4 문의(src/features/execution, public.inquiries)와는 아무 관계가 없다.
 */

/** 제작 희망 서비스 표시값(화면 순서). DB 에는 코드로 저장한다. */
export const PUBLIC_INQUIRY_SERVICES = ["홈페이지 제작", "상세페이지 제작", "쇼츠·릴스 영상", "로고 제작", "광고·상품 이미지", "SNS 콘텐츠", "기타"] as const;
export type PublicInquiryService = (typeof PUBLIC_INQUIRY_SERVICES)[number];

export const PUBLIC_INQUIRY_SERVICE_CODES = {
  "홈페이지 제작": "homepage",
  "상세페이지 제작": "detail_page",
  "쇼츠·릴스 영상": "short_video",
  "로고 제작": "logo",
  "광고·상품 이미지": "ad_image",
  "SNS 콘텐츠": "sns_content",
  기타: "other",
} as const satisfies Record<PublicInquiryService, string>;
export type PublicInquiryServiceCode = (typeof PUBLIC_INQUIRY_SERVICE_CODES)[PublicInquiryService];

/** 저장 코드 → 표시값(관리자 화면용). 모르는 코드는 그대로 돌려준다. */
export function serviceLabel(code: string): string {
  const hit = (Object.entries(PUBLIC_INQUIRY_SERVICE_CODES) as Array<[PublicInquiryService, string]>).find(([, c]) => c === code);
  return hit ? hit[0] : code;
}

export const PUBLIC_INQUIRY_LIMITS = { company: 80, name: 40, phone: 30, other: 80, message: 2000, url: 300, short: 80 } as const;

/** 상담 상태(관리자). 순서 = 처리 흐름 */
export const PUBLIC_INQUIRY_STATUSES = ["new", "contacted", "quoted", "closed"] as const;
export type PublicInquiryStatus = (typeof PUBLIC_INQUIRY_STATUSES)[number];
export const PUBLIC_INQUIRY_STATUS_LABELS: Record<PublicInquiryStatus, string> = {
  new: "새 접수",
  contacted: "연락함",
  quoted: "견적 보냄",
  closed: "종료",
};
export const isPublicInquiryStatus = (v: unknown): v is PublicInquiryStatus =>
  typeof v === "string" && (PUBLIC_INQUIRY_STATUSES as readonly string[]).includes(v);

/**
 * 개인정보 동의 문구의 판. 동의 문구(목적·항목·보유 기간)를 바꾸면 이 값을 바꾼다 — 접수마다 함께 저장한다.
 * 최종 문구·보유 기간은 출시 전 주인님 확인 항목이다.
 */
export const PUBLIC_INQUIRY_CONSENT_VERSION = "privacy-v1-20261123";

/** 화면이 넘기는 입력(Front ContactInput 과 같은 모양) */
export interface PublicInquiryInput {
  company_name: string;
  contact_name: string;
  phone: string;
  services: string[];
  other_service: string;
  message: string;
  reference_url: string;
  desired_timeline: string;
  budget_range: string;
  privacy_consent: boolean;
}

export type PublicInquiryField =
  | "company_name"
  | "contact_name"
  | "phone"
  | "services"
  | "other_service"
  | "message"
  | "reference_url"
  | "desired_timeline"
  | "budget_range"
  | "privacy_consent";
export type PublicInquiryFieldErrors = Partial<Record<PublicInquiryField, string>>;
const FIELDS: readonly PublicInquiryField[] = [
  "company_name", "contact_name", "phone", "services", "other_service", "message", "reference_url", "desired_timeline", "budget_range", "privacy_consent",
];
export const isPublicInquiryField = (v: string): v is PublicInquiryField => (FIELDS as readonly string[]).includes(v);

/**
 * 접수 결과(화면 계약).
 * - ok: 서버가 DB 저장을 확인한 경우에만. refCode 를 성공 문구에 보여 준다.
 * - validation: fieldErrors 의 칸에 문구를 단다. 입력은 그대로 둔다.
 * - rate_limited: message 를 보여 준다. 입력은 그대로 둔다.
 * - unavailable: 접수가 꺼져 있다(서명 키 없음). 다른 연락 방법 안내.
 * - error: 저장 실패. 입력을 보존하고 다시 시도 안내.
 */
export type PublicInquirySubmitResult =
  | { ok: true; refCode: string; receivedAt: string }
  | { ok: false; reason: "validation"; message: string; fieldErrors: PublicInquiryFieldErrors }
  | { ok: false; reason: "rate_limited" | "unavailable" | "error"; message: string };

const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** 알 수 없는 값을 입력 모양으로 정리(서비스 중복 제거·화면 순서, 기타를 안 고르면 기타 내용 비움) */
export function normalizePublicInquiryInput(raw: unknown): PublicInquiryInput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const picked = new Set(Array.isArray(r.services) ? r.services.filter((x): x is string => typeof x === "string").map((x) => x.trim()) : []);
  const known = PUBLIC_INQUIRY_SERVICES.filter((s) => picked.has(s));
  const unknown = [...picked].filter((s) => !(PUBLIC_INQUIRY_SERVICES as readonly string[]).includes(s));
  const services = [...known, ...unknown];
  return {
    company_name: trim(r.company_name),
    contact_name: trim(r.contact_name),
    phone: trim(r.phone),
    services,
    other_service: services.includes("기타") ? trim(r.other_service) : "",
    message: trim(r.message),
    reference_url: trim(r.reference_url),
    desired_timeline: trim(r.desired_timeline),
    budget_range: trim(r.budget_range),
    privacy_consent: r.privacy_consent === true,
  };
}

/** 서버 검사(DB 와 같은 규칙). 오류가 없으면 빈 객체 */
export function validatePublicInquiry(v: PublicInquiryInput): PublicInquiryFieldErrors {
  const L = PUBLIC_INQUIRY_LIMITS;
  const e: PublicInquiryFieldErrors = {};
  if (!v.company_name || v.company_name.length > L.company) e.company_name = `업체명은 1~${L.company}자로 입력해 주세요.`;
  if (!v.contact_name || v.contact_name.length > L.name) e.contact_name = `담당자 이름은 1~${L.name}자로 입력해 주세요.`;
  const digits = v.phone.replace(/\D/g, "");
  if (!v.phone || v.phone.length > L.phone || !/^[0-9+() -]+$/.test(v.phone) || digits.length < 8 || digits.length > 15) {
    e.phone = "연락 가능한 전화번호를 숫자로 입력해 주세요. (예: 010-0000-0000)";
  }
  if (v.reference_url && (v.reference_url.length > L.url || !/^https?:\/\/\S+$/i.test(v.reference_url))) {
    e.reference_url = "참고 URL은 https:// 로 시작하는 주소로 입력해 주세요.";
  }
  if (v.services.length === 0) e.services = "제작 희망 서비스를 1개 이상 선택해 주세요.";
  else if (v.services.some((s) => !(PUBLIC_INQUIRY_SERVICES as readonly string[]).includes(s))) e.services = "알 수 없는 서비스가 있습니다.";
  if (v.services.includes("기타") && (!v.other_service || v.other_service.length > L.other)) {
    e.other_service = `기타를 선택하셨다면 필요한 제작 내용을 1~${L.other}자로 적어 주세요.`;
  }
  if (!v.message || v.message.length > L.message) e.message = `요청 내용은 1~${L.message}자로 입력해 주세요.`;
  if (v.desired_timeline.length > L.short) e.desired_timeline = `희망 일정은 ${L.short}자 이내로 입력해 주세요.`;
  if (v.budget_range.length > L.short) e.budget_range = `예산 범위는 ${L.short}자 이내로 입력해 주세요.`;
  if (!v.privacy_consent) e.privacy_consent = "개인정보 수집·이용에 동의해 주세요.";
  return e;
}

/** 관리자 화면 한 줄(admin/server.ts listAdminPublicInquiries) */
export interface AdminPublicInquiry {
  id: string;
  refCode: string;
  createdAt: string;
  status: PublicInquiryStatus;
  companyName: string;
  contactName: string;
  phone: string;
  services: string[];
  serviceLabels: string[];
  otherService: string | null;
  message: string;
  /** 사용자가 적은 주소 그대로. 화면은 클릭 링크로 만들지 말고 글자로 보여 준다(피싱 방지) */
  referenceUrl: string | null;
  desiredTimeline: string | null;
  budgetRange: string | null;
  privacyConsentAt: string;
  consentVersion: string;
  statusChangedAt: string | null;
  updatedAt: string;
}
