import { Suspense } from "react";
import { requireWorkspace } from "@/server/auth/session";
import styles from "./ui.module.css";

export default function HomePage() {
  return (
    <main className={styles.page}>
      <Suspense fallback={<p className={styles.muted}>불러오는 중…</p>}>
        <Home />
      </Suspense>
    </main>
  );
}

/** 로그인 정보를 읽는 부분. 요청마다 서버에서 그린다. */
async function Home() {
  const { user, workspace } = await requireWorkspace();
  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.title}>{workspace.name}</h1>
        <form action="/auth/signout" method="post">
          <button type="submit" className={styles.button}>
            로그아웃
          </button>
        </form>
      </div>
      <p className={styles.muted}>{user.email} 계정으로 로그인했습니다.</p>
      <p>고객·프로젝트·작업 화면은 다음 단계(M4~M7)에서 추가됩니다.</p>
    </>
  );
}
