"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ActionForm } from "../../_components/action-form";
import { focusSideAfterMove } from "./move-focus";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import pp from "./ppt-deck.module.css";
import { notConnectedAction, type BriefAction } from "./production-brief-edit-form";
import {
  PPT_COPY,
  PPT_DECK_LIMITS,
  PPT_DECK_STATUSES,
  PPT_DECK_STATUS_KEYS,
  PPT_LABELS,
  PPT_TEMPLATES,
  PPT_TEMPLATE_KEYS,
  P3_COMMON_COPY,
  addSlide,
  canAddSlide,
  checkPptDeck,
  countChars,
  counterText,
  moveSlide,
  nearLimit,
  removeSlide,
  slideKey,
  toPptDeckPayload,
  toggleAsset,
  type PptAssetOption,
  type PptDeckStatus,
  type PptDeckView,
  type PptSlideView,
  type PptTemplate,
} from "./ppt-deck-model";

/**
 * PPT 구성안 편집기(P3E-UI-PREP-01, 시안 Design/p3-production/ppt-deck.html).
 * 발표 자료 제목·템플릿(라디오 카드) → 슬라이드 목록(위로·아래로·제외, 제목·핵심 요점·발표자 메모·자산 연결) → 진행 상태 → 저장.
 * 저장은 구성안 전체를 숨은 칸 payload(JSON) 하나로 보낸다. 서버가 없으면 자리용 동작이 안내만 한다. 값은 자르지 않는다.
 */
