import Link from "next/link";
import { BadgeArchived, BadgeBlocked, BadgeDrafting, BadgeReady, BadgeStale, EmptyExecutionArt, P3BundleIcon } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import db from "./delivery-bundle.module.css";
import { BriefActionButton } from "./production-brief-buttons";
import type { BriefAction } from "./production-brief-edit-form";
import { DeliveryLogForm } from "./delivery-bundle-log-form";
import {
  DB_COPY,
  DB_LABELS,
  DB_METHODS,
  DB_STATUSES,
  DB_STATUS_KEYS,
  P3_COMMON_COPY,
  bundleLine,
  countText,
  deliveryState,
  excludedTitle,
  includedDetail,
  includedVersionText,
  logLine,
  type DbBundleView,
  type DeliveryBundleData,
} from "./delivery-bundle-model";

/** 서버 동작 자리(P3-g 서버가 오면 actions.ts 의 동작을 넘긴다. 없으면 단추마다 '아직 서버와 연결되지 않아…' 안내) */
export interface DeliveryBundleActions {
  create?: BriefAction;
  rebase?: BriefAction;
  download?: BriefAction;
  restore?: BriefAction;
  addLog?: BriefAction;
  saveStatus?: BriefAction;
  archive?: BriefAction;
}

/**
 * P3G-UI-PREP-01 납품 묶음 영역(서버 연결 전, 가짜 데이터로 그리는 부품). 실제 파일 묶기·외부 발송은 하지 않는다.
 * 시안 Design/p3-production/delivery-bundle.html, 인계표 P3G-HANDOFF.md 상태:
 *   작성 중 · 검토 완료 · 이전 기준 · 보관(archived_at 따로) · 읽기 전용 + 빈 상태 · 바탕 보관 · 승인 판 없음 · 권한 없음
 *   · 한도(묶음 50·전달 기록 50) · 불러오기 실패(data = null).
 * 진행률 막대는 그리지 않는다(인계표 3절 5) — 포함 승인본 수·전달 기록 수만. 보관·읽기 전용이어도 내려받기는 남긴다.
 */
export function DeliveryBundleSection({ data, readOnly, taskId, actions = {} }: { data: DeliveryBundleData | null; readOnly: boolean; taskId: string; actions?: DeliveryBundleActions }) {
  return (
    <section className={`${styles.section} ${f.funnel} ${db.dbSection}`} aria-labelledby="delivery-bundle">
      <div className={db.dbHead}>
        <h2 id="delivery-bundle" className={`${styles.subtitle} ${db.dbTitle}`}>
          <P3BundleIcon className={db.dbIcon} />
          {DB_COPY.heading}
        </h2>
        <p className={`${styles.muted} ${f.keep}`}>{DB_COPY.intro}</p>
        {data && <Badges data={data} />}
      </div>
      {data === null ? (
        <>
          <p className={styles.error} role="alert">
            {DB_COPY.loadError}
          </p>
          <p>
            <Link href={`/tasks/${taskId}#delivery-bundle`} className={`${styles.secondaryButton} ${f.touch}`}>
              {P3_COMMON_COPY.reload}
            </Link>
          </p>
        </>
      ) : (
        <Body data={data} readOnly={readOnly} actions={actions} />
      )}
    </section>
  );
}

function Badges({ data }: { data: DeliveryBundleData }) {
  const latest = data.bundles[0];
  const archived = latest?.archivedAt != null;
  const Icon = latest?.status === "reviewed" ? BadgeReady : BadgeDrafting;
  return (
    <p className={db.dbBadges}>
      {latest && (
        <span className={`${db.dbBadge} ${db[`dbBadge_${latest.status}`]}`}>
          <Icon />
          {DB_STATUSES[latest.status]}
        </span>
      )}
      {archived && (
        <span className={`${db.dbBadge} ${db.dbBadge_archived}`}>
          <BadgeArchived />
          {DB_LABELS.archivedBadge}
        </span>
      )}
      {data.stale && !archived && (
        <span className={`${f.tag} ${f.tag_warn} ${db.dbTagIcon}`}>
          <BadgeStale />
          {DB_LABELS.staleBadge}
        </span>
      )}
      <span className={f.tag}>{countText(data.included.length, data.excluded.length)}</span>
    </p>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div className={`${styles.notice} ${db.dbBanner}`} role="note">
      <p className={f.keep}>{text}</p>
    </div>
  );
}

