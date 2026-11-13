import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "마케팅 업무실",
  description: "1인 운영 AI 마케팅 업무실",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
