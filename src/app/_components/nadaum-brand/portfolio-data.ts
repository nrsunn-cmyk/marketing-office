import type { ServiceOption } from "./brand-copy";

/**
 * NADAUM-PORTFOLIO-WORKS-FRONT-01: #works 사례 데이터 계약(AGY PORTFOLIO-WORKS-SPEC-01 4절).
 * - 공개 허락을 받은 실제 사례(verified)와 자체 제작 콘셉트 시안(concept)만 넣는다. 지어낸 실적·별점·가격 금지(1절)
 * - 비어 있으면 화면은 지금처럼 '프로젝트 준비 중' 세 칸을 그대로 보여 준다
 */
export type PortfolioCategory = "website" | "detail" | "ai-visual";

export type PortfolioItem = {
  id: string;
  kind: "verified" | "concept";
  category: PortfolioCategory;
  categoryLabel: string;
  title: string;
  summary: string;
  /** /brand/nadaum/works/<id>.webp (960x600) */
  thumbnailSrc: string;
  thumbnailAlt: string;
  /** 고객 업종(공개 동의 범위). 예: "B2B 제조" */
  industry?: string;
  /** 제작 기간(실제 값만, 명세 3절 2). 4절 표에는 없어 선택 칸으로 둔다 */
  period?: string;
  /** 산출물·제작 범위. 예: ["반응형 홈페이지", "상담 폼 연동"] */
  deliverables: string[];
  challenge: string;
  solution: string;
  /** https:// 만 허용(그 밖이면 링크를 그리지 않는다) */
  liveUrl?: string;
  /** '비슷한 프로젝트 상담하기' 때 #contact 폼에서 미리 고를 서비스(폼 항목 이름 그대로) */
  presetServices: ServiceOption[];
};

/** 사례 목록. 공개 허락이 확인된 사례만 여기에 추가한다(사진은 public/brand/nadaum/works/) */
export const PORTFOLIO_ITEMS: readonly PortfolioItem[] = [];

/** 화면 문구 — AGY PORTFOLIO-WORKS-SPEC-01 그대로 */
export const PORTFOLIO_COPY = {
  kind: { verified: "실제 사례", concept: "콘셉트 시안" },
  filtersLabel: "작업물 분류",
  filters: [
    { key: "all", label: "전체" },
    { key: "website", label: "홈페이지" },
    { key: "detail", label: "상세페이지" },
    { key: "ai-visual", label: "AI 영상·비주얼" },
  ],
  viewHint: "사례 보기 →",
  close: "사례 상세 닫기",
  industry: "고객 업종",
  deliverables: "제작 범위",
  period: "제작 기간",
  challenge: "과제",
  solution: "해결 방향",
  output: "산출물",
  live: "새 창으로 사이트 보기 ↗",
  cta: "비슷한 프로젝트 상담하기",
} as const;

export type PortfolioFilter = "all" | PortfolioCategory;

/** 분류 칩은 사례가 4건 이상일 때만(1~3건이면 숨김, 명세 2절 가) */
export const FILTER_MIN_ITEMS = 4;
export const showFilters = (items: readonly PortfolioItem[]) => items.length >= FILTER_MIN_ITEMS;

export const filterItems = (items: readonly PortfolioItem[], f: PortfolioFilter) => (f === "all" ? [...items] : items.filter((i) => i.category === f));

/** 외부 링크는 https 주소만 쓴다(javascript:·http: 등은 버림) */
export function safeLiveUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** 검색 노출(BRAND_INDEXABLE)을 켜려면 실제 사례가 1건 이상 있어야 한다(명세 1절 '0건일 때') */
export const hasVerifiedWorks = (items: readonly PortfolioItem[]) => items.some((i) => i.kind === "verified");
