import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import { archiveProductionBriefAction, createProductionBriefAction, rebaseProductionBriefAction, updateProductionBriefAction } from "@/features/production-brief/actions";
import { getProject } from "@/features/projects/server";
import { getProductionBriefsFor, type ProductionBriefBoard, type ProductionBriefView } from "@/features/production-brief/server";
import type { TaskDetail } from "@/features/tasks/server";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import pb from "./production-brief.module.css";
import { BriefActionButton } from "./production-brief-buttons";
import { ProductionBriefEditForm } from "./production-brief-edit-form";
import { PB_COPY, PRODUCTION_BRIEF_DISPLAY, TEXT_FIELDS, deliverableText, emptyProductionBrief, productionBriefToForm, staleText } from "./production-brief-model";

/**
 * P3A-UI-CONNECT-01 공통 제작 브리프 영역. 전략 작업 상세에서 FunnelSection 아래·DeliveryPanel 위(AGY P3I-HANDOFF.md 1절).
 * 서버: src/features/production-brief(P3A-BACKEND-01) — 프로젝트 단위 목록(보관 안 된 것 10개까지), 만들기는 이 작업의 전략으로.
 * 불러오지 못하면 영역 안에서 알리고 다시 불러오기를 준다(작업 화면의 다른 영역은 그대로).
 */
export async function ProductionBriefArea({ detail }: { detail: TaskDetail }) {
  let board: ProductionBriefBoard | null = null;
  let projectArchived = false;
  try {
    const [r, project] = await Promise.all([getProductionBriefsFor(detail.project.id), getProject(detail.project.id)]);
    if (r.ok) board = r.data;
    else console.error("[production-brief]", r.code, r.message);
    projectArchived = project?.status === "archived";
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과
    console.error("[production-brief]", e);
  }
  return (
    <ProductionBriefSection
      board={board}
      readOnly={projectArchived || detail.task.status === "cancelled"}
      taskId={detail.task.id}
      strategyArtifactId={detail.artifact?.id ?? null}
    />
  );
}

/**
 * 화면 본문(동기, 시험에서 가짜 보드로 그린다). AGY 시안 task-detail-entry.html 상태:
 * 진행 중(목록) · 빈 상태 · P2 미승인(차단) · 10개 한도 · 읽기 전용 + 보관 접기 + 불러오기 실패(board = null).
 */
