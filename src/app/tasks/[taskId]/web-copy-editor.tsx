"use client";

import { useId, useState } from "react";
import { ActionForm } from "../../_components/action-form";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import wc from "./web-copy.module.css";
import { notConnectedAction, type BriefAction } from "./production-brief-edit-form";
import {
  SECTION_FIELDS,
  WC_COPY,
  WEB_COPY_EDITABLE_STATUSES,
  WEB_COPY_LIMITS,
  WEB_COPY_STATUSES,
  addPage,
  addSection,
  canAddPage,
  canAddSection,
  charLength,
  checkWebCopy,
  counterText,
  moveSection,
  pageKey,
  secKey,
  setExcluded,
  toWebCopyPayload,
  toggleCitation,
  totalSections,
  type SectionFieldKey,
  type WebCopyEditableStatus,
  type WebCopyPageView,
  type WebCopySectionView,
  type WebCopySourceOption,
} from "./web-copy-model";

/**
 * 홈페이지 구조·문구 편집기(P3B-UI-PREP-01, 시안 Design/p3-production/web-copy.html).
 * - 페이지 목록에서 한 페이지를 골라 그 페이지의 섹션을 편집한다(고른 페이지는 aria-pressed).
 * - 섹션: 위로·아래로(순서), 제외(지우지 않고 접어 둠, 다시 포함 가능), 칸별 글자 수, 근거 출처 체크.
 * - 저장은 문서 전체를 숨은 칸 payload(JSON) 하나로 보낸다. 서버가 없으면 자리용 동작이 안내만 한다.
 * - 값은 자르지 않고, 문제는 칸 아래 안내로만 보인다(최종 판단은 서버).
 */
