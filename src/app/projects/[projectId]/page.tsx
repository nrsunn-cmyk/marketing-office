import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { MACHINES, type ProjectStatus } from "@/domain/state";
import { randomUUID } from "node:crypto";
import {
  PROJECT_KIND_LABELS,
  PROJECT_STATUS_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
} from "@/domain/state/labels";
import { formatWon } from "@/domain/quote/parse";
import { changeProjectStatusAction } from "@/features/projects/actions";
import { createTaskAction } from "@/features/tasks/actions";
import { listTasks } from "@/features/tasks/server";
import { getProject } from "@/features/projects/server";
import { listResearchSources } from "@/features/research-sources/server";
import { ActionForm } from "../../_components/action-form";
import { AppNav } from "../../_components/app-nav";
import { AssetsPanel } from "../../_components/assets-panel";
import { MobileActionSheet } from "../../_components/mobile-action-sheet";
import styles from "../../ui.module.css";

export const metadata: Metadata = { title: "프로젝트 · 마케팅 업무실" };

export default function ProjectPage({ params }: PageProps<"/projects/[projectId]">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
      <Suspense
        fallback={
          <p className={styles.muted} role="status">
            프로젝트를 불러오는 중…
          </p>
        }
      >
        <ProjectView params={params} />
      </Suspense>
      </main>
    </>
  );
}

async function ProjectView({ params }: { params: PageProps<"/projects/[projectId]">["params"] }) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const project = await getProject(projectId);
  if (!project) notFound();
  const nextStates = MACHINES.project[project.status as ProjectStatus] ?? [];
  // 작업 목록만 실패하면 프로젝트 정보는 보여 주고 작업 구역에 오류를 알린다(UI-RESP-03)
  let tasks: Awaited<ReturnType<typeof listTasks>> | null = null;
  try {
    tasks = await listTasks(project.id);
  } catch (e) {
    unstable_rethrow(e);
    console.error("[project tasks]", e);
  }
  // 외부 출처 건수(SOURCES-UI-01). 실패해도 출처 화면으로 가는 링크는 보인다
  let sourceCounts: { all: number; unverified: number } | null = null;
  try {
    const sources = await listResearchSources(project.id);
    sourceCounts = { all: sources.length, unverified: sources.filter((x) => x.review_status === "unverified").length };
  } catch (e) {
    unstable_rethrow(e);
    console.error("[project sources]", e);
  }

  return (
    <>
      <div className={styles.header}>
        <h1 className={`${styles.title} ${styles.titleWrap}`}>{project.title}</h1>
        <span className={styles.badge}>{PROJECT_STATUS_LABELS[project.status] ?? project.status}</span>
      </div>
      <section className={styles.section} aria-labelledby="project-info">
        <h2 id="project-info" className={styles.subtitle}>
          프로젝트 정보
        </h2>
        <dl className={styles.facts}>
          <dt>종류</dt>
          <dd>
            {PROJECT_KIND_LABELS[project.kind]}
            {project.client_id && (
              <>
                {" · "}
                {/* QA-SOURCES-UI-01 O3: 누르는 높이 44px(글자 크기는 그대로) */}
                <Link href={`/clients/${project.client_id}`} className={styles.touchLink}>
                  {project.client_name}
                </Link>
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
                variant="secondary"
              >
                <input type="hidden" name="id" value={project.id} />
                <input type="hidden" name="revision" value={project.revision} />
                <input type="hidden" name="to" value={to} />
              </ActionForm>
            ))}
          </div>
        )}
      </section>
      <section className={styles.section} aria-labelledby="tasks">
        <h2 id="tasks" className={styles.subtitle}>
          작업
        </h2>
        {tasks === null ? (
          <>
            <p className={styles.error} role="alert">
              작업 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
            </p>
            <p>
              <Link href={`/projects/${project.id}`} className={`${styles.secondaryButton} ${styles.touchTarget}`}>
                다시 불러오기
              </Link>
            </p>
          </>
        ) : tasks.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>아직 작업이 없습니다.</strong>
            <p className={styles.muted}>아래 &lsquo;새 작업&rsquo;에서 로고 브리프·견적{project.kind === "client" ? "·마케팅 전략" : ""} 작업을 시작할 수 있습니다.</p>
          </div>
        ) : (
          <ul className={styles.list} aria-label="작업 목록">
            {tasks.map((t) => (
              <li key={t.id} className={`${styles.listItem} ${styles.rowItem}`}>
                <span className={styles.rowMain}>
                  <Link href={`/tasks/${t.id}`} className={styles.rowLink}>
                    {TASK_TYPE_LABELS[t.type]}
                  </Link>
                </span>
                <span className={styles.badge}>{TASK_STATUS_LABELS[t.status] ?? t.status}</span>
              </li>
            ))}
          </ul>
        )}
        <MobileActionSheet title="새 작업">
        <ActionForm action={createTaskAction} submitLabel="작업 시작" className={styles.row}>
          <input type="hidden" name="projectId" value={project.id} />
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <label htmlFor="task-type">새 작업</label>
          <select id="task-type" name="type" defaultValue="logo_brief">
            <option value="logo_brief">{TASK_TYPE_LABELS.logo_brief}</option>
            <option value="quote">{TASK_TYPE_LABELS.quote}</option>
            {project.kind === "client" && <option value="strategy">{TASK_TYPE_LABELS.strategy}</option>}
          </select>
        </ActionForm>
        </MobileActionSheet>
      </section>
      <AssetsPanel owner={{ projectId: project.id }} heading="프로젝트 자료" />
      <section className={styles.section} aria-labelledby="project-sources">
        <h2 id="project-sources" className={styles.subtitle}>
          외부 출처
        </h2>
        <p className={styles.muted}>
          {sourceCounts === null
            ? "외부 출처 건수를 불러오지 못했습니다."
            : sourceCounts.all === 0
              ? "아직 등록한 외부 출처가 없습니다. 통계·보고서·기사 주소를 적어 두면 콘텐츠 브리프에서 근거로 고를 수 있습니다."
              : `${sourceCounts.all}건${sourceCounts.unverified > 0 ? ` (확인 전 ${sourceCounts.unverified}건)` : ""}`}
        </p>
        <p>
          <Link href={`/projects/${project.id}/sources`} className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            외부 출처 관리
          </Link>
        </p>
      </section>
    </>
  );
}
