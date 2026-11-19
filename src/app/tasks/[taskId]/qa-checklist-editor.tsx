"use client";

import { useId, useState } from "react";
import { ActionForm } from "../../_components/action-form";
import { BadgeArchived, BadgeBlocked, BadgeDrafting, BadgeReady, BadgeStale, EmptyBriefArt } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import qa from "./qa-checklist.module.css";
import { BriefActionButton } from "./production-brief-buttons";
import { notConnectedAction, type BriefAction } from "./production-brief-edit-form";
import {
  P3_COMMON_COPY,
  QA_COPY,
  QA_LABELS,
  QA_LIMITS,
  QA_STATUSES,
  QA_TARGET_KINDS,
  QA_VERDICTS,
  QA_VERDICT_KEYS,
  checkQaItems,
  countChars,
  counterText,
  formatKstMinute,
  gateBadgeText,
  memoKey,
  qaGate,
  qaTabText,
  qaTargetState,
  sortedItems,
  toQaPayload,
  versionText,
  type QaChecklistData,
  type QaItemDraft,
  type QaItemView,
  type QaRoundView,
  type QaTargetView,
  type QaVerdict,
} from "./qa-checklist-model";

/** 서버 동작 자리(P3-f 서버가 오면 actions.ts 의 동작을 넘긴다. 없으면 단추마다 '아직 서버와 연결되지 않아…' 안내) */
export interface QaChecklistActions {
  create?: BriefAction;
  save?: BriefAction;
  requestFix?: BriefAction;
  approve?: BriefAction;
  rebase?: BriefAction;
  archive?: BriefAction;
}

/**
 * 결과물 종류 탭(홈페이지·디자인 자산·영상·PPT, 시안 qa-checklist.html) + 고른 결과물의 검수 판.
 * 탭은 단추(aria-pressed) — 고른 탭의 판만 그린다. 탭 글에는 필수 항목 통과 수만(진행률 막대 없음, P3I-HANDOFF 2절).
 */
export function QaChecklistBoard({ data, readOnly, actions }: { data: QaChecklistData; readOnly: boolean; actions: QaChecklistActions }) {
  const id = useId();
  const [cur, setCur] = useState(0);
  const target = data.targets[cur] ?? data.targets[0];
  if (!target) return null;
  return (
    <>
      <nav className={qa.qaTabs} aria-label="검수할 결과물">
        {data.targets.map((t, i) => (
          <button key={t.kind} type="button" className={qa.qaTab} aria-pressed={t === target} aria-controls={`${id}-panel`} onClick={() => setCur(i)}>
            {qaTabText(t)}
          </button>
        ))}
      </nav>
      <div id={`${id}-panel`}>
        <TargetPanel key={target.kind} target={target} canWrite={data.canWrite} readOnly={readOnly} actions={actions} />
      </div>
    </>
  );
}

