/** 리드마그넷 기획 상수(zod 없음). 화면이 상수만 가져올 때 zod 가 브라우저 묶음에 실리지 않게 따로 둔다. 값은 DB 규칙(migration 26)과 같게 둔다 */
export const LEAD_MAGNET_FORMATS = {
  checklist: "체크리스트",
  guide: "가이드북",
  template: "템플릿",
  diagnosis: "자가 진단",
  webinar: "웨비나·강의",
  sample: "샘플·체험",
  consultation: "무료 상담",
  other: "기타",
} as const;
export type LeadMagnetFormat = keyof typeof LEAD_MAGNET_FORMATS;

export const LEAD_MAGNET_DELIVERIES = {
  download: "파일 내려받기",
  email: "이메일 발송",
  web_page: "웹 페이지",
  message: "메시지(DM·카톡)",
  in_person: "대면·통화",
  other: "기타",
} as const;
export type LeadMagnetDelivery = keyof typeof LEAD_MAGNET_DELIVERIES;

export const LEAD_MAGNET_STATUSES = { planned: "기획", drafting: "제작 중", ready: "준비 완료", live: "배포 중" } as const;
export type LeadMagnetStatus = keyof typeof LEAD_MAGNET_STATUSES;

/** 리드마그넷을 가리킬 수 있는 퍼널 카드 유형(DB CHECK funnel_items_lead_magnet_kind 와 같음) */
export const LEAD_MAGNET_LINKABLE_KINDS = ["cta", "lead_magnet"] as const;

export const LEAD_MAGNET_LIMITS = {
  title: 200,
  audience: 500,
  promise: 500,
  leadFields: 10,
  leadField: 50,
  outline: 20,
  outlineLine: 300,
  perFunnel: 20,
} as const;
