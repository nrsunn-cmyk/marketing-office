import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAdminUsage } from "@/features/admin/server";
import { AppNav } from "../../_components/app-nav";
import styles from "../../ui.module.css";
import { AdminHeader, adminMetadata, formatBytes, kstDateTime, kstDaysAgo, microUsdToWon, requireAdminOr404, TableWrap } from "../admin-parts";
import ad from "../admin.module.css";

export const generateMetadata = () => adminMetadata("이용 현황");

/** 관리자 ② 이용 현황: 한국 날짜 기간(끝일 포함, 최대 366일), 업무실별 수치와 합계. 업무 내용 글은 없다 */
export default function AdminUsagePage({ searchParams }: PageProps<"/admin/usage">) {
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
          <Usage searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function Usage({ searchParams }: { searchParams: PageProps<"/admin/usage">["searchParams"] }) {
  await requireAdminOr404();
  const sp = await searchParams;
  const today = kstDaysAgo(0);
  const from = typeof sp.from === "string" && DATE.test(sp.from) ? sp.from : kstDaysAgo(6);
  const to = typeof sp.to === "string" && DATE.test(sp.to) ? sp.to : today;
  const res = await getAdminUsage(from, to);
  if (!res.ok && res.code === "NOT_FOUND") notFound();

  const rows = res.ok ? res.data : [];
  const sum = (k: "tasksCreated" | "artifactVersionsCreated" | "briefsCreated" | "aiRuns" | "aiCostUsdMicro" | "assetsAdded" | "assetBytes") => rows.reduce((n, r) => n + r[k], 0);
  const quick = [
    { label: "최근 7일", from: kstDaysAgo(6) },
    { label: "최근 30일", from: kstDaysAgo(29) },
  ];

  return (
    <>
      <AdminHeader current="/admin/usage" title="이용 현황" lead="기간을 골라 업무실별 작업·결과물·브리프·AI 문구·자료 수를 봅니다. 날짜는 한국 날짜이고 끝일을 포함합니다(최대 366일)." />

      <section className={styles.section} aria-labelledby="usage-range">
        <h2 id="usage-range" className={styles.subtitle}>
          기간
        </h2>
        <p className={ad.quick}>
          {quick.map((q) => (
            <Link
              key={q.label}
              href={`/admin/usage?from=${q.from}&to=${today}`}
              className={`${ad.tab} ${from === q.from && to === today ? ad.tabActive : ""}`}
              aria-current={from === q.from && to === today ? "true" : undefined}
            >
              {q.label}
            </Link>
          ))}
        </p>
        <form className={ad.filters} aria-label="기간 직접 고르기">
          <div className={styles.field}>
            <label htmlFor="usage-from">시작일</label>
            <input id="usage-from" name="from" type="date" defaultValue={from} max={today} />
          </div>
          <div className={styles.field}>
            <label htmlFor="usage-to">끝일(포함)</label>
            <input id="usage-to" name="to" type="date" defaultValue={to} max={today} />
          </div>
          <button type="submit" className={styles.secondaryButton}>
            이 기간으로 보기
          </button>
        </form>
      </section>

      <section className={styles.section} aria-labelledby="usage-result">
        <h2 id="usage-result" className={styles.subtitle}>
          {from} ~ {to}
        </h2>
        {!res.ok ? (
          <p className={styles.error} role="alert">
            {res.message}
          </p>
        ) : (
          <>
            <ul className={ad.totals} aria-label="기간 합계">
              <Total label="만든 작업" value={`${sum("tasksCreated")}건`} />
              <Total label="결과물 버전" value={`${sum("artifactVersionsCreated")}개`} />
              <Total label="콘텐츠 브리프" value={`${sum("briefsCreated")}건`} />
              <Total label="AI 문구 생성 · 추정 비용" value={`${sum("aiRuns")}회 · ${microUsdToWon(sum("aiCostUsdMicro"))}`} note="비용은 공개 요금표 기준 어림(1달러 ≈ 1,450원). 실제 청구는 업체 콘솔 기준" />
              <Total label="올린 자료" value={`${sum("assetsAdded")}개 · ${formatBytes(sum("assetBytes"))}`} />
            </ul>
            {rows.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>이 기간에 활동한 업무실이 없습니다.</strong>
              </div>
            ) : (
              <TableWrap label="업무실별 이용 현황">
                <table className={styles.table}>
                  <caption className={styles.srOnly}>
                    {from} ~ {to} 업무실 {rows.length}곳
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">업무실</th>
                      <th scope="col">주인 이메일</th>
                      <th scope="col" className={ad.num}>
                        작업
                      </th>
                      <th scope="col" className={ad.num}>
                        결과물 버전
                      </th>
                      <th scope="col" className={ad.num}>
                        브리프
                      </th>
                      <th scope="col" className={ad.num}>
                        AI 생성
                      </th>
                      <th scope="col" className={ad.num}>
                        AI 추정 비용
                      </th>
                      <th scope="col" className={ad.num}>
                        자료
                      </th>
                      <th scope="col">마지막 활동</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.workspaceId}>
                        <td data-label="업무실" className={ad.wrapCell}>{r.workspaceName}</td>
                        <td data-label="주인 이메일" className={ad.wrapCell}>{r.ownerEmail ?? "—"}</td>
                        <td data-label="작업" className={ad.num}>{r.tasksCreated}</td>
                        <td data-label="결과물 버전" className={ad.num}>{r.artifactVersionsCreated}</td>
                        <td data-label="브리프" className={ad.num}>{r.briefsCreated}</td>
                        <td data-label="AI 생성" className={ad.num}>{r.aiRuns}</td>
                        <td data-label="AI 추정 비용" className={ad.num}>{microUsdToWon(r.aiCostUsdMicro)}</td>
                        <td data-label="자료" className={ad.num}>
                          {r.assetsAdded}개 · {formatBytes(r.assetBytes)}
                        </td>
                        <td data-label="마지막 활동">{kstDateTime(r.lastActivityAt)}</td>
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

function Total({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <li className={ad.total}>
      <span className={styles.muted}>{label}</span>
      <span className={ad.totalValue}>{value}</span>
      {note && <span className={styles.muted}>{note}</span>}
    </li>
  );
}