export function PptDeckEditor({
  deck,
  assets,
  action,
  hidden,
}: {
  deck: PptDeckView;
  assets: PptAssetOption[];
  action?: BriefAction;
  /** 만들기(첫 저장)일 때 deckId·revision 대신 보낼 숨은 칸(productionBriefId) */
  hidden?: Record<string, string>;
}) {
  const id = useId();
  const [title, setTitle] = useState(deck.title);
  const [template, setTemplate] = useState<PptTemplate>(deck.templateKey);
  const [status, setStatus] = useState<PptDeckStatus>(deck.status);
  const [slides, setSlides] = useState<PptSlideView[]>(() => [...deck.slides].sort((a, b) => a.sortOrder - b.sortOrder));
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState("");
  // 순서를 옮긴 뒤 초점을 옮긴 항목의 같은 단추로(Tester QA-P3D-E2E-01 O1). 그린 뒤에 맞춘다
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    document.getElementById(target)?.focus();
  });
  const assetIds = assets.map((a) => a.id);
  const issues = checkPptDeck(title, slides, assetIds);
  const L = PPT_DECK_LIMITS;
  const change = (next: PptSlideView[], msg = "") => {
    setTouched(true);
    setSlides(next);
    setNote(msg);
  };
  const setField = <K extends keyof PptSlideView>(i: number, k: K, v: PptSlideView[K]) => change(slides.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const nTitle = countChars(title);
  const titleMsg = nTitle > L.title || touched ? issues.title : undefined;

  return (
    <ActionForm action={action ?? notConnectedAction} submitLabel={PPT_COPY.save} pendingLabel={P3_COMMON_COPY.savePending} className={`${f.form} ${pp.ppForm}`}>
      {hidden ? (
        Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)
      ) : (
        <>
          <input type="hidden" name="deckId" value={deck.id} />
          <input type="hidden" name="revision" value={deck.revision} />
        </>
      )}
      <input type="hidden" name="payload" value={JSON.stringify(toPptDeckPayload({ title, templateKey: template, status, slides }))} />

      <div className={styles.field}>
        <div className={pp.ppFieldHead}>
          <label htmlFor={`${id}-title`}>
            {PPT_LABELS.title} <span className={pp.ppReq}>(필수)</span>
          </label>
          <Counter id={`${id}-title-count`} n={nTitle} max={L.title} label={PPT_LABELS.title} />
        </div>
        <input
          id={`${id}-title`}
          type="text"
          value={title}
          onChange={(e) => {
            setTouched(true);
            setTitle(e.target.value);
          }}
          required
          aria-required
          aria-invalid={titleMsg ? true : undefined}
          aria-describedby={`${id}-title-count${titleMsg ? ` ${id}-title-msg` : ""}`}
        />
        {titleMsg && (
          <span id={`${id}-title-msg`} className={styles.error}>
            {titleMsg}
          </span>
        )}
      </div>

      <fieldset className={pp.ppTemplates}>
        <legend>{PPT_LABELS.template}</legend>
        <div className={pp.ppTemplateGrid}>
          {PPT_TEMPLATE_KEYS.map((k) => (
            <label key={k} className={pp.ppTemplate}>
              <input type="radio" name={`${id}-template`} value={k} checked={template === k} onChange={() => setTemplate(k)} />
              <span className={pp.ppTemplateText}>
                <span className={pp.ppTemplateName}>{PPT_TEMPLATES[k].name}</span>
                <span className={pp.ppTemplateDesc}>{PPT_TEMPLATES[k].desc}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <h4 className={pp.ppSubhead} id={`${id}-slides-h`}>{`${PPT_LABELS.slidesHeading} (${slides.length} / ${L.slidesMax}장)`}</h4>
      {issues.slides && <p className={styles.error}>{issues.slides}</p>}
      <ol className={pp.ppSlides} aria-labelledby={`${id}-slides-h`}>
        {slides.map((s, i) => (
          <SlideCard
            key={`${i}-${s.id ?? "new"}`}
            idBase={`${id}-s${i}`}
            s={s}
            i={i}
            count={slides.length}
            assets={assets}
            issues={issues}
            touched={touched}
            onField={(k, v) => setField(i, k, v)}
            onMove={(dir) => {
              const to = focusSideAfterMove(i, dir, slides.length);
              focusAfter.current = `${id}-s${to.index}-${to.side}`;
              change(moveSlide(slides, i, dir), `슬라이드 순서를 ${dir < 0 ? "위로" : "아래로"} 옮겼습니다.`);
            }}
            onRemove={() => change(removeSlide(slides, i))}
            onAsset={(aid, on) => setField(i, "assetIds", toggleAsset(s.assetIds, aid, on, assetIds))}
          />
        ))}
      </ol>
      {canAddSlide(slides) ? (
        <button type="button" className={`${styles.secondaryButton} ${f.touch}`} onClick={() => change(addSlide(slides))}>
          {PPT_LABELS.addSlide}
        </button>
      ) : (
        <p className={styles.muted} role="note">
          {PPT_COPY.slideLimitReached}
        </p>
      )}
      <p className={pp.ppSrOnly} role="status" aria-live="polite">
        {note}
      </p>

      {/* 만들기(hidden 있음)는 서버가 작성 중으로 시작하므로 진행 상태를 고르지 않는다 */}
      {!hidden && (
        <div className={styles.field}>
          <label htmlFor={`${id}-status`}>{PPT_LABELS.status}</label>
          <select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as PptDeckStatus)}>
            {PPT_DECK_STATUS_KEYS.map((k) => (
              <option key={k} value={k}>
                {PPT_DECK_STATUSES[k]}
              </option>
            ))}
          </select>
        </div>
      )}
    </ActionForm>
  );
}

function Counter({ id, n, max, label }: { id: string; n: number; max: number; label: string }) {
  return (
    <>
      <span id={id} className={n > max ? `${pp.ppCount} ${pp.ppCountOver}` : pp.ppCount}>
        {counterText(n, max)}
      </span>
      <span className={pp.ppSrOnly} aria-live="polite">
        {nearLimit(n, max) ? `${label} ${counterText(n, max)}` : ""}
      </span>
    </>
  );
}

