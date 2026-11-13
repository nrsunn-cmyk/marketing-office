import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { MACHINES, type ProjectStatus } from "@/domain/state";
import { PROJECT_KIND_LABELS, PROJECT_STATUS_LABELS } from "@/domain/state/labels";
import { formatWon } from "@/domain/quote/parse";
import { changeProjectStatusAction } from "@/features/projects/actions";
import { getProject } from "@/features/projects/server";
import { ActionForm } from "../../_components/action-form";
import { AppNav } from "../../_components/app-nav";
import { AssetsPanel } from "../../_components/assets-panel";
import styles from "../../ui.module.css";

export const metadata: Metadata = { title: "프로젝트 · 마케팅 업무실" };

export default function ProjectPage({ params }: PageProps<"/projects/[projectId]">) {
  return (
    <main className={`${styles.page} ${styles.wide}`}>
      <AppNav />
      <Suspense fallback={<p className={styles.muted}>불러오는 중…</p>}>
        <ProjectView params={params} />
      </Suspense>
    </main>
  );
}

async function ProjectView({ params }: { params: PageProps<"/projects/[projectId]">["params"] }) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const project = await getProject(projectId);
  if (!project) notFound();
  const nextStates = MACHINES.project[project.status as ProjectStatus] ?? [];

  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.title}>{project.title}</h1>
        <span className={styles.badge}>{PROJECT_STATUS_LABELS[project.status] ?? project.status}</span>
      </div>
      <section className={styles.section} aria-labelledby="project-info">
        <h2 id="project-info" className={styles.subtitle}>
          프로젝트 정보
        </h2>
        <dl>
          <dt>종류</dt>
          <dd>
            {PROJECT_KIND_LABELS[project.kind]}
            {project.client_id && (
              <>
                {" · "}
                <Link href={`/clients/${project.client_id}`}>{project.client_name}</Link>
              </>
            )}
          </dd>
          <dt>사용하는 회사 프로필</dt>
          <dd>{project.profile_version ? `${project.profile_version}번 버전` : "연결된 프로필 없음"}</dd>
          <dt>예산</dt>
          <dd>{project.budget_won != null ? `${formatWon(project.budget_won)}원` : "미정"}</dd>
          <dt>납기</dt>
          <dd>{project.due_at ?? "미정"}</dd>
        </dl>
        {nextStates.length > 0 && (
          <div className={styles.row} aria-label="상태 바꾸기">
            {nextStates.map((to) => (
              <ActionForm
                key={to}
                action={changeProjectStatusAction}
                submitLabel={`${PROJECT_STATUS_LABELS[to]}(으)로`}
                className={styles.row}
              >
                <input type="hidden" name="id" value={project.id} />
                <input type="hidden" name="revision" value={project.revision} />
                <input type="hidden" name="to" value={to} />
              </ActionForm>
            ))}
          </div>
        )}
      </section>
      <AssetsPanel owner={{ projectId: project.id }} heading="프로젝트 자료" />
    </>
  );
}
