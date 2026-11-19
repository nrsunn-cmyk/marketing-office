import Link from "next/link";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import wc from "./web-copy.module.css";
import { BriefActionButton } from "./production-brief-buttons";
import type { BriefAction } from "./production-brief-edit-form";
import { WebCopyEditor } from "./web-copy-editor";
import {
  SECTION_FIELDS,
  WC_COPY,
  WEB_COPY_STATUSES,
  docToEditor,
  formatKstMinute,
  rebaseLabel,
  restoreHint,
  sortedPages,
  sortedSections,
  staleWebCopyText,
  type WebCopyDocView,
  type WebCopySectionData,
  type WebCopySourceOption,
} from "./web-copy-model";

/** 서버 동작 자리(P3-b 서버가 오면 actions.ts 의 동작을 넘긴다. 없으면 단추마다 '아직 연결 안 됨' 안내) */
export interface WebCopyActions {
  create?: BriefAction;
  save?: BriefAction;
  rebase?: BriefAction;
  archive?: BriefAction;
  restore?: BriefAction;
}

/**
 * P3B-UI-PREP-01 홈페이지 구조·문구 영역(서버 연결 전, 표시·입력 부품).
 * 시안 Design/p3-production/web-copy.html, 인계표 P3B-HANDOFF.md 상태:
 *   작성 중 · 검토 완료 · 이전 브리프 기준(계산 배지) · 보관(읽기 전용) · 빈 상태 · 프로젝트 읽기 전용 + 불러오기 실패.
 * 읽기 전용이면 폼·되돌리기 단추를 그리지 않고 내용과 이력만 보인다. 화면 연결은 서버가 온 뒤에 한다.
 */
export function WebCopySection({ data, readOnly, taskId, actions = {} }: { data: WebCopySectionData | null; readOnly: boolean; taskId: string; actions?: WebCopyActions }) {
  const doc = data?.doc ?? null;
  return (
    <section className={`${styles.section} ${f.funnel} ${wc.wcSection_root}`} aria-labelledby="web-copy">
      <div className={wc.wcHead}>
        <h2 id="web-copy" className={`${styles.subtitle} ${wc.wcTitle}`}>
          {WC_COPY.heading}
        </h2>
        <p className={`${styles.muted} ${f.keep}`}>{WC_COPY.intro}</p>
        {doc && (
          <p className={wc.wcBadges}>
            <span className={`${wc.wcStatus} ${wc[`wcStatus_${doc.status}`]}`}>{WEB_COPY_STATUSES[doc.status]}</span>
            {doc.stale && <span className={`${f.tag} ${f.tag_warn}`}>이전 브리프 기준</span>}
            <span className={f.tag}>{`${doc.briefVersion ? `제작 브리프 v${doc.briefVersion} 기준` : "기준 제작 브리프 알 수 없음"} · 편집 v${doc.version}`}</span>
          </p>
        )}
      </div>

      {data === null ? (
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
      ) : doc === null ? (
        <div className={`${styles.emptyState} ${wc.wcEmpty}`}>
          <strong>{WC_COPY.emptyTitle}</strong>
          {readOnly ? (
            <p className={`${styles.muted} ${f.keep}`} role="note">
              {WC_COPY.projectReadOnly}
            </p>
          ) : data.canCreate ? (
            <>
              <p className={`${styles.muted} ${f.keep}`}>{WC_COPY.emptyDesc}</p>
              <BriefActionButton action={actions.create} hidden={{}} submitLabel={WC_COPY.create} pendingLabel="만드는 중…" variant="primary" />
            </>
          ) : (
            <p className={`${styles.muted} ${f.keep}`} role="note">
              {data.createBlockedReason ?? "확정된 공통 제작 브리프가 있어야 시작할 수 있습니다."}
            </p>
          )}
        </div>
      ) : (
        <DocBody doc={doc} data={data} readOnly={readOnly} actions={actions} />
      )}
    </section>
  );
}