function Body({ data, readOnly, actions }: { data: DeliveryBundleData; readOnly: boolean; actions: DeliveryBundleActions }) {
  const st = deliveryState(data, { readOnly });
  const latest = st.latest;
  return (
    <>
      {readOnly && <Note text={P3_COMMON_COPY.projectReadOnly} />}
      {st.notice && <Note text={st.notice} />}
      {st.archivedCanCreate && <Note text={DB_COPY.archivedCanCreateNotice} />}
      {st.stale && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>
            <strong>{DB_LABELS.stalePrefix}</strong> {DB_COPY.staleBanner}
          </p>
          {!st.baseLocked && <BriefActionButton action={actions.rebase} hidden={{}} submitLabel={DB_COPY.rebase} pendingLabel={P3_COMMON_COPY.savePending} />}
        </div>
      )}

      {!latest && (
        <div className={`${styles.emptyState} ${db.dbEmpty}`}>
          <EmptyExecutionArt className={db.dbEmptyArt} />
          <strong>{DB_COPY.emptyTitle}</strong>
          {st.canCreate && (
            <>
              <p className={`${styles.muted} ${f.keep}`}>{DB_COPY.emptyDesc}</p>
              <BriefActionButton action={actions.create} hidden={{}} submitLabel={DB_COPY.create} pendingLabel={P3_COMMON_COPY.savePending} variant="primary" />
            </>
          )}
        </div>
      )}

      {/* 1. 포함 목록(서버가 모은 승인본만) */}
      <section className={db.dbBlock} aria-labelledby="delivery-included">
        <h3 id="delivery-included" className={db.dbSubhead}>
          {DB_LABELS.includedHeading(data.included.length)}
        </h3>
        {data.included.length > 0 && (
          <ul className={db.dbList}>
            {data.included.map((it) => {
              const detail = includedDetail(it);
              return (
                <li key={`${it.kind}-${it.versionNo}`} className={db.dbItem}>
                  <div className={db.dbItemText}>
                    <p className={db.dbItemTitle}>
                      {it.title} <span className={db.dbItemVer}>{includedVersionText(it)}</span>
                    </p>
                    {detail && <p className={`${styles.muted} ${f.keep}`}>{detail}</p>}
                  </div>
                  <span className={`${db.dbBadge} ${db.dbBadge_reviewed}`}>
                    <BadgeReady />
                    {DB_LABELS.included}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 2. 자동 제외 목록·사유(서버 계산) */}
      {data.excluded.length > 0 && (
        <section className={db.dbBlock} aria-labelledby="delivery-excluded">
          <h3 id="delivery-excluded" className={db.dbSubhead}>
            {DB_LABELS.excludedHeading(data.excluded.length)}
          </h3>
          <ul className={db.dbList}>
            {data.excluded.map((it, i) => (
              <li key={`${it.kind}-${i}`} className={`${db.dbItem} ${db.dbItemOut}`}>
                <div className={db.dbItemText}>
                  <p className={db.dbItemTitle}>
                    {excludedTitle(it)} <span className={db.dbItemVer}>{it.stateLabel}</span>
                  </p>
                  <p className={`${styles.muted} ${f.keep}`}>
                    <strong>{DB_LABELS.reasonPrefix}</strong> {it.reason}
                  </p>
                </div>
                <span className={`${db.dbBadge} ${db.dbBadge_out}`}>
                  <BadgeBlocked />
                  {DB_LABELS.excluded}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. 스냅샷 이력: 내려받기는 늘 남김, 복구는 새 묶음을 만든다(비파괴) */}
      {latest && (
        <section className={db.dbBlock} aria-labelledby="delivery-history">
          <h3 id="delivery-history" className={db.dbSubhead}>
            {DB_LABELS.historyHeading(data.bundles.length)}
          </h3>
          <p className={`${styles.muted} ${f.keep}`}>{DB_LABELS.historyHint}</p>
          {st.canCreate && <BriefActionButton action={actions.create} hidden={{}} submitLabel={DB_COPY.createNext} pendingLabel={P3_COMMON_COPY.savePending} variant="primary" />}
          {st.bundlesFull && !st.baseLocked && (
            <p className={`${styles.muted} ${f.keep}`} role="note">
              {DB_COPY.bundleLimitReached}
            </p>
          )}
          <ol className={db.dbList}>
            {data.bundles.map((b, i) => (
              <BundleRow key={b.id} b={b} isLatest={i === 0} canRestore={st.canRestore} actions={actions} />
            ))}
          </ol>
        </section>
      )}

      {/* 4. 고객 전달 기록(추가 전용, 실제 발송 없음) */}
      {latest && (
        <section className={db.dbBlock} aria-labelledby="delivery-logs">
          <h3 id="delivery-logs" className={db.dbSubhead}>
            {DB_LABELS.logsHeading}
          </h3>
          <p className={`${styles.muted} ${f.keep}`}>{DB_COPY.deliveryHint}</p>
          {st.canLog && <DeliveryLogForm bundleId={latest.id} action={actions.addLog} />}
          {st.logsFull && !st.locked && (
            <p className={`${styles.muted} ${f.keep}`} role="note">
              {DB_COPY.deliveryLimitReached}
            </p>
          )}
          {data.bundles.some((b) => b.logs.length > 0) && (
            <ul className={db.dbList}>
              {data.bundles.flatMap((b) =>
                b.logs.map((l) => (
                  <li key={l.id} className={db.dbItem}>
                    <div className={db.dbItemText}>
                      <p className={db.dbItemTitle}>{`${DB_METHODS[l.method]} · 묶음 ${l.bundleVersion}`}</p>
                      <p className={`${styles.muted} ${f.keep}`}>{logLine(l)}</p>
                    </div>
                    <span className={f.tag}>{DB_LABELS.logged}</span>
                  </li>
                )),
              )}
            </ul>
          )}
        </section>
      )}

      {/* 묶음 상태·보관(최신 묶음, 고칠 수 있을 때만) */}
      {latest && !st.locked && (
        <div className={db.dbFoot}>
          <BriefActionButton action={actions.saveStatus} hidden={{ bundleId: latest.id, revision: latest.revision }} submitLabel={DB_LABELS.saveStatus} pendingLabel={P3_COMMON_COPY.savePending}>
            <div className={styles.field}>
              <label htmlFor="delivery-status">{DB_LABELS.status}</label>
              <select id="delivery-status" name="status" defaultValue={latest.status}>
                {DB_STATUS_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {DB_STATUSES[k]}
                  </option>
                ))}
              </select>
            </div>
          </BriefActionButton>
          <details className={`${f.inlineDetails} ${db.dbDanger}`}>
            <summary>{DB_COPY.archive}</summary>
            <BriefActionButton action={actions.archive} hidden={{ bundleId: latest.id, revision: latest.revision }} submitLabel={DB_COPY.archive} pendingLabel={P3_COMMON_COPY.archivePending}>
              <p className={`${styles.muted} ${f.keep}`}>{P3_COMMON_COPY.archiveConfirm}</p>
            </BriefActionButton>
          </details>
        </div>
      )}
    </>
  );
}

function BundleRow({ b, isLatest, canRestore, actions }: { b: DbBundleView; isLatest: boolean; canRestore: boolean; actions: DeliveryBundleActions }) {
  return (
    <li className={`${db.dbItem} ${isLatest ? db.dbItemLatest : ""}`}>
      <div className={db.dbItemText}>
        <p className={db.dbItemTitle}>{`${DB_LABELS.bundleName(b.bundleVersion)}${isLatest ? ` ${DB_LABELS.latest}` : ""}`}</p>
        <p className={`${styles.muted} ${f.keep}`}>{bundleLine(b)}</p>
      </div>
      <div className={db.dbRowButtons}>
        <BriefActionButton action={actions.download} hidden={{ bundleId: b.id }} submitLabel={DB_COPY.downloadBundle} pendingLabel={P3_COMMON_COPY.savePending} />
        {!isLatest && canRestore && <BriefActionButton action={actions.restore} hidden={{ bundleId: b.id }} submitLabel={DB_COPY.restoreBundle} pendingLabel={P3_COMMON_COPY.savePending} />}
      </div>
    </li>
  );
}