export function WebCopyEditor({
  action,
  hidden,
  initialStatus,
  initialPages,
  sources,
}: {
  action?: BriefAction;
  hidden: Record<string, string | number>;
  initialStatus: WebCopyEditableStatus;
  initialPages: WebCopyPageView[];
  sources: WebCopySourceOption[];
}) {
  const id = useId();
  const [pages, setPages] = useState<WebCopyPageView[]>(initialPages);
  const [status, setStatus] = useState<WebCopyEditableStatus>(initialStatus);
  const [cur, setCur] = useState(0);
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState("");
  const L = WEB_COPY_LIMITS;
  const sourceIds = sources.map((s) => s.id);
  const issues = checkWebCopy(pages, sourceIds);
  const page = pages[cur] ?? pages[0];
  const pi = pages[cur] ? cur : 0;

  const change = (next: WebCopyPageView[], msg = "") => {
    setTouched(true);
    setPages(next);
    setNote(msg);
  };
  const setPage = (patch: Partial<WebCopyPageView>) => change(pages.map((p, i) => (i === pi ? { ...p, ...patch } : p)));
  const setSections = (sections: WebCopySectionView[], msg = "") => change(pages.map((p, i) => (i === pi ? { ...p, sections } : p)), msg);
  const setField = (si: number, k: SectionFieldKey, v: string) => setSections(page.sections.map((s, i) => (i === si ? { ...s, [k]: v } : s)));
  // 비어 있음 안내는 손댄 뒤에만, 글자 수 넘침·형식 오류는 바로
  const show = (key: string, over: boolean) => (over || touched ? issues[key] : undefined);

  return (
    <ActionForm action={action ?? notConnectedAction} submitLabel={WC_COPY.save} className={`${f.form} ${wc.wcForm}`}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={String(v)} />
      ))}
      <input type="hidden" name="payload" value={JSON.stringify(toWebCopyPayload(status, pages))} />

      <div className={wc.wcWorkspace}>
        <nav className={wc.wcPages} aria-label="페이지 목록">
          <div className={wc.wcPagesHead}>
            <h4 className={wc.wcSubhead}>{`페이지 (${pages.length} / ${L.pagesMax})`}</h4>
            <button
              type="button"
              className={`${styles.secondaryButton} ${f.touch}`}
              disabled={!canAddPage(pages) || totalSections(pages) >= L.sectionsTotalMax}
              onClick={() => {
                const next = addPage(pages);
                change(next, `새 페이지를 추가했습니다: ${next[next.length - 1].title}`);
                setCur(next.length - 1);
              }}
            >
              {WC_COPY.addPage}
            </button>
          </div>
          <ul className={wc.wcPageList}>
            {pages.map((p, i) => (
              <li key={i}>
                <button type="button" className={wc.wcPageTab} aria-pressed={i === pi} onClick={() => setCur(i)}>
                  <span className={wc.wcPageName}>{`${i + 1}. ${p.title || "이름 없음"}`}</span>
                  <span className={wc.wcPageSlug}>{p.slug}</span>
                  {Object.keys(issues).some((k) => k.startsWith(`page:${i}:`) || k.startsWith(`sec:${i}:`)) && touched && <span className={wc.wcPageWarn}>확인 필요</span>}
                </button>
              </li>
            ))}
          </ul>
          {issues["doc:pages"] && <p className={styles.error}>{issues["doc:pages"]}</p>}
          {issues["doc:sections"] && <p className={styles.error}>{issues["doc:sections"]}</p>}
        </nav>

        {page && (
          <div className={wc.wcPagePanel}>
            <div className={wc.wcPanelHead}>
              <h4 className={wc.wcSubhead} id={`${id}-page-h`}>
                {`${pi + 1}. ${page.title || "이름 없음"} (${page.slug}) · 섹션 ${page.sections.length} / ${L.sectionsPerPageMax}개`}
              </h4>
              <p className={`${styles.muted} ${f.keep}`}>{WC_COPY.pageHint}</p>
            </div>
            <div className={wc.wcGrid2}>
              <TextField id={`${id}-p${pi}-title`} label="페이지 이름" required value={page.title} max={L.pageTitle} msg={show(pageKey(pi, "title"), charLength(page.title) > L.pageTitle)} onChange={(v) => setPage({ title: v })} />
              <TextField
                id={`${id}-p${pi}-slug`}
                label="경로(슬러그)"
                required
                value={page.slug}
                max={L.slug}
                msg={issues[pageKey(pi, "slug")]}
                onChange={(v) => setPage({ slug: v })}
                placeholder="/about"
              />
            </div>
            {issues[`page:${pi}:sections`] && <p className={styles.error}>{issues[`page:${pi}:sections`]}</p>}

            <ol className={wc.wcSections} aria-labelledby={`${id}-page-h`}>
              {page.sections.map((s, si) => (
                <SectionCard
                  key={`${pi}-${si}-${s.id ?? "new"}`}
                  idBase={`${id}-p${pi}-s${si}`}
                  s={s}
                  si={si}
                  count={page.sections.length}
                  sources={sources}
                  issues={issues}
                  keyOf={(k) => secKey(pi, si, k)}
                  touched={touched}
                  onField={(k, v) => setField(si, k, v)}
                  onMove={(dir) => setSections(moveSection(page.sections, si, dir), `섹션 순서를 ${dir < 0 ? "위로" : "아래로"} 옮겼습니다.`)}
                  onExclude={(ex) => setSections(setExcluded(page.sections, si, ex), ex ? "섹션을 제외했습니다(지우지 않음, 다시 포함할 수 있음)." : "섹션을 다시 포함했습니다.")}
                  onCitation={(cid, on) => setSections(page.sections.map((x, i) => (i === si ? { ...x, citationIds: toggleCitation(x.citationIds, cid, on, sourceIds) } : x)))}
                />
              ))}
            </ol>
            <button
              type="button"
              className={`${styles.secondaryButton} ${f.touch}`}
              disabled={!canAddSection(pages, pi)}
              onClick={() => change(addSection(pages, pi), "이 페이지에 새 섹션을 추가했습니다.")}
            >
              {WC_COPY.addSection}
            </button>
          </div>
        )}
      </div>

      <p className={styles.muted} role="status" aria-live="polite">
        {note}
      </p>

      <div className={styles.field}>
        <label htmlFor={`${id}-status`}>진행 상태</label>
        <select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as WebCopyEditableStatus)}>
          {WEB_COPY_EDITABLE_STATUSES.map((st) => (
            <option key={st} value={st}>
              {WEB_COPY_STATUSES[st]}
            </option>
          ))}
        </select>
      </div>
    </ActionForm>
  );
}

