import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getProductionBriefsFor } from "@/features/production-brief/server";
import { getProject } from "@/features/projects/server";
import type { TaskDetail } from "@/features/tasks/server";
import { archiveWebCopyAction, createWebCopyDocAction, rebaseWebCopyAction, restoreWebCopyVersionAction, saveWebCopyAction } from "@/features/web-copy/actions";
import { getWebCopyFor, type WebCopyBoard, type WebCopyDocView } from "@/features/web-copy/server";
import styles from "../../ui.module.css";
import { StepBackLink } from "./step-back-link";
import { fixRequestedIdsFor } from "./qa-fix-flags";
import { QaFixTag } from "./qa-fix-tag";
import f from "./funnel.module.css";
import wc from "./web-copy.module.css";
import { BriefActionButton } from "./production-brief-buttons";
import type { BriefAction } from "./production-brief-edit-form";
import { WebCopyEditor } from "./web-copy-editor";
import {
  SECTION_FIELDS,
  WC_COPY,
  archivedDocOption,
  docToEditor,
  formatKstMinute,
  restoreHint,
  sortedPages,
  sortedSections,
  webCopyBriefNotice,
  type WebCopySourceOption,
} from "./web-copy-model";

/** 서버 동작(시험에서는 넘기지 않으면 단추마다 '아직 연결 안 됨' 안내) */
export interface WebCopyActions {
  create?: BriefAction;
  save?: BriefAction;
  rebase?: BriefAction;
  archive?: BriefAction;
  restore?: BriefAction;
}

const SERVER_ACTIONS: WebCopyActions = {
  create: createWebCopyDocAction,
  save: saveWebCopyAction,
  rebase: rebaseWebCopyAction,
  archive: archiveWebCopyAction,
  restore: restoreWebCopyVersionAction,
};

/**
 * P3B-UI-CONNECT-01 홈페이지 구조·문구 영역. 전략 작업 상세에서 공통 제작 브리프(#production-brief) 바로 아래(AGY P3I-HANDOFF.md 1절).
 * 서버: src/features/web-copy(P3B-BACKEND-IMPL-01) — 제작 브리프 하나에 문서 하나(보관 안 된 것).
 * 프로젝트의 제작 브리프 중 포함 산출물에 홈페이지 구조·문구가 있는 것마다 블록 하나. 보관한 브리프는 문서가 남아 있을 때만 보인다.
 * 불러오지 못하면 영역 안에서 알리고 다시 불러오기를 준다(작업 화면의 다른 영역은 그대로).
 */
export async function WebCopyArea({ detail }: { detail: TaskDetail }) {
  let boards: WebCopyBoard[] | null = null;
  let projectArchived = false;
  try {
    const [r, project] = await Promise.all([getProductionBriefsFor(detail.project.id), getProject(detail.project.id)]);
    projectArchived = project?.status === "archived";
    if (!r.ok) console.error("[web-copy]", r.code, r.message);
    else {
      const briefs = [...r.data.briefs.filter((b) => !b.archived), ...r.data.briefs.filter((b) => b.archived)].filter((b) => b.deliverableTypes.includes("web_copy"));
      const results = await Promise.all(briefs.map((b) => getWebCopyFor(b.id)));
      const bad = results.find((x) => !x.ok);
      if (bad && !bad.ok) console.error("[web-copy]", bad.code, bad.message);
      else boards = results.flatMap((x) => (x.ok && (x.data.doc !== null || !x.data.brief.archived) ? [x.data] : []));
    }
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과
    console.error("[web-copy]", e);
  }
  // P3FG-UI-CONNECT-01-R1: 검수에서 보완 요청된 산출물 배지(기존 검수 읽기로 계산, 실패하면 배지만 빠짐)
  const fixRequestedIds = await fixRequestedIdsFor(detail.project.id);
  return <WebCopySection boards={boards} readOnly={projectArchived || detail.task.status === "cancelled"} taskId={detail.task.id} actions={SERVER_ACTIONS} fixRequestedIds={fixRequestedIds} />;
}

