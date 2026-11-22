import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import styles from "../ui.module.css";
import { ActiveNavLinks, ActiveSettingsLink, NavLinks, SettingsLink } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";

/**
 * 상단 머리글 + 주 메뉴 (AGY S01~S09 공통 머리글).
 * 넓은 화면: 메뉴가 머리글 가운데. 태블릿(641~900px): 메뉴가 둘째 줄. 휴대폰(640px 이하): 메뉴가 화면 아래에 고정되는 탭바(AGY 04 §2.1).
 * 현재 위치 표시는 주소를 읽어야 해서 Suspense 안에서 그린다(그 전에는 표시 없이 같은 메뉴).
 */
export function AppNav() {
  return (
    <header className={styles.appHeader}>
      <div className={styles.appHeaderInner}>
        <Link href="/workspace" className={styles.brand}>
          {/* AGY 심볼(Plan/AGY-Visual-Assets-20261114). 글자 이름이 옆에 있어 그림은 꾸밈으로 둔다 */}
          <Image src="/brand/logo-symbol.svg" alt="" width={28} height={28} unoptimized priority className={styles.brandMark} />
          {/* 좁은 화면(420px 이하)에서는 글자를 눈으로만 숨기고 화면 읽기 이름은 그대로 둔다(UI-NAV-02) */}
          <span className={styles.brandText}>마케팅 업무실</span>
        </Link>
        <nav aria-label="주 메뉴" className={styles.nav}>
          <Suspense fallback={<NavLinks pathname={null} />}>
            <ActiveNavLinks />
          </Suspense>
        </nav>
        <div className={styles.headerActions}>
          <Suspense fallback={<SettingsLink pathname={null} />}>
            <ActiveSettingsLink />
          </Suspense>
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
