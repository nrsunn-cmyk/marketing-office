import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { isAdmin } from "@/features/admin/server";
import styles from "../ui.module.css";
import ad from "./admin.module.css";

/**
 * 관리자 페이지 1단계 공용 부품(ADMIN-UI-01, 주인님 DEC-13 A안, AGY 시안 admin-draft.html).
 * - 읽기 전용: 쓰기 단추 없음. 서버 컴포넌트만
 * - 비관리자·로그인 안 함은 404(서버가 NOT_FOUND 로 숨김). 페이지 제목도 관리자일 때만 붙여 화면이 있다는 것을 알리지 않는다
 * - 메뉴(AppNav)에는 넣지 않는다(설계 3-3). 주소를 아는 관리자만 연다
 */

/** 관리자가 아니면 404. 모든 관리자 화면의 맨 앞에서 부른다 */
export async function requireAdminOr404(): Promise<void> {
  await connection(); // 요청 때만 판단한다(빌드 미리 그리기에서 Supabase 연결을 만들지 않게, requireWorkspace 와 같음)
  if (!(await isAdmin())) notFound();
}

/** 관리자일 때만 제목을 붙인다(비관리자에게는 일반 제목). 검색 엔진 수집은 늘 막는다 */
export async function adminMetadata(title: string): Promise<Metadata> {
  const robots = { index: false, follow: false };
  await connection();
  return (await isAdmin()) ? { title: `${title} · 관리자 · 마케팅 업무실`, robots } : { robots };
}

const TABS = [
  { href: "/admin", label: "가입자·업무실" },
  { href: "/admin/usage", label: "이용 현황" },
  { href: "/admin/audit", label: "감사 기록" },
  { href: "/admin/p3", label: "P3 진행 현황" },
  { href: "/admin/p4", label: "P4 실행 현황" },
] as const;

export function AdminHeader({ current, title, lead }: { current: (typeof TABS)[number]["href"]; title: string; lead: string }) {
  return (
    <>
      {/* NADAUM-BRAND-ADMIN-THEME-01: 관리자 머리에 나다움 로고(어두운 배경 전용 흰 로고) */}
      <p className={`${ad.kicker} ${ad.brandBar}`}>
        <Image src="/brand/nadaum/nadaum-logo.svg" alt="NADAUM" width={116} height={22} unoptimized className={ad.brandLogo} />
        <span className={ad.adminPill}>관리자 · 읽기 전용</span>
      </p>
      <nav aria-label="관리자 화면">
        <ul className={ad.tabs}>
          {TABS.map((t) => (
            <li key={t.href}>
              <Link href={t.href} className={`${ad.tab} ${t.href === current ? ad.tabActive : ""}`} aria-current={t.href === current ? "page" : undefined}>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.muted}>{lead}</p>
      <p className={`${styles.notice} ${ad.readonly}`} role="note">
        운영 상태를 보기만 하는 화면입니다. 가입자 정보 수정·삭제·비밀번호 초기화는 여기서 할 수 없습니다. 이 화면을 열 때마다 열람 기록이 남습니다.
      </p>
    </>
  );
}

/** 넓은 표: 좁은 화면에서는 이 영역 안에서만 가로로 밀린다(페이지 가로 스크롤 없음). 키보드로도 닿게 tabIndex */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={ad.tableWrap} role="region" aria-label={`${label} (좁은 화면에서는 옆으로 밀어 봅니다)`} tabIndex={0}>
      {children}
    </div>
  );
}

const KST = 9 * 60 * 60 * 1000;
/** 한국 시각 'YYYY-MM-DD HH:mm'(없으면 '—') */
export function kstDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 16).replace("T", " ");
}
/** 한국 날짜 'YYYY-MM-DD'(없으면 '—') */
export function kstDate(iso: string | null): string {
  return iso ? kstDateTime(iso).slice(0, 10) : "—";
}
/** 오늘(한국 날짜)에서 days 일 뺀 날짜 */
export function kstDaysAgo(days: number, now = new Date()): string {
  return new Date(now.getTime() + KST - days * 86_400_000).toISOString().slice(0, 10);
}
/** 긴 id 줄여 보이기(전체는 title) */
export function shortId(id: string | null): string {
  return id ? `${id.slice(0, 8)}…` : "—";
}
/** 마이크로달러 → 원(어림, 1달러 ≈ 1,450원: DEC08 보고서와 같은 기준) */
export function microUsdToWon(micro: number): string {
  const won = (micro / 1_000_000) * 1_450;
  return `${Math.round(won).toLocaleString("ko-KR")}원`;
}
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
