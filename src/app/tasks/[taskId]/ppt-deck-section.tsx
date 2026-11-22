import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { DEFAULT_PPT_SLIDES } from "@/domain/ppt-decks";
import { archivePptDeckAction, createPptDeckAction, rebasePptDeckAction, restorePptDeckVersionAction, savePptDeckAction } from "@/features/ppt-decks/actions";
import { getPptDeckFor } from "@/features/ppt-decks/server";
import { getProductionBriefsFor } from "@/features/production-brief/server";
import { getProject } from "@/features/projects/server";
import type { TaskDetail } from "@/features/tasks/server";
import { BadgeArchived, BadgeDrafting, BadgeReady, BadgeStale, EmptyBriefArt, P3PptIcon } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import { fixRequestedIdsFor } from "./qa-fix-flags";
import { QaFixTag } from "./qa-fix-tag";
import f from "./funnel.module.css";
import pp from "./ppt-deck.module.css";
import { BriefActionButton } from "./production-brief-buttons";
import type { BriefAction } from "./production-brief-edit-form";
import { PptDeckEditor } from "./ppt-deck-editor";
import {
  PPT_COPY,
  PPT_DECK_LIMITS,
  PPT_DECK_STATUSES,
  PPT_LABELS,
  PPT_TEMPLATES,
  PPT_VERSION_KINDS,
  P3_COMMON_COPY,
  formatKstMinute,
  pptCreateBlockedText,
  pptExportHref,
  pptRebaseBlockedText,
  pptStaleNotices,
  slideCountText,
  sortedSlides,
  type PptDeckData,
  type PptDeckView,
} from "./ppt-deck-model";

/** 서버 동작(actions.ts). 시험에서 넘기지 않으면 단추마다 '아직 서버와 연결되지 않아…' 안내 */
export interface PptDeckActions {
  create?: BriefAction;
  save?: BriefAction;
  rebase?: BriefAction;
  archive?: BriefAction;
  restore?: BriefAction;
}
export interface PptDeckBoard {
  brief: { id: string; title: string };
  data: PptDeckData;
}

const SERVER_ACTIONS: PptDeckActions = {
  create: createPptDeckAction,
  save: savePptDeckAction,
  rebase: rebasePptDeckAction,
  archive: archivePptDeckAction,
  restore: restorePptDeckVersionAction,
};

/**
 * P3E-UI-CONNECT-01 PPT 구성·템플릿·내보내기 영역. 전략 작업 상세에서 영상 구성(#video-plan) 아래.
 * 서버: src/features/ppt-decks(P3E-BACKEND-IMPL-01). 포함 산출물에 PPT 가 있는 제작 브리프마다 블록 하나,
 * 블록은 대표 구성안(보관 안 된 것 중 최근에 고친 것) 1개를 그린다(AGY P3E-HANDOFF 1절).
 */
export async function PptDeckArea({ detail }: { detail: TaskDetail }) {
  let boards: PptDeckBoard[] | null = null;
  let projectArchived = false;
  try {
    const [r, project] = await Promise.all([getProductionBriefsFor(detail.project.id), getProject(detail.project.id)]);
    projectArchived = project?.status === "archived";
    if (!r.ok) console.error("[ppt-deck]", r.code, r.message);
    else {
      const briefs = [...r.data.briefs.filter((b) => !b.archived), ...r.data.briefs.filter((b) => b.archived)].filter((b) => b.deliverableTypes.includes("ppt_deck"));
      const results = await Promise.all(briefs.map((b) => getPptDeckFor(b.id)));
      const bad = results.find((x) => !x.ok);
      if (bad && !bad.ok) console.error("[ppt-deck]", bad.code, bad.message);
      else boards = results.flatMap((x, i) => (x.ok && (x.data.deck !== null || !briefs[i].archived) ? [{ brief: { id: briefs[i].id, title: briefs[i].title }, data: x.data }] : []));
    }
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과
    console.error("[ppt-deck]", e);
  }
  // P3FG-UI-CONNECT-01-R1: 검수에서 보완 요청된 산출물 배지(기존 검수 읽기로 계산, 실패하면 배지만 빠짐)
  const fixRequestedIds = await fixRequestedIdsFor(detail.project.id);
  return <PptDeckSection boards={boards} readOnly={projectArchived || detail.task.status === "cancelled"} taskId={detail.task.id} actions={SERVER_ACTIONS} fixRequestedIds={fixRequestedIds} />;
}

