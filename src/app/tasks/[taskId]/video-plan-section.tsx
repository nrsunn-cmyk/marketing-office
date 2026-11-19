import Link from "next/link";
import { BadgeArchived, BadgeDrafting, BadgeReady, BadgeStale, EmptyBriefArt, P3VideoIcon } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import vp from "./video-plan.module.css";
import { BriefActionButton } from "./production-brief-buttons";
import type { BriefAction } from "./production-brief-edit-form";
import { VideoPlanEditor } from "./video-plan-editor";
import {
  P3_COMMON_COPY,
  VIDEO_ASPECTS,
  VIDEO_PLAN_LIMITS,
  VIDEO_PLAN_STATUSES,
  VP_COPY,
  VP_LABELS,
  durationSummary,
  formatBytes,
  formatDuration,
  formatKstMinute,
  sortedScenes,
  type VideoPlanData,
  type VideoPlanView,
} from "./video-plan-model";

/** 서버 동작 자리(P3-d 서버가 오면 actions.ts 의 동작을 넘긴다. 없으면 단추마다 '아직 서버와 연결되지 않아…' 안내) */
export interface VideoPlanActions {
  create?: BriefAction;
  save?: BriefAction;
  rebase?: BriefAction;
  archive?: BriefAction;
  attach?: BriefAction;
  restore?: BriefAction;
}

/**
 * P3D-UI-PREP-01 영상 구성·파일 관리 영역(서버 연결 전, 가짜 데이터로 그리는 부품). 영상 생성·편집·실제 파일 첨부는 하지 않는다.
 * 시안 Design/p3-production/video-plan.html 상태: 작성 중 · 검토 완료 · 이전 기준 · 보관 · 읽기 전용 · 빈 상태
 * + 권한 없음 · 불러오기 실패(data = null). 진행률 막대는 그리지 않는다(근거 없는 진행률 금지, P3I-HANDOFF 2절) — 길이 합계·장면 수만.
 */
