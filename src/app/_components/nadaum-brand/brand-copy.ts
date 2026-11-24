/**
 * NADAUM-BRAND-FRONT-01 공개 홍보 화면 문구.
 * 기준: Design/nadaum-ui-20261123/2026-11-23-나다움브랜드-홍보홈페이지-최종기획및Claude인수인계서.docx(단일 기준) 3·4절 그대로,
 * 배치·색은 AGY NADAUM-BRAND-UI-SPEC-01. 실적·가격·연락처·포트폴리오는 지어내지 않는다(8절 미확정은 준비 상태로).
 */

export const BRAND_META = {
  title: "나다움브랜드 | 홈페이지·상세페이지·AI 영상 제작",
  description: "나다움을 발견하고 가능성을 넓히는 AI 크리에이티브 파트너. 홈페이지, 상세페이지, 쇼츠·릴스, 로고, 이미지 제작을 상담하세요.",
} as const;

/** 버튼 이름(4절): 상담 진입은 '상담하기' 하나, 포트폴리오는 '작업물 보기', 제출은 '상담 신청 완료하기' */
export const CTA = {
  contact: "상담하기",
  works: "작업물 보기",
  submit: "상담 신청 완료하기",
} as const;

export const NAV = [
  { href: "#services", label: "서비스" },
  { href: "#works", label: "작업물" },
] as const;

export const HERO = {
  eyebrow: "AI CREATIVE PARTNER",
  /** PC 2줄 중심(줄바꿈 위치) */
  titleLines: ["나다움을 발견하고,", "가능성을 넓히다."],
  desc: "홈페이지·상세페이지·AI 영상 제작까지. 브랜드의 시작과 성장을 하나로 연결합니다.",
} as const;

/** 상담 폼 서비스 7종(3절 SECTION 07, 정확한 문구) */
export const SERVICE_OPTIONS = ["홈페이지 제작", "상세페이지 제작", "쇼츠·릴스 영상", "로고 제작", "광고·상품 이미지", "SNS 콘텐츠", "기타"] as const;
export type ServiceOption = (typeof SERVICE_OPTIONS)[number];

export const SERVICES = {
  eyebrow: "WHAT WE CREATE",
  title: "필요한 제작, 나다움에서 한 번에.",
  /**
   * 홈페이지 제작이 첫 카드. preset: 카드를 누르면 상담 폼에서 추가로 고를 서비스(기존 선택과 합침, 방문자가 바꿀 수 있음).
   * AI 영상·비주얼은 폼에 같은 항목이 없어 영상·비주얼 두 개(AGY NADAUM-BRAND-ASSETS-HANDOFF 3절). image: 3안 v2 자체 3D PNG 960x600(장식, 카드 제목이 이름을 대신함)
   */
  cards: [
    { title: "홈페이지 제작", desc: "브랜드를 보여주는 가장 중요한 첫 화면.", preset: ["홈페이지 제작"], image: "/brand/nadaum/service-website.png" },
    { title: "상세페이지 제작", desc: "상품의 매력을 구매 이유로 바꾸는 화면.", preset: ["상세페이지 제작"], image: "/brand/nadaum/service-detail.png" },
    { title: "AI 영상·비주얼", desc: "시선을 끌고 기억에 남는 브랜드 콘텐츠.", preset: ["쇼츠·릴스 영상", "광고·상품 이미지"], image: "/brand/nadaum/service-ai-video.png" },
  ] satisfies { title: string; desc: string; preset: ServiceOption[]; image: string }[],
  more: "로고·브랜딩, 쇼츠·릴스, 광고·상품 이미지, SNS 콘텐츠도 함께 상담할 수 있습니다.",
} as const;

export const HOOK = {
  eyebrow: "MORE THAN DESIGN",
  title: "보여주는 디자인에서, 선택받는 경험으로.",
  desc: "우리 브랜드의 첫인상, 그 다음 가능성까지 생각합니다.",
} as const;

/**
 * 작업물(3절 SECTION 04): 공개 허락된 실제 사례가 아직 없으므로(8절 미확정) 세 칸 모두 '프로젝트 준비 중'.
 * 프로젝트명·고객사·수치는 만들지 않는다. 사례가 확정되면 status 'published'·'concept' 로 바꾼다.
 */
export type WorkStatus = "preparing" | "concept" | "published";
export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  preparing: "프로젝트 준비 중",
  concept: "콘셉트 시안",
  published: "납품 사례",
};
export const WORKS = {
  eyebrow: "SELECTED WORKS",
  title: "결과물로 보여드리겠습니다.",
  items: [
    { type: "홈페이지 제작", status: "preparing" },
    { type: "상세페이지 제작", status: "preparing" },
    { type: "AI 영상·비주얼", status: "preparing" },
  ] satisfies { type: string; status: WorkStatus }[],
} as const;

export const STATEMENT = {
  eyebrow: "FROM IDENTITY TO POSSIBILITY",
  title: "하나의 브랜드, 끝없이 이어지는 가능성.",
} as const;

