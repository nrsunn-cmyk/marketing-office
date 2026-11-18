import Link from "next/link";
import type { ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import { FUNNEL_ITEM_KINDS, FUNNEL_ITEM_STATUSES, funnelStageLabel } from "@/domain/funnel";
import {
  addFunnelItemAction,
  archiveFunnelItemAction,
  createFunnelAction,
  rebaseFunnelAction,
  updateFunnelItemAction,
  updateFunnelStageAction,
} from "@/features/funnel/actions";
import { getFunnelBoard, type FunnelBoard, type FunnelItemView, type FunnelStageView } from "@/features/funnel/server";
import { getProject } from "@/features/projects/server";
import type { TaskDetail } from "@/features/tasks/server";
import { ActionForm } from "../../_components/action-form";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import { EMPTY_FUNNEL_ITEM, type FunnelItemFormValue } from "./funnel-form";
import { FunnelItemForm } from "./funnel-item-form";

/**
 * P2D-FRONT-01 퍼널 보드(전략 작업 화면 아래). 시안: Design/P2-next-concepts/funnel-board.html.
 * 서버: src/features/funnel (P2D-BACKEND-01). 보관한 프로젝트·취소한 작업의 퍼널은 읽기 전용이다(서버도 거절한다).
 */
export async function FunnelSection({ detail }: { detail: TaskDetail }) {
  let board: FunnelBoard | null;
  let archived = false;
  try {
    const [b, project] = await Promise.all([getFunnelBoard(detail.task.id), getProject(detail.project.id)]);
    board = b;
    archived = project?.status === "archived";
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과시킨다
    console.error("[funnel]", e);
    return (
      <Shell>
        <p className={styles.error} role="alert">
          퍼널 보드를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <p>
          <Link href={`/tasks/${detail.task.id}#funnel`} className={`${styles.secondaryButton} ${f.touch}`}>
            다시 불러오기
          </Link>
        </p>
      </Shell>
    );
  }
  if (!board) return null;
  const cancelled = detail.task.status === "cancelled";
  const readOnly = archived || cancelled;

  return (
    <Shell>
      {readOnly && (
        <div className={styles.notice} role="note">
          {archived ? (
            <>
              <strong>보관한 프로젝트의 퍼널은 읽기 전용입니다.</strong> 카드를 더하거나 고치려면{" "}
              <Link href={`/projects/${detail.project.id}`} className={f.inlineLink}>
                프로젝트 화면
              </Link>
              에서 프로젝트를 다시 열어 주세요.
            </>
          ) : (
            <strong>취소한 작업의 퍼널은 읽기 전용입니다.</strong>
          )}
        </div>
      )}
      <BoardBody board={board} taskId={detail.task.id} readOnly={readOnly} />
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <section className={`${styles.section} ${f.funnel}`} aria-labelledby="funnel">
      <h2 id="funnel" className={styles.subtitle}>
        퍼널 보드
      </h2>
      <p className={`${styles.muted} ${f.keep}`}>
        승인한 전략의 목표·제안·타깃을 유입 → 인지 → 고려 → 전환 → 유지 5단계의 콘텐츠와 행동 유도로 이어 봅니다. 앱이 콘텐츠를 만들거나 발행하지는 않습니다.
      </p>
      {children}
    </section>
  );
}

function BoardBody({ board, taskId, readOnly }: { board: FunnelBoard; taskId: string; readOnly: boolean }) {
  if (board.state === "no_artifact") {
    return (
      <div className={styles.emptyState}>
        <strong>아직 전략 초안이 없습니다.</strong>
        <p className={styles.muted}>위 &lsquo;전략 입력&rsquo;에서 전략 초안을 만들고 승인하면 퍼널 보드를 만들 수 있습니다.</p>
      </div>
    );
  }
  if (board.state === "not_approved") {
    return (
      <div className={styles.emptyState}>
        <strong>승인한 전략이 아직 없습니다.</strong>
        <p className={styles.muted}>퍼널은 승인한 전략 버전을 기준으로 만듭니다. 위 결과에서 전략 버전을 검토하고 승인해 주세요.</p>
      </div>
    );
  }
  if (board.state === "ready") {
    return (
      <>
        <Basis board={board} />
        <div className={styles.emptyState}>
          <strong>아직 퍼널 보드가 없습니다.</strong>
          <p className={styles.muted}>
            승인한 전략 {board.strategy.approvedVersion?.version}번 버전을 기준으로 5단계 보드를 만듭니다. 카드는 만든 뒤 단계마다 추가합니다.
          </p>
          {!readOnly && (
            <ActionForm action={createFunnelAction} submitLabel="퍼널 보드 만들기" pendingLabel="만드는 중…" className={f.inlineForm}>
              <input type="hidden" name="taskId" value={taskId} />
            </ActionForm>
          )}
        </div>
      </>
    );
  }

  const funnel = board.funnel!;
  const total = board.stages.reduce((n, s) => n + s.items.length, 0);
  const bottleneck = board.warnings.find((w) => w.kind === "bottleneck");
  const stageOptions = board.stages.map((s) => ({ id: s.id, label: `${s.position}단계 · ${s.label}` }));

  return (
    <>
      <div className={f.refBar}>
        <span>
          <span className={styles.muted}>기준 전략</span> <strong>{funnel.strategyVersion.version}번 버전</strong>
        </span>
        {funnel.stale ? (
          <span className={`${styles.badge} ${f.warnBadge}`}>이전 전략 기준</span>
        ) : (
          <span className={styles.badge}>지금 승인본</span>
        )}
        <span className={styles.muted}>카드 {total}개</span>
      </div>

      {funnel.stale && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>
            <strong>이 보드는 이전 전략({funnel.strategyVersion.version}번 버전) 기준입니다.</strong> 지금 승인본은{" "}
            {board.strategy.approvedVersion ? `${board.strategy.approvedVersion.version}번 버전` : "없음"}입니다. 카드는 그대로 두고 기준만 바꿀 수 있습니다.
          </p>
          {!readOnly && board.strategy.approvedVersion && (
            <ActionForm action={rebaseFunnelAction} submitLabel="지금 승인본 기준으로 맞추기" pendingLabel="맞추는 중…" variant="secondary" className={f.inlineForm}>
              <input type="hidden" name="funnelId" value={funnel.id} />
              <input type="hidden" name="revision" value={funnel.revision} />
            </ActionForm>
          )}
        </div>
      )}

      <Basis board={board} />

      {board.warnings.some((w) => w.kind === "empty") && (
        <div className={styles.emptyState}>
          <strong>아직 카드가 없습니다.</strong>
          <p className={styles.muted}>단계마다 &lsquo;카드 추가&rsquo;를 펼쳐 콘텐츠·리드마그넷·전환 오퍼를 넣어 보세요. 고려·전환 단계부터 채우면 병목을 먼저 막을 수 있습니다.</p>
        </div>
      )}
      {bottleneck && bottleneck.kind === "bottleneck" && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>
            <strong>병목 경고:</strong> {bottleneck.stages.map(funnelStageLabel).join("·")} 단계에 카드가 없습니다. 관심을 보인 고객이 다음 행동으로 넘어갈 곳이 비어 있습니다.
          </p>
        </div>
      )}

      {/* 넓은 화면에서 5칸이 모자라면 보드 안에서 가로로 넘긴다. 키보드로도 넘길 수 있게 tabIndex 0 */}
      <ol className={f.board} aria-label="퍼널 5단계" tabIndex={0}>
        {board.stages.map((stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            readOnly={readOnly}
            stageOptions={stageOptions}
            missing={!!bottleneck && bottleneck.kind === "bottleneck" && bottleneck.stages.includes(stage.key)}
          />
        ))}
      </ol>
    </>
  );
}

