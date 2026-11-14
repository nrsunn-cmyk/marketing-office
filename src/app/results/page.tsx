import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TASK_STATUS_LABELS, TASK_TYPE_LABELS } from "@/domain/state/labels";
import { decodeCursor, parsePage } from "@/domain/paging";
import { listResults } from "@/features/library/server";
import { AppNav } from "../_components/app-nav";
import { Pager } from "../_components/pager";
import styles from "../ui.module.css";

export const metadata: Metadata = { title: "결과물 · 마케팅 업무실" };

/** 결과물 (S09 모아 보기): 로고 브리프·견적 결과물의 현재 초안·승인본·작업 상태. */
export default function ResultsPage({ searchParams }: PageProps<"/results">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide}`}>
        <h1 className={styles.title}>결과물</h1>
        <p className={styles.muted}>모든 프로젝트의 결과물을 모아 봅니다. 승인본은 고객에게 전달할 수 있는 확정본입니다.</p>
        <Suspense fallback={<p className={styles.muted}>불러오는 중…</p>}>
          <Results searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/results">["searchParams"] }) {
  const params = await searchParams;
  const type = params.type === "logo_brief" || params.type === "quote" ? params.type : null;
  const approvedOnly = params.approved === "1";
  const cursor = decodeCursor(typeof params.cursor === "string" ? params.cursor : null);
  const page = cursor ? parsePage(params.page) : 1;
  const { items, total, nextCursor } = await listResults({ type, approvedOnly, cursor });

  return (
    <section className={styles.section} aria-labelledby="results-list">
      <h2 id="results-list" className={styles.subtitle}>
        결과물 목록
      </h2>
      <form className={styles.row} role="search" aria-label="결과물 찾기">
        <label htmlFor="results-type" className={styles.muted}>
          종류
        </label>
        <select id="results-type" name="type" defaultValue={type ?? ""}>
          <option value="">전체</option>
          <option value="logo_brief">{TASK_TYPE_LABELS.logo_brief}</option>
          <option value="quote">{TASK_TYPE_LABELS.quote}</option>
        </select>
        <label className={styles.row}>
          <input type="checkbox" name="approved" value="1" defaultChecked={approvedOnly} /> 승인본 있는 것만
        </label>
        <button type="submit" className={styles.secondaryButton}>
          찾기
        </button>
      </form>
      {items.length === 0 ? (
        <p className={styles.muted}>{type || approvedOnly ? "조건에 맞는 결과물이 없습니다." : "아직 만든 결과물이 없습니다."}</p>
      ) : (
        <ul className={styles.list} aria-label="결과물 목록">
          {items.map((r) => (
            <li key={r.id} className={styles.listItem}>
              <div>
                <Link href={`/tasks/${r.task_id}`}>{TASK_TYPE_LABELS[r.type] ?? r.type}</Link>
                <div className={styles.muted}>
                  <Link href={`/projects/${r.project_id}`}>{r.project_title}</Link>
                  {r.client_name && ` · ${r.client_name}`}
                  {" · "}
                  {new Date(r.updated_at).toLocaleString("ko-KR")}
                </div>
              </div>
              <div className={styles.row}>
                {r.current_version !== null && <span className={styles.muted}>현재 초안 {r.current_version}번</span>}
                {r.approved_version !== null ? (
                  <span className={styles.badge}>승인본 {r.approved_version}번</span>
                ) : (
                  <span className={styles.muted}>승인 전</span>
                )}
                <span className={styles.badge}>{TASK_STATUS_LABELS[r.task_status] ?? r.task_status}</span>
              </div>
            </li>
          ))}
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