/**
 * 화면 본문(동기, 시험에서 가짜 보드로 그린다). 인계표 P3B-HANDOFF.md 상태:
 *   작성 중 · 검토 완료 · 이전 브리프 기준(원인별 안내 4종) · 읽기 전용 · 빈 상태 · 만들 수 없음 + 불러오기 실패(boards = null).
 */
export function WebCopySection({ boards, readOnly, taskId, actions = {}, fixRequestedIds = [] }: { boards: WebCopyBoard[] | null; readOnly: boolean; taskId: string; actions?: WebCopyActions; fixRequestedIds?: readonly string[] }) {
  return (
    <section className={`${styles.section} ${f.funnel} ${wc.wcSection_root}`} aria-labelledby="web-copy">
      <div className={wc.wcHead}>
        <h2 id="web-copy" className={`${styles.subtitle} ${wc.wcTitle}`}>
          {WC_COPY.heading}
        </h2>
        <StepBackLink />
        <p className={`${styles.muted} ${f.keep}`}>{WC_COPY.intro}</p>
      </div>

      {boards === null ? (
        <>
          <p className={styles.error} role="alert">
            {WC_COPY.loadError}
          </p>
          <p>
            <Link href={`/tasks/${taskId}#web-copy`} className={`${styles.secondaryButton} ${f.touch}`}>
              다시 불러오기
            </Link>
          </p>
        </>
      ) : boards.length === 0 ? (
        <div className={`${styles.emptyState} ${wc.wcEmpty}`}>
          <strong>{WC_COPY.emptyTitle}</strong>
          <p className={`${styles.muted} ${f.keep}`} role="note">
            {readOnly ? WC_COPY.projectReadOnly : "확정된 공통 제작 브리프가 있어야 시작할 수 있습니다."}
          </p>
        </div>
      ) : (
        boards.map((b) => <BriefBlock key={b.brief.id} board={b} readOnly={readOnly} actions={actions} fixRequestedIds={fixRequestedIds} />)
      )}
    </section>
  );
}

const sourceOptions = (board: WebCopyBoard): WebCopySourceOption[] => board.sources.map((s) => ({ id: s.id, label: s.title.trim() || s.url }));

function BriefBlock({ board, readOnly, actions, fixRequestedIds = [] }: { board: WebCopyBoard; readOnly: boolean; actions: WebCopyActions; fixRequestedIds?: readonly string[] }) {
  const doc = board.doc;
  const headId = `web-copy-${board.brief.id}`;
  return (
    <section className={wc.wcBrief} aria-labelledby={headId}>
      <h3 id={headId} className={wc.wcSubhead}>
        {`기준 제작 브리프: ${board.brief.title}`}
        {board.brief.archived && <span className={`${f.tag} ${wc.wcExcludedTag}`}>보관한 브리프</span>}
      </h3>
      {doc && (
        <p className={wc.wcBadges}>
          <span className={`${wc.wcStatus} ${wc[`wcStatus_${doc.status}`]}`}>{doc.displayLabel}</span>
          {doc.staleLabel && <span className={`${f.tag} ${f.tag_warn}`}>{doc.staleLabel}</span>}
          <span className={f.tag}>{`편집 v${doc.currentVersionNo}`}</span>
          <QaFixTag show={fixRequestedIds.includes(doc.id)} />
        </p>
      )}
      {doc === null ? (
        <div className={`${styles.emptyState} ${wc.wcEmpty}`}>
          <strong>{WC_COPY.emptyTitle}</strong>
          {readOnly ? (
            <p className={`${styles.muted} ${f.keep}`} role="note">
              {WC_COPY.projectReadOnly}
            </p>
          ) : board.canCreate ? (
            <>
              <p className={`${styles.muted} ${f.keep}`}>{WC_COPY.emptyDesc}</p>
              <BriefActionButton action={actions.create} hidden={{ briefId: board.brief.id }} submitLabel={WC_COPY.create} pendingLabel="만드는 중…" variant="primary" />
              {board.archivedDocs.length > 0 && <CopyFromArchived board={board} action={actions.create} />}
            </>
          ) : (
            <p className={`${styles.muted} ${f.keep}`} role="note">
              {board.createBlockedReason ?? "확정된 공통 제작 브리프가 있어야 시작할 수 있습니다."}
            </p>
          )}
        </div>
      ) : (
        <DocBody doc={doc} board={board} readOnly={readOnly} actions={actions} />
      )}
    </section>
  );
}

