/**
 * P3B-BACKEND-IMPL-01: 홈페이지 구조·문구(P3-b) 상수. 화면(클라이언트)에서도 가져다 쓸 수 있게 서버 전용 코드를 두지 않는다.
 * DB 규칙: supabase/migrations/20261121002000_p3b_web_copy.sql 과 값이 같아야 한다(글자 수는 코드 포인트).
 * Front 화면 부품(e739bc8 web-copy-model.ts)의 WEB_COPY_LIMITS 와도 같다.
 */
export const WEB_COPY_LIMITS = {
  pagesMax: 10,
  sectionsPerPageMax: 12,
  /** 제외한 섹션도 센다 */
  sectionsTotalMax: 60,
  citationsMax: 10,
  pageTitle: 60,
  slug: 80,
  sectionName: 80,
  purpose: 200,
  headline: 160,
  body: 2000,
  ctaLabel: 60,
  ctaTarget: 200,
  /** 문서당 판 */
  versionsMax: 100,
  /** 제작 브리프당 문서(보관 포함). 보관 안 된 문서는 1개 */
  docsPerBrief: 10,
} as const;

export const WEB_COPY_STATUSES = ["drafting", "reviewed"] as const;
export type WebCopyStatus = (typeof WEB_COPY_STATUSES)[number];
export const WEB_COPY_DISPLAY = { drafting: "작성 중", reviewed: "검토 완료", archived: "보관" } as const;
export type WebCopyDisplayStatus = keyof typeof WEB_COPY_DISPLAY;

export const WEB_COPY_VERSION_KINDS = { create: "처음 만듦", save: "저장", restore: "되돌림", rebase: "브리프 기준 맞춤" } as const;
export type WebCopyVersionKind = keyof typeof WEB_COPY_VERSION_KINDS;

export const BRIEF_STALE_LABEL = "이전 브리프 기준";

/** 페이지 경로: 홈 '/' 또는 한 단계 '/영소문자-숫자' (DB app.web_copy_slug_ok 와 같다) */
export const SLUG_RE = /^\/([a-z0-9]+(-[a-z0-9]+)*)?$/;
/** CTA 이동 대상 중 '/경로' 꼴(하위 경로·#조각 허용). https 주소는 채널 초안 게시 주소 규칙(PUBLICATION_URL_RE)을 쓴다 */
export const CTA_PATH_RE = /^\/([a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*)?(#[A-Za-z0-9_-]{1,50})?$/;

export function webCopyDisplayStatus(x: { archived: boolean; status: WebCopyStatus }): WebCopyDisplayStatus {
  return x.archived ? "archived" : x.status;
}
