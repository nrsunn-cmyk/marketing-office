import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { listAdminAccounts, listPendingAllowlist, type AdminCursor } from "@/features/admin/server";
import { AppNav } from "../_components/app-nav";
import styles from "../ui.module.css";
import { AdminHeader, adminMetadata, kstDate, kstDateTime, requireAdminOr404, TableWrap } from "./admin-parts";
import ad from "./admin.module.css";

export const generateMetadata = () => adminMetadata("가입자·업무실");

const PAGE = 50;

/** 관리자 ① 가입자·업무실 목록(가입 최신 순, 50명씩 커서 쪽 넘김) + 아직 가입하지 않은 허용 이메일 */
export default function AdminAccountsPage({ searchParams }: PageProps<"/admin">) {
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
          <Accounts searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

/** 커서는 '가입 시각|사용자 id' 한 값으로 주소에 싣는다 */
function parseCursor(v: unknown): AdminCursor | undefined {
  if (typeof v !== "string") return undefined;
  const i = v.lastIndexOf("|");
  if (i <= 0) return undefined;
  const beforeCreated = v.slice(0, i);
  const beforeId = v.slice(i + 1);
  return Number.isNaN(Date.parse(beforeCreated)) || !/^[0-9a-f-]{36}$/i.test(beforeId) ? undefined : { beforeCreated, beforeId };
}

async function Accounts({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  await requireAdminOr404();
  const sp = await searchParams;
  const before = parseCursor(sp.before);
  const [res, pending] = await Promise.all([listAdminAccounts({ limit: PAGE, before }), listPendingAllowlist()]);
  if (!res.ok && res.code === "NOT_FOUND") notFound();

  return (
    <>
      <AdminHeader current="/admin" title="가입자·업무실" lead="가입한 계정과 각 업무실의 고객·프로젝트·작업 수, 마지막 로그인을 봅니다. 가입 최신 순입니다." />

      <section className={styles.section} aria-labelledby="admin-accounts">
        <h2 id="admin-accounts" className={styles.subtitle}>
          가입자 목록 {before ? "(다음 쪽)" : ""}
        </h2>
        {!res.ok ? (
          <p className={styles.error} role="alert">
            {res.message}
          </p>
        ) : res.data.rows.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>{before ? "더 볼 가입자가 없습니다." : "아직 가입한 계정이 없습니다."}</strong>
          </div>
        ) : (
          <TableWrap label="가입자 목록">
            <table className={styles.table}>
              <caption className={styles.srOnly}>가입자 {res.data.rows.length}명</caption>
              <thead>
                <tr>
                  <th scope="col">이메일</th>
                  <th scope="col">업무실</th>
                  <th scope="col">가입일</th>
                  <th scope="col">마지막 로그인</th>
                  <th scope="col" className={ad.num}>
                    고객
                  </th>
                  <th scope="col" className={ad.num}>
                    프로젝트
                  </th>
                  <th scope="col" className={ad.num}>
                    작업
                  </th>
                  <th scope="col">상태</th>
                </tr>
              </thead>
              <tbody>
                {res.data.rows.map((r) => (
                  <tr key={r.userId}>
                    <td data-label="이메일" className={ad.wrapCell}>{r.email ?? "(이메일 없음)"}</td>
                    <td data-label="업무실" className={ad.wrapCell}>{r.workspaceName ?? "초기 설정 전"}</td>
                    <td data-label="가입일">{kstDate(r.signedUpAt)}</td>
                    <td data-label="마지막 로그인">{r.lastSignInAt ? kstDateTime(r.lastSignInAt) : "로그인 기록 없음"}</td>
                    <td data-label="고객" className={ad.num}>{r.clients}</td>
                    <td data-label="프로젝트" className={ad.num}>{r.projects}</td>
                    <td data-label="작업" className={ad.num}>{r.tasks}</td>
                    <td data-label="상태">{[r.emailConfirmed ? "이메일 확인함" : "이메일 확인 전", r.allowlisted ? "허용 목록" : "허용 목록 밖"].join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <p className={ad.pager}>
          {before && (
            <Link href="/admin" className={`${styles.secondaryButton} ${styles.touchTarget}`}>
              처음으로
            </Link>
          )}
          {res.ok && res.data.next && (
            <Link
              href={`/admin?before=${encodeURIComponent(`${res.data.next.beforeCreated}|${res.data.next.beforeId}`)}`}
              className={`${styles.secondaryButton} ${styles.touchTarget}`}
            >
              다음 {PAGE}명
            </Link>
          )}
        </p>
      </section>

      <section className={styles.section} aria-labelledby="admin-pending">
        <h2 id="admin-pending" className={styles.subtitle}>
          아직 가입하지 않은 허용 이메일
        </h2>
        {!pending.ok ? (
          <p className={styles.error} role="alert">
            {pending.message}
          </p>
        ) : pending.data.length === 0 ? (
          <p className={styles.muted}>없습니다. 허용 목록의 이메일은 모두 가입했습니다.</p>
        ) : (
          <ul className={ad.pending} aria-label="미가입 허용 이메일">
            {pending.data.map((p) => (
              <li key={p.email}>
                {p.email}
                <span className={styles.muted}>
                  {" "}
                  · 추가 {kstDate(p.addedAt)}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
