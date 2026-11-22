import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import {
  archiveDesignAssetAction,
  confirmDesignCreateAction,
  confirmDesignReplaceAction,
  designDownloadUrlAction,
  prepareDesignUploadAction,
  rebaseDesignAssetAction,
  restoreDesignAssetAction,
  setDesignAssetUsagesAction,
  updateDesignAssetAction,
} from "@/features/design-assets/actions";
import { getDesignAssetFileUrl, getDesignAssetTextPreview, getDesignAssetsFor } from "@/features/design-assets/server";
import { getProductionBriefsFor } from "@/features/production-brief/server";
import { getProject } from "@/features/projects/server";
import type { TaskDetail } from "@/features/tasks/server";
import { BadgeStale, EmptyAssetsArt, P3AssetsIcon } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import da from "./design-assets.module.css";
import { DesignAssetList, type DesignAssetActions, type DesignPreviews } from "./design-assets-list";
import { DesignUploadPanel } from "./design-assets-upload";
import { DA_COPY, DA_LABELS, P3_COMMON_COPY, storageLevel, storageLimitReachedText, storageNearLimitText, storageOf, storageUsedText, type DesignAssetsData } from "./design-assets-model";

export type { DesignAssetActions };
export interface DesignAssetBoard {
  data: DesignAssetsData;
  previews: DesignPreviews;
}

const SERVER_ACTIONS: DesignAssetActions = {
  save: updateDesignAssetAction,
  archive: archiveDesignAssetAction,
  restore: restoreDesignAssetAction,
  rebase: rebaseDesignAssetAction,
  usages: setDesignAssetUsagesAction,
  download: designDownloadUrlAction,
  upload: { prepare: prepareDesignUploadAction, confirmCreate: confirmDesignCreateAction, confirmReplace: confirmDesignReplaceAction },
};

/** 지금 판 미리 보기: 그림은 300초 서명 주소(<img> 로만), 색상·토큰은 글자. 실패하면 미리 보기 없이 둔다 */
async function previewsFor(d: DesignAssetsData): Promise<DesignPreviews> {
  const out: DesignPreviews = {};
  await Promise.all(
    d.assets.map(async (a) => {
      if (a.mimeType.startsWith("image/")) {
        const r = await getDesignAssetFileUrl(a.id, a.version, "preview");
        if (r.ok) out[a.id] = { url: r.data.url };
      } else if (a.kind === "color") {
        const r = await getDesignAssetTextPreview(a.id, a.version);
        if (r.ok) out[a.id] = { text: r.data.text };
      }
    }),
  );
  return out;
}

/**
 * P3C-UI-CONNECT-01 디자인 자산 영역. 전략 작업 상세에서 홈페이지 구조·문구(#web-copy) 아래.
 * 서버: src/features/design-assets(P3C-BACKEND-IMPL-01). 포함 산출물에 디자인 자산이 있는 제작 브리프마다 블록 하나
 * (보관한 브리프는 자산이 남아 있을 때만). 불러오지 못하면 영역 안에서 알리고 다시 불러오기를 준다.
 */
export async function DesignAssetArea({ detail }: { detail: TaskDetail }) {
  let boards: DesignAssetBoard[] | null = null;
  let projectArchived = false;
  try {
    const [r, project] = await Promise.all([getProductionBriefsFor(detail.project.id), getProject(detail.project.id)]);
    projectArchived = project?.status === "archived";
    if (!r.ok) console.error("[design-assets]", r.code, r.message);
    else {
      const briefs = [...r.data.briefs.filter((b) => !b.archived), ...r.data.briefs.filter((b) => b.archived)].filter((b) => b.deliverableTypes.includes("design_assets"));
      const results = await Promise.all(briefs.map((b) => getDesignAssetsFor(b.id)));
      const bad = results.find((x) => !x.ok);
      if (bad && !bad.ok) console.error("[design-assets]", bad.code, bad.message);
      else {
        const datas = results.flatMap((x) => (x.ok && (x.data.assets.length > 0 || !x.data.brief.archived) ? [x.data] : []));
        boards = await Promise.all(datas.map(async (d) => ({ data: d, previews: await previewsFor(d) })));
      }
    }
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과
    console.error("[design-assets]", e);
  }
  return <DesignAssetSection boards={boards} readOnly={projectArchived || detail.task.status === "cancelled"} taskId={detail.task.id} actions={SERVER_ACTIONS} />;
}

/**
 * 화면 본문(동기, 시험에서 가짜 보드로 그린다). 시안 assets.html 상태:
 * 작성 중 · 검토 완료 · 이전 기준 · 보관 · 읽기 전용 · 빈 상태 · 업로드·확정 + 한도(50/50) · 권한 없음(서버 이유) · 불러오기 실패(boards = null).
 */
