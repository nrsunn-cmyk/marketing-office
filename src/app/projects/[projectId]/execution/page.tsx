import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import {
  addExecutionResultAction,
  approveExecutionAction,
  archiveExecutionAction,
  archiveExecutionResultAction,
  holdExecutionAction,
  rebaseExecutionAction,
  recordTistoryExecutionAction,
  resumeExecutionAction,
  retryExecutionAction,
  voidExecutionResultAction,
} from "@/features/execution/actions";
import { getExecutionBoard } from "@/features/execution/server";
import { getProject } from "@/features/projects/server";
import { AppNav } from "../../../_components/app-nav";
import styles from "../../../ui.module.css";
import { ExecutionView, type ExecutionActions } from "./execution-view";
import type { ExecutionBoard } from "./execution-model";

export const metadata: Metadata = { title: "실행 · 성과 · 마케팅 업무실" };

const SERVER_ACTIONS: ExecutionActions = {
  approve: approveExecutionAction,
  retry: retryExecutionAction,
  hold: holdExecutionAction,
  resume: resumeExecutionAction,
  rebase: rebaseExecutionAction,
  archive: archiveExecutionAction,
  record: recordTistoryExecutionAction,
  addResult: addExecutionResultAction,
  voidResult: voidExecutionResultAction,
  archiveResult: archiveExecutionResultAction,
};

/**
 * P4A-UI-01 실행 · 성과 전용 화면(/projects/[projectId]/execution, AGY P4-ENTRY-HANDOFF 1절 ②).
 * 외부 출처 화면(/projects/[id]/sources)과 같은 하위 경로 꼴. 외부 API 호출 없음.
 */
export default function ProjectExecutionPage({ params }: PageProps<"/projects/[projectId]/execution">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
        <Suspense
          fallback={
            <p className={styles.muted} role="status">
              실행 대기열을 불러오는 중…
            </p>
          }
        >
          <ExecutionPageView params={params} />
        </Suspense>
      </main>
    </>
  );
}

async function ExecutionPageView({ params }: { params: PageProps<"/projects/[projectId]/execution">["params"] }) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const project = await getProject(projectId);
  if (!project) notFound();
  let board: ExecutionBoard | null = null;
  try {
    const r = await getExecutionBoard(project.id);
    if (r.ok) board = r.data;
    else console.error("[execution]", r.code, r.message);
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과
    console.error("[execution]", e);
  }
  return <ExecutionView board={board} projectTitle={project.title} actions={SERVER_ACTIONS} />;
}
