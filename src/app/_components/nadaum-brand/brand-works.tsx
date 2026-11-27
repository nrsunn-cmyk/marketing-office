"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { requestContactPreset } from "./brand-contact";
import { PORTFOLIO_COPY as P, filterItems, safeLiveUrl, showFilters, type PortfolioFilter, type PortfolioItem } from "./portfolio-data";
import s from "./nadaum.module.css";

/** '비슷한 프로젝트 상담하기': 상담 구획으로 옮긴다(이미 #contact 면 해시 변화가 없으니 직접 스크롤) */
/** '사례 보기 →' → '사례 보기'. 끝 화살표는 화면 읽기에서 빼고 따로 그린다 */
export function hintText(hint: string): string {
  return hint.replace(/\s*→\s*$/, "");
}

function goToContact() {
  if (window.location.hash !== "#contact") {
    window.location.hash = "contact";
    return;
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("contact")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/**
 * NADAUM-PORTFOLIO-WORKS-FRONT-01 #works 사례 카드·분류 칩·상세 dialog(AGY PORTFOLIO-WORKS-SPEC-01 2·3절).
 * 사례가 1건 이상일 때만 그린다(0건이면 nadaum-home 이 '프로젝트 준비 중' 세 칸을 그대로 둔다).
 * - 카드 전체가 button. 누르면 네이티브 dialog(showModal). ESC·배경·닫기(×)로 닫으면 연 카드로 초점 복귀
 * - 상세의 '비슷한 프로젝트 상담하기'는 dialog 를 닫고 그 사례의 서비스를 상담 폼에 미리 고른 뒤 #contact 로
 */
export function PortfolioWorks({ items }: { items: readonly PortfolioItem[] }) {
  const [filter, setFilter] = useState<PortfolioFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const toContactRef = useRef(false);

  const shown = filterItems(items, filter);
  const open = items.find((i) => i.id === openId) ?? null;

  useEffect(() => {
    const d = dialogRef.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);

  const onClose = () => {
    setOpenId(null);
    // 상담으로 가는 경우는 상담 폼이 첫 칸으로 초점을 가져간다
    if (!toContactRef.current) openerRef.current?.focus();
    toContactRef.current = false;
  };

  const onConsult = (item: PortfolioItem) => {
    toContactRef.current = true;
    dialogRef.current?.close();
    requestContactPreset(item.presetServices);
    goToContact();
  };

  const live = open ? safeLiveUrl(open.liveUrl) : null;

  return (
    <>
      {showFilters(items) && (
        <div className={s.workFilters} role="group" aria-label={P.filtersLabel}>
          {P.filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`${s.workChip}${filter === f.key ? ` ${s.workChipActive}` : ""}`}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <ul className={`${s.grid3} ${s.workGrid}`}>
        {shown.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              className={s.workCard}
              aria-haspopup="dialog"
              onClick={(e) => {
                openerRef.current = e.currentTarget;
                setOpenId(w.id);
              }}
            >
              <span className={s.workCardMedia}>
                <Image src={w.thumbnailSrc} alt={w.thumbnailAlt} width={960} height={600} unoptimized className={s.workCardImg} />
                <span className={s.workKind}>{P.kind[w.kind]}</span>
              </span>
              <span className={s.workCardBody}>
                <span className={s.workCategory}>{w.categoryLabel}</span>
                <span className={s.workTitle}>{w.title}</span>
                <span className={s.workSummary}>{w.summary}</span>
                {/* Tester QA-NADAUM-PORTFOLIO-CONCEPT3-01 제안: 보이는 글자가 단추 이름에 들어가야 한다(WCAG 2.5.3). 화살표만 숨긴다 */}
                <span className={s.workHint}>
                  {hintText(P.viewHint)}
                  <span aria-hidden="true"> →</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        className={s.workDialog}
        aria-labelledby={open ? "work-dialog-title" : undefined}
        onClose={onClose}
        onClick={(e) => {
          // 배경(dialog 자신) 클릭이면 닫는다. 안쪽 내용 클릭은 그대로
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        {open && (
          <div className={s.workDialogInner}>
            <button type="button" className={s.workClose} aria-label={P.close} onClick={() => dialogRef.current?.close()}>
              <span aria-hidden="true">×</span>
            </button>
            <Image src={open.thumbnailSrc} alt={open.thumbnailAlt} width={960} height={600} unoptimized className={s.workDialogImg} />
            <p className={s.workDialogMeta}>
              <span className={s.workKindInline}>{P.kind[open.kind]}</span>
              <span className={s.workCategory}>{open.categoryLabel}</span>
            </p>
            <h3 id="work-dialog-title" className={s.workDialogTitle}>
              {open.title}
            </h3>
            <dl className={s.workFacts}>
              {open.industry && (
                <div>
                  <dt>{P.industry}</dt>
                  <dd>{open.industry}</dd>
                </div>
              )}
              <div>
                <dt>{P.deliverables}</dt>
                <dd>{open.categoryLabel}</dd>
              </div>
              {open.period && (
                <div>
                  <dt>{P.period}</dt>
                  <dd>{open.period}</dd>
                </div>
              )}
            </dl>
            <ol className={s.workSteps}>
              <li>
                <h4>{P.challenge}</h4>
                <p>{open.challenge}</p>
              </li>
              <li>
                <h4>{P.solution}</h4>
                <p>{open.solution}</p>
              </li>
              <li>
                <h4>{P.output}</h4>
                <ul className={s.workTags}>
                  {open.deliverables.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </li>
            </ol>
            <div className={s.workDialogActions}>
              {live && (
                <a href={live} target="_blank" rel="noopener noreferrer" className={`${s.btn} ${s.btnOutline}`}>
                  {P.live}
                </a>
              )}
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => onConsult(open)}>
                {P.cta}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