/** 보관한 문서(판 100개가 찬 문서 포함)의 지금 판을 복사해 새 문서로(서버 createWebCopyDoc copyFromDocId) */
function CopyFromArchived({ board, action }: { board: WebCopyBoard; action?: BriefAction }) {
  const sumId = `web-copy-copy-${board.brief.id}`;
  return (
    <details className={`${f.inlineDetails} ${wc.wcCopy}`}>
      <summary id={sumId}>{WC_COPY.copyFromArchived}</summary>
      <BriefActionButton action={action} hidden={{ briefId: board.brief.id }} submitLabel={WC_COPY.copyFromArchived} pendingLabel="만드는 중…">
        <p className={`${styles.muted} ${f.keep}`}>{WC_COPY.copyFromArchivedHint}</p>
        <div className={styles.field}>
          <select name="copyFromDocId" aria-labelledby={sumId} defaultValue={board.archivedDocs[0]?.id}>
            {board.archivedDocs.map((d) => (
              <option key={d.id} value={d.id}>
                {archivedDocOption(d)}
              </option>
            ))}
          </select>
        </div>
      </BriefActionButton>
    </details>
  );
}

function DocBody({ doc, board, readOnly, actions }: { doc: WebCopyDocView; board: WebCopyBoard; readOnly: boolean; actions: WebCopyActions }) {
  const locked = readOnly || doc.readOnlyReason !== null;
  // 판 100개: 저장·되돌리기·맞추기 없이 내용만 보이고, 보관한 뒤 복사해 새 문서로(AGY versionLimitReached)
  const full = !locked && doc.versionsFull;
  const ids = { docId: doc.id, revision: doc.revision };
  const editor = docToEditor(doc);
  const sources = sourceOptions(board);
  // 바탕 브리프 안내는 원인별로 하나만(브리프 보관이면 staleBanner 대신 briefArchivedNotice, Master 결정)
  // 화면 쪽 읽기 전용(프로젝트 보관·작업 취소)도 서버 readOnlyReason 처럼 본다(맞추기 단추를 내지 않음)
  const notice = webCopyBriefNotice({ ...doc, readOnlyReason: locked ? (doc.readOnlyReason ?? WC_COPY.projectReadOnly) : null }, board.brief);
  return (
    <>
      {locked && (
        <div className={styles.notice} role="note">
          <p className={f.keep}>{WC_COPY.projectReadOnly}</p>
        </div>
      )}
      {notice && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>{notice.text}</p>
          {notice.canRebase && <BriefActionButton action={actions.rebase} hidden={ids} submitLabel={WC_COPY.rebase} pendingLabel="맞추는 중…" />}
        </div>
      )}

      {full && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>{WC_COPY.versionLimitReached}</p>
        </div>
      )}

      {locked || full ? (
        <ReadOnlyDoc doc={doc} sources={sources} />
      ) : null}
      {!locked && (
        <>
          {/* 저장에 성공하면 revision 이 바뀌어 편집기가 서버 값으로 새로 그려진다 */}
          {!full && <WebCopyEditor key={doc.revision} action={actions.save} hidden={ids} initialStatus={editor.status} initialPages={editor.pages} sources={sources} />}
          {/* 되돌릴 수 없는 보관은 한 번 더 확인한다(P3-a 와 같은 접은 안, AGY P3I-HANDOFF.md 3절) */}
          <details className={`${f.inlineDetails} ${wc.wcDanger}`}>
            <summary>{WC_COPY.archive}</summary>
            <BriefActionButton action={actions.archive} hidden={ids} submitLabel="보관 확인" pendingLabel="보관 중…">
              <p className={`${styles.muted} ${f.keep}`}>보관하면 조회만 할 수 있고 고치기·되돌리기를 할 수 없습니다. 보관은 되돌릴 수 없습니다.</p>
            </BriefActionButton>
          </details>
        </>
      )}

      <Versions doc={doc} board={board} locked={locked || full} restore={actions.restore} />
    </>
  );
}