export function DesignAssetSection({ boards, readOnly, taskId, actions = {} }: { boards: DesignAssetBoard[] | null; readOnly: boolean; taskId: string; actions?: DesignAssetActions }) {
  return (
    <section className={`${styles.section} ${f.funnel} ${da.daSection}`} aria-labelledby="design-assets">
      <div className={da.daHead}>
        <h2 id="design-assets" className={`${styles.subtitle} ${da.daTitle}`}>
          <P3AssetsIcon className={da.daIcon} />
          {DA_COPY.heading}
        </h2>
        <p className={`${styles.muted} ${f.keep}`}>{DA_COPY.intro}</p>
      </div>
      {boards === null ? (
        <>
          <p className={styles.error} role="alert">
            {DA_COPY.loadError}
          </p>
          <p>
            <Link href={`/tasks/${taskId}#design-assets`} className={`${styles.secondaryButton} ${f.touch}`}>
              {P3_COMMON_COPY.reload}
            </Link>
          </p>
        </>
      ) : (
        <>
          <div className={`${styles.notice} ${da.daBanner}`} role="note">
            <p className={f.keep}>{DA_COPY.fileRuleNotice}</p>
          </div>
          {readOnly && (
            <div className={`${styles.notice} ${da.daBanner}`} role="note">
              <p className={f.keep}>{P3_COMMON_COPY.projectReadOnly}</p>
            </div>
          )}
          {boards.length === 0 ? (
            <div className={`${styles.emptyState} ${da.daEmpty}`}>
              <EmptyAssetsArt className={da.daEmptyArt} />
              <strong>{DA_COPY.emptyTitle}</strong>
              <p className={`${styles.muted} ${f.keep}`} role="note">
                {readOnly ? P3_COMMON_COPY.projectReadOnly : "제작 브리프를 확정해야 디자인 자산을 올릴 수 있습니다."}
              </p>
            </div>
          ) : (
            boards.map((b) => <BriefBlock key={b.data.brief.id} board={b} readOnly={readOnly} actions={actions} />)
          )}
        </>
      )}
    </section>
  );
}

function BriefBlock({ board, readOnly, actions }: { board: DesignAssetBoard; readOnly: boolean; actions: DesignAssetActions }) {
  const { data, previews } = board;
  const locked = readOnly || !data.canWrite;
  const full = data.count >= data.limit;
  const headId = `design-assets-${data.brief.id}`;
  // 고칠 수 없는 이유: 화면 읽기 전용은 위에 한 번, 그 밖(올리기 꺼짐 등)은 서버 이유 그대로, 없으면 권한 없음
  const lockNote = readOnly ? null : !data.canWrite ? (data.readOnlyReason ?? DA_COPY.noPermission) : null;
  // 업무실 저장 용량(서버가 줄 때만, 막대 없이 실제 숫자 글 — Master O4 결정·AGY DESIGN-P3C-COPY-03)
  const storage = storageOf(data);
  const level = storageLevel(storage);
  const blocked = !locked && !data.canCreate && !full ? data.createBlockedReason : null;
  const canUpload = !locked && data.canCreate && level !== "full";
  return (
    <section className={da.daBrief} aria-labelledby={headId}>
      <h3 id={headId} className={da.daBriefTitle}>
        {`기준 제작 브리프: ${data.brief.title}`}
        <span className={styles.badge}>{`자산 ${data.count} / ${data.limit}개`}</span>
        {storage && <span className={f.tag}>{storageUsedText(storage.usedBytes, storage.limitBytes)}</span>}
        {data.stale && (
          <span className={`${f.tag} ${f.tag_warn} ${da.daTagIcon}`}>
            <BadgeStale />
            이전 기준
          </span>
        )}
      </h3>
      {lockNote && (
        <div className={`${styles.notice} ${da.daBanner}`} role="note">
          <p className={f.keep}>{lockNote}</p>
        </div>
      )}
      {data.stale && (
        // 맞추기는 자산마다(서버 rebaseDesignAsset 이 자산 단위) — 카드의 '최신 기준으로 맞추기'
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>
            <strong>{DA_LABELS.stalePrefix}</strong> {DA_COPY.staleBanner}
          </p>
        </div>
      )}
      {!locked && full && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>{DA_COPY.limitReached}</p>
        </div>
      )}
      {!locked && storage && level !== "ok" && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>{level === "full" ? storageLimitReachedText(storage.limitBytes) : storageNearLimitText(storage.limitBytes)}</p>
        </div>
      )}
      {blocked && (
        <p className={`${styles.muted} ${f.keep}`} role="note">
          {blocked}
        </p>
      )}

      {data.assets.length === 0 && (
        <div className={`${styles.emptyState} ${da.daEmpty}`}>
          <EmptyAssetsArt className={da.daEmptyArt} />
          <strong>{DA_COPY.emptyTitle}</strong>
          {canUpload && <p className={`${styles.muted} ${f.keep}`}>{DA_COPY.emptyDesc}</p>}
        </div>
      )}
      {/* 업로드 패널은 자산 수와 상관없이 늘 같은 자리(첫 자산을 올린 뒤에도 다시 만들어지지 않아 성공 안내가 남는다, Tester QA-P3C-E2E-01 O1) */}
      {canUpload && <DesignUploadPanel key={`upload-${data.brief.id}`} mode="create" briefId={data.brief.id} actions={actions.upload} />}
      {data.assets.length > 0 && <DesignAssetList data={data} locked={locked} previews={previews} actions={actions} />}
    </section>
  );
}