/**
 * 화면 본문(동기, 시험에서 가짜 보드로 그린다). 시안 ppt-deck.html 상태:
 * 작성 중 · 검토 완료 · 이전 기준(원인별) · 보관 · 읽기 전용 · 빈 상태 + 자산 보관 경고 · 맞추기 막힘 · 판 20 · 구성안 한도 · 불러오기 실패.
 * 진행률 막대는 그리지 않는다 — 슬라이드 수·판 수만. 보관·읽기 전용에서도 내보내기 링크는 보인다(P3E-HANDOFF 3절 2).
 */
export function PptDeckSection({ boards, readOnly, taskId, actions = {}, fixRequestedIds = [] }: { boards: PptDeckBoard[] | null; readOnly: boolean; taskId: string; actions?: PptDeckActions; fixRequestedIds?: readonly string[] }) {
  return (
    <section className={`${styles.section} ${f.funnel} ${pp.ppSection}`} aria-labelledby="ppt-deck">
      <div className={pp.ppHead}>
        <h2 id="ppt-deck" className={`${styles.subtitle} ${pp.ppTitle}`}>
          <P3PptIcon className={pp.ppIcon} />
          {PPT_COPY.heading}
        </h2>
        <p className={`${styles.muted} ${f.keep}`}>{PPT_COPY.intro}</p>
      </div>
      {boards === null ? (
        <>
          <p className={styles.error} role="alert">
            {PPT_COPY.loadError}
          </p>
          <p>
            <Link href={`/tasks/${taskId}#ppt-deck`} className={`${styles.secondaryButton} ${f.touch}`}>
              {P3_COMMON_COPY.reload}
            </Link>
          </p>
        </>
      ) : (
        <>
          {readOnly && <Note text={P3_COMMON_COPY.projectReadOnly} />}
          {boards.length === 0 ? (
            <div className={`${styles.emptyState} ${pp.ppEmpty}`}>
              <EmptyBriefArt className={pp.ppEmptyArt} />
              <strong>{PPT_COPY.emptyTitle}</strong>
              <p className={`${styles.muted} ${f.keep}`} role="note">
                {readOnly ? P3_COMMON_COPY.projectReadOnly : "제작 브리프를 확정해야 PPT 구성안을 만들 수 있습니다."}
              </p>
            </div>
          ) : (
            boards.map((b) => <BriefBlock key={b.brief.id} board={b} readOnly={readOnly} actions={actions} fixRequestedIds={fixRequestedIds} />)
          )}
        </>
      )}
    </section>
  );
}

function Note({ text, prefix }: { text: string; prefix?: string }) {
  return (
    <div className={`${styles.notice} ${pp.ppBanner}`} role="note">
      <p className={f.keep}>
        {prefix && <strong>{prefix}</strong>} {text}
      </p>
    </div>
  );
}

/** 만들기 기본 뼈대: 서버 DEFAULT_PPT_SLIDES 3장(AGY P3E-TEMPLATES 2절), 표지 제목은 브리프 제목(Backend 5절) */
function blankDeck(briefTitle: string): PptDeckView {
  return {
    id: "",
    title: briefTitle,
    templateKey: "royal_grid",
    status: "drafting",
    archivedAt: null,
    revision: 0,
    versionNo: 0,
    stale: false,
    staleReasons: [],
    staleAssetCount: 0,
    archivedAssetCount: 0,
    rebaseBlockedReason: null,
    versionLimitReached: false,
    slides: DEFAULT_PPT_SLIDES.map((s, i) => ({
      id: null,
      slideTitle: i === 0 && briefTitle ? briefTitle : s.title,
      bulletPoints: s.bullets,
      speakerNotes: s.notes,
      assetIds: [],
      sortOrder: i + 1,
    })),
    deckVersions: [],
  };
}