export function VideoPlanSection({ data, readOnly, taskId, actions = {} }: { data: VideoPlanData | null; readOnly: boolean; taskId: string; actions?: VideoPlanActions }) {
  const plan = data?.plan ?? null;
  return (
    <section className={`${styles.section} ${f.funnel} ${vp.vpSection}`} aria-labelledby="video-plan">
      <div className={vp.vpHead}>
        <h2 id="video-plan" className={`${styles.subtitle} ${vp.vpTitle}`}>
          <P3VideoIcon className={vp.vpIcon} />
          {VP_COPY.heading}
        </h2>
        <p className={`${styles.muted} ${f.keep}`}>{VP_COPY.intro}</p>
        {plan && <Badges plan={plan} />}
      </div>
      {data === null ? (
        <>
          <p className={styles.error} role="alert">
            {VP_COPY.loadError}
          </p>
          <p>
            <Link href={`/tasks/${taskId}#video-plan`} className={`${styles.secondaryButton} ${f.touch}`}>
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

function Badges({ plan }: { plan: VideoPlanView }) {
  const Icon = plan.status === "reviewed" ? BadgeReady : BadgeDrafting;
  return (
    <p className={vp.vpBadges}>
      <span className={`${vp.vpBadge} ${vp[`vpBadge_${plan.status}`]}`}>
        <Icon />
        {VIDEO_PLAN_STATUSES[plan.status]}
      </span>
      {plan.archivedAt && (
        <span className={`${vp.vpBadge} ${vp.vpBadge_archived}`}>
          <BadgeArchived />
          {VP_LABELS.archivedBadge}
        </span>
      )}
      {plan.stale && (
        <span className={`${f.tag} ${f.tag_warn} ${vp.vpTagIcon}`}>
          <BadgeStale />
          {VP_LABELS.staleBadge}
        </span>
      )}
      <span className={f.tag}>{durationSummary(plan.scenes)}</span>
    </p>
  );
}

function Body({ data, readOnly, actions }: { data: VideoPlanData; readOnly: boolean; actions: VideoPlanActions }) {
  const plan = data.plan;
  const archived = plan?.archivedAt != null;
  const locked = readOnly || !data.canWrite || archived;
  return (
    <>
      <div className={`${styles.notice} ${vp.vpBanner}`} role="note">
        <p className={f.keep}>
          <strong>{VP_LABELS.scopePrefix}</strong> {VP_COPY.scopeNotice}
        </p>
      </div>
      {readOnly ? (
        <Note text={P3_COMMON_COPY.projectReadOnly} />
      ) : !data.canWrite ? (
        <Note text={VP_COPY.noPermission} />
      ) : (
        archived && <Note text={VP_COPY.archivedNote} />
      )}

      {!plan ? (
        <div className={`${styles.emptyState} ${vp.vpEmpty}`}>
          <EmptyBriefArt className={vp.vpEmptyArt} />
          <strong>{VP_COPY.emptyTitle}</strong>
          {!locked &&
            (data.canCreate ? (
              <>
                <p className={`${styles.muted} ${f.keep}`}>{VP_COPY.emptyDesc}</p>
                <BriefActionButton action={actions.create} hidden={{}} submitLabel={VP_COPY.create} pendingLabel={P3_COMMON_COPY.savePending} variant="primary" />
              </>
            ) : (
              data.createBlockedReason && (
                <p className={`${styles.muted} ${f.keep}`} role="note">
                  {data.createBlockedReason}
                </p>
              )
            ))}
        </div>
      ) : (
        <>
          {plan.stale && !archived && (
            <div className={`${styles.notice} ${f.warnBox}`} role="note">
              <p className={f.keep}>
                <strong>{VP_LABELS.stalePrefix}</strong> {VP_COPY.staleBanner}
              </p>
              {!locked && <BriefActionButton action={actions.rebase} hidden={{ planId: plan.id, revision: plan.revision }} submitLabel={VP_COPY.rebase} pendingLabel={P3_COMMON_COPY.rebasePending} />}
            </div>
          )}
          {locked ? <ReadOnlyPlan plan={plan} assets={data.assets} /> : <VideoPlanEditor key={plan.revision} plan={plan} assets={data.assets} action={actions.save} />}
          <Files plan={plan} locked={locked} actions={actions} />
          {!locked && (
            <details className={`${f.inlineDetails} ${vp.vpDanger}`}>
              <summary>{VP_COPY.archive}</summary>
              <BriefActionButton action={actions.archive} hidden={{ planId: plan.id, revision: plan.revision }} submitLabel={VP_COPY.archive} pendingLabel={P3_COMMON_COPY.archivePending}>
                <p className={`${styles.muted} ${f.keep}`}>{P3_COMMON_COPY.archiveConfirm}</p>
              </BriefActionButton>
            </details>
          )}
        </>
      )}
    </>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div className={`${styles.notice} ${vp.vpBanner}`} role="note">
      <p className={f.keep}>{text}</p>
    </div>
  );
}

function Files({ plan, locked, actions }: { plan: VideoPlanView; locked: boolean; actions: VideoPlanActions }) {
  const L = VIDEO_PLAN_LIMITS;
  const list = [...plan.files].sort((a, b) => b.version - a.version);
  const full = plan.files.length >= L.fileVersionsMax;
  return (
    <section className={vp.vpFiles} aria-labelledby="video-plan-files">
      <h3 id="video-plan-files" className={vp.vpSubhead}>{`${VP_LABELS.filesHeading} (${plan.files.length} / ${L.fileVersionsMax}버전)`}</h3>
      <p className={`${styles.muted} ${f.keep}`}>{VP_LABELS.allowedFormats}</p>
      {!locked &&
        (full ? (
          <p className={styles.muted} role="note">
            {VP_COPY.fileLimitReached}
          </p>
        ) : (
          <BriefActionButton action={actions.attach} hidden={{ planId: plan.id, revision: plan.revision }} submitLabel={VP_COPY.attachFile} pendingLabel={P3_COMMON_COPY.savePending} />
        ))}
      {!locked && list.length > 1 && <p className={`${styles.muted} ${f.keep}`}>{P3_COMMON_COPY.restoreHint}</p>}
      {list.length > 0 && (
        <ol className={vp.vpFileList}>
          {list.map((v) => (
            <li key={v.version} className={`${vp.vpFile} ${v.current ? vp.vpFileCurrent : ""}`}>
              <div>
                <p className={vp.vpFileName}>{`v${v.version}${v.current ? ` ${VP_LABELS.currentMark}` : ""} · ${v.fileName}`}</p>
                <p className={`${styles.muted} ${f.keep}`}>{`${formatBytes(v.fileSizeBytes)} · ${formatKstMinute(v.savedAt)}${v.note ? ` · ${v.note}` : ""}`}</p>
              </div>
              {v.current ? (
                <span className={f.tag}>{VP_LABELS.currentVersion}</span>
              ) : locked ? null : (
                <BriefActionButton action={actions.restore} hidden={{ planId: plan.id, revision: plan.revision, version: v.version }} submitLabel={VP_COPY.restore} pendingLabel={P3_COMMON_COPY.savePending} />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** 읽기 전용: 폼 없이 구성안 내용만(글은 React 글자로만) */
function ReadOnlyPlan({ plan, assets }: { plan: VideoPlanView; assets: Array<{ id: string; label: string }> }) {
  const assetLabel = (id: string) => assets.find((a) => a.id === id)?.label ?? "목록에 없는 자산";
  return (
    <div className={vp.vpReadOnly}>
      <dl className={vp.vpView}>
        <div className={vp.vpViewRow}>
          <dt>{VP_LABELS.title}</dt>
          <dd>{plan.title}</dd>
        </div>
        <div className={vp.vpViewRow}>
          <dt>{VP_LABELS.aspect}</dt>
          <dd>{VIDEO_ASPECTS[plan.aspectRatio] ?? plan.aspectRatio}</dd>
        </div>
      </dl>
      <h3 className={vp.vpSubhead}>{`${VP_LABELS.scenesHeading} (${plan.scenes.length} / ${VIDEO_PLAN_LIMITS.scenesMax}장면)`}</h3>
      <ol className={vp.vpScenes}>
        {sortedScenes(plan.scenes).map((s, i) => (
          <li key={s.id ?? i} className={vp.vpScene}>
            <h4 className={vp.vpSceneTitle}>{`장면 ${i + 1} · ${s.sceneTitle} · ${formatDuration(s.durationSec)}`}</h4>
            <dl className={vp.vpView}>
              <div className={vp.vpViewRow}>
                <dt>{VP_LABELS.narration}</dt>
                <dd className={s.narration ? vp.vpViewText : styles.muted}>{s.narration || "적지 않음"}</dd>
              </div>
              <div className={vp.vpViewRow}>
                <dt>{VP_LABELS.subtitle}</dt>
                <dd className={s.subtitle ? vp.vpViewText : styles.muted}>{s.subtitle || "적지 않음"}</dd>
              </div>
              <div className={vp.vpViewRow}>
                <dt>{VP_LABELS.assets}</dt>
                <dd>{s.assetIds.length ? s.assetIds.map(assetLabel).join(", ") : <span className={styles.muted}>연결 안 함</span>}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </div>
  );
}
