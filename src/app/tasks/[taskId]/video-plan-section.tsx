import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getProductionBriefsFor } from "@/features/production-brief/server";
import { getProject } from "@/features/projects/server";
import type { TaskDetail } from "@/features/tasks/server";
import {
  archiveVideoPlanAction,
  cancelVideoUploadAction,
  createVideoPlanAction,
  finishVideoUploadAction,
  rebaseVideoPlanAction,
  restoreVideoFileVersionAction,
  restoreVideoPlanVersionAction,
  saveVideoPlanAction,
  startVideoUploadAction,
  videoDownloadUrlAction,
} from "@/features/video-plans/actions";
import { getVideoPlanFor } from "@/features/video-plans/server";
import { BadgeArchived, BadgeDrafting, BadgeReady, BadgeStale, EmptyBriefArt, P3VideoIcon } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import vp from "./video-plan.module.css";
import { BriefActionButton } from "./production-brief-buttons";
import type { BriefAction } from "./production-brief-edit-form";
import { VideoDownloadButton } from "./video-download-button";
import { VideoPlanEditor } from "./video-plan-editor";
import { VideoUploadPanel } from "./video-upload-panel";
import type { VideoUploadActions } from "./video-upload";
import {
  P3_COMMON_COPY,
  VIDEO_ASPECTS,
  VIDEO_PLAN_LIMITS,
  VIDEO_PLAN_STATUSES,
  VIDEO_PLAN_VERSION_KINDS,
  VP_COPY,
  VP_LABELS,
  archivedAssetsWarnText,
  durationSummary,
  formatBytes,
  formatDuration,
  formatKstMinute,
  sortedScenes,
  videoRebaseBlockedText,
  videoStaleNotices,
  type VideoPlanData,
  type VideoPlanView,
} from "./video-plan-model";

/** 서버 동작(actions.ts). 시험에서 넘기지 않으면 단추마다 '아직 서버와 연결되지 않아…' 안내 */
export interface VideoPlanActions {
  create?: BriefAction;
  save?: BriefAction;
  rebase?: BriefAction;
  archive?: BriefAction;
  restorePlan?: BriefAction;
  restoreFile?: BriefAction;
  upload?: VideoUploadActions;
  download?: (planId: string, version: number) => Promise<{ ok: true; data: { url: string } } | { ok: false; message: string }>;
}
export interface VideoPlanBoard {
  brief: { id: string; title: string };
  data: VideoPlanData;
}

const SERVER_ACTIONS: VideoPlanActions = {
  create: createVideoPlanAction,
  save: saveVideoPlanAction,
  rebase: rebaseVideoPlanAction,
  archive: archiveVideoPlanAction,
  restorePlan: restoreVideoPlanVersionAction,
  restoreFile: restoreVideoFileVersionAction,
  upload: { start: startVideoUploadAction, finish: finishVideoUploadAction, cancel: cancelVideoUploadAction },
  download: videoDownloadUrlAction,
};

/**
 * P3D-UI-CONNECT-01 영상 구성·파일 영역. 전략 작업 상세에서 디자인 자산(#design-assets) 아래.
 * 서버: src/features/video-plans(P3D-BACKEND-IMPL-01). 포함 산출물에 영상 구성이 있는 제작 브리프마다 블록 하나,
 * 블록은 대표 구성안(보관 안 된 것 중 최근에 고친 것) 1개를 그린다(AGY P3D-HANDOFF 1절).
 */
export async function VideoPlanArea({ detail }: { detail: TaskDetail }) {
  let boards: VideoPlanBoard[] | null = null;
  let projectArchived = false;
  try {
    const [r, project] = await Promise.all([getProductionBriefsFor(detail.project.id), getProject(detail.project.id)]);
    projectArchived = project?.status === "archived";
    if (!r.ok) console.error("[video-plan]", r.code, r.message);
    else {
      const briefs = [...r.data.briefs.filter((b) => !b.archived), ...r.data.briefs.filter((b) => b.archived)].filter((b) => b.deliverableTypes.includes("video_plan"));
      const results = await Promise.all(briefs.map((b) => getVideoPlanFor(b.id)));
      const bad = results.find((x) => !x.ok);
      if (bad && !bad.ok) console.error("[video-plan]", bad.code, bad.message);
      else
        boards = results.flatMap((x, i) => (x.ok && (x.data.plan !== null || !briefs[i].archived) ? [{ brief: { id: briefs[i].id, title: briefs[i].title }, data: x.data }] : []));
    }
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과
    console.error("[video-plan]", e);
  }
  return <VideoPlanSection boards={boards} readOnly={projectArchived || detail.task.status === "cancelled"} taskId={detail.task.id} actions={SERVER_ACTIONS} />;
}

