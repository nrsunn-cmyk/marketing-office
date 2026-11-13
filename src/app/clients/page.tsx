import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClientAction } from "@/features/clients/actions";
import { listClients } from "@/features/clients/server";
import { ActionForm } from "../_components/action-form";
import { AppNav } from "../_components/app-nav";
import styles from "../ui.module.css";

export const metadata: Metadata = { title: "고객 · 마케팅 업무실" };

export default function ClientsPage({ searchParams }: PageProps<"/clients">) {
  return (
    <main className={`${styles.page} ${styles.wide}`}>
      <AppNav />
      <h1 className={styles.title}>고객</h1>
      <Suspense fallback={<p className={styles.muted}>불러오는 중…</p>}>
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
  );
}

async function ClientList({ searchParams }: { searchParams: PageProps<"/clients">["searchParams"] }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const includeArchived = params.archived === "1";
  const clients = await listClients({ q, includeArchived });
  return (
    <section className={styles.section} aria-labelledby="client-list">
      <h2 id="client-list" className={styles.subtitle}>
        고객 목록
      </h2>
      <form className={styles.row} role="search">
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
        <p className={styles.muted}>{q ? "검색 결과가 없습니다." : "아직 등록한 고객이 없습니다."}</p>
      ) : (
        <ul className={styles.list}>
          {clients.map((c) => (
            <li key={c.id} className={styles.listItem}>
              <Link href={`/clients/${c.id}`}>{c.name}</Link>
              <span className={styles.muted}>
                {c.industry ?? ""} {c.archived_at && <span className={styles.badge}>보관</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