function DocBody({ doc, data, readOnly, actions }: { doc: WebCopyDocView; data: WebCopySectionData; readOnly: boolean; actions: WebCopyActions }) {
  const archived = doc.status === "archived";
  const locked = readOnly || archived;
  const ids = { docId: doc.id, revision: doc.revision };
  const editor = docToEditor(doc);
  return (
    <>
      {locked && (
        <div className={styles.notice} role="note">
          <p className={f.keep}>{archived ? WC_COPY.archivedNote : WC_COPY.projectReadOnly}</p>
        </div>
      )}
      {doc.stale && !archived && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>
            <strong>이전 브리프 기준:</strong> {staleWebCopyText(data.latestBriefVersion)}
          </p>
          {!locked && <BriefActionButton action={actions.rebase} hidden={ids} submitLabel={rebaseLabel(data.latestBriefVersion)} pendingLabel="맞추는 중…" />}
        </div>
      )}

      {locked ? (
        <ReadOnlyDoc doc={doc} sources={data.sources} />
      ) : (
        <>
          {/* 저장에 성공하면 revision 이 바뀌어 편집기가 서버 값으로 새로 그려진다 */}
          <WebCopyEditor key={doc.revision} action={actions.save} hidden={ids} initialStatus={editor.status} initialPages={editor.pages} sources={data.sources} />
          <div className={wc.wcDanger}>
            <BriefActionButton action={actions.archive} hidden={ids} submitLabel={WC_COPY.archive} pendingLabel="보관 중…">
              <p className={`${styles.muted} ${f.keep}`}>보관하면 조회만 할 수 있고 고치기·되돌리기를 할 수 없습니다. 보관은 되돌릴 수 없습니다.</p>
            </BriefActionButton>
          </div>
        </>
      )}

      <Versions doc={doc} locked={locked} restore={actions.restore} />
    </>
  );
}

function Versions({ doc, locked, restore }: { doc: WebCopyDocView; locked: boolean; restore?: BriefAction }) {
  const list = [...doc.versions].sort((a, b) => b.version - a.version);
  return (
    <section className={wc.wcVersions} aria-labelledby="web-copy-versions">
      <h3 id="web-copy-versions" className={wc.wcSubhead}>
        {WC_COPY.versionsTitle}
      </h3>
      {!locked && <p className={`${styles.muted} ${f.keep}`}>{restoreHint(doc.version + 1)}</p>}
      {list.length === 0 ? (
        <p className={styles.muted}>아직 저장한 판이 없습니다.</p>
      ) : (
        <ol className={wc.wcVersionList}>
          {list.map((v) => (
            <li key={v.version} className={`${wc.wcVersion} ${v.current ? wc.wcVersionCurrent : ""}`}>
              <div>
                <p className={wc.wcVersionName}>{`v${v.version} (${v.current ? `현재 작업본 · ${WEB_COPY_STATUSES[v.status]}` : WEB_COPY_STATUSES[v.status]})`}</p>
                <p className={`${styles.muted} ${f.keep}`}>{`${formatKstMinute(v.savedAt)}${v.note ? ` · ${v.note}` : ""}`}</p>
              </div>
              {v.current ? (
                <span className={f.tag}>{WC_COPY.currentVersion}</span>
              ) : locked ? null : (
                <BriefActionButton action={restore} hidden={{ docId: doc.id, revision: doc.revision, version: v.version }} submitLabel={WC_COPY.restore} pendingLabel="되돌리는 중…" />
              )}
            </li>
          ))}
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
  return (
    <div className={wc.wcReadOnly}>
      {sortedPages(doc.pages).map((p, pi) => (
        <section key={p.id ?? pi} className={wc.wcReadPage} aria-labelledby={`wc-ro-${pi}`}>
          <h3 id={`wc-ro-${pi}`} className={wc.wcSubhead}>{`${pi + 1}. ${p.title} (${p.slug}) · 섹션 ${p.sections.length}개`}</h3>
          <ol className={wc.wcSections}>
            {sortedSections(p.sections).map((s, si) => (
              <li key={s.id ?? si} className={`${wc.wcSection} ${s.excluded ? wc.wcSectionExcluded : ""}`}>
                <h4 className={wc.wcSectionTitle}>
                  {`섹션 ${si + 1} · ${s.sectionName}`}
                  {s.excluded && <span className={`${f.tag} ${wc.wcExcludedTag}`}>제외됨</span>}
                </h4>
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
