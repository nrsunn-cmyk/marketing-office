import type { Metadata } from "next";
import { Suspense } from "react";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import { FlashProvider } from "./_components/flash";
import { GlobalHashScroll } from "./_components/global-hash-scroll";
import { HydrationHintProvider } from "./_components/hydration-hint";

/**
 * 브라우저 탭 아이콘(icon.svg)·아이폰 홈 화면 아이콘(apple-icon.png)·링크 미리보기 그림(opengraph-image.png)은
 * src/app 안의 파일 이름 규칙으로 Next.js가 자동으로 넣는다. 그림은 AGY 브랜드 에셋(scripts/brand/render-brand.mjs).
 * 로그인해야 쓰는 개인 업무실이라 검색 엔진에는 올리지 않는다.
 */
export const metadata: Metadata = {
  // 공유 이미지 주소도 로그인 복귀 주소와 같은 앱 주소 설정을 따른다.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "마케팅 업무실",
  description: "1인 마케터를 위한 마케팅 업무실",
  applicationName: "마케팅 업무실",
  robots: { index: false, follow: false },
  openGraph: { title: "마케팅 업무실", description: "1인 마케터를 위한 마케팅 업무실", locale: "ko_KR", type: "website" },
};

/**
 * 저장된 테마(라이트/다크)를 화면을 그리기 전에 적용한다. 그리지 않으면 잠깐 반대 색이 깜박인다.
 * 이 스크립트가 <html>의 data-theme 를 바꾸므로 suppressHydrationWarning 이 필요하다.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("mo-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* 폼이 사라지는 동작의 성공 안내를 화면 아래에 남긴다(BUNDLE-C-PREP-01) */}
        {/* 화면 준비 전 안내는 화면당 한 곳에서만 보인다(BUNDLE-D-FRONT-01) */}
        <FlashProvider>
          <HydrationHintProvider>{children}</HydrationHintProvider>
        </FlashProvider>
        {/* #해시 대상이 스트리밍으로 늦게 그려져도 그 자리로 한 번 옮긴다(UX-HASH-SCROLL-GLOBAL-01). 그리는 것 없음 */}
        <Suspense fallback={null}>
          <GlobalHashScroll />
        </Suspense>
      </body>
    </html>
  );
}
