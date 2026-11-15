import Image from "next/image";
import type { ReactNode } from "react";
import styles from "../ui.module.css";

/** 로그인·회원가입·비밀번호 찾기·새 비밀번호 화면의 공통 틀 (AGY 심볼 + 제목 + 본문 + 아래 링크) */
export function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className={styles.page}>
      <Image src="/brand/logo-symbol.svg" alt="" width={48} height={48} unoptimized priority className={styles.loginMark} />
      <h1 className={styles.title}>{title}</h1>
      {children}
      {footer && <nav aria-label="계정 화면 이동" className={styles.authLinks}>{footer}</nav>}
    </main>
  );
}

/** 이메일·비밀번호 입력 칸 (도움말이 있으면 화면 읽기 프로그램에도 연결) */
export function AuthField({
  name,
  label,
  type,
  autoComplete,
  help,
}: {
  name: string;
  label: string;
  type: "email" | "password";
  autoComplete: string;
  help?: string;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={`auth-${name}`}>{label}</label>
      <input
        id={`auth-${name}`}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-describedby={help ? `auth-${name}-help` : undefined}
      />
      {help && (
        <span id={`auth-${name}-help`} className={styles.muted}>
          {help}
        </span>
      )}
    </div>
  );
}
