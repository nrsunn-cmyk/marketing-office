import Link from "next/link";
import type { FormState } from "../../../_components/form-state";
import { ActionForm } from "../../../_components/action-form";
import styles from "../../../ui.module.css";
import s from "./execution.module.css";
import {
  ER_COPY,
  EX_COPY,
  EX_LABELS,
  RESULT_UNIT_OPTIONS,
  blockText,
  formatKst,
  jobActions,
  resultHeadline,
  resultMeta,
  splitJobs,
  todayKst,
  type ExecutionBoard,
  type ExecutionJobView,
  type ExecutionResultView,
} from "./execution-model";

import type { P4ExternalBoard } from "@/features/execution/channels";
import { ExternalChannelsPanel, type ExternalExecutionActions } from "./execution-channels-panel";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
/** 서버 동작(actions.ts). 시험에서 넘기지 않으면 단추마다 '아직 서버와 연결되지 않아…' 안내 */
export interface ExecutionActions extends ExternalExecutionActions {
  approve?: Action;
  retry?: Action;
  hold?: Action;
  resume?: Action;
  rebase?: Action;
  archive?: Action;
  record?: Action;
  addResult?: Action;
  voidResult?: Action;
  archiveResult?: Action;
}
const notConnected: Action = async () => ({ message: "아직 서버와 연결되지 않아 저장할 수 없습니다." });

/**
 * P4A-UI-01 실행·성과 화면 본문(동기, 시험·화면 점검은 이 함수를 쓴다).
 * 시안 execution-queue·tistory-manual·results.html, 진입 P4-ENTRY-HANDOFF 2절 나(#queue · #results · #channels).
 * 티스토리는 자동 게시가 없다: 작업 화면에서 내보내기 → 직접 게시 → 여기서 주소·시각 기록. 외부 API 호출 0, 진행률 막대 없음.
 */
export function ExecutionView({
  board,
  projectTitle,
  actions = {},
  externalBoard,
}: {
  board: ExecutionBoard | null;
  projectTitle: string;
  actions?: ExecutionActions;
  externalBoard?: P4ExternalBoard | null;
}) {
  return (
    <>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{EX_LABELS.pageTitle}</h1>
          <p className={styles.muted}>{projectTitle}</p>
        </div>
      </div>
      <nav aria-label="실행 화면 바로 가기">
        <ul className={s.exJump}>
          <li>
            <Link href={board ? `/projects/${board.projectId}` : "/projects"}>{EX_LABELS.back}</Link>
          </li>
          <li>
            <a href="#queue">{EX_LABELS.jumpQueue}</a>
          </li>
          <li>
            <a href="#results">{EX_LABELS.jumpResults}</a>
          </li>
          <li>
            <a href="#channels">{EX_LABELS.jumpChannels}</a>
          </li>
        </ul>
      </nav>
      {board === null ? (
        <section className={`${styles.section} ${s.exSection}`} aria-labelledby="queue">
          <h2 id="queue" className={styles.subtitle}>
            {EX_COPY.heading}
          </h2>
          <p className={styles.error} role="alert">
            {EX_COPY.loadError}
          </p>
        </section>
      ) : (
        <>
          <Queue board={board} actions={actions} />
          <Results board={board} actions={actions} />
        </>
      )}
      <section className={`${styles.section} ${s.exSection}`} aria-labelledby="channels">
        <h2 id="channels" className={styles.subtitle}>
          {EX_LABELS.channelsHeading}
        </h2>
        <ul className={s.exList}>
          {EX_LABELS.channels.map((c) => (
            <li key={c} className={s.exCard}>
              <p>
                <strong>{c}</strong>
              </p>
              <p className={s.exTags}>
                <span className={s.exTag}>{externalBoard ? "연동 가능" : EX_COPY.channelPreparing}</span>
              </p>
            </li>
          ))}
        </ul>
      </section>
      {externalBoard !== undefined ? (
        <ExternalChannelsPanel board={board} externalBoard={externalBoard} actions={actions} notConnected={notConnected} />
      ) : null}
    </>
  );
}

