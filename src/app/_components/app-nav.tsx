import Link from "next/link";
import { Suspense } from "react";
import styles from "../ui.module.css";
import { ActiveNavLinks, NavLinks } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";

/**
 * 상단 머리글 + 주 메뉴 (AGY S01~S09 공통 머리글).
 * 넓은 화면: 메뉴가 머리글 가운데. 휴대폰(640px 이하): 메뉴가 화면 아래에 고정되는 탭바(AGY 04 §2.1).
 * 현재 위치 표시는 주소를 읽어야 해서 Suspense 안에서 그린다(그 전에는 표시 없이 같은 메뉴).
 */
export function AppNav() {
  return (
    <header className={styles.appHeader}>
      <div className={styles.appHeaderInner}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            M
          </span>
          마케팅 업무실
        </Link>
        <nav aria-label="주 메뉴" className={styles.nav}>
          <Suspense fallback={<NavLinks pathname={null} />}>
            <ActiveNavLinks />
          </Suspense>
        </nav>
        <div className={styles.headerActions}>
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <button type="submit" className={styles.secondaryButton}>
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
