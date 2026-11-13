import Link from "next/link";
import { Suspense } from "react";
import { requireWorkspace } from "@/server/auth/session";
import { AppNav } from "./_components/app-nav";
import styles from "./ui.module.css";

export default function HomePage() {
  return (
    <main className={`${styles.page} ${styles.wide}`}>
      <AppNav />
      <Suspense fallback={<p className={styles.muted}>불러오는 중…</p>}>
        <Home />
      </Suspense>
    </main>
  );
}

/** 로그인 정보를 읽는 부분. 요청마다 서버에서 그린다. 실제 현황 집계는 M7에서. */
async function Home() {
  const { user, workspace } = await requireWorkspace();
  return (
    <>
      <h1 className={styles.title}>{workspace.name}</h1>
      <p className={styles.muted}>{user.email} 계정으로 로그인했습니다.</p>
      <ul className={styles.list}>
        <li className={styles.listItem}>
          <Link href="/clients">고객 관리</Link>
          <span className={styles.muted}>고객 정보·회사 프로필·자료</span>
        </li>
        <li className={styles.listItem}>
          <Link href="/projects">프로젝트</Link>
          <span className={styles.muted}>고객·자체 프로젝트와 자료</span>
        </li>
      </ul>
    </>
  );
}
