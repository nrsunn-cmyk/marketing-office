import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { designDownloadUrlAction } from "@/features/design-assets/actions";
import { getProductionBriefsFor } from "@/features/production-brief/server";
import { getProject } from "@/features/projects/server";
import {
  addDeliveryLogAction,
  archiveDeliveryBundleAction,
  createDeliveryBundleAction,
  refreshDeliveryAction,
  restoreDeliveryBundleAction,
  updateDeliveryBundleAction,
} from "@/features/qa-delivery/actions";
import { getDeliveryBundleFor } from "@/features/qa-delivery/server";
import type { TaskDetail } from "@/features/tasks/server";
import { BadgeArchived, BadgeBlocked, BadgeDrafting, BadgeReady, BadgeStale, EmptyExecutionArt, P3BundleIcon } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import db from "./delivery-bundle.module.css";
import { BriefActionButton } from "./production-brief-buttons";
import type { BriefAction } from "./production-brief-edit-form";
import { DeliveryLogForm } from "./delivery-bundle-log-form";
import { pptExportHref } from "./ppt-deck-model";
import { EX_LABELS } from "../../projects/[projectId]/execution/execution-model";
import { VideoDownloadButton } from "./video-download-button";
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
  manifestHref,
  type DbBundleView,
  type DbIncludedItem,
  type DeliveryBundleData,
} from "./delivery-bundle-model";

/** 서버 동작(actions.ts). 시험에서 넘기지 않으면 단추마다 '아직 서버와 연결되지 않아…' 안내 */
export interface DeliveryBundleActions {
  create?: BriefAction;
  rebase?: BriefAction;
  restore?: BriefAction;
  addLog?: BriefAction;
  saveStatus?: BriefAction;
  archive?: BriefAction;
  /** 디자인 자산 판 내려받기 주소(서명 주소 60초) */
  assetDownload?: (assetId: string, version: number) => Promise<{ ok: true; data: { url: string } } | { ok: false; message: string }>;
}

const SERVER_ACTIONS: DeliveryBundleActions = {
  create: createDeliveryBundleAction,
  rebase: refreshDeliveryAction,
  restore: restoreDeliveryBundleAction,
  addLog: addDeliveryLogAction,
  saveStatus: updateDeliveryBundleAction,
  archive: archiveDeliveryBundleAction,
  assetDownload: designDownloadUrlAction,
};

/**
 * P3FG-UI-CONNECT-01 납품 영역(서버 연결). 검수(#qa-checklist) 아래. 납품 묶음은 프로젝트 단위라
 * 제작 브리프 하나(보관 안 된 것 우선)로 읽는다 — 서버가 프로젝트의 모든 승인본을 모은다.
 */
export async function DeliveryBundleArea({ detail }: { detail: TaskDetail }) {
  let data: DeliveryBundleData | null = null;
  let projectArchived = false;
  let noBrief = false;
  try {
    const [r, project] = await Promise.all([getProductionBriefsFor(detail.project.id), getProject(detail.project.id)]);
    projectArchived = project?.status === "archived";
    if (!r.ok) console.error("[delivery-bundle]", r.code, r.message);
    else {
      const brief = r.data.briefs.find((b) => !b.archived) ?? r.data.briefs[0];
      if (!brief) noBrief = true;
      else {
        const d = await getDeliveryBundleFor(brief.id);
        if (d.ok) data = d.data;
        else console.error("[delivery-bundle]", d.code, d.message);
      }
    }
  } catch (e) {
    unstable_rethrow(e);
    console.error("[delivery-bundle]", e);
  }
  if (noBrief)
    // 제작 브리프가 없으면 묶을 것도 없다: 빈 상태(만들기 없음)
    data = { projectId: detail.project.id, included: [], excluded: [], bundles: [], stale: false, baseArchived: projectArchived, canWrite: false, canCreate: false, createBlockedCode: "no_approved" };
  return <DeliveryBundleSection data={data} readOnly={projectArchived || detail.task.status === "cancelled"} taskId={detail.task.id} actions={SERVER_ACTIONS} />;
}

