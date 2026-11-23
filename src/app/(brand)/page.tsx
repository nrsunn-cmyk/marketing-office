import type { Metadata } from "next";
import { BRAND_META } from "../_components/nadaum-brand/brand-copy";
import { NadaumHome } from "../_components/nadaum-brand/nadaum-home";
import { submitNadaumInquiry } from "./actions";

/**
 * 공개 첫 화면(/): 나다움브랜드 홍보 화면(NADAUM-BRAND-FRONT-01, 미리보기 후보).
 * (brand) 묶음 폴더: 주소는 그대로 / 이고, 이 폴더의 icon.svg(나다움 파비콘)가 / 에만 붙는다(로그인·업무실·관리자는 루트 icon.svg 그대로).
 * 기존 마케팅 업무실 소개(_components/landing-page.tsx)는 지우지 않고 보존한다 — 되돌릴 때는 LandingPage 연결만 복구.
 * 상담 접수는 서버 동작 submitNadaumInquiry(actions.ts → Backend 계약 함수)로 연결한다. 저장 확인 때만 성공.
 * 검색 노출(robots)은 루트 설정(noindex)을 그대로 따른다. 공유 이미지(opengraph-image)도 같은 방식으로 이 폴더에 두면 / 에만 붙는다(AGY PNG 출고 뒤).
 */
export const metadata: Metadata = {
  title: BRAND_META.title,
  description: BRAND_META.description,
  openGraph: { title: BRAND_META.title, description: BRAND_META.description, locale: "ko_KR", type: "website" },
};

export default function HomePage() {
  // NADAUM-BRAND-CONNECT-01: 접수 서버 연결(Backend 51913d4). 서명 키가 없으면 서버가 unavailable 로 답한다(가짜 성공 없음)
  return <NadaumHome submit={submitNadaumInquiry} />;
}