function Basis({ board }: { board: FunnelBoard }) {
  const b = board.strategy.basis;
  const n = b.goals.length + b.offers.length + b.audiences.length;
  if (n === 0) return null;
  const group = (label: string, list: string[]) =>
    list.length > 0 && (
      <div>
        <strong>{label}</strong>
        <ul className={f.basisList}>
          {list.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <details className={f.basis}>
      <summary>전략에서 이어받은 목표·제안·타깃 {n}개</summary>
      <div className={f.basisGrid}>
        {group("목표", b.goals)}
        {group("제안", b.offers)}
        {group("타깃", b.audiences)}
      </div>
    </details>
  );
}

function StageColumn({
  stage,
  readOnly,
  stageOptions,
  missing,
}: {
  stage: FunnelStageView;
  readOnly: boolean;
  stageOptions: Array<{ id: string; label: string }>;
  missing: boolean;
}) {
  const headingId = `funnel-stage-${stage.key}`;
  const full = stage.items.length >= 50;
  return (
    <li className={`${f.column} ${missing ? f.columnMissing : ""}`} aria-labelledby={headingId}>
      <div className={f.colHead}>
        <span className={f.stepNum}>{stage.position}단계</span>
        <h3 id={headingId} className={f.colTitle}>
          {stage.label}
          <span className={styles.badge}>{stage.items.length}개</span>
        </h3>
        {stage.focus ? <p className={`${f.focus} ${f.keep}`}>타깃: {stage.focus}</p> : <p className={`${styles.muted} ${f.focus}`}>단계 타깃 문구 없음</p>}
        {!readOnly && (
          <details className={f.inlineDetails}>
            <summary>타깃 문구 {stage.focus ? "고치기" : "적기"}</summary>
            <ActionForm action={updateFunnelStageAction} submitLabel="타깃 저장" variant="secondary" className={f.form} key={stage.revision}>
              <input type="hidden" name="stageId" value={stage.id} />
              <input type="hidden" name="revision" value={stage.revision} />
              <div className={styles.field}>
                <label htmlFor={`${headingId}-focus`}>{stage.label} 단계에서 고객이 하는 생각·행동</label>
                <input id={`${headingId}-focus`} name="focus" defaultValue={stage.focus ?? ""} placeholder="예: 비슷한 서비스 가격을 비교한다" />
              </div>
            </ActionForm>
          </details>
        )}
      </div>

      {stage.items.length === 0 ? (
        <p className={`${styles.muted} ${f.colEmpty}`}>{missing ? "비어 있음 — 이 단계가 비면 다음 행동으로 이어지지 않습니다." : "아직 카드가 없습니다."}</p>
      ) : (
        <ul className={f.cards} aria-label={`${stage.label} 단계 카드`}>
          {stage.items.map((item) => (
            <ItemCard key={item.id} item={item} stage={stage} readOnly={readOnly} stageOptions={stageOptions} />
          ))}
        </ul>
      )}

      {!readOnly &&
        (full ? (
          <p className={styles.muted}>이 단계는 카드가 50개라 더 넣을 수 없습니다. 쓰지 않는 카드를 보관해 주세요.</p>
        ) : (
          <details className={f.inlineDetails}>
            <summary>+ 카드 추가</summary>
            {/* 추가에 성공하면 카드 수가 바뀌어 폼이 새로 그려지고 입력이 비워진다 */}
            <FunnelItemForm
              key={stage.items.length}
              action={addFunnelItemAction}
              hidden={{ stageId: stage.id }}
              initial={EMPTY_FUNNEL_ITEM}
              submitLabel="카드 추가"
            />
          </details>
        ))}
    </li>
  );
}

function toForm(item: FunnelItemView): FunnelItemFormValue {
  return {
    kind: item.kind,
    title: item.title,
    description: item.description ?? "",
    channel: item.channel ?? "",
    status: item.status,
    targetNote: item.targetNote ?? "",
    deliverable: item.details?.deliverable ?? "",
    leadFields: (item.details?.leadFields ?? []).join("\n"),
    outline: (item.details?.outline ?? []).join("\n"),
  };
}

function ItemCard({
  item,
  stage,
  readOnly,
  stageOptions,
}: {
  item: FunnelItemView;
  stage: FunnelStageView;
  readOnly: boolean;
  stageOptions: Array<{ id: string; label: string }>;
}) {
  const lead = item.kind === "lead_magnet";
  const d = item.details;
  return (
    <li className={`${f.card} ${lead ? f.cardLead : ""}`}>
      <span className={`${f.tag} ${f[`tag_${item.kind}`] ?? ""}`}>{FUNNEL_ITEM_KINDS[item.kind]}</span>
      <h4 className={f.cardTitle}>{item.title}</h4>
      {item.description && <p className={f.cardDesc}>{item.description}</p>}
      <p className={f.cardFoot}>
        <span>진행: {FUNNEL_ITEM_STATUSES[item.status]}</span>
        {item.channel && <span>채널: {item.channel}</span>}
        {item.targetNote && <span>목표: {item.targetNote}</span>}
      </p>
      {lead && d && (d.deliverable || d.leadFields?.length || d.outline?.length) && (
        <details className={f.inlineDetails}>
          <summary>리드마그넷 기획 보기</summary>
          <dl className={f.leadView}>
            {d.deliverable && (
              <>
                <dt>전달물</dt>
                <dd>{d.deliverable}</dd>
              </>
            )}
            {d.leadFields && d.leadFields.length > 0 && (
              <>
                <dt>받을 정보</dt>
                <dd>{d.leadFields.join(", ")}</dd>
              </>
            )}
            {d.outline && d.outline.length > 0 && (
              <>
                <dt>아웃라인</dt>
                <dd>
                  <ol className={f.basisList}>
                    {d.outline.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ol>
                </dd>
              </>
            )}
          </dl>
        </details>
      )}
      {!readOnly && (
        <details className={f.inlineDetails}>
          <summary>고치기·옮기기</summary>
          {/* 저장에 성공하면 revision 이 바뀌어 폼이 서버 값으로 새로 그려진다 */}
          <FunnelItemForm
            key={item.revision}
            action={updateFunnelItemAction}
            hidden={{ itemId: item.id, revision: item.revision }}
            initial={toForm(item)}
            submitLabel="카드 저장"
            stages={stageOptions}
            stageId={stage.id}
          />
          <ActionForm action={archiveFunnelItemAction} submitLabel="이 카드 보관" pendingLabel="보관 중…" variant="secondary" className={f.inlineForm}>
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="revision" value={item.revision} />
            <p className={styles.muted}>보관한 카드는 보드에서 빠집니다(지우지 않음, 되돌리기는 아직 없습니다).</p>
          </ActionForm>
        </details>
      )}
    </li>
  );
}