/**
 * 납품 묶음 화면 본문(동기, 시험에서 가짜 데이터로 그린다). 실제 파일 묶기·외부 발송은 하지 않는다.
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
        <>
          <Body data={data} readOnly={readOnly} actions={actions} />
          {/* 진입 ③: P4 실행·성과와의 관계 안내(연결 단추 없음, 실행 화면 링크만) */}
          <div className={`${styles.notice} ${db.dbBanner}`} role="note">
            <p className={f.keep}>
              <span className={f.tag}>{EX_LABELS.bundleNextBadge}</span> {EX_LABELS.bundleNextNotice}
            </p>
            <p>
              <Link href={`/projects/${data.projectId}/execution`} className={`${styles.secondaryButton} ${f.touch}`}>
                {EX_LABELS.bundleNextLink}
              </Link>
            </p>
          </div>
        </>
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
          {st.canCreate && <BriefActionButton action={actions.create} hidden={{ projectId: data.projectId }} submitLabel={DB_COPY.createNext} pendingLabel={P3_COMMON_COPY.savePending} variant="primary" />}
        </div>
      )}

      {!latest && (
        <div className={`${styles.emptyState} ${db.dbEmpty}`}>
          <EmptyExecutionArt className={db.dbEmptyArt} />
          <strong>{DB_COPY.emptyTitle}</strong>
          {st.canCreate && (
            <>
              <p className={`${styles.muted} ${f.keep}`}>{DB_COPY.emptyDesc}</p>
              <BriefActionButton action={actions.create} hidden={{ projectId: data.projectId }} submitLabel={DB_COPY.create} pendingLabel={P3_COMMON_COPY.savePending} variant="primary" />
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
                <li key={`${it.kind}-${it.targetId}-${it.versionNo}`} className={db.dbItem}>
                  <div className={db.dbItemText}>
                    <p className={db.dbItemTitle}>
                      {it.title} <span className={db.dbItemVer}>{includedVersionText(it)}</span>
                    </p>
                    {detail && <p className={`${styles.muted} ${f.keep}`}>{detail}</p>}
                  </div>
                  <div className={db.dbRowButtons}>
                    <ItemDownload it={it} actions={actions} />
                    <span className={`${db.dbBadge} ${db.dbBadge_reviewed}`}>
                      <BadgeReady />
                      {DB_LABELS.included}
                    </span>
                  </div>
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
              <li key={`${it.kind}-${it.targetId}-${i}`} className={`${db.dbItem} ${db.dbItemOut}`}>
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
          {st.canCreate && !st.stale && <BriefActionButton action={actions.create} hidden={{ projectId: data.projectId }} submitLabel={DB_COPY.createNext} pendingLabel={P3_COMMON_COPY.savePending} variant="primary" />}
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
          {st.canLog && <DeliveryLogForm bundleId={latest.id} revision={latest.revision} action={actions.addLog} />}
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

/**
 * 포함 항목별 내려받기(Master ⑤: 목록 .md + 항목별 기존 링크). PPT 는 그 판의 .pptx·.md 내보내기,
 * 디자인 자산은 그 판 파일(서명 주소). 홈페이지·영상 구성·브리프는 파일이 아니라 각 단계 화면에서 본다
 */
function ItemDownload({ it, actions }: { it: DbIncludedItem; actions: DeliveryBundleActions }) {
  if (it.kind === "ppt_deck")
    return (
      <>
        <a href={pptExportHref(it.targetId, "pptx", it.versionNo)} className={`${styles.secondaryButton} ${f.touch}`} download aria-label={`${it.title} v${it.versionNo} .pptx 내려받기`}>
          .pptx
        </a>
        <a href={pptExportHref(it.targetId, "md", it.versionNo)} className={`${styles.secondaryButton} ${f.touch}`} download aria-label={`${it.title} v${it.versionNo} .md 내려받기`}>
          .md
        </a>
      </>
    );
  if (it.kind === "design_assets") return <VideoDownloadButton planId={it.targetId} version={it.versionNo} action={actions.assetDownload} />;
  return null;
}

function BundleRow({ b, isLatest, canRestore, actions }: { b: DbBundleView; isLatest: boolean; canRestore: boolean; actions: DeliveryBundleActions }) {
  return (
    <li className={`${db.dbItem} ${isLatest ? db.dbItemLatest : ""}`}>
      <div className={db.dbItemText}>
        <p className={db.dbItemTitle}>{`${DB_LABELS.bundleName(b.bundleVersion)}${isLatest ? ` ${DB_LABELS.latest}` : ""}`}</p>
        <p className={`${styles.muted} ${f.keep}`}>{bundleLine(b)}</p>
      </div>
      <div className={db.dbRowButtons}>
        {/* 납품 목록(.md): 항목·판·검수 회차·승인 시각·sha256·전달 기록(경로 처리기, 보관 묶음도 됨) */}
        <a href={manifestHref(b.id)} className={`${styles.secondaryButton} ${f.touch}`} download aria-label={`${DB_LABELS.bundleName(b.bundleVersion)} ${DB_COPY.downloadManifest}`}>
          {DB_COPY.downloadManifest}
        </a>
        {!isLatest && canRestore && <BriefActionButton action={actions.restore} hidden={{ bundleId: b.id }} submitLabel={DB_COPY.restoreBundle} pendingLabel={P3_COMMON_COPY.savePending} />}
      </div>
    </li>
  );
}