function TextField({
  id,
  label,
  required = false,
  value,
  max,
  msg,
  onChange,
  multiline = false,
  rows = 1,
  placeholder,
}: {
  id: string;
  label: string;
  required?: boolean;
  value: string;
  max: number;
  msg?: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const n = charLength(value);
  const over = n > max;
  const common = {
    id,
    value,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    required,
    "aria-required": required || undefined,
    "aria-invalid": msg ? true : undefined,
    "aria-describedby": `${id}-count${msg ? ` ${id}-msg` : ""}`,
    placeholder,
  };
  return (
    <div className={styles.field}>
      <div className={wc.wcFieldHead}>
        <label htmlFor={id}>
          {label} {required && <span className={wc.wcReq}>(필수)</span>}
        </label>
        <span id={`${id}-count`} className={over ? `${wc.wcCount} ${wc.wcCountOver}` : wc.wcCount} aria-live="polite">
          {counterText(n, max)}
        </span>
      </div>
      {multiline ? <textarea {...common} rows={rows} /> : <input type="text" {...common} />}
      {msg && (
        <span id={`${id}-msg`} className={styles.error}>
          {msg}
        </span>
      )}
    </div>
  );
}

function SectionCard({
  idBase,
  s,
  si,
  count,
  sources,
  issues,
  keyOf,
  touched,
  onField,
  onMove,
  onExclude,
  onCitation,
}: {
  idBase: string;
  s: WebCopySectionView;
  si: number;
  count: number;
  sources: WebCopySourceOption[];
  issues: Record<string, string>;
  keyOf: (k: SectionFieldKey | "citationIds") => string;
  touched: boolean;
  onField: (k: SectionFieldKey, v: string) => void;
  onMove: (dir: -1 | 1) => void;
  onExclude: (excluded: boolean) => void;
  onCitation: (id: string, on: boolean) => void;
}) {
  const L = WEB_COPY_LIMITS;
  const title = `섹션 ${si + 1} · ${s.sectionName || "이름 없음"}`;
  const hId = `${idBase}-h`;
  return (
    <li className={`${wc.wcSection} ${s.excluded ? wc.wcSectionExcluded : ""}`} aria-labelledby={hId}>
      <div className={wc.wcSectionHead}>
        <h5 id={hId} className={wc.wcSectionTitle}>
          {title}
          {s.excluded && <span className={`${f.tag} ${wc.wcExcludedTag}`}>제외됨</span>}
        </h5>
        <div className={wc.wcSectionTools} role="group" aria-label={`${title} 순서·제외`}>
          <button type="button" className={`${styles.secondaryButton} ${f.touch}`} disabled={si === 0} onClick={() => onMove(-1)} aria-label={`${title} 위로`}>
            {WC_COPY.up}
          </button>
          <button type="button" className={`${styles.secondaryButton} ${f.touch}`} disabled={si === count - 1} onClick={() => onMove(1)} aria-label={`${title} 아래로`}>
            {WC_COPY.down}
          </button>
          <button type="button" className={`${styles.secondaryButton} ${f.touch}`} onClick={() => onExclude(!s.excluded)} aria-label={`${title} ${s.excluded ? WC_COPY.include : WC_COPY.exclude}`}>
            {s.excluded ? WC_COPY.include : WC_COPY.exclude}
          </button>
        </div>
      </div>
      {s.excluded ? (
        <p className={`${styles.muted} ${f.keep}`}>제외한 섹션은 홈페이지에 넣지 않습니다. 내용은 지우지 않으며 &lsquo;다시 포함&rsquo;으로 되살릴 수 있습니다.</p>
      ) : (
        <>
          {SECTION_FIELDS.map((fd) => {
            const v = s[fd.key];
            const over = charLength(v) > L[fd.key];
            const key = keyOf(fd.key);
            // CTA 형식 안내는 바로, 비어 있음은 손댄 뒤
            const msg = over || touched || (fd.key === "ctaTarget" && v.trim()) ? issues[key] : undefined;
            return <TextField key={fd.key} id={`${idBase}-${fd.key}`} label={fd.label} required={fd.required} value={v} max={L[fd.key]} msg={msg} onChange={(x) => onField(fd.key, x)} multiline={fd.multiline} rows={fd.rows} placeholder={fd.placeholder} />;
          })}
          <fieldset className={wc.wcCites}>
            <legend>
              {WC_COPY.citationLegend} <span className={wc.wcCount}>{` ${s.citationIds.length}/${L.citationsMax}개`}</span>
            </legend>
            {sources.length === 0 ? (
              <p className={`${styles.muted} ${f.keep}`}>{WC_COPY.noSources}</p>
            ) : (
              <div className={wc.wcCiteGrid}>
                {sources.map((src, n) => (
                  <label key={src.id} className={wc.wcCheck}>
                    <input type="checkbox" checked={s.citationIds.includes(src.id)} onChange={(e) => onCitation(src.id, e.target.checked)} />
                    <span>{`[출처 #${n + 1}] ${src.label}`}</span>
                  </label>
                ))}
              </div>
            )}
            <span className={styles.muted}>{WC_COPY.citationHint}</span>
            {issues[keyOf("citationIds")] && <span className={styles.error}>{issues[keyOf("citationIds")]}</span>}
          </fieldset>
        </>
      )}
    </li>
  );
}