/**
 * 화면 본문(동기, 시험에서 가짜 보드로 그린다). 시안 video-plan.html 상태:
 * 작성 중 · 검토 완료 · 이전 기준(원인별) · 보관 · 읽기 전용 · 빈 상태 + 자산 보관 경고 · 맞추기 막힘 · 구성안 한도 · 첨부 막힘 · 불러오기 실패.
 * 진행률 막대는 그리지 않는다 — 길이 합계·장면 수·실제 바이트만.
 */
export function VideoPlanSection({ boards, readOnly, taskId, actions = {} }: { boards: VideoPlanBoard[] | null; readOnly: boolean; taskId: string; actions?: VideoPlanActions }) {
  return (
    <section className={`${styles.section} ${f.funnel} ${vp.vpSection}`} aria-labelledby="video-plan">
      <div className={vp.vpHead}>
        <h2 id="video-plan" className={`${styles.subtitle} ${vp.vpTitle}`}>
          <P3VideoIcon className={vp.vpIcon} />
          {VP_COPY.heading}
        </h2>
        <p className={`${styles.muted} ${f.keep}`}>{VP_COPY.intro}</p>
      </div>
      {boards === null ? (
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
        <>
          <Note text={VP_COPY.scopeNotice} prefix={VP_LABELS.scopePrefix} />
          {readOnly && <Note text={P3_COMMON_COPY.projectReadOnly} />}
          {boards.length === 0 ? (
            <div className={`${styles.emptyState} ${vp.vpEmpty}`}>
              <EmptyBriefArt className={vp.vpEmptyArt} />
              <strong>{VP_COPY.emptyTitle}</strong>
              <p className={`${styles.muted} ${f.keep}`} role="note">
                {readOnly ? P3_COMMON_COPY.projectReadOnly : "제작 브리프를 확정해야 영상 구성안을 만들 수 있습니다."}
              </p>
            </div>
          ) : (
            boards.map((b) => <BriefBlock key={b.brief.id} board={b} readOnly={readOnly} actions={actions} />)
          )}
        </>
      )}
    </section>
  );
}

function Note({ text, prefix }: { text: string; prefix?: string }) {
  return (
    <div className={`${styles.notice} ${vp.vpBanner}`} role="note">
      <p className={f.keep}>
        {prefix && <strong>{prefix}</strong>} {text}
      </p>
    </div>
  );
}

/** 만들기 막힘: 구성안 한도면 AGY planLimitReached, 그 밖은 서버 글 */
const createBlockedText = (reason: string | null) => (reason && /제작 브리프당|활성/.test(reason) ? VP_COPY.planLimitReached : reason);
/** 첨부 막힘: 파일 판 20개면 AGY fileLimitReached, 그 밖은 서버 글 */
const attachBlockedText = (reason: string | null) => (reason && /20개|판이 \d+/.test(reason) && /파일/.test(reason) ? VP_COPY.fileLimitReached : reason);

const blankPlan = (): VideoPlanView => ({
  id: "",
  title: "",
  aspectRatio: "16:9",
  status: "drafting",
  archivedAt: null,
  revision: 0,
  stale: false,
  staleReasons: [],
  rebaseBlockedReason: null,
  archivedAssetCount: 0,
  totalSec: 10,
  scenes: [{ id: null, sceneTitle: "", durationSec: 10, narration: "", subtitle: "", assetIds: [], sortOrder: 1 }],
  files: [],
  planVersions: [],
});