function TargetPanel({ target, canWrite, readOnly, actions }: { target: QaTargetView; canWrite: boolean; readOnly: boolean; actions: QaChecklistActions }) {
  const st = qaTargetState(target, { canWrite, readOnly });
  const round = st.round;
  const kindName = QA_TARGET_KINDS[target.kind].product;
  const reviewed = target.versions.filter((v) => v.status === "reviewed").sort((a, b) => b.versionNo - a.versionNo);
  /** 산출물별 판 고르기(검토 완료 판만, 최신이 기본) */
  const versionPicker = (
    <div className={styles.field}>
      <label htmlFor={`qa-ver-${target.kind}`}>{QA_LABELS.targetVersion}</label>
      <select id={`qa-ver-${target.kind}`} name="targetVersionId" defaultValue={st.latest?.id}>
        {reviewed.map((v) => (
          <option key={v.id} value={v.id}>
            {versionText(target.kind, v.versionNo)}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <section className={qa.qaPanel} aria-label={`${kindName} 검수`}>
      {st.notice && (
        <div className={`${styles.notice} ${qa.qaBanner}`} role="note">
          <p className={f.keep}>{st.notice}</p>
        </div>
      )}
      {!round ? (
        <div className={`${styles.emptyState} ${qa.qaEmpty}`}>
          <EmptyBriefArt className={qa.qaEmptyArt} />
          <strong>{QA_COPY.emptyTitle}</strong>
          {st.canOpen && (
            <>
              <p className={`${styles.muted} ${f.keep}`}>{QA_COPY.emptyDesc}</p>
              <BriefActionButton action={actions.create} hidden={{ targetKind: target.kind }} submitLabel={QA_COPY.create} pendingLabel={P3_COMMON_COPY.savePending} variant="primary">
                {versionPicker}
              </BriefActionButton>
            </>
          )}
        </div>
      ) : (
        <>
          <RoundHead round={round} kind={target.kind} archived={st.archived} stale={st.stale} />
          {st.stale && (
            <div className={`${styles.notice} ${f.warnBox}`} role="note">
              <p className={f.keep}>
                <strong>{QA_LABELS.stalePrefix}</strong> {QA_COPY.staleBanner}
              </p>
              {st.canOpen && (
                <BriefActionButton action={actions.rebase} hidden={{ targetKind: target.kind, roundId: round.id, revision: round.revision }} submitLabel={QA_COPY.rebase} pendingLabel={P3_COMMON_COPY.savePending}>
                  {versionPicker}
                </BriefActionButton>
              )}
            </div>
          )}
          {st.roundsFull && !st.locked && (
            <p className={`${styles.muted} ${f.keep}`} role="note">
              {QA_COPY.roundLimitReached}
            </p>
          )}
          {st.locked || round.status === "reviewed" ? <ReadOnlyItems items={round.items} /> : <ItemsEditor round={round} action={actions.save} />}
          {!st.locked && round.status !== "reviewed" && <Gate round={round} actions={actions} />}
          {!st.locked && (
            <details className={`${f.inlineDetails} ${qa.qaDanger}`}>
              <summary>{QA_COPY.archive}</summary>
              <BriefActionButton action={actions.archive} hidden={{ roundId: round.id, revision: round.revision }} submitLabel={QA_COPY.archive} pendingLabel={P3_COMMON_COPY.archivePending}>
                <p className={`${styles.muted} ${f.keep}`}>{P3_COMMON_COPY.archiveConfirm}</p>
              </BriefActionButton>
            </details>
          )}
          <History target={target} current={round} />
        </>
      )}
    </section>
  );
}

function RoundHead({ round, kind, archived, stale }: { round: QaRoundView; kind: QaTargetView["kind"]; archived: boolean; stale: boolean }) {
  const Icon = round.status === "reviewed" ? BadgeReady : round.status === "fix_requested" ? BadgeBlocked : BadgeDrafting;
  const g = qaGate(round.items);
  return (
    <div className={qa.qaRoundHead}>
      <p className={qa.qaBadges}>
        <span className={`${qa.qaBadge} ${qa[`qaBadge_${round.status}`]}`}>
          <Icon />
          {QA_STATUSES[round.status]}
        </span>
        {archived && (
          <span className={`${qa.qaBadge} ${qa.qaBadge_archived}`}>
            <BadgeArchived />
            {QA_LABELS.archivedBadge}
          </span>
        )}
        {stale && (
          <span className={`${f.tag} ${f.tag_warn} ${qa.qaTagIcon}`}>
            <BadgeStale />
            {QA_LABELS.staleBadge}
          </span>
        )}
        {round.status !== "reviewed" && !g.ready && <span className={`${f.tag} ${f.tag_warn}`}>{gateBadgeText(g)}</span>}
        <span className={f.tag}>{`${round.roundNo}차 · ${g.passed}/${g.required} ${QA_LABELS.passed}`}</span>
      </p>
      <p className={`${f.keep} ${qa.qaTarget}`}>
        <strong>{QA_LABELS.targetVersion}</strong> {versionText(kind, round.targetVersionNo)}
      </p>
    </div>
  );
}

function checkerText(it: Pick<QaItemView, "checkedByName" | "checkedAt">): string | null {
  if (!it.checkedByName && !it.checkedAt) return null;
  return `${QA_LABELS.checker}: ${it.checkedByName ?? "알 수 없음"} · ${QA_LABELS.lastChecked}: ${formatKstMinute(it.checkedAt)}`;
}

/** 항목별 판정(라디오 3개, 44px 라벨)·메모. 저장은 판정·메모 전체를 숨은 칸 payload 하나로 보낸다. 값은 자르지 않는다 */
function ItemsEditor({ round, action }: { round: QaRoundView; action?: BriefAction }) {
  const id = useId();
  const items = sortedItems(round.items);
  const [drafts, setDrafts] = useState<QaItemDraft[]>(() => items.map((it) => ({ id: it.id, verdict: it.verdict, memo: it.memo })));
  const [touched, setTouched] = useState(false);
  const issues = checkQaItems(drafts);
  const set = (i: number, patch: Partial<QaItemDraft>) => {
    setTouched(true);
    setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  };
  const memoMissing = drafts.some((d) => d.verdict === "needs_fix" && countChars(d.memo) === 0);
  return (
    <ActionForm action={action ?? notConnectedAction} submitLabel={QA_COPY.save} pendingLabel={P3_COMMON_COPY.savePending} className={`${f.form} ${qa.qaForm}`}>
      <input type="hidden" name="roundId" value={round.id} />
      <input type="hidden" name="revision" value={round.revision} />
      <input type="hidden" name="payload" value={JSON.stringify(toQaPayload(drafts))} />
      {memoMissing && (
        <p className={`${styles.notice} ${f.warnBox} ${f.keep}`} role="note">
          {QA_COPY.memoRequiredNote}
        </p>
      )}
      <ol className={qa.qaItems}>
        {items.map((it, i) => {
          const d = drafts[i];
          const n = countChars(d.memo);
          const msg = n > QA_LIMITS.memo || touched ? issues[memoKey(i)] : undefined;
          const who = checkerText(it);
          const base = `${id}-i${i}`;
          return (
            <li key={it.id} className={`${qa.qaItem} ${d.verdict === "needs_fix" ? qa.qaItemFix : ""}`}>
              <div className={qa.qaItemHead}>
                <h4 className={qa.qaItemTitle} id={`${base}-h`}>{`${i + 1}. ${it.isRequired ? `${QA_LABELS.required} ` : ""}${it.itemTitle}`}</h4>
                <span className={`${qa.qaVerdict} ${qa[`qaVerdict_${d.verdict}`]}`}>{QA_VERDICTS[d.verdict]}</span>
              </div>
              {who && <p className={`${styles.muted} ${f.keep} ${qa.qaMeta}`}>{who}</p>}
              <fieldset className={qa.qaVerdicts} aria-describedby={`${base}-h`}>
                <legend>{QA_LABELS.verdict}</legend>
                <div className={qa.qaVerdictGrid}>
                  {QA_VERDICT_KEYS.map((k) => (
                    <label key={k} className={qa.qaRadio}>
                      <input type="radio" name={`${base}-verdict`} value={k} checked={d.verdict === k} onChange={() => set(i, { verdict: k as QaVerdict })} />
                      <span>{QA_VERDICTS[k]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className={styles.field}>
                <div className={qa.qaFieldHead}>
                  <label htmlFor={`${base}-memo`}>{QA_LABELS.memoWhenFix}</label>
                  <span id={`${base}-count`} className={`${qa.qaCount} ${n > QA_LIMITS.memo ? qa.qaCountOver : ""}`}>
                    {counterText(n, QA_LIMITS.memo)}
                  </span>
                </div>
                <textarea
                  id={`${base}-memo`}
                  rows={3}
                  value={d.memo}
                  onChange={(e) => set(i, { memo: e.target.value })}
                  aria-required={d.verdict === "needs_fix" ? true : undefined}
                  aria-invalid={msg ? true : undefined}
                  aria-describedby={`${base}-count${msg ? ` ${base}-msg` : ""}`}
                />
                {msg && (
                  <span id={`${base}-msg`} className={styles.error}>
                    {msg}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </ActionForm>
  );
}

/** 승인 게이트(저장된 판정 기준, 최종 판단은 서버): 보완 필요가 있으면 보완 요청, 필수 전부 통과면 승인 */
function Gate({ round, actions }: { round: QaRoundView; actions: QaChecklistActions }) {
  const g = qaGate(round.items);
  const ids = { roundId: round.id, revision: round.revision };
  return (
    <div className={`${styles.notice} ${g.ready ? qa.qaGateReady : f.warnBox} ${qa.qaGate}`} role="note">
      <p className={f.keep}>
        {g.ready ? (
          QA_COPY.gateReady
        ) : (
          <>
            <strong>{QA_LABELS.gatePrefix}</strong> {QA_COPY.gateBlocked}
          </>
        )}
      </p>
      <div className={qa.qaGateButtons}>
        {g.needsFix > 0 && round.status === "drafting" && <BriefActionButton action={actions.requestFix} hidden={ids} submitLabel={QA_COPY.requestFix} pendingLabel={P3_COMMON_COPY.savePending} />}
        {g.ready && <BriefActionButton action={actions.approve} hidden={ids} submitLabel={QA_COPY.approve} pendingLabel={P3_COMMON_COPY.savePending} variant="primary" />}
      </div>
    </div>
  );
}

/** 읽기 전용: 폼 없이 판정·메모만(글은 React 글자로만) */
function ReadOnlyItems({ items }: { items: QaItemView[] }) {
  return (
    <ol className={qa.qaItems}>
      {sortedItems(items).map((it, i) => {
        const who = checkerText(it);
        return (
          <li key={it.id} className={`${qa.qaItem} ${it.verdict === "needs_fix" ? qa.qaItemFix : ""}`}>
            <div className={qa.qaItemHead}>
              <h4 className={qa.qaItemTitle}>{`${i + 1}. ${it.isRequired ? `${QA_LABELS.required} ` : ""}${it.itemTitle}`}</h4>
              <span className={`${qa.qaVerdict} ${qa[`qaVerdict_${it.verdict}`]}`}>{QA_VERDICTS[it.verdict]}</span>
            </div>
            {who && <p className={`${styles.muted} ${f.keep} ${qa.qaMeta}`}>{who}</p>}
            <dl className={qa.qaView}>
              <div className={qa.qaViewRow}>
                <dt>{QA_LABELS.memo}</dt>
                <dd className={it.memo ? qa.qaViewText : styles.muted}>{it.memo || "적지 않음"}</dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ol>
  );
}

/** 보완 요청 · 재검수 흐름 이력(최신 회차가 위). 다음 회차가 있는 보완 요청 회차는 '수정됨' */
function History({ target, current }: { target: QaTargetView; current: QaRoundView }) {
  const list = [...target.rounds].sort((a, b) => b.roundNo - a.roundNo);
  const headId = `qa-history-${target.kind}`;
  return (
    <section className={qa.qaHistory} aria-labelledby={headId}>
      <h4 id={headId} className={qa.qaSubhead}>
        {QA_LABELS.historyHeading}
      </h4>
      <ol className={qa.qaHistoryList}>
        {list.map((r) => {
          const g = qaGate(r.items);
          const isCur = r.id === current.id;
          const fixed = r.status === "fix_requested" && r.roundNo < current.roundNo;
          const tail = g.needsFix > 0 ? ` (보완 ${g.needsFix}건)` : "";
          return (
            <li key={r.id} className={`${qa.qaHistoryItem} ${isCur ? qa.qaHistoryCurrent : ""}`}>
              <p className={f.keep}>{`${r.roundNo}차 ${QA_STATUSES[r.status]} · ${formatKstMinute(r.updatedAt)} · ${versionText(target.kind, r.targetVersionNo)}${tail}`}</p>
              {isCur ? <span className={f.tag}>{QA_LABELS.currentRound}</span> : fixed ? <span className={`${f.tag} ${qa.qaFixedTag}`}>{QA_LABELS.fixed}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
