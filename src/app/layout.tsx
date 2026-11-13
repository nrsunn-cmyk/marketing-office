import type { Metadata } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "마케팅 업무실",
  description: "1인 운영 AI 마케팅 업무실",
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
      <body>{children}</body>
    </html>
  );
}
