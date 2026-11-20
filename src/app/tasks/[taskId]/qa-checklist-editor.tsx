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
  canAddQaItem,
  canRemoveQaItem,
  checkQaItems,
  countChars,
  counterText,
  formatKstMinute,
  gateBadgeText,
  memoKey,
  newQaItem,
  titleKey,
  qaGate,
  qaGateText,
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

/** 서버 동작(src/features/qa-delivery/actions.ts). 시험에서 넘기지 않으면 단추마다 '아직 서버와 연결되지 않아…' 안내 */
export interface QaChecklistActions {
  create?: BriefAction;
  save?: BriefAction;
  requestFix?: BriefAction;
  approve?: BriefAction;
  rebase?: BriefAction;
  archive?: BriefAction;
}

/**
 * 결과물 탭(홈페이지·디자인 자산·영상·PPT, 시안 qa-checklist.html) + 고른 결과물의 검수 판.
 * 대상은 산출물 하나(디자인 자산은 자산마다 탭 하나, Master ①) — 같은 종류가 여럿이면 탭에 제목을 붙인다.
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
          <button key={t.targetId ?? t.kind} type="button" className={qa.qaTab} aria-pressed={t === target} aria-controls={`${id}-panel`} onClick={() => setCur(i)}>
            {qaTabText(t, data.targets.filter((x) => x.kind === t.kind).length)}
          </button>
        ))}
      </nav>
      <div id={`${id}-panel`}>
        <TargetPanel key={target.targetId ?? target.kind} target={target} canWrite={data.canWrite} readOnly={readOnly} actions={actions} />
      </div>
    </>
  );
}

function TargetPanel({ target, canWrite, readOnly, actions }: { target: QaTargetView; canWrite: boolean; readOnly: boolean; actions: QaChecklistActions }) {
  const st = qaTargetState(target, { canWrite, readOnly });
  const round = st.round;
  const kindName = target.title || QA_TARGET_KINDS[target.kind].product;
  // 검수 대상 판은 서버가 정한다(지금 판 = 검토 완료 판, Backend openQaReview·rebaseQaReview)
  const targetNow = target.currentVersionNo ? (
    <p className={`${f.keep} ${qa.qaTarget}`}>
      <strong>{QA_LABELS.targetVersion}</strong> {versionText(target.kind, target.currentVersionNo)}
    </p>
  ) : null;
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
              <BriefActionButton action={actions.create} hidden={{ targetKind: target.kind, targetId: target.targetId ?? "" }} submitLabel={QA_COPY.create} pendingLabel={P3_COMMON_COPY.savePending} variant="primary">
                {targetNow}
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
              {st.canRebase && (
                <BriefActionButton action={actions.rebase} hidden={{ roundId: round.id, revision: round.revision }} submitLabel={QA_COPY.rebase} pendingLabel={P3_COMMON_COPY.savePending}>
                  {targetNow}
                </BriefActionButton>
              )}
            </div>
          )}
          {st.roundsFull && !st.locked && (
            <p className={`${styles.muted} ${f.keep}`} role="note">
              {QA_COPY.roundLimitReached}
            </p>
          )}
          {st.locked || round.status === "reviewed" ? <ReadOnlyItems items={round.items} /> : <ItemsEditor key={round.revision} round={round} action={actions.save} />}
          {!st.locked && round.status !== "reviewed" && !st.stale && <Gate round={round} actions={actions} />}
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
  const [drafts, setDrafts] = useState<QaItemDraft[]>(() => items.map((it) => ({ id: it.id, itemTitle: it.itemTitle, verdict: it.verdict, memo: it.memo })));
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState("");
  /** 삭제하기로 한 추가 항목(저장할 때 서버에서 먼저 지운다) */
  const [removed, setRemoved] = useState<string[]>([]);
  const issues = checkQaItems(drafts);
  const set = (i: number, patch: Partial<QaItemDraft>) => {
    setTouched(true);
    setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  };
  return (
    <ActionForm action={action ?? notConnectedAction} submitLabel={QA_COPY.save} pendingLabel={P3_COMMON_COPY.savePending} className={`${f.form} ${qa.qaForm}`}>
      <input type="hidden" name="roundId" value={round.id} />
      <input type="hidden" name="revision" value={round.revision} />
      <input type="hidden" name="payload" value={JSON.stringify(toQaPayload(drafts, items, removed))} />
      <ol className={qa.qaItems}>
        {drafts.map((d, i) => {
          const it = d.id === null ? null : (items.find((x) => x.id === d.id) ?? null);
          const n = countChars(d.memo);
          // 보완 필요인데 메모가 비면 바로(AGY memoRequired 하나), 넘침도 바로, 그 밖은 손댄 뒤
          const msg = n > QA_LIMITS.memo || (d.verdict === "needs_fix" && n === 0) || touched ? issues[memoKey(i)] : undefined;
          const who = it ? checkerText(it) : null;
          const base = `${id}-i${i}`;
          const titleMsg = d.id === null && (touched || countChars(d.itemTitle) > QA_LIMITS.itemTitle) ? issues[titleKey(i)] : undefined;
          return (
            <li key={d.id ?? `new-${i}`} className={`${qa.qaItem} ${d.verdict === "needs_fix" ? qa.qaItemFix : ""}`}>
              <div className={qa.qaItemHead}>
                <h4 className={qa.qaItemTitle} id={`${base}-h`}>{`${i + 1}. ${!it || it.isRequired ? `${QA_LABELS.required} ` : ""}${it ? it.itemTitle : d.itemTitle.trim()}`}</h4>
                <span className={`${qa.qaVerdict} ${qa[`qaVerdict_${d.verdict}`]}`}>{QA_VERDICTS[d.verdict]}</span>
              </div>
              {who && <p className={`${styles.muted} ${f.keep} ${qa.qaMeta}`}>{who}</p>}
              {it && canRemoveQaItem(round, it) && (
                // 접힌 확인 단계. 일반 단추라 Enter 로 눌리지 않고, 저장할 때 서버에서 지운다(삭제 → 판정 저장 순서)
                <details className={`${f.inlineDetails} ${qa.qaDanger}`}>
                  <summary>{QA_COPY.removeItem}</summary>
                  <p className={`${styles.muted} ${f.keep}`}>{QA_COPY.removeItemConfirm}</p>
                  <button
                    type="button"
                    className={`${styles.secondaryButton} ${f.touch}`}
                    aria-label={`${it.itemTitle} ${QA_COPY.removeItemSubmit}`}
                    onClick={() => {
                      setTouched(true);
                      setRemoved([...removed, it.id]);
                      setDrafts(drafts.filter((x) => x.id !== it.id));
                      setNote(`'${it.itemTitle}' 항목을 삭제 목록에 넣었습니다. ${QA_COPY.save}을 누르면 삭제됩니다.`);
                    }}
                  >
                    {QA_COPY.removeItemSubmit}
                  </button>
                </details>
              )}
              {d.id === null && (
                <div className={styles.field}>
                  <div className={qa.qaFieldHead}>
                    <label htmlFor={`${base}-title`}>
                      검수 항목 제목 <span className={qa.qaReq}>(필수)</span>
                    </label>
                    <span id={`${base}-title-count`} className={`${qa.qaCount} ${countChars(d.itemTitle) > QA_LIMITS.itemTitle ? qa.qaCountOver : ""}`}>
                      {counterText(countChars(d.itemTitle), QA_LIMITS.itemTitle)}
                    </span>
                  </div>
                  <input
                    id={`${base}-title`}
                    type="text"
                    value={d.itemTitle}
                    placeholder={QA_COPY.itemTitlePlaceholder}
                    onChange={(e) => set(i, { itemTitle: e.target.value })}
                    aria-required
                    aria-invalid={titleMsg ? true : undefined}
                    aria-describedby={`${base}-title-count${titleMsg ? ` ${base}-title-msg` : ""}`}
                  />
                  {titleMsg && (
                    <span id={`${base}-title-msg`} className={styles.error}>
                      {titleMsg}
                    </span>
                  )}
                </div>
              )}
              {d.id === null ? (
                <p className={`${styles.muted} ${f.keep}`}>{QA_LABELS.newItemPending}</p>
              ) : (
                <>
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
                </>
              )}
            </li>
          );
        })}
      </ol>
      {canAddQaItem(drafts.length) ? (
        <button
          type="button"
          className={`${styles.secondaryButton} ${f.touch}`}
          onClick={() => {
            setDrafts([...drafts, newQaItem()]);
            setNote(`${drafts.length + 1}번째 검수 항목을 추가했습니다.`);
          }}
        >
          {QA_COPY.addItem}
        </button>
      ) : (
        <p className={`${styles.muted} ${f.keep}`} role="note">
          {QA_COPY.itemLimitReached}
        </p>
      )}
      <p className={qa.qaSrOnly} role="status" aria-live="polite">
        {note}
      </p>
    </ActionForm>
  );
}

