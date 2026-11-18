import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
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
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
      <h1 className={styles.title}>프로젝트</h1>
      <Suspense
        fallback={
          <p className={styles.muted} role="status">
            프로젝트 목록을 불러오는 중…
          </p>
        }
      >
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
    </>
  );
}

/** 프로젝트 목록 (UI-RESP-03): 빈 상태·불러오는 중·오류를 메인 화면 A와 같은 구조로, 긴 제목은 한 줄 말줄임 + title 로 전체 */
async function ProjectList() {
  let projects: Awaited<ReturnType<typeof listProjects>>;
  try {
    projects = await listProjects();
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과시킨다
    console.error("[projects]", e);
    return (
      <section className={styles.section} aria-label="프로젝트 목록 상태">
        <p className={styles.error} role="alert">
          프로젝트 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <p>
          <Link href="/projects" className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            다시 불러오기
          </Link>
        </p>
      </section>
    );
  }
  if (projects.length === 0)
    return (
      <section className={styles.section} aria-label="프로젝트 목록 상태">
        <div className={styles.emptyState}>
          <strong>아직 프로젝트가 없습니다.</strong>
          <p className={styles.muted}>고객 프로젝트는 고객 화면에서, 우리 회사·개인 채널용 프로젝트는 아래에서 만듭니다.</p>
          <p className={styles.row}>
            <Link href="/clients" className={styles.button}>
              고객 화면으로
            </Link>
            <a href="#new-own-project" className={styles.secondaryButton}>
              자체 프로젝트 만들기
            </a>
          </p>
        </div>
      </section>
    );
  return (
    <ul className={styles.list} aria-label="프로젝트 목록">
      {projects.map((p) => {
        const sub = p.client_name ?? PROJECT_KIND_LABELS[p.kind];
        return (
          <li key={p.id} className={`${styles.listItem} ${styles.rowItem}`}>
            <span className={styles.rowMain}>
              <Link href={`/projects/${p.id}`} className={styles.rowLink} title={p.title}>
                {p.title}
              </Link>
              <span className={`${styles.muted} ${styles.rowSub}`} title={sub}>
                {sub}
                {p.due_at && ` · 납기 ${p.due_at}`}
              </span>
            </span>
            <span className={styles.badge}>{PROJECT_STATUS_LABELS[p.status] ?? p.status}</span>
          </li>
        );
      })}
    </ul>
  );
}
