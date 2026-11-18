import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { createClientAction } from "@/features/clients/actions";
import { listClients } from "@/features/clients/server";
import { ActionForm } from "../_components/action-form";
import { AppNav } from "../_components/app-nav";
import styles from "../ui.module.css";

export const metadata: Metadata = { title: "고객 · 마케팅 업무실" };

export default function ClientsPage({ searchParams }: PageProps<"/clients">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
      <h1 className={styles.title}>고객</h1>
      <Suspense
        fallback={
          <p className={styles.muted} role="status">
            고객 목록을 불러오는 중…
          </p>
        }
      >
        <ClientList searchParams={searchParams} />
      </Suspense>
      <section className={styles.section} aria-labelledby="new-client">
        <h2 id="new-client" className={styles.subtitle}>
          새 고객 등록
        </h2>
        <ActionForm action={createClientAction} submitLabel="고객 등록">
          <div className={styles.field}>
            <label htmlFor="name">고객명 (필수)</label>
            <input id="name" name="name" required />
          </div>
          <div className={styles.field}>
            <label htmlFor="industry">업종</label>
            <input id="industry" name="industry" />
          </div>
          <div className={styles.field}>
            <label htmlFor="description">설명</label>
            <textarea id="description" name="description" />
          </div>
        </ActionForm>
      </section>
      </main>
    </>
  );
}

/** 고객 목록 (UI-RESP-03): 빈 상태·불러오는 중·오류를 메인 화면 A와 같은 구조로, 긴 이름은 한 줄 말줄임 + title 로 전체 */
async function ClientList({ searchParams }: { searchParams: PageProps<"/clients">["searchParams"] }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const includeArchived = params.archived === "1";
  let clients: Awaited<ReturnType<typeof listClients>>;
  try {
    clients = await listClients({ q, includeArchived });
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과시킨다
    console.error("[clients]", e);
    return (
      <section className={styles.section} aria-labelledby="client-list">
        <h2 id="client-list" className={styles.subtitle}>
          고객 목록
        </h2>
        <p className={styles.error} role="alert">
          고객 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <p>
          <Link href="/clients" className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            다시 불러오기
          </Link>
        </p>
      </section>
    );
  }
  return (
    <section className={styles.section} aria-labelledby="client-list">
      <h2 id="client-list" className={styles.subtitle}>
        고객 목록
      </h2>
      <form className={`${styles.row} ${styles.searchForm}`} role="search">
        <label htmlFor="q" className={styles.muted}>
          검색
        </label>
        <input id="q" name="q" defaultValue={q} />
        <label className={styles.row}>
          <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} /> 보관한 고객 포함
        </label>
        <button type="submit" className={styles.secondaryButton}>
          찾기
        </button>
      </form>
      {clients.length === 0 ? (
        q ? (
          <div className={styles.emptyState}>
            <p className={styles.muted}>검색 결과가 없습니다.</p>
            <p>
              <Link href="/clients" className={styles.secondaryButton}>
                검색 지우기
              </Link>
            </p>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>아직 등록한 고객이 없습니다.</strong>
            <p className={styles.muted}>아래 &lsquo;새 고객 등록&rsquo;에서 고객사 이름만 넣으면 시작할 수 있습니다.</p>
            <p>
              <a href="#new-client" className={styles.button}>
                + 첫 고객 등록하기
              </a>
            </p>
          </div>
        )
      ) : (
        <ul className={styles.list} aria-label="고객 목록">
          {clients.map((c) => (
            <li key={c.id} className={`${styles.listItem} ${styles.rowItem}`}>
              <span className={styles.rowMain}>
                <Link href={`/clients/${c.id}`} className={styles.rowLink} title={c.name}>
                  {c.name}
                </Link>
                {c.industry && (
                  <span className={`${styles.muted} ${styles.rowSub}`} title={c.industry}>
                    {c.industry}
                  </span>
                )}
              </span>
              {c.archived_at && <span className={styles.badge}>보관</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