export const FAQ = {
  title: "자주 묻는 질문",
  items: [
    { q: "홈페이지를 처음 만들어도 의뢰할 수 있나요?", a: "네. 사업 소개와 원하는 방향부터 함께 정리할 수 있습니다." },
    { q: "상세페이지와 로고를 함께 의뢰할 수 있나요?", a: "네. 상담 화면에서 필요한 서비스를 여러 개 선택할 수 있습니다." },
    { q: "사진과 문구가 준비되지 않았다면요?", a: "현재 자료를 먼저 확인한 뒤 필요한 내용과 별도 제작 범위를 안내합니다." },
    { q: "쇼츠·릴스 영상이나 이미지 제작도 가능한가요?", a: "네. 영상의 목적, 길이, 채널 및 이미지 활용 용도에 따라 제작 범위를 상담합니다." },
    { q: "제작 비용과 일정은 어떻게 결정되나요?", a: "제작 종류, 페이지 수, 자료 준비 정도, 수정 범위 등을 확인한 후 개별 안내합니다." },
  ],
} as const;

/**
 * 공개 상담 개인정보 보유·이용 기간(고지 문구 전체). 바꾸면 Backend 동의 판 번호도 함께 올린다.
 * 2026-11-24 주인님 결정: 계속 보관하고 관리자가 필요할 때 건별 삭제(AGY INQUIRY-ADMIN-DELETE-SPEC-01, 동의 판 privacy-v2-20261124)
 */
export const PRIVACY_RETENTION =
  "상담 이력 관리 및 관리자 삭제 시까지 보관 (이용자 삭제 요청 시 지체 없이 파기, 관계 법령에 따라 보존이 필요한 경우 해당 기간 보관)";

export const CONTACT = {
  eyebrow: "START A PROJECT",
  title: "당신의 브랜드, 다음 장면은 무엇인가요?",
  desc: "필요한 작업을 선택하고 간단히 남겨주세요. 브랜드에 맞는 제작 방향을 함께 살펴보겠습니다.",
  labels: {
    company: "업체명 (필수)",
    name: "담당자 이름 (필수)",
    phone: "연락처 (필수)",
    url: "참고 URL (선택)",
    services: "제작 희망 서비스 (필수 · 복수 선택)",
    other: "기타 희망 서비스 입력",
    message: "간단한 요청 내용 (필수)",
    more: "희망 일정 · 예산 (선택)",
    timeline: "희망 일정 (선택)",
    budget: "예산 (선택)",
    consent: "개인정보 수집·이용에 동의합니다 (필수)",
  },
  placeholders: {
    company: "예: 스튜디오 나다움",
    name: "성함",
    phone: "010-0000-0000",
    url: "https://",
    other: "필요한 제작 내용을 한 줄로 적어주세요",
    message: "브랜드 소개나 원하시는 방향을 편하게 적어주세요.",
  },
  /** 실제 서버 저장 성공 이후에만 표시(3절) */
  success: "신청이 접수되었습니다. 남겨주신 내용을 확인하고 연락드리겠습니다.",
  /** 접수 번호(Backend refCode, 예: ND-261123-3F2A1C) 앞 이름 — Backend 계약 3-1 권고 */
  refLabel: "접수 번호:",
  /** 서버 저장 실패: 입력 보존 + 재시도 안내(3절) */
  failure: "신청을 보내지 못했습니다. 입력하신 내용은 그대로 남아 있으니 잠시 후 다시 시도해 주세요.",
  /** 접수 서버가 아직 연결되지 않은 미리보기(가짜 성공 금지, 5절 '테스트용 모드는 명시적으로 구분') — 문구 AGY 확인 대상 */
  notConnected: "미리보기 화면입니다. 상담 접수 서버가 아직 연결되지 않아 신청은 전송되지 않았습니다. 입력하신 내용은 그대로 남아 있습니다.",
  errorSummary: "입력 내용을 확인해 주세요.",
  /** 개인정보 보호법 제15조 제2항 고지 4요소(AGY PRIVACY-CONSENT-SPEC-01 1절). 동의 칸 바로 아래 늘 펼쳐 보인다 */
  privacy: [
    { term: "수집·이용 목적", desc: "프로젝트 상담 확인, 견적 안내 및 회신 연락" },
    { term: "수집 항목", desc: "(필수) 업체명, 담당자 이름, 연락처, 요청 서비스, 요청 내용 / (선택) 참고 URL, 희망 일정, 예상 예산" },
    { term: "보유·이용 기간", desc: PRIVACY_RETENTION },
    { term: "동의 거부 권리 및 불이익", desc: "개인정보 수집·이용 동의를 거부할 수 있으며, 거부 시 상담 신청 접수가 제한됩니다." },
  ],
} as const;

/** 푸터 보조 링크 '업무실 로그인'(/login) 노출 여부. 숨기려면 false 한 줄(AGY PRIVACY-CONSENT-SPEC-01 2절) */
export const SHOW_FOOTER_WORKSPACE_LOGIN = true;

export const FOOTER = {
  name: "NADAUM BRAND",
  /** 8절 미확정: 실제 번호가 확정될 때까지 자리 표시 그대로(번호를 지어내지 않음) */
  phone: "전화: [전화번호 직접 입력 예정]",
  copyright: "© NADAUM BRAND",
  login: "업무실 로그인",
  loginHref: "/login",
} as const;
