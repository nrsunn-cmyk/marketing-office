import Link from "next/link";
import { BadgeArchived, BadgeDrafting, BadgeReady, BadgeStale, EmptyBriefArt, P3PptIcon } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import pp from "./ppt-deck.module.css";
import { BriefActionButton } from "./production-brief-buttons";
import type { BriefAction } from "./production-brief-edit-form";
import { PptDeckEditor } from "./ppt-deck-editor";
import { PPT_COPY, PPT_DECK_LIMITS, PPT_DECK_STATUSES, PPT_LABELS, PPT_TEMPLATES, P3_COMMON_COPY, slideCountText, sortedSlides, type PptDeckData, type PptDeckView } from "./ppt-deck-model";

/** 서버 동작 자리(P3-e 서버가 오면 actions.ts 의 동작을 넘긴다. 없으면 단추마다 '아직 서버와 연결되지 않아…' 안내) */
export interface PptDeckActions {
  create?: BriefAction;
  save?: BriefAction;
  rebase?: BriefAction;
  archive?: BriefAction;
  exportPptx?: BriefAction;
  exportMd?: BriefAction;
}

/**
 * P3E-UI-PREP-01 PPT 구성·템플릿·내보내기 영역(서버 연결 전, 가짜 데이터로 그리는 부품). 실제 .pptx 생성은 하지 않는다.
 * 시안 Design/p3-production/ppt-deck.html 상태: 작성 중 · 검토 완료 · 이전 기준 · 보관 · 읽기 전용 · 빈 상태
 * + 만들 수 없음 · 권한 없음 · 한도(40장) · 불러오기 실패(data = null). 진행률 막대는 그리지 않는다(P3I-HANDOFF 2절) — 슬라이드 수만.
 * 보관해도 내보내기는 된다(인계표 3절 2: 조회·내보내기만 허용).
 */
export function PptDeckSection({ data, readOnly, taskId, actions = {} }: { data: PptDeckData | null; readOnly: boolean; taskId: string; actions?: PptDeckActions }) {
  const deck = data?.deck ?? null;
  return (
    <section className={`${styles.section} ${f.funnel} ${pp.ppSection}`} aria-labelledby="ppt-deck">
      <div className={pp.ppHead}>
        <h2 id="ppt-deck" className={`${styles.subtitle} ${pp.ppTitle}`}>
          <P3PptIcon className={pp.ppIcon} />
          {PPT_COPY.heading}
        </h2>
        <p className={`${styles.muted} ${f.keep}`}>{PPT_COPY.intro}</p>
        {deck && <Badges deck={deck} />}
      </div>
      {data === null ? (
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
        <Body data={data} readOnly={readOnly} actions={actions} />
      )}
    </section>
  );
}

function Badges({ deck }: { deck: PptDeckView }) {
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
      {deck.stale && (
        <span className={`${f.tag} ${f.tag_warn} ${pp.ppTagIcon}`}>
          <BadgeStale />
          {PPT_LABELS.staleBadge}
        </span>
      )}
      <span className={f.tag}>{slideCountText(deck.slides.length)}</span>
    </p>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div className={`${styles.notice} ${pp.ppBanner}`} role="note">
      <p className={f.keep}>{text}</p>
    </div>
  );
}

function Body({ data, readOnly, actions }: { data: PptDeckData; readOnly: boolean; actions: PptDeckActions }) {
  const deck = data.deck;
  const archived = deck?.archivedAt != null;
  const locked = readOnly || !data.canWrite || archived;
  return (
    <>
      {readOnly ? <Note text={P3_COMMON_COPY.projectReadOnly} /> : !data.canWrite ? <Note text={PPT_COPY.noPermission} /> : archived && <Note text={PPT_COPY.archivedNote} />}

      {!deck ? (
        <div className={`${styles.emptyState} ${pp.ppEmpty}`}>
          <EmptyBriefArt className={pp.ppEmptyArt} />
          <strong>{PPT_COPY.emptyTitle}</strong>
          {!locked &&
            (data.canCreate ? (
              <>
                <p className={`${styles.muted} ${f.keep}`}>{PPT_COPY.emptyDesc}</p>
                <BriefActionButton action={actions.create} hidden={{}} submitLabel={PPT_COPY.create} pendingLabel={P3_COMMON_COPY.savePending} variant="primary" />
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
          {deck.stale && !archived && (
            <div className={`${styles.notice} ${f.warnBox}`} role="note">
              <p className={f.keep}>
                <strong>{PPT_LABELS.stalePrefix}</strong> {PPT_COPY.staleBanner}
              </p>
              {!locked && <BriefActionButton action={actions.rebase} hidden={{ deckId: deck.id, revision: deck.revision }} submitLabel={PPT_COPY.rebase} pendingLabel={P3_COMMON_COPY.rebasePending} />}
            </div>
          )}
          {locked ? <ReadOnlyDeck deck={deck} assets={data.assets} /> : <PptDeckEditor key={deck.revision} deck={deck} assets={data.assets} action={actions.save} />}
          {/* 내보내기 자리: 보관한 구성안도 내보낼 수 있다(인계표 3절 2). 프로젝트 읽기 전용·권한 없음이어도 조회·내보내기는 막지 않는다 */}
          <section className={pp.ppExport} aria-labelledby="ppt-deck-export">
            <h3 id="ppt-deck-export" className={pp.ppSubhead}>
              {PPT_LABELS.exportHeading}
            </h3>
            <p className={`${styles.muted} ${f.keep}`}>{PPT_COPY.exportNotice}</p>
            <div className={pp.ppExportButtons}>
              <BriefActionButton action={actions.exportPptx} hidden={{ deckId: deck.id }} submitLabel={PPT_COPY.exportPptx} pendingLabel={P3_COMMON_COPY.savePending} />
              <BriefActionButton action={actions.exportMd} hidden={{ deckId: deck.id }} submitLabel={PPT_COPY.exportMd} pendingLabel={P3_COMMON_COPY.savePending} />
            </div>
          </section>
          {!locked && (
            <details className={`${f.inlineDetails} ${pp.ppDanger}`}>
              <summary>{PPT_COPY.archive}</summary>
              <BriefActionButton action={actions.archive} hidden={{ deckId: deck.id, revision: deck.revision }} submitLabel={PPT_COPY.archive} pendingLabel={P3_COMMON_COPY.archivePending}>
                <p className={`${styles.muted} ${f.keep}`}>{P3_COMMON_COPY.archiveConfirm}</p>
              </BriefActionButton>
            </details>
          )}
        </>
      )}
    </>
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
      <h3 className={pp.ppSubhead}>{`${PPT_LABELS.slidesHeading} (${deck.slides.length} / ${PPT_DECK_LIMITS.slidesMax}장)`}</h3>
      <ol className={pp.ppSlides}>
        {sortedSlides(deck.slides).map((s, i) => (
          <li key={s.id ?? i} className={pp.ppSlide}>
            <h4 className={pp.ppSlideTitle}>{`슬라이드 ${i + 1} · ${s.slideTitle}`}</h4>
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
