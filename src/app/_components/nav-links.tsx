"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "../ui.module.css";

const LINKS = [
  { href: "/workspace", label: "현황", icon: "📊", match: (p: string) => p === "/workspace" },
  { href: "/clients", label: "고객", icon: "🏢", match: (p: string) => p.startsWith("/clients") },
  { href: "/projects", label: "프로젝트", icon: "📁", match: (p: string) => p.startsWith("/projects") || p.startsWith("/tasks") },
  { href: "/assets", label: "자료실", icon: "🗂️", match: (p: string) => p === "/assets" },
  { href: "/results", label: "결과물", icon: "✅", match: (p: string) => p.startsWith("/results") },
];

/** 메뉴 링크. pathname 이 없으면(미리 그린 화면) 현재 위치 표시 없이 그린다. */
export function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <>
      {LINKS.map((l) => {
        const active = pathname !== null && l.match(pathname);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
            aria-current={active ? "page" : undefined}
          >
            <span className={styles.navIcon} aria-hidden="true">
              {l.icon}
            </span>
            {l.label}
          </Link>
        );
      })}
    </>
  );
}

/** 현재 주소를 읽어 지금 있는 메뉴를 표시한다 (Suspense 안에서만 쓴다). */
export function ActiveNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}

/** 머리글의 '설정' 링크. 주 메뉴(5개)에는 넣지 않고, 설정 화면에 있을 때 현재 위치만 알린다(UI-NAV-02). */
export function SettingsLink({ pathname }: { pathname: string | null }) {
  const active = pathname !== null && pathname.startsWith("/settings");
  return (
    <Link
      href="/settings"
      className={active ? `${styles.secondaryButton} ${styles.settingsActive}` : styles.secondaryButton}
      aria-current={active ? "page" : undefined}
    >
      설정
    </Link>
  );
}

export function ActiveSettingsLink() {
  return <SettingsLink pathname={usePathname()} />;
}
