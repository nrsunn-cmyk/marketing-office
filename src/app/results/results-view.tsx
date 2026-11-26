import Link from "next/link";
import { TASK_STATUS_LABELS, TASK_TYPE_LABELS } from "@/domain/state/labels";
import { formatDateTimeIn } from "../_components/format-time";
import { Pager } from "../_components/pager";
import styles from "../ui.module.css";
import { safeBundleHref, type DeliveryBundleEntry, type ResultEntry, type ResultEntryType } from "./result-entry";
import { RESULTS_COPY as C, bundleItemCount, bundleRestoredNote, bundleStatusLabel, bundleTitle } from "./results-copy";

/**
 * 결과물 목록(S09 모아 보기) 본문: 찾기 폼·빈 상태·결과물/납품 묶음 줄·쪽 넘김.
 * 데이터 읽기는 page.tsx, 이 컴포넌트는 그리기만 한다(UX-F1-RESULTS-FRONT-01, 합성 계약 시험 대상).
 */
export function ResultsView({
  items,
  total,
  nextCursor,
  type,
  approvedOnly,
  page,
  timeZone,
}: {
  items: ResultEntry[];
  total: number;
  nextCursor: string | null;
  type: ResultEntryType | null;
  approvedOnly: boolean;
  page: number;
  timeZone: string;
}) {
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
          <option value="delivery_bundle">{C.typeBundle}</option>
        </select>
        <label className={styles.row}>
          <input type="checkbox" name="approved" value="1" defaultChecked={approvedOnly} /> {C.approvedOnlyLabel}
        </label>
        <button type="submit" className={styles.secondaryButton}>
          찾기
        </button>
      </form>
      {items.length === 0 ? (
        <EmptyResults type={type} approvedOnly={approvedOnly} />
      ) : (
        <ul className={styles.list} aria-label="결과물 목록">
          {items.map((r) =>
            r.kind === "delivery_bundle" ? (
              <BundleRow key={`b-${r.id}`} r={r} timeZone={timeZone} />
            ) : (
              <ArtifactRow key={`a-${r.id}`} r={r} timeZone={timeZone} />
            ),
          )}
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

function EmptyResults({ type, approvedOnly }: { type: ResultEntryType | null; approvedOnly: boolean }) {
  if (!type && !approvedOnly) {
    return (
      <div className={styles.emptyState}>
        <strong>{C.emptyTitle}</strong>
        <p className={styles.muted}>{C.emptyDesc}</p>
        <p className={styles.row}>
          <Link href="/projects" className={styles.button}>
            {C.emptyCta}
          </Link>
        </p>
      </div>
    );
  }
  const bundle = type === "delivery_bundle";
  return (
    <div className={styles.emptyState}>
      <strong>{bundle ? C.bundleFilterEmptyTitle : C.filterEmptyTitle}</strong>
      <p className={styles.muted}>{bundle ? C.bundleFilterEmptyDesc : C.filterEmptyDesc}</p>
      {approvedOnly && <p className={styles.muted}>{C.approvedOnlyEmptyHint}</p>}
      <p className={styles.row}>
        <Link href="/results" className={styles.secondaryButton}>
          {C.filterClear}
        </Link>
      </p>
    </div>
  );
}

/** 프로젝트·고객·시각(결과물과 납품 묶음 공통 메타 줄) */
function Meta({ r, timeZone, extra }: { r: Pick<ResultEntry, "project_id" | "project_title" | "client_name" | "updated_at">; timeZone: string; extra?: string }) {
  return (
    <span className={`${styles.muted} ${styles.metaRow}`}>
      <Link href={`/projects/${r.project_id}`} className={styles.metaLink} title={r.project_title}>
        {r.project_title}
      </Link>
      {r.client_name && (
        <span className={styles.metaLink} title={r.client_name}>
          {r.client_name}
        </span>
      )}
      <span className={styles.metaLink}>{formatDateTimeIn(r.updated_at, timeZone)}</span>
      {extra && <span className={styles.metaLink}>{extra}</span>}
    </span>
  );
}

function ArtifactRow({ r, timeZone }: { r: Extract<ResultEntry, { kind: "artifact" }>; timeZone: string }) {
  const label = TASK_TYPE_LABELS[r.type] ?? r.type;
  return (
    <li className={styles.listItem}>
      <span className={styles.rowMainGrow}>
        <Link href={`/tasks/${r.task_id}`} className={styles.rowLink} title={label}>
          {label}
        </Link>
        <Meta r={r} timeZone={timeZone} />
      </span>
      <span className={styles.rowActions}>
        {r.current_version !== null && <span className={styles.muted}>현재 초안 {r.current_version}번</span>}
        {r.approved_version !== null ? <span className={styles.badge}>승인본 {r.approved_version}번</span> : <span className={styles.muted}>승인 전</span>}
        <span className={styles.badge}>{TASK_STATUS_LABELS[r.task_status] ?? r.task_status}</span>
      </span>
    </li>
  );
}

/** 납품 묶음 줄: 유효한 작업 상세 링크가 있을 때만 이동, 없으면 제목만(AGY 2절 나항) */
function BundleRow({ r, timeZone }: { r: DeliveryBundleEntry; timeZone: string }) {
  const title = bundleTitle(r.bundle_no);
  const href = safeBundleHref(r);
  return (
    <li className={styles.listItem}>
      <span className={styles.rowMainGrow}>
        {href ? (
          <Link href={href} className={styles.rowLink} title={title}>
            {title}
          </Link>
        ) : (
          <strong className={styles.rowLink} title={title}>
            {title}
          </strong>
        )}
        <Meta r={r} timeZone={timeZone} extra={bundleItemCount(r.item_count)} />
      </span>
      <span className={styles.rowActions}>
        {r.restored_from_bundle_no !== null && <span className={styles.muted}>{bundleRestoredNote(r.restored_from_bundle_no)}</span>}
        <span className={styles.badge}>{bundleStatusLabel(r.status)}</span>
      </span>
    </li>
  );
}
