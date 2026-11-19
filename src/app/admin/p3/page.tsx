import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAdminP3Progress } from "@/features/admin/server";
import { AppNav } from "../../_components/app-nav";
import styles from "../../ui.module.css";
import { AdminHeader, adminMetadata, kstDateTime, requireAdminOr404, shortId, TableWrap } from "../admin-parts";
import ad from "../admin.module.css";
import { blockedText, chipText, stageChips, stageSummary, totals } from "./p3-progress-view";

export const generateMetadata = () => adminMetadata("P3 진행 현황");

/**
 * 관리자 ④ 업무실별 P3 제작 진행 현황(ADMIN-P3-01, AGY 시안 p3-progress.html). 읽기 전용, 비관리자 404.
 * 개수·상태·시각만 보여 준다(브리프·문구·프로젝트 이름 등 본문 0). 구현된 단계만 실제 개수, 나머지는 '준비 중'.
 */
export default function AdminP3Page() {
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
          <Progress />
        </Suspense>
      </main>
    </>
  );
}

async function Progress() {
  await requireAdminOr404();
  const res = await getAdminP3Progress();
  if (!res.ok && res.code === "NOT_FOUND") notFound();
  const rows = res.ok ? res.data : [];
  const t = totals(rows);

  return (
    <>
      <AdminHeader
        current="/admin/p3"
        title="업무실별 P3 제작 진행 현황"
        lead="업무실·프로젝트별로 지금 있는 단계(제작 브리프·홈페이지)의 개수와 막힌 곳(이전 기준·한도·승인 대기), 최근 활동 시각만 봅니다. 브리프·문구 등 본문 내용은 표시하지 않습니다. 아직 없는 단계는 '준비 중'입니다."
      />

      <section className={styles.section} aria-labelledby="p3-result">
        <h2 id="p3-result" className={styles.subtitle}>
          업무실 · 프로젝트별 현황
        </h2>
        {!res.ok ? (
          <p className={styles.error} role="alert">
            {res.message}
          </p>
        ) : (
          <>
            <ul className={ad.totals} aria-label="합계">
              <Total label="P3 진행 프로젝트" value={`${t.projects}개`} />
              <Total label="이전 기준 경고" value={`${t.stale}건`} />
              <Total label="한도 도달" value={`${t.limit}건`} />
              <Total label="검수 · 승인 대기" value={t.pendingApprovals === null ? "준비 중" : `${t.pendingApprovals}건`} />
            </ul>
            {rows.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>아직 P3 제작을 시작한 업무실이 없습니다.</strong>
                <p className={styles.muted}>공통 제작 브리프가 1건 이상 생기면 업무실별 진행 현황이 이곳에 집계됩니다.</p>
              </div>
            ) : (
              <TableWrap label="업무실·프로젝트별 P3 진행 현황">
                <table className={styles.table}>
                  <caption className={styles.srOnly}>P3 진행 프로젝트 {rows.length}개(본문 내용 없음)</caption>
                  <thead>
                    <tr>
                      <th scope="col">업무실 · 프로젝트</th>
                      <th scope="col">구현된 단계 요약</th>
                      <th scope="col">단계별 현황</th>
                      <th scope="col">막힌 곳</th>
                      <th scope="col">최근 활동(한국 시각)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.workspaceId}-${r.projectId}`}>
                        <td data-label="업무실 · 프로젝트" className={ad.wrapCell}>
                          <strong>{r.workspaceName}</strong>
                          <br />
                          <span className={styles.muted}>
                            {r.ownerEmail ?? "—"} · 프로젝트 {shortId(r.projectId)}
                          </span>
                        </td>
                        <td data-label="구현된 단계 요약" className={ad.wrapCell}>
                          {stageSummary(r)}
                        </td>
                        <td data-label="단계별 현황" className={ad.wrapCell}>
                          <ul className={ad.quick} aria-label="단계별 현황">
                            {stageChips(r).map((c) => (
                              <li key={c.label} className={`${styles.pill} ${c.count === null ? styles.pillNeutral : styles.pillInfo}`}>
                                {chipText(c)}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td data-label="막힌 곳" className={ad.wrapCell}>
                          {blockedText(r)}
                        </td>
                        <td data-label="최근 활동">{kstDateTime(r.lastActivityAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </>
        )}
      </section>
    </>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <li className={ad.total}>
      <span className={styles.muted}>{label}</span>
      <span className={ad.totalValue}>{value}</span>
    </li>
  );
}
