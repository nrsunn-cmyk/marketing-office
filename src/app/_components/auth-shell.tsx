import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import s from "./auth.module.css";

/** 로그인 2안의 인증 화면 공통 틀. */
export function AuthShell({
  title,
  subtitle,
  tab,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: string;
  tab?: "login" | "signup";
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className={s.screen}>
      <header className={s.header}>
        <div className={s.headerInner}>
          <Link href="/" className={s.brand}>
            <Image src="/brand/logo-horizontal.svg" alt="마케팅 업무실" width={260} height={48} unoptimized className={s.logoLight} />
            <Image src="/brand/logo-horizontal-dark.svg" alt="마케팅 업무실" width={260} height={48} unoptimized className={s.logoDark} />
          </Link>
          <Link href="/" className={s.back}>메인 화면으로</Link>
        </div>
      </header>
      <main className={s.container}>
        <h1 className={s.title}>{title}</h1>
        {subtitle && <p className={s.subtitle}>{subtitle}</p>}
        <div className={s.card}>
          {tab && (
            <nav aria-label="로그인·회원가입 전환" className={s.tabs}>
              <Link href="/login" className={s.tab} aria-current={tab === "login" ? "page" : undefined}>
                로그인
              </Link>
              <Link href="/signup" className={s.tab} aria-current={tab === "signup" ? "page" : undefined}>
                회원가입
              </Link>
            </nav>
          )}
          {children}
          {footer && <div className={s.foot}>{footer}</div>}
        </div>
      </main>
    </div>
  );
}

export { default as authStyles } from "./auth.module.css";
