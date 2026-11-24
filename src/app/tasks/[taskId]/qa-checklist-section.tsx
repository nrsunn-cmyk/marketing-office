import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getProductionBriefsFor } from "@/features/production-brief/server";
import { getProject } from "@/features/projects/server";
import { approveQaReviewAction, archiveQaReviewAction, openQaReviewAction, rebaseQaReviewAction, requestQaFixAction, saveQaItemsAction } from "@/features/qa-delivery/actions";
import { getQaChecklistFor } from "@/features/qa-delivery/server";
import type { TaskDetail } from "@/features/tasks/server";
import { HashArrival } from "../../_components/hash-arrival";
import { P3QaIcon } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import { StepBackLink } from "./step-back-link";
import f from "./funnel.module.css";
import qa from "./qa-checklist.module.css";
import { QaChecklistBoard, type QaChecklistActions } from "./qa-checklist-editor";
import { P3_COMMON_COPY, QA_COPY, type QaChecklistData } from "./qa-checklist-model";

export type { QaChecklistActions };

const SERVER_ACTIONS: QaChecklistActions = {
  create: openQaReviewAction,
  save: saveQaItemsAction,
  requestFix: requestQaFixAction,
  approve: approveQaReviewAction,
  rebase: rebaseQaReviewAction,
  archive: archiveQaReviewAction,
};

/**
 * P3FG-UI-CONNECT-01 검수 영역(서버 연결). 전략 작업 상세에서 PPT 구성(#ppt-deck) 아래.
 * 프로젝트의 확정 제작 브리프마다 서버가 대상(산출물 하나씩)을 주고, 화면은 탭 하나로 모은다(같은 산출물은 한 번만).
 */
export async function QaChecklistArea({ detail }: { detail: TaskDetail }) {
  let data: QaChecklistData | null = null;
  let projectArchived = false;
  try {
    const [r, project] = await Promise.all([getProductionBriefsFor(detail.project.id), getProject(detail.project.id)]);
    projectArchived = project?.status === "archived";
    if (!r.ok) console.error("[qa-checklist]", r.code, r.message);
    else {
      const briefs = [...r.data.briefs.filter((b) => !b.archived), ...r.data.briefs.filter((b) => b.archived)];
      const results = await Promise.all(briefs.map((b) => getQaChecklistFor(b.id)));
      const bad = results.find((x) => !x.ok);
      if (bad && !bad.ok) console.error("[qa-checklist]", bad.code, bad.message);
      else {
        const seen = new Set<string>();
        const targets = results.flatMap((x) => (x.ok ? x.data.targets : [])).filter((t) => {
          const k = `${t.kind}/${t.targetId ?? "-"}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        data = { targets, canWrite: results.length > 0 && results.every((x) => x.ok && x.data.canWrite) };
      }
    }
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과
    console.error("[qa-checklist]", e);
  }
  return <QaChecklistSection data={data} readOnly={projectArchived || detail.task.status === "cancelled"} taskId={detail.task.id} actions={SERVER_ACTIONS} />;
}

/**
 * 결과물 검수 체크리스트 화면 본문(동기, 시험에서 가짜 데이터로 그린다).
 * 시안 Design/p3-production/qa-checklist.html, 인계표 P3F-HANDOFF.md 상태:
 *   작성 중 · 보완 요청됨 · 검토 완료 · 이전 기준(재검수) · 보관(archived_at 따로) · 읽기 전용
 *   + 빈 상태 · 바탕 보관 · 확정 전 · 권한 없음 · 회차 한도(30) · 불러오기 실패(data = null).
 * 진행률 막대는 그리지 않는다(P3I-HANDOFF 2절) — 필수 항목 통과 수만. 승인 판단은 서버 RPC 몫.
 */
export function QaChecklistSection({ data, readOnly, taskId, actions = {} }: { data: QaChecklistData | null; readOnly: boolean; taskId: string; actions?: QaChecklistActions }) {
  return (
    <section className={`${styles.section} ${f.funnel} ${qa.qaSection}`} aria-labelledby="qa-checklist">
      <div className={qa.qaHead}>
        <h2 id="qa-checklist" className={`${styles.subtitle} ${qa.qaTitle}`}>
          <P3QaIcon className={qa.qaIcon} />
          {QA_COPY.heading}
        </h2>
        <StepBackLink />
        {/* 현황 「검수 열기」(#qa-checklist)로 들어왔을 때 늦게 그려져도 이 구획으로(UX-G1-G4-FRONT-01 r2). 그리는 것 없음 */}
        <HashArrival id="qa-checklist" />
        <p className={`${styles.muted} ${f.keep}`}>{QA_COPY.intro}</p>
      </div>
      {data === null ? (
        <>
          <p className={styles.error} role="alert">
            {QA_COPY.loadError}
          </p>
          <p>
            <Link href={`/tasks/${taskId}#qa-checklist`} className={`${styles.secondaryButton} ${f.touch}`}>
              {P3_COMMON_COPY.reload}
            </Link>
          </p>
        </>
      ) : (
        <>
          {readOnly && (
            <div className={`${styles.notice} ${qa.qaBanner}`} role="note">
              <p className={f.keep}>{P3_COMMON_COPY.projectReadOnly}</p>
            </div>
          )}
          {data.targets.length === 0 ? (
            <div className={`${styles.emptyState} ${qa.qaEmpty}`}>
              <strong>{QA_COPY.emptyTitle}</strong>
              <p className={`${styles.muted} ${f.keep}`} role="note">
                {QA_COPY.emptyDesc}
              </p>
            </div>
          ) : (
            <QaChecklistBoard data={data} readOnly={readOnly} actions={actions} />
          )}
        </>
      )}
    </section>
  );
}