function BriefBlock({ board, readOnly, actions, fixRequestedIds = [] }: { board: PptDeckBoard; readOnly: boolean; actions: PptDeckActions; fixRequestedIds?: readonly string[] }) {
  const { data } = board;
  const deck = data.deck;
  const archived = deck?.archivedAt != null;
  const locked = readOnly || !data.canWrite;
  // 판 20개면 저장·되돌리기·맞추기가 서버에서 거절된다 → 편집기 대신 읽기 화면 + 안내(보관은 됨)
  const full = !locked && deck?.versionLimitReached === true;
  const headId = `ppt-deck-${board.brief.id}`;
  // 고칠 수 없는 이유: 프로젝트 읽기 전용은 위에 한 번, 구성안 보관은 PPT_COPY.archivedNote, 그 밖은 서버 이유(없으면 권한 없음)
  const lockNote = readOnly || !deck ? null : archived ? PPT_COPY.archivedNote : !data.canWrite ? (data.readOnlyReason ?? PPT_COPY.noPermission) : null;
  const staleNotes = deck ? pptStaleNotices(deck) : [];
  const blocked = deck?.stale ? pptRebaseBlockedText(deck.rebaseBlockedReason) : null;
  const canCreate = !readOnly && data.canCreate;
  const create = canCreate && (
    <details className={`${f.inlineDetails} ${pp.ppCreate}`} open={!deck}>
      <summary>{PPT_COPY.create}</summary>
      <PptDeckEditor deck={blankDeck(data.briefTitle)} assets={data.assets} action={actions.create} hidden={{ productionBriefId: board.brief.id }} />
    </details>
  );
  return (
    <section className={pp.ppBrief} aria-labelledby={headId}>
      <h3 id={headId} className={pp.ppBriefTitle}>{`기준 제작 브리프: ${board.brief.title}`}</h3>
      {deck && <Badges deck={deck} active={data.activeDeckCount} fixRequested={fixRequestedIds.includes(deck.id)} />}
      {lockNote && <Note text={lockNote} />}
      {full && (
        // 시안 version-full-banner 는 경고 상자(banner-warning)
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>
            <strong>{PPT_LABELS.versionLimitPrefix}</strong> {PPT_COPY.versionLimitReached}
          </p>
        </div>
      )}
      {deck && staleNotes.length > 0 && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          {staleNotes.map((t) => (
            <p key={t} className={f.keep}>
              <strong>{PPT_LABELS.stalePrefix}</strong> {t}
            </p>
          ))}
          {!locked && !blocked && <BriefActionButton action={actions.rebase} hidden={{ deckId: deck.id, revision: deck.revision }} submitLabel={PPT_COPY.rebase} pendingLabel={P3_COMMON_COPY.rebasePending} />}
          {!locked && blocked && <p className={f.keep}>{blocked}</p>}
        </div>
      )}
      {deck && !archived && deck.archivedAssetCount > 0 && <Note text={PPT_COPY.archivedAssetsWarn(deck.archivedAssetCount)} />}

      {!deck ? (
        <div className={`${styles.emptyState} ${pp.ppEmpty}`}>
          <EmptyBriefArt className={pp.ppEmptyArt} />
          <strong>{PPT_COPY.emptyTitle}</strong>
          {canCreate ? (
            <p className={`${styles.muted} ${f.keep}`}>{PPT_COPY.emptyDesc}</p>
          ) : (
            !readOnly &&
            data.createBlockedReason && (
              <p className={`${styles.muted} ${f.keep}`} role="note">
                {pptCreateBlockedText(data.createBlockedCode, data.createBlockedReason)}
              </p>
            )
          )}
        </div>
      ) : locked || full ? (
        <ReadOnlyDeck deck={deck} assets={data.assets} />
      ) : (
        <PptDeckEditor key={deck.revision} deck={deck} assets={data.assets} action={actions.save} />
      )}
      {create}

      {deck && data.canExport && <Exports deck={deck} />}
      {deck && <DeckVersions deck={deck} locked={locked || full} restore={actions.restore} />}
      {deck && !locked && (
        <details className={`${f.inlineDetails} ${pp.ppDanger}`}>
          <summary>{PPT_COPY.archive}</summary>
          <BriefActionButton action={actions.archive} hidden={{ deckId: deck.id, revision: deck.revision }} submitLabel={PPT_COPY.archive} pendingLabel={P3_COMMON_COPY.archivePending}>
            <p className={`${styles.muted} ${f.keep}`}>{P3_COMMON_COPY.archiveConfirm}</p>
          </BriefActionButton>
        </details>
      )}
      {deck && !readOnly && !canCreate && data.createBlockedCode === "deck_limit" && (
        <p className={`${styles.muted} ${f.keep}`} role="note">
          {PPT_COPY.planLimitReached}
        </p>
      )}
    </section>
  );
}