/**
 * 승인 게이트: 서버 gate(필수 항목만, Master ⑦)의 blockedBy 로 문구를 고른다(Backend 6절). 최종 판단은 승인 RPC.
 * 보완 필요가 있으면 보완 요청, blockedBy 가 null 이면 승인(선택 항목 보완 필요는 경고만)
 */
function Gate({ round, actions }: { round: QaRoundView; actions: QaChecklistActions }) {
  const g = qaGate(round.items);
  const ready = round.gate.blockedBy === null;
  const ids = { roundId: round.id, revision: round.revision };
  return (
    <div className={`${styles.notice} ${ready ? qa.qaGateReady : f.warnBox} ${qa.qaGate}`} role="note">
      <p className={f.keep}>
        {ready ? (
          qaGateText(null)
        ) : (
          <>
            <strong>{QA_LABELS.gatePrefix}</strong> {qaGateText(round.gate.blockedBy)}
          </>
        )}
      </p>
      {ready && round.gate.optionalNeedsFix > 0 && <p className={f.keep}>{QA_COPY.optionalNeedsFixWarn(round.gate.optionalNeedsFix)}</p>}
      <div className={qa.qaGateButtons}>
        {g.needsFix > 0 && round.status === "drafting" && <BriefActionButton action={actions.requestFix} hidden={ids} submitLabel={QA_COPY.requestFix} pendingLabel={P3_COMMON_COPY.savePending} />}
        {ready && <BriefActionButton action={actions.approve} hidden={ids} submitLabel={QA_COPY.approve} pendingLabel={P3_COMMON_COPY.savePending} variant="primary" />}
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
  const headId = `qa-history-${target.targetId ?? target.kind}`;
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
