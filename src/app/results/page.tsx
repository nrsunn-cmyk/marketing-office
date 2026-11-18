import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { TASK_STATUS_LABELS, TASK_TYPE_LABELS } from "@/domain/state/labels";
import { decodeCursor, parsePage } from "@/domain/paging";
import { listResults } from "@/features/library/server";
import { requireWorkspace } from "@/server/auth/session";
import { AppNav } from "../_components/app-nav";
import { formatDateTimeIn } from "../_components/format-time";
import { Pager } from "../_components/pager";
import styles from "../ui.module.css";

export const metadata: Metadata = { title: "결과물 · 마케팅 업무실" };

/** 결과물 (S09 모아 보기): 로고 브리프·견적 결과물의 현재 초안·승인본·작업 상태. */
export default function ResultsPage({ searchParams }: PageProps<"/results">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
        <h1 className={styles.title}>결과물</h1>
        <p className={styles.muted}>모든 프로젝트의 결과물을 모아 봅니다. 승인본은 고객에게 전달할 수 있는 확정본입니다.</p>
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
  const type = params.type === "logo_brief" || params.type === "quote" || params.type === "strategy" ? params.type : null;
  const approvedOnly = params.approved === "1";
  const cursor = decodeCursor(typeof params.cursor === "string" ? params.cursor : null);
  const page = cursor ? parsePage(params.page) : 1;
  let loaded: [Awaited<ReturnType<typeof listResults>>, Awaited<ReturnType<typeof requireWorkspace>>];
  try {
    loaded = await Promise.all([
      listResults({ type, approvedOnly, cursor }),
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

  return (
    <section className={styles.section} aria-labelledby="results-list">
      <h2 id="results-list" className={styles.subtitle}>
        결과물 목록
      </h2>
      <form className={`${styles.row} ${styles.searchForm}`} role="search" aria-label="결과물 찾기">
        <label htmlFor="results-type" className={styles.muted}>
          종류
        </label>
        <select id="results-type" name="type" defaultValue={type ?? ""}>
          <option value="">전체</option>
          <option value="logo_brief">{TASK_TYPE_LABELS.logo_brief}</option>
          <option value="quote">{TASK_TYPE_LABELS.quote}</option>
          <option value="strategy">{TASK_TYPE_LABELS.strategy}</option>
        </select>
        <label className={styles.row}>
          <input type="checkbox" name="approved" value="1" defaultChecked={approvedOnly} /> 승인본 있는 것만
        </label>
        <button type="submit" className={styles.secondaryButton}>
          찾기
        </button>
      </form>
      {items.length === 0 ? (
        type || approvedOnly ? (
          <div className={styles.emptyState}>
            <strong>조건에 맞는 결과물이 없습니다.</strong>
            <p className={styles.muted}>종류를 &lsquo;전체&rsquo;로 바꾸거나 &lsquo;승인본 있는 것만&rsquo;을 끄고 다시 찾아 보세요.</p>
            <p className={styles.row}>
              <Link href="/results" className={styles.secondaryButton}>
                조건 지우기
              </Link>
            </p>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>아직 만든 결과물이 없습니다.</strong>
            <p className={styles.muted}>프로젝트 화면에서 로고 브리프·견적·마케팅 전략 작업을 만들면 여기에 모입니다.</p>
            <p className={styles.row}>
              <Link href="/projects" className={styles.button}>
                프로젝트 화면으로
              </Link>
            </p>
          </div>
        )
      ) : (
        <ul className={styles.list} aria-label="결과물 목록">
          {items.map((r) => {
            const label = TASK_TYPE_LABELS[r.type] ?? r.type;
            return (
              <li key={r.id} className={styles.listItem}>
                <span className={styles.rowMainGrow}>
                  <Link href={`/tasks/${r.task_id}`} className={styles.rowLink} title={label}>
                    {label}
                  </Link>
                  <span className={`${styles.muted} ${styles.metaRow}`}>
                    <Link href={`/projects/${r.project_id}`} className={styles.metaLink} title={r.project_title}>
                      {r.project_title}
                    </Link>
                    {r.client_name && (
                      <span className={styles.metaLink} title={r.client_name}>
                        {r.client_name}
                      </span>
                    )}
                    <span className={styles.metaLink}>{formatDateTimeIn(r.updated_at, workspace.timezone)}</span>
                  </span>
                </span>
                <span className={styles.rowActions}>
                  {r.current_version !== null && <span className={styles.muted}>현재 초안 {r.current_version}번</span>}
                  {r.approved_version !== null ? (
                    <span className={styles.badge}>승인본 {r.approved_version}번</span>
                  ) : (
                    <span className={styles.muted}>승인 전</span>
                  )}
                  <span className={styles.badge}>{TASK_STATUS_LABELS[r.task_status] ?? r.task_status}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {total > 0 && (
        <Pager
          basePath="/results"
          params={{ type, approved: approvedOnly ? "1" : null }}
          total={total}
          page={page}
          shown={items.length}
          nextCursor={nextCursor}
          label="결과물"
        />
      )}
    </section>
  );
}