export function ProductionBriefSection({
  board,
  readOnly,
  taskId,
  strategyArtifactId,
}: {
  board: ProductionBriefBoard | null;
  readOnly: boolean;
  taskId: string;
  /** 이 전략 작업의 산출물 id(만들기에 쓴다). 없으면 만들 수 없음 */
  strategyArtifactId: string | null;
}) {
  if (!board) {
    return (
      <Shell count={null}>
        <p className={styles.error} role="alert">
          {PB_COPY.loadError}
        </p>
        <p>
          <Link href={`/tasks/${taskId}#production-brief`} className={`${styles.secondaryButton} ${f.touch}`}>
            다시 불러오기
          </Link>
        </p>
      </Shell>
    );
  }
  const active = board.briefs.filter((b) => !b.archived);
  const archived = board.briefs.filter((b) => b.archived);
  // 만들기의 바탕 전략(Tester I2·Master): 고를 수 있는 승인 전략이 하나면 자동, 여럿이면 고르는 칸(이 작업의 전략을 기본으로)
  const selectable = board.strategies.filter((s) => s.selectable);
  const strategyOptions = selectable.map((s) => ({
    id: s.artifactId,
    label: `${s.artifactId === strategyArtifactId ? "이 작업의 전략" : "다른 전략 작업"} · 승인본 ${s.approvedVersion ?? "?"}번 버전`,
  }));
  const defaultStrategyId = selectable.some((s) => s.artifactId === strategyArtifactId) ? strategyArtifactId : (selectable[0]?.artifactId ?? null);
  // 고를 승인 전략이 없으면 서버 사유보다 먼저 P2 미승인을 알린다
  const blockedReason = readOnly ? null : selectable.length === 0 ? PB_COPY.noApprovedStrategy : board.createBlockedReason;
  const canCreate = !readOnly && blockedReason === null && board.canCreate;
  const approvedOf = (b: ProductionBriefView) => board.strategies.find((s) => s.artifactId === b.strategyArtifactId)?.approvedVersion ?? null;
  const readyCount = active.filter((b) => b.status === "ready").length;

  return (
    <Shell count={`${board.activeCount} / ${board.limit}개`}>
      <p className={`${styles.muted} ${f.keep}`} role="note">
        {`P3 1단계(공통 제작 브리프): 작성 중 ${active.length - readyCount}개 · 확정 ${readyCount}개. `}
        {readyCount > 0 ? "확정한 브리프가 다음 제작 단계(홈페이지 구조·문구 등)의 기준본이 됩니다." : "제작 브리프를 확정하면 다음 제작 단계의 기준본으로 쓸 수 있습니다."}
      </p>

      {readOnly && (
        <div className={`${styles.notice} ${pb.pbBanner}`} role="note">
          <p className={f.keep}>{PB_COPY.projectReadOnly}</p>
        </div>
      )}
      {blockedReason && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>
            <strong>{PB_COPY.createBlockedLead}</strong> {blockedReason}
          </p>
        </div>
      )}

      {canCreate && (
        <details className={`${f.inlineDetails} ${pb.pbCreate}`}>
          <summary>{active.length === 0 ? PB_COPY.createFirst : PB_COPY.createMore}</summary>
          {/* 만들기에 성공하면 개수가 바뀌어 폼이 새로 그려지고 입력이 비워진다 */}
          <ProductionBriefEditForm
            key={board.activeCount}
            mode="create"
            action={createProductionBriefAction}
            hidden={{ projectId: board.projectId }}
            initial={emptyProductionBrief()}
            strategyOptions={strategyOptions}
            defaultStrategyId={defaultStrategyId}
          />
        </details>
      )}

      {active.length === 0 ? (
        <div className={`${styles.emptyState} ${pb.pbEmpty}`}>
          <strong>{PB_COPY.emptyTitle}</strong>
          {canCreate && <p className={`${styles.muted} ${f.keep}`}>{PB_COPY.emptyDesc}</p>}
        </div>
      ) : (
        <ul className={pb.pbList} aria-label="제작 브리프 목록">
          {active.map((b) => (
            <BriefCard key={b.id} b={b} approvedVersion={approvedOf(b)} readOnly={readOnly} />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <details className={`${f.inlineDetails} ${pb.pbArchivedBox}`}>
          <summary>{`보관한 제작 브리프 ${archived.length}개`}</summary>
          <ul className={pb.pbList} aria-label="보관한 제작 브리프 목록">
            {archived.map((b) => (
              <BriefCard key={b.id} b={b} approvedVersion={approvedOf(b)} readOnly />
            ))}
          </ul>
        </details>
      )}
    </Shell>
  );
}

function Shell({ count, children }: { count: string | null; children: ReactNode }) {
  return (
    <section className={`${styles.section} ${f.funnel} ${pb.pbSection}`} aria-labelledby="production-brief">
      <div className={pb.pbHead}>
        <h2 id="production-brief" className={`${styles.subtitle} ${pb.pbTitle}`}>
          {PB_COPY.heading}
          {count && <span className={styles.badge}>{count}</span>}
        </h2>
        <p className={`${styles.muted} ${f.keep}`}>{PB_COPY.intro}</p>
      </div>
      {children}
    </section>
  );
}

function BriefCard({ b, approvedVersion, readOnly }: { b: ProductionBriefView; approvedVersion: number | null; readOnly: boolean }) {
  const locked = readOnly || b.archived || b.readOnlyReason !== null;
  const titleId = `pb-${b.id}`;
  const ids = { briefId: b.id, revision: b.revision };
  return (
    <li className={`${pb.pbCard} ${b.stale ? pb.pbCardStale : ""} ${b.archived ? pb.pbCardArchived : ""}`} aria-labelledby={titleId}>
      <h3 id={titleId} className={pb.pbCardTitle}>
        {b.title}
      </h3>
      <p className={pb.pbBadges}>
        <span className={`${pb.pbStatus} ${pb[`pbStatus_${b.status}`]}`}>{PRODUCTION_BRIEF_DISPLAY[b.status]}</span>
        {b.archived && <span className={`${pb.pbStatus} ${pb.pbStatus_archived}`}>보관</span>}
        {b.stale && <span className={`${f.tag} ${f.tag_warn}`}>{b.staleLabel ?? "이전 전략 기준"}</span>}
      </p>
      <p className={`${styles.muted} ${f.keep}`}>{`산출물: ${deliverableText(b.deliverableTypes) || "없음"} · ${b.strategyVersion.version ? `전략 ${b.strategyVersion.version}번 버전 기준` : "기준 전략 알 수 없음"}`}</p>

      <details className={f.inlineDetails}>
        <summary>{locked ? PB_COPY.view : PB_COPY.open}</summary>
        <div className={pb.pbCardBody}>
          {locked && (
            <div className={`${styles.notice} ${pb.pbBanner}`} role="note">
              <p className={f.keep}>{b.readOnlyReason ?? PB_COPY.projectReadOnly}</p>
            </div>
          )}
          {b.stale && (
            <div className={`${styles.notice} ${f.warnBox}`} role="note">
              <p className={f.keep}>
                <strong>이전 전략 기준:</strong> {staleText(b.strategyVersion.version, approvedVersion, !locked)}
              </p>
              {!locked && b.canRebase && <BriefActionButton action={rebaseProductionBriefAction} hidden={ids} submitLabel={PB_COPY.rebase} pendingLabel="맞추는 중…" />}
            </div>
          )}
          {b.status === "ready" && !locked && (
            <p className={`${styles.muted} ${f.keep}`} role="note">
              {PB_COPY.readyNote}
            </p>
          )}
          {locked ? (
            <ReadOnlyView b={b} />
          ) : (
            <>
              {/* 저장에 성공하면 revision 이 바뀌어 폼이 서버 값으로 새로 그려진다 */}
              <ProductionBriefEditForm key={b.revision} action={updateProductionBriefAction} hidden={ids} initial={productionBriefToForm(b)} />
              {/* 되돌릴 수 없는 보관은 한 번 더 확인한다(QA-P3A-UI-01 U3, Master 결정) */}
              <details className={`${f.inlineDetails} ${pb.pbDanger}`}>
                <summary>{PB_COPY.archive}</summary>
                <BriefActionButton action={archiveProductionBriefAction} hidden={ids} submitLabel={PB_COPY.archiveConfirm} pendingLabel="보관 중…">
                  <p className={`${styles.muted} ${f.keep}`}>{PB_COPY.archiveNote}</p>
                </BriefActionButton>
              </details>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

/** 읽기 전용: 폼 없이 내용만(글은 React 글자로만 그린다) */
function ReadOnlyView({ b }: { b: ProductionBriefView }) {
  return (
    <dl className={pb.pbView}>
      {TEXT_FIELDS.map((fd) => {
        const value = b[fd.key] ?? "";
        return (
          <div key={fd.key} className={pb.pbViewRow}>
            <dt>{fd.label}</dt>
            <dd className={value ? pb.pbViewText : styles.muted}>{value || "적지 않음"}</dd>
          </div>
        );
      })}
      <div className={pb.pbViewRow}>
        <dt>포함 산출물 종류</dt>
        <dd>{deliverableText(b.deliverableTypes) || <span className={styles.muted}>선택 안 함</span>}</dd>
      </div>
      <div className={pb.pbViewRow}>
        <dt>진행 상태</dt>
        <dd>{b.displayLabel}</dd>
      </div>
    </dl>
  );
}
