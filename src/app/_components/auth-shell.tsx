import Link from "next/link";
import type { ReactNode } from "react";
import s from "./auth.module.css";

/**
 * 인증 화면 공통 틀 — 1안 테크 그리드 & 로열 블루 (AGY: C:\nadaum\Design\login-concepts).
 * 격자 배경, 위쪽 아이콘 상자·배지·제목·설명, 흰 카드, 로그인/회원가입 알약 탭.
 */
export function AuthShell({
  icon,
  title,
  subtitle,
  tab,
  children,
  footer,
}: {
  icon: "rocket" | "lock";
  title: string;
  subtitle?: string;
  /** 로그인·회원가입 화면이면 위쪽 알약 탭을 보여 주고 현재 화면을 표시한다 */
  tab?: "login" | "signup";
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className={s.screen}>
      <div className={s.container}>
        <span className={s.iconBox} aria-hidden="true">
          {icon === "rocket" ? <RocketIcon /> : <LockIcon />}
        </span>
        {/* SITE-FIX-01(AGY SITE-FIX-HANDOFF 3절): 영문 부제 'AI MARKETING OFFICE'는 바로 아래 한글 제목과 겹쳐 뺐다 */}
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
      </div>
    </main>
  );
}

const iconProps = { width: 30, height: 30, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function RocketIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export { default as authStyles } from "./auth.module.css";
