"use client"; // 오류 경계는 클라이언트 컴포넌트여야 한다

import Link from "next/link";
import { useEffect } from "react";
import styles from "./ui.module.css";

/**
 * 화면 단위 안전망 (UI-RESP-04, QA-SWEEP-01 D1).
 * 각 화면이 조회 실패를 직접 처리하지만, 그래도 빠져나온 예외가 Next 기본 영문 화면으로 바뀌지 않게 한다.
 * 문구는 목록 화면(UI-RESP-03)의 오류 문구 규칙과 같다. 서버 오류 내용(message)은 보여 주지 않는다.
 */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  return (
    <main className={`${styles.page} ${styles.touchPage}`}>
      <h1 className={styles.title}>화면을 불러오지 못했습니다</h1>
      <section className={styles.section} aria-label="오류 안내">
        <p className={styles.error} role="alert">
          화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <p className={styles.row}>
          <button type="button" className={styles.button} onClick={() => retry()}>
            다시 불러오기
          </button>
          <Link href="/" className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            현황으로
          </Link>
        </p>
        {digest && <p className={styles.muted}>문의할 때 알려 주실 번호: {digest}</p>}
      </section>
    </main>
  );
}
