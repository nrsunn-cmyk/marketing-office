import Link from "next/link";
import styles from "../ui.module.css";

/** 상단 메뉴 (기능 확인용. 최종 모양은 AGY 시안으로) */
export function AppNav() {
  return (
    <nav aria-label="주 메뉴" className={styles.nav}>
      <Link href="/">현황</Link>
      <Link href="/clients">고객</Link>
      <Link href="/projects">프로젝트</Link>
      <form action="/auth/signout" method="post" className={styles.navRight}>
        <button type="submit" className={styles.linkButton}>
          로그아웃
        </button>
      </form>
    </nav>
  );
}