function SlideCard({
  idBase,
  s,
  i,
  count,
  assets,
  issues,
  touched,
  onField,
  onMove,
  onRemove,
  onAsset,
}: {
  idBase: string;
  s: PptSlideView;
  i: number;
  count: number;
  assets: PptAssetOption[];
  issues: Record<string, string>;
  touched: boolean;
  onField: <K extends keyof PptSlideView>(k: K, v: PptSlideView[K]) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onAsset: (id: string, on: boolean) => void;
}) {
  const L = PPT_DECK_LIMITS;
  const name = `슬라이드 ${i + 1} · ${s.slideTitle || "이름 없음"}`;
  const hId = `${idBase}-h`;
  const text = (k: "slideTitle" | "bulletPoints" | "speakerNotes", label: string, max: number, multiline: boolean, required = false) => {
    const v = s[k];
    const n = countChars(v);
    const m = n > max || touched ? issues[slideKey(i, k)] : undefined;
    const fid = `${idBase}-${k}`;
    const common = {
      id: fid,
      value: v,
      onChange: (e: { target: { value: string } }) => onField(k, e.target.value),
      required,
      "aria-required": required || undefined,
      "aria-invalid": m ? true : undefined,
      "aria-describedby": `${fid}-count${m ? ` ${fid}-msg` : ""}`,
    };
    return (
      <div className={styles.field}>
        <div className={pp.ppFieldHead}>
          <label htmlFor={fid}>
            {label} {required && <span className={pp.ppReq}>(필수)</span>}
          </label>
          <Counter id={`${fid}-count`} n={n} max={max} label={label} />
        </div>
        {multiline ? <textarea {...common} rows={3} /> : <input type="text" {...common} />}
        {m && (
          <span id={`${fid}-msg`} className={styles.error}>
            {m}
          </span>
        )}
      </div>
    );
  };
  const assetMsg = issues[slideKey(i, "assetIds")];
  return (
    <li className={pp.ppSlide} aria-labelledby={hId}>
      <div className={pp.ppSlideHead}>
        <h5 id={hId} className={pp.ppSlideTitle}>
          {name}
        </h5>
        <div className={pp.ppTools} role="group" aria-label={`${name} 순서·제외`}>
          <button id={`${idBase}-up`} type="button" className={`${styles.secondaryButton} ${f.touch}`} disabled={i === 0} onClick={() => onMove(-1)} aria-label={`${name} ${PPT_LABELS.up}`}>
            {PPT_LABELS.up}
          </button>
          <button id={`${idBase}-down`} type="button" className={`${styles.secondaryButton} ${f.touch}`} disabled={i === count - 1} onClick={() => onMove(1)} aria-label={`${name} ${PPT_LABELS.down}`}>
            {PPT_LABELS.down}
          </button>
          <button type="button" className={`${styles.secondaryButton} ${f.touch}`} disabled={count <= 1} onClick={onRemove} aria-label={`${name} ${PPT_LABELS.exclude}`}>
            {PPT_LABELS.exclude}
          </button>
        </div>
      </div>
      {text("slideTitle", PPT_LABELS.slideTitle, L.slideTitle, false, true)}
      {text("bulletPoints", PPT_LABELS.bulletPoints, L.bulletPoints, true)}
      {text("speakerNotes", PPT_LABELS.speakerNotes, L.speakerNotes, true)}
      <fieldset className={pp.ppAssets}>
        <legend>
          {PPT_LABELS.assets} <span className={pp.ppCount}>{` ${s.assetIds.length}/${L.assetsPerSlide}개`}</span>
        </legend>
        <div className={pp.ppAssetGrid}>
          {assets.map((a) => (
            <label key={a.id} className={pp.ppCheck}>
              <input type="checkbox" checked={s.assetIds.includes(a.id)} onChange={(e) => onAsset(a.id, e.target.checked)} />
              <span>{a.label}</span>
            </label>
          ))}
        </div>
        {assetMsg && <span className={styles.error}>{assetMsg}</span>}
      </fieldset>
    </li>
  );
}
