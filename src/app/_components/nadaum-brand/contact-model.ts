import { SERVICE_OPTIONS, type ServiceOption } from "./brand-copy";

/**
 * NADAUM-BRAND-FRONT-01 공개 상담 폼의 화면 쪽 입력 검사(브라우저에서 먼저 막는 용도).
 * 칸 이름은 기획서 5절 데이터 필드(company_name 등)와 같다. 서버 검증·저장·제출 제한은 Backend 3B 몫이며 이 검사를 대신하지 않는다.
 */
export interface ContactInput {
  company_name: string;
  contact_name: string;
  phone: string;
  services: ServiceOption[];
  other_service: string;
  message: string;
  reference_url: string;
  desired_timeline: string;
  budget_range: string;
  privacy_consent: boolean;
}

export type ContactField = "company_name" | "contact_name" | "phone" | "services" | "other_service" | "message" | "reference_url" | "privacy_consent";
export type ContactErrors = Partial<Record<ContactField, string>>;

export const CONTACT_LIMITS = { company: 80, name: 40, phone: 30, other: 80, message: 2000, url: 300, short: 80 } as const;

/** 검사 순서 = 화면 순서(첫 오류 칸으로 초점을 옮길 때 쓴다) */
export const FIELD_ORDER: ContactField[] = ["company_name", "contact_name", "phone", "reference_url", "services", "other_service", "message", "privacy_consent"];

const isService = (v: string): v is ServiceOption => (SERVICE_OPTIONS as readonly string[]).includes(v);

export function readContactForm(fd: FormData): ContactInput {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const services = [...new Set(fd.getAll("services").map(String))].filter(isService);
  return {
    company_name: s("company_name"),
    contact_name: s("contact_name"),
    phone: s("phone"),
    services,
    other_service: services.includes("기타") ? s("other_service") : "",
    message: s("message"),
    reference_url: s("reference_url"),
    desired_timeline: s("desired_timeline"),
    budget_range: s("budget_range"),
    privacy_consent: fd.get("privacy_consent") === "on",
  };
}

export function validateContact(v: ContactInput): ContactErrors {
  const e: ContactErrors = {};
  if (!v.company_name) e.company_name = "업체명을 입력해 주세요.";
  else if (v.company_name.length > CONTACT_LIMITS.company) e.company_name = `업체명은 ${CONTACT_LIMITS.company}자 이내로 입력해 주세요.`;
  if (!v.contact_name) e.contact_name = "담당자 이름을 입력해 주세요.";
  else if (v.contact_name.length > CONTACT_LIMITS.name) e.contact_name = `담당자 이름은 ${CONTACT_LIMITS.name}자 이내로 입력해 주세요.`;
  const digits = v.phone.replace(/\D/g, "");
  if (!v.phone) e.phone = "연락처를 입력해 주세요.";
  else if (!/^[0-9+\-() ]+$/.test(v.phone) || digits.length < 8 || digits.length > 15 || v.phone.length > CONTACT_LIMITS.phone)
    e.phone = "연락 가능한 전화번호를 숫자로 입력해 주세요. (예: 010-0000-0000)";
  if (v.reference_url) {
    let ok = false;
    try {
      const u = new URL(v.reference_url);
      ok = (u.protocol === "https:" || u.protocol === "http:") && v.reference_url.length <= CONTACT_LIMITS.url;
    } catch {
      ok = false;
    }
    if (!ok) e.reference_url = "참고 URL은 https:// 로 시작하는 주소로 입력해 주세요.";
  }
  if (v.services.length === 0) e.services = "제작 희망 서비스를 1개 이상 선택해 주세요.";
  if (v.services.includes("기타")) {
    if (!v.other_service) e.other_service = "기타를 선택하셨다면 필요한 제작 내용을 한 줄로 적어 주세요.";
    else if (v.other_service.length > CONTACT_LIMITS.other) e.other_service = `기타 내용은 ${CONTACT_LIMITS.other}자 이내로 입력해 주세요.`;
  }
  if (!v.message) e.message = "간단한 요청 내용을 입력해 주세요.";
  else if (v.message.length > CONTACT_LIMITS.message) e.message = `요청 내용은 ${CONTACT_LIMITS.message}자 이내로 입력해 주세요.`;
  if (!v.privacy_consent) e.privacy_consent = "개인정보 수집·이용에 동의해 주세요.";
  return e;
}

export function firstErrorField(e: ContactErrors): ContactField | null {
  return FIELD_ORDER.find((f) => e[f]) ?? null;
}

/** 카드 미리 선택: 기존 선택을 지우지 않고 더한다(OR 병합, 화면 순서 유지) */
export function mergePreset(current: readonly string[], preset: readonly string[]): ServiceOption[] {
  const set = new Set([...current, ...preset]);
  return SERVICE_OPTIONS.filter((o) => set.has(o));
}

/**
 * 제출 결과. 서버 연결(Backend 3B·4단계)은 submit 함수로 주입한다.
 * - 'sent': 서버가 저장을 확인한 경우에만 → 성공 문구
 * - 'failed': 저장 실패 → 입력 보존·재시도 안내
 * - 주입이 없으면 'not_connected' → 미리보기 안내(가짜 성공 금지)
 */
export type ContactSubmitResult = { status: "sent" } | { status: "failed"; errors?: ContactErrors };
export type ContactSubmit = (input: ContactInput) => Promise<ContactSubmitResult>;
