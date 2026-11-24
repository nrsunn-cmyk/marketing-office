import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { decodeCursor, parsePage } from "@/domain/paging";
import { listResultEntries } from "@/features/library/server";
import { requireWorkspace } from "@/server/auth/session";
import { AppNav } from "../_components/app-nav";
import styles from "../ui.module.css";
import { parseResultType } from "./result-entry";
import { RESULTS_COPY } from "./results-copy";
import { ResultsView } from "./results-view";

export const metadata: Metadata = { title: "결과물 · 마케팅 업무실" };

/** 결과물 (S09 모아 보기): 로고 브리프·견적·전략 결과물과 납품 묶음(UX-F1)을 한 목록으로. */
export default function ResultsPage({ searchParams }: PageProps<"/results">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
        <h1 className={styles.title}>결과물</h1>
        <p className={styles.muted}>{RESULTS_COPY.intro}</p>
        <Suspense
          fallback={
            <p className={styles.muted} role="status">
              결과물 목록을 불러오는 중…
            </p>
          }
        >
          <Results searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

/** 결과물 목록 (UI-RESP-04): 빈 상태·불러오는 중·오류를 목록 화면(UI-RESP-03)과 같은 구조로, 긴 이름은 한 줄 말줄임 + title */
async function Results({ searchParams }: { searchParams: PageProps<"/results">["searchParams"] }) {
  const params = await searchParams;
  const type = parseResultType(params.type);
  const approvedOnly = params.approved === "1";
  const cursor = decodeCursor(typeof params.cursor === "string" ? params.cursor : null);
  const page = cursor ? parsePage(params.page) : 1;
  let loaded: [Awaited<ReturnType<typeof listResultEntries>>, Awaited<ReturnType<typeof requireWorkspace>>];
  try {
    loaded = await Promise.all([
      listResultEntries({ type, approvedOnly, cursor }), // 결과물 + 납품 묶음(보관 제외·업무실 분리는 서버)
      requireWorkspace(), // 요청마다 캐시됨. 시각을 업무실 시간대로 보이기 위해(UI-TIME-02)
    ]);
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과시킨다
    console.error("[results]", e);
    return (
      <section className={styles.section} aria-label="결과물 목록 상태">
        <p className={styles.error} role="alert">
          결과물 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <p>
          <Link href="/results" className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            다시 불러오기
          </Link>
        </p>
      </section>
    );
  }
  const [{ items, total, nextCursor }, { workspace }] = loaded;
  return <ResultsView items={items} total={total} nextCursor={nextCursor} type={type} approvedOnly={approvedOnly} page={page} timeZone={workspace.timezone} />;
}
