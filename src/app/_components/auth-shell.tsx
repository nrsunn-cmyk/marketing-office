import type { ReactNode } from "react";
import s from "./auth.module.css";

/**
 * 인증 화면 공통 틀 — 1안 모던 슬레이트 (AGY: Plan/AGY-Auth-UI-Modern-Slate-20261115).
 * 가운데 카드, 딥 슬레이트 엠블럼(화면마다 아이콘), 제목·설명·배지, 아래 이동 링크.
 */
export function AuthShell({
  icon,
  title,
  subtitle,
  badge,
  wide,
  children,
  footer,
}: {
  icon: "login" | "signup" | "reset";
  title: string;
  subtitle?: string;
  badge?: string;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className={s.screen}>
      <div className={`${s.card} ${wide ? s.wide : ""}`}>
        <div className={s.head}>
          <span className={`${s.emblem} ${icon === "signup" ? s.emblemSignup : icon === "reset" ? s.emblemReset : ""}`} aria-hidden="true">
            <Icon name={icon} />
          </span>
          <h1 className={s.title}>{title}</h1>
          {subtitle && <p className={s.subtitle}>{subtitle}</p>}
          {badge && (
            <span className={s.badge}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              {badge}
            </span>
          )}
        </div>
        {children}
        {footer && (
          <nav aria-label="계정 화면 이동" className={s.foot}>
            {footer}
          </nav>
        )}
      </div>
    </main>
  );
}

function Icon({ name }: { name: "login" | "signup" | "reset" }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "signup")
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M19 8v6M16 11h6" />
      </svg>
    );
  if (name === "reset")
    return (
      <svg {...common}>
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

/** 화면 아래·안의 링크 */
export { default as authStyles } from "./auth.module.css";
