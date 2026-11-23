import type { Metadata } from "next";
import { BRAND_META } from "./_components/nadaum-brand/brand-copy";
import { NadaumHome } from "./_components/nadaum-brand/nadaum-home";

/**
 * 공개 첫 화면(/): 나다움브랜드 홍보 화면(NADAUM-BRAND-FRONT-01, 미리보기 후보).
 * 기존 마케팅 업무실 소개(_components/landing-page.tsx)는 지우지 않고 보존한다 — 되돌릴 때는 LandingPage 연결만 복구.
 * 상담 접수 서버(Backend 3B)가 연결되기 전이라 submit 을 넘기지 않는다 → 제출해도 성공으로 보이지 않는다.
 * 검색 노출(robots)은 루트 설정(noindex)을 그대로 따른다. 파비콘·공유 이미지는 앱 전체 파일 규칙이라 AGY 자산 확정 뒤 별도 반영.
 */
export const metadata: Metadata = {
  title: BRAND_META.title,
  description: BRAND_META.description,
  openGraph: { title: BRAND_META.title, description: BRAND_META.description, locale: "ko_KR", type: "website" },
};

export default function HomePage() {
  return <NadaumHome />;
}
