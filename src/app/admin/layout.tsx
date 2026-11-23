import type { ReactNode } from "react";
import ad from "./admin.module.css";

/**
 * NADAUM-BRAND-ADMIN-THEME-01: 관리자 화면(/admin/**) 전체에 나다움 브랜드 다크 테마를 입힌다.
 * - data-theme="dark": 기존 다크 모드 규칙이 OS·테마 토글과 상관없이 이 안에서만 적용되게 한다(업무실 화면은 그대로)
 * - .theme: 그 위에 나다움 토큰(블랙·딥 네이비·라일락·청록)을 덮는다(admin.module.css)
 * - 같은 폴더의 icon.svg(나다움 파비콘)는 /admin 에만 붙는다
 * 비관리자·로그아웃은 proxy 가 이 레이아웃 밖(/_admin-not-found·/login)으로 보내므로 테마·파비콘이 드러나지 않는다.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div data-theme="dark" className={ad.theme}>
      {children}
    </div>
  );
}
