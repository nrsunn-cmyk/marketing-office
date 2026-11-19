import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { listAdminAudit, type AdminAuditFilter } from "@/features/admin/server";
import { AppNav } from "../../_components/app-nav";
import styles from "../../ui.module.css";
import { AdminHeader, adminMetadata, kstDateTime, requireAdminOr404, shortId, TableWrap } from "../admin-parts";
import ad from "../admin.module.css";

export const generateMetadata = () => adminMetadata("감사 기록");

const PAGE = 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 관리자 ③ 감사 기록(최신 순, 100개씩). 조건: 기간(한국 날짜)·동작 이름·업무실 id. 상세 안의 글은 서버가 200자에서 자른다 */
export default function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
        <Suspense
          fallback={
            <p className={styles.muted} role="status">
              불러오는 중…
            </p>
          }
        >
          <Audit searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function Audit({ searchParams }: { searchParams: PageProps<"/admin/audit">["searchParams"] }) {
  await requireAdminOr404();
  const sp = await searchParams;
  const from = DATE.test(str(sp.from)) ? str(sp.from) : "";
  const to = DATE.test(str(sp.to)) ? str(sp.to) : "";
  const action = str(sp.action).slice(0, 100);
  const workspace = str(sp.workspace);
  const before = Number(str(sp.before));
  const workspaceBad = workspace !== "" && !UUID.test(workspace);

  // 한국 날짜 → 그날 0시(시작)·다음 날 0시 직전(끝)의 ISO 시각
  const filter: AdminAuditFilter = {
    limit: PAGE,
    ...(from ? { from: `${from}T00:00:00+09:00` } : {}),
    ...(to ? { to: `${to}T23:59:59.999+09:00` } : {}),
    ...(action ? { action } : {}),
    ...(workspace && !workspaceBad ? { workspaceId: workspace } : {}),
    ...(Number.isSafeInteger(before) && before > 0 ? { beforeSeq: before } : {}),
  };
  const res = await listAdminAudit(filter);
  if (!res.ok && res.code === "NOT_FOUND") notFound();

  const query = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(action ? { action } : {}), ...(workspace && !workspaceBad ? { workspace } : {}) });
  const base = `/admin/audit${query.size ? `?${query}` : ""}`;
  const filtered = Boolean(from || to || action || workspace);

  return (
    <>
      <AdminHeader current="/admin/audit" title="감사 기록" lead="생성·수정·승인 같은 기록을 최신 순으로 봅니다. 기간·동작 이름·업무실로 거를 수 있습니다." />

      <section className={styles.section} aria-labelledby="audit-filter">
        <h2 id="audit-filter" className={styles.subtitle}>
          조회 조건
        </h2>
        <form className={ad.filters} aria-label="감사 기록 거르기">
          <div className={styles.field}>
            <label htmlFor="audit-from">시작일</label>
            <input id="audit-from" name="from" type="date" defaultValue={from} />
          </div>
          <div className={styles.field}>
            <label htmlFor="audit-to">끝일(포함)</label>
            <input id="audit-to" name="to" type="date" defaultValue={to} />
          </div>
          <div className={styles.field}>
            <label htmlFor="audit-action">동작 이름</label>
            <input id="audit-action" name="action" defaultValue={action} maxLength={100} placeholder="예: create, approve, copy_generate" />
          </div>
          <div className={styles.field}>
            <label htmlFor="audit-workspace">업무실 id</label>
            <input id="audit-workspace" name="workspace" defaultValue={workspace} placeholder="전체" aria-describedby={workspaceBad ? "audit-workspace-error" : undefined} aria-invalid={workspaceBad || undefined} />
            {workspaceBad && (
              <span id="audit-workspace-error" className={styles.error}>
                업무실 id 형식이 아닙니다. 이 조건은 빼고 보여 줍니다.
              </span>
            )}
          </div>
          <button type="submit" className={styles.secondaryButton}>
            조회
          </button>
        </form>
        {filtered && (
          <p className={ad.pager}>
            <Link href="/admin/audit" className={`${styles.secondaryButton} ${styles.touchTarget}`}>
              조건 지우기
            </Link>
          </p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="audit-list">
        <h2 id="audit-list" className={styles.subtitle}>
          기록 {filter.beforeSeq ? "(다음 쪽)" : ""}
        </h2>
        {!res.ok ? (
          <p className={styles.error} role="alert">
            {res.message}
          </p>
        ) : res.data.rows.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>{filtered ? "조건에 맞는 기록이 없습니다." : "아직 기록이 없습니다."}</strong>
          </div>
        ) : (
          <TableWrap label="감사 기록">
            <table className={styles.table}>
              <caption className={styles.srOnly}>감사 기록 {res.data.rows.length}개</caption>
              <thead>
                <tr>
                  <th scope="col">발생 시각</th>
                  <th scope="col">업무실</th>
                  <th scope="col">대상 종류</th>
                  <th scope="col">동작</th>
                  <th scope="col">대상</th>
                  <th scope="col" className={ad.num}>
                    변경 번호
                  </th>
                  <th scope="col">상세</th>
                </tr>
              </thead>
              <tbody>
                {res.data.rows.map((r) => (
                  <tr key={r.seq}>
                    <td data-label="발생 시각">{kstDateTime(r.occurredAt)}</td>
                    <td data-label="업무실">
                      <span title={r.workspaceId}>{shortId(r.workspaceId)}</span>
                    </td>
                    <td data-label="대상 종류">{r.entityType}</td>
                    <td data-label="동작">{r.action}</td>
                    <td data-label="대상">
                      <span title={r.entityId}>{shortId(r.entityId)}</span>
                    </td>
                    <td data-label="변경 번호" className={ad.num}>{r.revision ?? "—"}</td>
                    <td data-label="상세">
                      {r.details && typeof r.details === "object" && Object.keys(r.details).length > 0 ? (
                        <details className={ad.details}>
                          <summary>보기</summary>
                          <pre>{JSON.stringify(r.details, null, 2)}</pre>
                        </details>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <p className={ad.pager}>
          {filter.beforeSeq && (
            <Link href={base} className={`${styles.secondaryButton} ${styles.touchTarget}`}>
              처음으로
            </Link>
          )}
          {res.ok && res.data.nextBeforeSeq && (
            <Link href={`${base}${query.size ? "&" : "?"}before=${res.data.nextBeforeSeq}`} className={`${styles.secondaryButton} ${styles.touchTarget}`}>
              다음 {PAGE}개
            </Link>
          )}
        </p>
      </section>
    </>
  );
}