function BriefBlock({ board, readOnly, actions }: { board: VideoPlanBoard; readOnly: boolean; actions: VideoPlanActions }) {
  const { data } = board;
  const plan = data.plan;
  const archived = plan?.archivedAt != null;
  const locked = readOnly || !data.canWrite;
  const headId = `video-plan-${board.brief.id}`;
  // 고칠 수 없는 이유: 프로젝트 읽기 전용은 위에 한 번, 구성안 보관은 VP_COPY.archivedNote, 그 밖은 서버 이유(없으면 권한 없음)
  const lockNote = readOnly || !plan ? null : archived ? VP_COPY.archivedNote : !data.canWrite ? (data.readOnlyReason ?? VP_COPY.noPermission) : null;
  const staleNotes = plan ? videoStaleNotices(plan) : [];
  const blocked = plan?.stale ? videoRebaseBlockedText(plan.rebaseBlockedReason) : null;
  const canCreate = !readOnly && data.canCreate;
  const create = canCreate && (
    <details className={`${f.inlineDetails} ${vp.vpCreate}`} open={!plan}>
      <summary>{VP_COPY.create}</summary>
      <VideoPlanEditor plan={blankPlan()} assets={data.assets} action={actions.create} hidden={{ productionBriefId: board.brief.id }} />
    </details>
  );
  return (
    <section className={vp.vpBrief} aria-labelledby={headId}>
      <h3 id={headId} className={vp.vpBriefTitle}>{`기준 제작 브리프: ${board.brief.title}`}</h3>
      {plan && <Badges plan={plan} active={data.activePlanCount} />}
      {lockNote && <Note text={lockNote} />}
      {plan && staleNotes.length > 0 && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          {staleNotes.map((t) => (
            <p key={t} className={f.keep}>
              <strong>{VP_LABELS.stalePrefix}</strong> {t}
            </p>
          ))}
          {!locked && !blocked && <BriefActionButton action={actions.rebase} hidden={{ planId: plan.id, revision: plan.revision }} submitLabel={VP_COPY.rebase} pendingLabel={P3_COMMON_COPY.rebasePending} />}
          {!locked && blocked && <p className={f.keep}>{blocked}</p>}
        </div>
      )}
      {plan && !archived && plan.archivedAssetCount > 0 && <Note text={archivedAssetsWarnText(plan.archivedAssetCount)} />}

      {!plan ? (
        <div className={`${styles.emptyState} ${vp.vpEmpty}`}>
          <EmptyBriefArt className={vp.vpEmptyArt} />
          <strong>{VP_COPY.emptyTitle}</strong>
          {canCreate ? (
            <p className={`${styles.muted} ${f.keep}`}>{VP_COPY.emptyDesc}</p>
          ) : (
            !readOnly &&
            data.createBlockedReason && (
              <p className={`${styles.muted} ${f.keep}`} role="note">
                {createBlockedText(data.createBlockedReason)}
              </p>
            )
          )}
        </div>
      ) : locked ? (
        <ReadOnlyPlan plan={plan} assets={data.assets} />
      ) : (
        <VideoPlanEditor key={plan.revision} plan={plan} assets={data.assets} action={actions.save} />
      )}
      {create}

      {plan && <PlanVersions plan={plan} locked={locked} restore={actions.restorePlan} />}
      {plan && <Files plan={plan} data={data} locked={locked} actions={actions} />}
      {plan && !locked && (
        <details className={`${f.inlineDetails} ${vp.vpDanger}`}>
          <summary>{VP_COPY.archive}</summary>
          <BriefActionButton action={actions.archive} hidden={{ planId: plan.id, revision: plan.revision }} submitLabel={VP_COPY.archive} pendingLabel={P3_COMMON_COPY.archivePending}>
            <p className={`${styles.muted} ${f.keep}`}>{P3_COMMON_COPY.archiveConfirm}</p>
          </BriefActionButton>
        </details>
      )}
      {plan && !readOnly && !canCreate && createBlockedText(data.createBlockedReason) === VP_COPY.planLimitReached && (
        <p className={`${styles.muted} ${f.keep}`} role="note">
          {VP_COPY.planLimitReached}
        </p>
      )}
    </section>
  );
}

function Badges({ plan, active }: { plan: VideoPlanView; active: number }) {
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
      {plan.stale && !plan.archivedAt && (
        <span className={`${f.tag} ${f.tag_warn} ${vp.vpTagIcon}`}>
          <BadgeStale />
          {VP_LABELS.staleBadge}
        </span>
      )}
      <span className={f.tag}>{durationSummary(plan.scenes)}</span>
      <span className={f.tag}>{VP_LABELS.representative(active)}</span>
    </p>
  );
}