function Badges({ deck, active, fixRequested = false }: { deck: PptDeckView; active: number; fixRequested?: boolean }) {
  const Icon = deck.status === "reviewed" ? BadgeReady : BadgeDrafting;
  return (
    <p className={pp.ppBadges}>
      <span className={`${pp.ppBadge} ${pp[`ppBadge_${deck.status}`]}`}>
        <Icon />
        {PPT_DECK_STATUSES[deck.status]}
      </span>
      {deck.archivedAt && (
        <span className={`${pp.ppBadge} ${pp.ppBadge_archived}`}>
          <BadgeArchived />
          {PPT_LABELS.archivedBadge}
        </span>
      )}
      {deck.stale && !deck.archivedAt && (
        <span className={`${f.tag} ${f.tag_warn} ${pp.ppTagIcon}`}>
          <BadgeStale />
          {PPT_LABELS.staleBadge}
        </span>
      )}
      <span className={f.tag}>{slideCountText(deck.slides.length)}</span>
      <span className={f.tag}>{PPT_LABELS.representative(active)}</span>
      <QaFixTag show={fixRequested} />
    </p>
  );
}

/** 내보내기: 경로 처리기 링크(현재 판). 보관·읽기 전용에서도 보인다 */
function Exports({ deck }: { deck: PptDeckView }) {
  const headId = `ppt-deck-export-${deck.id}`;
  return (
    <section className={pp.ppExport} aria-labelledby={headId}>
      <h4 id={headId} className={pp.ppSubhead}>
        {PPT_LABELS.exportHeading}
      </h4>
      <p className={`${styles.muted} ${f.keep}`}>{PPT_COPY.exportNotice}</p>
      <div className={pp.ppExportButtons}>
        <a href={pptExportHref(deck.id, "pptx")} className={`${styles.button} ${f.touch}`} download>
          {PPT_COPY.exportPptx}
        </a>
        <a href={pptExportHref(deck.id, "md")} className={`${styles.secondaryButton} ${f.touch}`} download>
          {PPT_COPY.exportMd}
        </a>
      </div>
    </section>
  );
}