function Versions({ doc, board, locked, restore }: { doc: WebCopyDocView; board: WebCopyBoard; locked: boolean; restore?: BriefAction }) {
  const list = [...board.versions].sort((a, b) => b.versionNo - a.versionNo);
  const headId = `web-copy-versions-${doc.id}`;
  return (
    <section className={wc.wcVersions} aria-labelledby={headId}>
      <h4 id={headId} className={wc.wcSubhead}>
        {WC_COPY.versionsTitle}
      </h4>
      {!locked && <p className={`${styles.muted} ${f.keep}`}>{restoreHint(doc.currentVersionNo + 1)}</p>}
      {list.length === 0 ? (
        <p className={styles.muted}>아직 저장한 판이 없습니다.</p>
      ) : (
        <ol className={wc.wcVersionList}>
          {list.map((v) => {
            const status = v.status === "reviewed" ? "검토 완료" : "작성 중";
            const from = v.restoredFromVersionNo ? ` (v${v.restoredFromVersionNo}에서)` : "";
            return (
              <li key={v.id} className={`${wc.wcVersion} ${v.current ? wc.wcVersionCurrent : ""}`}>
                <div>
                  <p className={wc.wcVersionName}>{`v${v.versionNo} (${v.current ? `현재 작업본 · ${status}` : status})`}</p>
                  <p className={`${styles.muted} ${f.keep}`}>{`${formatKstMinute(v.createdAt)} · ${v.kindLabel}${from}`}</p>
                </div>
                {v.current ? (
                  <span className={f.tag}>{WC_COPY.currentVersion}</span>
                ) : locked ? null : (
                  <BriefActionButton action={restore} hidden={{ docId: doc.id, revision: doc.revision, versionNo: v.versionNo }} submitLabel={WC_COPY.restore} pendingLabel="되돌리는 중…" />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** 읽기 전용: 폼 없이 페이지·섹션 내용만(글은 React 글자로만 그린다) */
function ReadOnlyDoc({ doc, sources }: { doc: WebCopyDocView; sources: WebCopySourceOption[] }) {
  const label = (id: string) => {
    const i = sources.findIndex((s) => s.id === id);
    return i >= 0 ? `[출처 #${i + 1}] ${sources[i].label}` : "목록에 없는 출처";
  };
  const pages = docToEditor(doc).pages;
  return (
    <div className={wc.wcReadOnly}>
      {sortedPages(pages).map((p, pi) => (
        <section key={p.id ?? pi} className={wc.wcReadPage} aria-labelledby={`wc-ro-${doc.id}-${pi}`}>
          <h4 id={`wc-ro-${doc.id}-${pi}`} className={wc.wcSubhead}>{`${pi + 1}. ${p.title} (${p.slug}) · 섹션 ${p.sections.length}개`}</h4>
          <ol className={wc.wcSections}>
            {sortedSections(p.sections).map((s, si) => (
              <li key={s.id ?? si} className={`${wc.wcSection} ${s.excluded ? wc.wcSectionExcluded : ""}`}>
                <h5 className={wc.wcSectionTitle}>
                  {`섹션 ${si + 1} · ${s.sectionName}`}
                  {s.excluded && <span className={`${f.tag} ${wc.wcExcludedTag}`}>제외됨</span>}
                </h5>
                {!s.excluded && (
                  <dl className={wc.wcView}>
                    {SECTION_FIELDS.filter((fd) => fd.key !== "sectionName").map((fd) => (
                      <div key={fd.key} className={wc.wcViewRow}>
                        <dt>{fd.label}</dt>
                        <dd className={s[fd.key] ? wc.wcViewText : styles.muted}>{s[fd.key] || "적지 않음"}</dd>
                      </div>
                    ))}
                    <div className={wc.wcViewRow}>
                      <dt>근거·출처</dt>
                      <dd>{s.citationIds.length ? s.citationIds.map(label).join(", ") : <span className={styles.muted}>연결 안 함</span>}</dd>
                    </div>
                  </dl>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