/** 구성안 판 이력(최신 위). 빼기로 사라진 장면은 옛 판 되돌리기로만 원래 id 로 돌아온다 */
function PlanVersions({ plan, locked, restore }: { plan: VideoPlanView; locked: boolean; restore?: BriefAction }) {
  const list = [...plan.planVersions].sort((a, b) => b.version - a.version);
  if (list.length === 0) return null;
  const headId = `video-plan-versions-${plan.id}`;
  return (
    <section className={vp.vpFiles} aria-labelledby={headId}>
      <h4 id={headId} className={vp.vpSubhead}>
        {VP_LABELS.planVersionsHeading}
      </h4>
      {!locked && <p className={`${styles.muted} ${f.keep}`}>{VP_LABELS.planVersionsHint}</p>}
      <ol className={vp.vpFileList}>
        {list.map((v) => (
          <li key={v.version} className={`${vp.vpFile} ${v.current ? vp.vpFileCurrent : ""}`}>
            <div>
              <p className={vp.vpFileName}>{`v${v.version}${v.current ? ` ${VP_LABELS.currentMark}` : ""} · ${VIDEO_PLAN_VERSION_KINDS[v.kind]}${v.restoredFromVersion ? ` (v${v.restoredFromVersion}에서)` : ""}`}</p>
              <p className={`${styles.muted} ${f.keep}`}>{`${formatKstMinute(v.savedAt)} · 총 ${formatDuration(v.totalSec)} · ${v.sceneCount}장면`}</p>
            </div>
            {v.current ? (
              <span className={f.tag}>{VP_LABELS.currentPlanVersion}</span>
            ) : locked ? null : (
              <BriefActionButton action={restore} hidden={{ planId: plan.id, revision: plan.revision, versionNo: v.version }} submitLabel={VP_LABELS.restorePlanVersion} pendingLabel={P3_COMMON_COPY.savePending} />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Files({ plan, data, locked, actions }: { plan: VideoPlanView; data: VideoPlanData; locked: boolean; actions: VideoPlanActions }) {
  const L = VIDEO_PLAN_LIMITS;
  const list = [...plan.files].sort((a, b) => b.version - a.version);
  const headId = `video-plan-files-${plan.id}`;
  const attachNote = !locked && !data.canAttach ? attachBlockedText(data.attachBlockedReason) : null;
  return (
    <section className={vp.vpFiles} aria-labelledby={headId}>
      <h4 id={headId} className={vp.vpSubhead}>{`${VP_LABELS.filesHeading} (${plan.files.length} / ${L.fileVersionsMax}버전)`}</h4>
      <p className={`${styles.muted} ${f.keep}`}>{VP_LABELS.allowedFormats(L.maxFileBytes)}</p>
      {!locked && data.canAttach && <VideoUploadPanel key={`up-${plan.id}`} planId={plan.id} revision={plan.revision} limitBytes={L.maxFileBytes} actions={actions.upload} />}
      {attachNote && (
        <p className={`${styles.muted} ${f.keep}`} role="note">
          {attachNote}
        </p>
      )}
      {!locked && list.length > 1 && <p className={`${styles.muted} ${f.keep}`}>{P3_COMMON_COPY.restoreHint}</p>}
      {list.length > 0 && (
        <ol className={vp.vpFileList}>
          {list.map((v) => (
            <li key={v.version} className={`${vp.vpFile} ${v.current ? vp.vpFileCurrent : ""}`}>
              <div>
                <p className={vp.vpFileName}>{`v${v.version}${v.current ? ` ${VP_LABELS.currentMark}` : ""} · ${v.fileName}`}</p>
                <p className={`${styles.muted} ${f.keep}`}>{`${formatBytes(v.fileSizeBytes)} · ${formatKstMinute(v.savedAt)}${v.note ? ` · ${v.note}` : ""}${v.restoredFromVersion ? ` · v${v.restoredFromVersion}에서 되돌림` : ""}`}</p>
              </div>
              <div className={vp.vpFileTools}>
                <VideoDownloadButton planId={plan.id} version={v.version} action={actions.download} />
                {v.current ? (
                  <span className={f.tag}>{VP_LABELS.currentVersion}</span>
                ) : locked ? null : (
                  <BriefActionButton action={actions.restoreFile} hidden={{ planId: plan.id, revision: plan.revision, version: v.version }} submitLabel={VP_COPY.restore} pendingLabel={P3_COMMON_COPY.savePending} />
                )}
              </div>
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
      <h4 className={vp.vpSubhead}>{`${VP_LABELS.scenesHeading} (${plan.scenes.length} / ${VIDEO_PLAN_LIMITS.scenesMax}장면)`}</h4>
      <ol className={vp.vpScenes}>
        {sortedScenes(plan.scenes).map((s, i) => (
          <li key={s.id ?? i} className={vp.vpScene}>
            <h5 className={vp.vpSceneTitle}>{`장면 ${i + 1} · ${s.sceneTitle} · ${formatDuration(s.durationSec)}`}</h5>
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