/** 구성안 판 이력(최신 위). 빼기로 사라진 슬라이드는 옛 판 되돌리기로만 원래 id 로 돌아온다. 옛 판도 그 판 그대로 내보낼 수 있다 */
function DeckVersions({ deck, locked, restore }: { deck: PptDeckView; locked: boolean; restore?: BriefAction }) {
  const list = [...deck.deckVersions].sort((a, b) => b.version - a.version);
  if (list.length === 0) return null;
  const headId = `ppt-deck-versions-${deck.id}`;
  return (
    <section className={pp.ppVersions} aria-labelledby={headId}>
      <h4 id={headId} className={pp.ppSubhead}>
        {PPT_LABELS.versionsHeading(list.length)}
      </h4>
      {!locked && <p className={`${styles.muted} ${f.keep}`}>{PPT_LABELS.versionsHint}</p>}
      <ol className={pp.ppVersionList}>
        {list.map((v) => (
          <li key={v.version} className={`${pp.ppVersion} ${v.current ? pp.ppVersionCurrent : ""}`}>
            <div>
              <p className={pp.ppVersionName}>{`v${v.version}${v.current ? ` ${PPT_LABELS.currentMark}` : ""} · ${PPT_VERSION_KINDS[v.kind]}${v.restoredFromVersion ? ` (v${v.restoredFromVersion}에서)` : ""}`}</p>
              <p className={`${styles.muted} ${f.keep}`}>{`${formatKstMinute(v.savedAt)} · ${PPT_DECK_STATUSES[v.status]} · ${v.slideCount}장`}</p>
            </div>
            <div className={pp.ppVersionTools}>
              {!v.current && (
                <>
                  <a href={pptExportHref(deck.id, "pptx", v.version)} className={`${styles.secondaryButton} ${f.touch}`} download aria-label={`v${v.version} ${PPT_COPY.exportPptx}`}>
                    .pptx
                  </a>
                  <a href={pptExportHref(deck.id, "md", v.version)} className={`${styles.secondaryButton} ${f.touch}`} download aria-label={`v${v.version} ${PPT_COPY.exportMd}`}>
                    .md
                  </a>
                </>
              )}
              {v.current ? (
                <span className={f.tag}>{PPT_LABELS.currentVersion}</span>
              ) : locked ? null : (
                <BriefActionButton action={restore} hidden={{ deckId: deck.id, revision: deck.revision, versionNo: v.version }} submitLabel={PPT_COPY.restore} pendingLabel={P3_COMMON_COPY.savePending} />
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 읽기 전용: 폼 없이 구성안 내용만(글은 React 글자로만) */
function ReadOnlyDeck({ deck, assets }: { deck: PptDeckView; assets: Array<{ id: string; label: string }> }) {
  const assetLabel = (id: string) => assets.find((a) => a.id === id)?.label ?? "목록에 없는 자산";
  const tpl = PPT_TEMPLATES[deck.templateKey];
  return (
    <div className={pp.ppReadOnly}>
      <dl className={pp.ppView}>
        <div className={pp.ppViewRow}>
          <dt>{PPT_LABELS.title}</dt>
          <dd>{deck.title}</dd>
        </div>
        <div className={pp.ppViewRow}>
          <dt>{PPT_LABELS.template}</dt>
          <dd>{tpl ? `${tpl.name} · ${tpl.desc}` : deck.templateKey}</dd>
        </div>
      </dl>
      <h4 className={pp.ppSubhead}>{`${PPT_LABELS.slidesHeading} (${deck.slides.length} / ${PPT_DECK_LIMITS.slidesMax}장)`}</h4>
      <ol className={pp.ppSlides}>
        {sortedSlides(deck.slides).map((s, i) => (
          <li key={s.id ?? i} className={pp.ppSlide}>
            <h5 className={pp.ppSlideTitle}>{`슬라이드 ${i + 1} · ${s.slideTitle}`}</h5>
            <dl className={pp.ppView}>
              <div className={pp.ppViewRow}>
                <dt>{PPT_LABELS.bulletPoints}</dt>
                <dd className={s.bulletPoints ? pp.ppViewText : styles.muted}>{s.bulletPoints || "적지 않음"}</dd>
              </div>
              <div className={pp.ppViewRow}>
                <dt>{PPT_LABELS.speakerNotes}</dt>
                <dd className={s.speakerNotes ? pp.ppViewText : styles.muted}>{s.speakerNotes || "적지 않음"}</dd>
              </div>
              <div className={pp.ppViewRow}>
                <dt>{PPT_LABELS.assets}</dt>
                <dd>{s.assetIds.length ? s.assetIds.map(assetLabel).join(", ") : <span className={styles.muted}>연결 안 함</span>}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </div>
  );
}
