import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAdminP4Execution } from "@/features/admin/server";
import { AppNav } from "../../_components/app-nav";
import styles from "../../ui.module.css";
import { AdminHeader, adminMetadata, kstDateTime, requireAdminOr404, shortId, TableWrap } from "../admin-parts";
import ad from "../admin.module.css";
import { blockedText, chipText, outputText, statusChips, totals, type ChipTone } from "./p4-execution-view";

export const generateMetadata = () => adminMetadata("P4 실행 현황");

const TONE: Record<ChipTone, string> = { info: styles.pillInfo, warning: styles.pillWarning, danger: styles.pillDanger, neutral: styles.pillNeutral };

/**
 * 관리자 ⑤ 업무실별 P4 실행 현황(ADMIN-P4-01, AGY 시안 p4-execution.html). 읽기 전용, 비관리자 404.
 * 개수·상태·시각만 보여 준다. 초안 본문·게시 주소·성과 출처·업무실 이름·이메일은 받지 않는다(업무실·프로젝트는 짧은 id).
 */
export default function AdminP4Page() {
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
          <Execution />
        </Suspense>
      </main>
    </>
  );
}

async function Execution() {
  await requireAdminOr404();
  const res = await getAdminP4Execution();
  if (!res.ok && res.code === "NOT_FOUND") notFound();
  const rows = res.ok ? res.data : [];
  const t = totals(rows);

  return (
    <>
      <AdminHeader
        current="/admin/p4"
        title="업무실별 P4 실행 현황"
        lead="업무실·프로젝트별 실행 건 상태 7종 개수, 막힘 원인 3종 개수, 재시도 3회 소진 건수, 티스토리 수동 게시 기록 수, 성과 입력 수, 최근 활동 시각(KST)만 집계합니다. 본문·게시 주소·개인정보는 표시하지 않습니다."
      />

      <section className={styles.section} aria-labelledby="p4-result">
        <h2 id="p4-result" className={styles.subtitle}>
          업무실 · 프로젝트별 실행 집계
        </h2>
        {!res.ok ? (
          <p className={styles.error} role="alert">
            {res.message}
          </p>
        ) : (
          <>
            <ul className={ad.totals} aria-label="합계">
              <Total label="전체 실행 건 (7종 합계)" value={`${t.jobs}건`} />
              <Total label="불일치 차단 (3종)" value={`${t.blocked}건`} />
              <Total label="재시도 3회 소진" value={`${t.retryExhausted}건`} />
              <Total label="티스토리 게시 · 성과 입력" value={`${t.published} · ${t.results}건`} />
            </ul>
            {rows.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>아직 P4 실행 건이 없습니다.</strong>
                <p className={styles.muted}>실행 승인 대기열에 1건 이상 등록되면 업무실별 실행 현황이 이곳에 집계됩니다.</p>
              </div>
            ) : (
              <TableWrap label="업무실·프로젝트별 P4 실행 현황">
                <table className={styles.table}>
                  <caption className={styles.srOnly}>P4 실행 프로젝트 {rows.length}개(본문·주소·개인정보 없음)</caption>
                  <thead>
                    <tr>
                      <th scope="col">업무실 · 프로젝트</th>
                      <th scope="col">실행 건 상태 7종 개수</th>
                      <th scope="col">막힘 원인 3종 · 재시도 소진</th>
                      <th scope="col">티스토리 게시 · 성과 입력 수</th>
                      <th scope="col">최근 활동(KST)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.workspaceId}-${r.projectId}`}>
                        <td data-label="업무실 · 프로젝트" className={ad.wrapCell}>
                          <strong>업무실 {shortId(r.workspaceId)}</strong>
                          <br />
                          <span className={styles.muted}>프로젝트 {shortId(r.projectId)}</span>
                        </td>
                        <td data-label="실행 건 상태 7종" className={ad.wrapCell}>
                          <ul className={ad.quick} aria-label="실행 건 상태 7종 개수">
                            {statusChips(r).map((c) => (
                              <li key={c.label} className={`${styles.pill} ${TONE[c.tone]}`}>
                                {chipText(c)}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td data-label="막힘 원인 · 재시도 소진" className={ad.wrapCell}>
                          {blockedText(r)}
                        </td>
                        <td data-label="티스토리 게시 · 성과 입력" className={ad.wrapCell}>
                          {outputText(r)}
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
