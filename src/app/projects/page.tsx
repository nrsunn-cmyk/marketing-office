import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PROJECT_KIND_LABELS, PROJECT_STATUS_LABELS } from "@/domain/state/labels";
import { createProjectAction } from "@/features/clients/actions";
import { listProjects } from "@/features/projects/server";
import { ActionForm } from "../_components/action-form";
import { AppNav } from "../_components/app-nav";
import styles from "../ui.module.css";

export const metadata: Metadata = { title: "프로젝트 · 마케팅 업무실" };

export default function ProjectsPage() {
  return (
    <main className={`${styles.page} ${styles.wide}`}>
      <AppNav />
      <h1 className={styles.title}>프로젝트</h1>
      <Suspense fallback={<p className={styles.muted}>불러오는 중…</p>}>
        <ProjectList />
      </Suspense>
      <section className={styles.section} aria-labelledby="new-own-project">
        <h2 id="new-own-project" className={styles.subtitle}>
          자체 프로젝트 만들기
        </h2>
        <p className={styles.muted}>고객 프로젝트는 고객 화면에서 만듭니다. 여기서는 우리 회사·개인 채널용 프로젝트를 만듭니다.</p>
        <ActionForm action={createProjectAction} submitLabel="프로젝트 만들기">
          <div className={styles.field}>
            <label htmlFor="kind">종류</label>
            <select id="kind" name="kind" defaultValue="internal_brand">
              <option value="internal_brand">{PROJECT_KIND_LABELS.internal_brand}</option>
              <option value="personal">{PROJECT_KIND_LABELS.personal}</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="title">프로젝트 제목 (필수)</label>
            <input id="title" name="title" required />
          </div>
          <div className={styles.field}>
            <label htmlFor="dueAt">납기</label>
            <input id="dueAt" name="dueAt" type="date" />
          </div>
        </ActionForm>
      </section>
    </main>
  );
}

async function ProjectList() {
  const projects = await listProjects();
  if (projects.length === 0) return <p className={styles.muted}>아직 프로젝트가 없습니다.</p>;
  return (
    <ul className={styles.list} aria-label="프로젝트 목록">
      {projects.map((p) => (
        <li key={p.id} className={styles.listItem}>
          <div>
            <Link href={`/projects/${p.id}`}>{p.title}</Link>
            <div className={styles.muted}>{p.client_name ?? PROJECT_KIND_LABELS[p.kind]}</div>
          </div>
          <span className={styles.badge}>{PROJECT_STATUS_LABELS[p.status] ?? p.status}</span>
        </li>
      ))}
    </ul>
  );
}