function Queue({ board, actions }: { board: ExecutionBoard; actions: ExecutionActions }) {
  const { queue, history } = splitJobs(board.jobs);
  return (
    <section className={`${styles.section} ${s.exSection}`} aria-labelledby="queue">
      <h2 id="queue" className={styles.subtitle}>
        {EX_COPY.heading}
      </h2>
      <p className={styles.muted}>{EX_COPY.intro}</p>
      <p className={s.exTags}>
        <span className={`${s.exTag} ${s.exTag_info}`}>{EX_LABELS.firstSource}</span>
        <span className={s.exTag}>{EX_COPY.channelPreparing}</span>
      </p>
      {!board.canWrite && (
        <p className={styles.notice} role="note">
          {EX_COPY.noPermission}
        </p>
      )}
      {/* 티스토리 기본 경로 3단계(자동 게시 없음, tistory-manual.html) */}
      <details>
        <summary>{EX_LABELS.manualSteps}</summary>
        <ol className={s.exSteps}>
          <li>{EX_LABELS.step1}</li>
          <li>{EX_LABELS.step2}</li>
          <li>{`${EX_LABELS.step3}: ${EX_COPY.recordBtn}`}</li>
        </ol>
        <p className={styles.muted}>{EX_LABELS.noApi}</p>
      </details>
      {queue.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>{EX_COPY.emptyTitle}</strong>
          <p className={styles.muted}>{EX_COPY.emptyDesc}</p>
        </div>
      ) : (
        <ul className={s.exList}>
          {queue.map((j) => (
            <JobCard key={j.id} j={j} canWrite={board.canWrite} actions={actions} />
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <>
          <h3 className={styles.subtitle}>{EX_LABELS.historyHeading}</h3>
          <p className={styles.muted}>{EX_LABELS.historyHint}</p>
          <ul className={s.exList}>
            {history.map((j) => (
              <JobCard key={j.id} j={j} canWrite={board.canWrite} actions={actions} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Step({ action, j, label, variant = "secondary", children }: { action?: Action; j: ExecutionJobView; label: string; variant?: "primary" | "secondary"; children?: React.ReactNode }) {
  return (
    <ActionForm action={action ?? notConnected} submitLabel={label} variant={variant} className={s.exInline}>
      <input type="hidden" name="jobId" value={j.id} />
      <input type="hidden" name="revision" value={j.revision} />
      {children}
    </ActionForm>
  );
}

function JobCard({ j, canWrite, actions }: { j: ExecutionJobView; canWrite: boolean; actions: ExecutionActions }) {
  const can = jobActions(j, canWrite);
  const title = j.source.title ?? j.payloadTitle;
  const headId = `job-${j.id}`;
  return (
    <li className={s.exCard} aria-labelledby={headId}>
      <h3 id={headId} className={s.exCardTitle}>{`티스토리 블로그 수동 게시 — ${title}`}</h3>
      <p className={styles.muted}>{EX_LABELS.channelLine(j.idempotencyKey)}</p>
      <p className={s.exTags}>
        <span className={`${s.exTag} ${j.status === "succeeded" ? s.exTag_ok : j.status === "blocked_mismatch" || j.status === "failed" ? s.exTag_warn : s.exTag_info}`}>{j.statusLabel}</span>
        {j.archivedAt && <span className={s.exTag}>{EX_LABELS.archived}</span>}
        {j.status === "pending_approval" && j.liveMatches && <span className={`${s.exTag} ${s.exTag_ok}`}>{EX_LABELS.matchOk}</span>}
        {j.status === "blocked_mismatch" && <span className={`${s.exTag} ${s.exTag_warn}`}>{EX_LABELS.blockedSaved}</span>}
      </p>
      {j.status === "pending_approval" && j.liveMatches && <p className={styles.muted}>{EX_LABELS.matchOkNote}</p>}
      {j.status === "blocked_mismatch" && (
        <p className={s.exWarn} role="note">
          <strong>{EX_LABELS.blockReasonPrefix(j.blockReason ?? "content_changed")}</strong> {blockText(j.blockReason)}
        </p>
      )}
      {(j.executedAt || j.externalUrl) && (
        <p className={styles.muted}>
          {`실행 시각: ${formatKst(j.executedAt)}`}
          {j.status === "failed" && ` · 시도 ${j.attemptCount}/3`}
        </p>
      )}
      {j.externalUrl && (
        // 게시 주소는 따로 한 줄, 44px 링크(새 창)
        <p>
          {"대상: "}
          <a href={j.externalUrl} target="_blank" rel="noopener noreferrer" className={styles.touchLink}>
            {j.externalUrl}
          </a>
        </p>
      )}
      {j.publicationVoided && (
        <p className={s.exWarn} role="note">
          {EX_COPY.publicationVoidedNotice}
        </p>
      )}
      <div className={s.exButtons}>
        {can.approve && <Step action={actions.approve} j={j} label={EX_COPY.approveBtn} variant="primary" />}
        {can.rebase && <Step action={actions.rebase} j={j} label={EX_COPY.rebaseBtn} variant="primary" />}
        {can.retry && <Step action={actions.retry} j={j} label={EX_COPY.retryBtn(j.attemptCount)} />}
        {can.resume && <Step action={actions.resume} j={j} label={EX_COPY.resumeBtn} />}
        {can.hold && <Step action={actions.hold} j={j} label={EX_COPY.holdBtn} />}
      </div>
      {can.record && (
        <details open>
          <summary>{EX_COPY.recordBtn}</summary>
          <ActionForm action={actions.record ?? notConnected} submitLabel={EX_COPY.recordBtn}>
            <input type="hidden" name="jobId" value={j.id} />
            <input type="hidden" name="revision" value={j.revision} />
            <div className={s.exGrid2}>
              <div className={styles.field}>
                <label htmlFor={`${headId}-url`}>{EX_LABELS.url}</label>
                <input id={`${headId}-url`} name="url" type="url" inputMode="url" placeholder="https://" required />
              </div>
              <div className={styles.field}>
                <label htmlFor={`${headId}-at`}>{EX_LABELS.publishedAt}</label>
                <input id={`${headId}-at`} name="publishedAt" type="datetime-local" required />
              </div>
            </div>
            <div className={styles.field}>
              <label htmlFor={`${headId}-note`}>{EX_LABELS.note}</label>
              <input id={`${headId}-note`} name="note" type="text" />
            </div>
          </ActionForm>
        </details>
      )}
      {can.archive && (
        <details>
          <summary>{EX_COPY.archiveBtn}</summary>
          <Step action={actions.archive} j={j} label={EX_COPY.archiveBtn}>
            <p className={styles.muted}>보관하면 내용만 볼 수 있고 고칠 수 없습니다. 보관은 되돌릴 수 없습니다.</p>
          </Step>
        </details>
      )}
    </li>
  );
}

function Results({ board, actions }: { board: ExecutionBoard; actions: ExecutionActions }) {
  const list = board.results;
  return (
    <section className={`${styles.section} ${s.exSection}`} aria-labelledby="results">
      <h2 id="results" className={styles.subtitle}>
        {ER_COPY.heading}
      </h2>
      <p className={styles.muted}>{ER_COPY.intro}</p>
      <p className={s.exTags}>
        <span className={s.exTag}>{EX_LABELS.autoSyncPreparing}</span>
      </p>
      {!board.canWrite && (
        <p className={styles.notice} role="note">
          {EX_COPY.noPermission}
        </p>
      )}
      {list.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>{EX_LABELS.resultEmpty}</strong>
          <p className={styles.muted}>{EX_LABELS.resultEmptyDesc}</p>
        </div>
      ) : (
        <ul className={s.exList}>
          {list.map((r) => (
            <ResultCard key={r.id} r={r} canWrite={board.canWrite} actions={actions} />
          ))}
        </ul>
      )}
      {board.canWrite && (
        <details open={list.length === 0}>
          <summary>{ER_COPY.addBtn}</summary>
          <ActionForm action={actions.addResult ?? notConnected} submitLabel={ER_COPY.addBtn}>
            <input type="hidden" name="projectId" value={board.projectId} />
            <h3 className={styles.subtitle}>{EX_LABELS.resultFormHeading}</h3>
            <p className={styles.muted}>{ER_COPY.periodHint}</p>
            <div className={styles.field}>
              <label htmlFor="er-metric">{EX_LABELS.metricName}</label>
              <input id="er-metric" name="metricName" type="text" required />
            </div>
            <div className={s.exGrid2}>
              <div className={styles.field}>
                <label htmlFor="er-value">{EX_LABELS.value}</label>
                <input id="er-value" name="value" type="number" min={0} step="0.01" inputMode="decimal" required />
              </div>
              <div className={styles.field}>
                <label htmlFor="er-unit">{EX_LABELS.unit}</label>
                <select id="er-unit" name="unit" defaultValue="count">
                  {Object.entries(RESULT_UNIT_OPTIONS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="er-num">{EX_LABELS.numerator}</label>
                <input id="er-num" name="numerator" type="number" min={0} step={1} inputMode="numeric" />
              </div>
              <div className={styles.field}>
                <label htmlFor="er-den">{EX_LABELS.denominator}</label>
                <input id="er-den" name="denominator" type="number" min={1} step={1} inputMode="numeric" />
              </div>
              <div className={styles.field}>
                <label htmlFor="er-start">{EX_LABELS.periodStart}</label>
                <input id="er-start" name="periodStart" type="date" max={todayKst()} required />
              </div>
              <div className={styles.field}>
                <label htmlFor="er-end">{EX_LABELS.periodEnd}</label>
                <input id="er-end" name="periodEnd" type="date" max={todayKst()} required />
              </div>
            </div>
            <div className={styles.field}>
              <label htmlFor="er-source">{EX_LABELS.sourceNote}</label>
              <input id="er-source" name="sourceNote" type="text" required />
            </div>
            <div className={styles.field}>
              <label htmlFor="er-job">{EX_LABELS.linkedJob}</label>
              <select id="er-job" name="executionJobId" defaultValue="">
                <option value="">{EX_LABELS.noJob}</option>
                {board.jobs
                  .filter((j) => j.status === "succeeded")
                  .map((j) => (
                    <option key={j.id} value={j.id}>
                      {`${j.source.title ?? j.payloadTitle} · ${formatKst(j.executedAt)}`}
                    </option>
                  ))}
              </select>
            </div>
          </ActionForm>
        </details>
      )}
    </section>
  );
}

function ResultCard({ r, canWrite, actions }: { r: ExecutionResultView; canWrite: boolean; actions: ExecutionActions }) {
  const open = canWrite && r.archivedAt === null;
  const headId = `result-${r.id}`;
  return (
    <li className={s.exCard} aria-labelledby={headId}>
      <h3 id={headId} className={s.exCardTitle}>
        {resultHeadline(r)}
      </h3>
      <p className={styles.muted}>{resultMeta(r)}</p>
      <p className={s.exTags}>
        <span className={s.exTag}>{r.collectionMode === "manual_entry" ? EX_LABELS.manualBadge : EX_LABELS.syncBadge}</span>
        {r.status === "voided" && <span className={`${s.exTag} ${s.exTag_warn}`}>{EX_LABELS.voided}</span>}
        {r.archivedAt && <span className={s.exTag}>{EX_LABELS.archived}</span>}
      </p>
      {r.status === "voided" && r.voidReason && <p className={styles.muted}>{`취소 사유: ${r.voidReason}`}</p>}
      {open && r.status === "active" && (
        <details>
          <summary>{ER_COPY.voidBtn}</summary>
          <ActionForm action={actions.voidResult ?? notConnected} submitLabel={ER_COPY.voidBtn} variant="secondary">
            <input type="hidden" name="resultId" value={r.id} />
            <p className={styles.muted}>{ER_COPY.voidHint}</p>
            <div className={styles.field}>
              <label htmlFor={`${headId}-reason`}>{EX_LABELS.voidReason}</label>
              <input id={`${headId}-reason`} name="reason" type="text" required />
            </div>
          </ActionForm>
        </details>
      )}
      {open && (
        <details>
          <summary>{ER_COPY.archiveBtn}</summary>
          <ActionForm action={actions.archiveResult ?? notConnected} submitLabel={ER_COPY.archiveBtn} variant="secondary">
            <input type="hidden" name="resultId" value={r.id} />
            <p className={styles.muted}>보관하면 내용만 볼 수 있고 고칠 수 없습니다. 보관은 되돌릴 수 없습니다.</p>
          </ActionForm>
        </details>
      )}
    </li>
  );
}
