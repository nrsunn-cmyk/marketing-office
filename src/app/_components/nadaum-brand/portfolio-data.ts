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
  /** public 아래 사진 경로(/brand/nadaum/…, 960x600). 실제 사례 사진은 /brand/nadaum/works/<id>.webp */
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

/**
 * 사례 목록. 공개 허락이 확인된 사례와 자체 제작 콘셉트 시안만 넣는다.
 * NADAUM-PORTFOLIO-CONCEPT3-FRONT-01: 주인님 1-A안 확정(자체 콘셉트 시안 3건 우선 공개), 내용은 AGY 배정 msg_4461a18d0584 그대로.
 * 모두 kind 'concept'·liveUrl 없음이므로 hasVerifiedWorks 는 계속 false(검색 노출 안전장치 유지)
 */
export const PORTFOLIO_ITEMS: readonly PortfolioItem[] = [
  {
    id: "website-brand-concept",
    kind: "concept",
    category: "website",
    categoryLabel: "홈페이지 제작",
    title: "프리미엄 브랜드 원페이지 홍보 사이트 시안",
    summary: "방문자가 3초 안에 핵심 서비스를 이해하고 통합 상담 폼으로 자연스럽게 이어지는 다크 스페이셜 벤토 구조",
    thumbnailSrc: "/brand/nadaum/service-website.png",
    thumbnailAlt: "나다움브랜드 홈페이지 제작 콘셉트 시안 3D 비주얼",
    industry: "자체 제작 쇼케이스 (B2B · 브랜드 홍보)",
    deliverables: ["반응형 원페이지 UI", "통합 상담 폼 연동", "모바일 접근성 최적화"],
    challenge: "서비스 소개와 문의 동선이 흩어져 방문자가 이탈하기 쉬운 기존 기업 홍보 사이트의 한계를 정리해야 했습니다.",
    solution: "첫 화면 3D 비주얼과 3가지 핵심 서비스 카드를 중심으로 시선을 모으고, 모든 상담 진입을 단일 #contact 폼과 서비스 프리선택으로 연결했습니다.",
    presetServices: ["홈페이지 제작"],
  },
  {
    id: "detail-commerce-concept",
    kind: "concept",
    category: "detail",
    categoryLabel: "상세페이지 제작",
    title: "전환 중심 제품 상세페이지 구조 시안",
    summary: "제품의 핵심 강점과 신뢰 근거를 모바일 스크롤 흐름에 맞춰 설득력 있게 배치한 상세페이지 레이아웃",
    thumbnailSrc: "/brand/nadaum/service-detail.png",
    thumbnailAlt: "나다움브랜드 상세페이지 제작 콘셉트 시안 3D 비주얼",
    industry: "자체 제작 쇼케이스 (커머스 · 브랜드 제품)",
    deliverables: ["전환 스토리보드", "모바일 퍼스트 상세페이지", "핵심 포인트 비주얼"],
    challenge: "긴 설명과 과도한 이미지 나열로 모바일 방문자가 핵심 장점을 파악하기 전에 이탈하는 문제를 줄여야 했습니다.",
    solution: "도입 후킹 → 핵심 가치 3단 요약 → 사용 시나리오 → FAQ 흐름으로 정보 밀도를 재설계해 읽기 피로도를 낮췄습니다.",
    presetServices: ["상세페이지 제작"],
  },
  {
    id: "ai-visual-motion-concept",
    kind: "concept",
    category: "ai-visual",
    categoryLabel: "AI 영상·비주얼",
    title: "AI 기반 브랜드 쇼츠 · 3D 키비주얼 시안",
    summary: "브랜드 고유의 톤앤매너를 유지하면서 쇼츠·릴스·광고 이미지를 빠르게 확장하는 AI 비주얼 제작 워크플로우",
    thumbnailSrc: "/brand/nadaum/service-ai-video.png",
    thumbnailAlt: "나다움브랜드 AI 영상 및 비주얼 콘셉트 시안 3D 이미지",
    industry: "자체 제작 쇼케이스 (디지털 캠페인 · SNS)",
    deliverables: ["3D 키비주얼 에셋", "쇼츠·릴스 숏폼 구성", "SNS 광고 이미지 세트"],
    challenge: "매체별 규격과 캠페인 일정에 맞춰 일관된 브랜드 무드의 영상·이미지를 신속하게 제작해야 했습니다.",
    solution: "브랜드 컬러와 질감 기준을 먼저 고정한 뒤 AI 생성·후보정 파이프라인으로 키비주얼과 숏폼을 하나의 톤으로 통일했습니다.",
    presetServices: ["쇼츠·릴스 영상", "광고·상품 이미지"],
  },
];

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
