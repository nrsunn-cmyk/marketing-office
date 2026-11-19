"use client";

import { useId, useState } from "react";
import { ActionForm } from "../../_components/action-form";
import { BadgeArchived, BadgeDrafting, BadgeReady } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import da from "./design-assets.module.css";
import { notConnectedAction, type BriefAction } from "./production-brief-edit-form";
import { BriefActionButton } from "./production-brief-buttons";
import {
  DA_COPY,
  DA_LABELS,
  DESIGN_ASSET_KINDS,
  DESIGN_ASSET_KIND_KEYS,
  DESIGN_ASSET_LIMITS,
  DESIGN_ASSET_ORIGINS,
  DESIGN_ASSET_STATUSES,
  DESIGN_ASSET_STATUS_KEYS,
  P3_COMMON_COPY,
  assetMetaLine,
  assetToForm,
  checkAssetForm,
  countChars,
  counterText,
  filterAssets,
  formatKstMinute,
  kindCounts,
  nearLimit,
  toAssetPayload,
  type DesignAssetKind,
  type DesignAssetStatus,
  type DesignAssetView,
} from "./design-assets-model";

/** 서버 동작 자리(P3-c 서버가 오면 actions.ts 의 동작을 넘긴다. 없으면 단추마다 '아직 서버와 연결되지 않아…' 안내) */
export interface DesignAssetActions {
  save?: BriefAction;
  replace?: BriefAction;
  archive?: BriefAction;
  restore?: BriefAction;
}

/**
 * 디자인 자산 목록(P3C-UI-PREP-01, 시안 Design/p3-production/assets.html).
 * 분류 필터(전체·로고·이미지·색상·글꼴, 고른 단추 aria-pressed) → 자산 카드.
 * 고칠 수 없으면(읽기 전용·권한 없음·보관 자산) 폼·단추를 그리지 않고 내용과 이력만 보인다.
 */
export function DesignAssetList({ assets, locked, actions = {} }: { assets: DesignAssetView[]; locked: boolean; actions?: DesignAssetActions }) {
  const [kind, setKind] = useState<DesignAssetKind | "all">("all");
  const counts = kindCounts(assets);
  const shown = filterAssets(assets, kind);
  const filters: Array<DesignAssetKind | "all"> = ["all", ...DESIGN_ASSET_KIND_KEYS];
  return (
    <>
      <div className={da.daFilters} role="group" aria-label={DA_LABELS.kindGroup}>
        {filters.map((k) => (
          <button key={k} type="button" className={da.daFilter} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {`${k === "all" ? DA_LABELS.filterAll : DESIGN_ASSET_KINDS[k]} (${counts[k]})`}
          </button>
        ))}
      </div>
      <ul className={da.daList} aria-label={`${DA_COPY.heading} 목록`}>
        {shown.map((a) => (
          <AssetCard key={a.id} a={a} locked={locked || a.archivedAt !== null} actions={actions} />
        ))}
      </ul>
    </>
  );
}

function StatusBadge({ status }: { status: DesignAssetStatus }) {
  const Icon = status === "reviewed" ? BadgeReady : BadgeDrafting;
  return (
    <span className={`${da.daBadge} ${da[`daBadge_${status}`]}`}>
      <Icon />
      {DESIGN_ASSET_STATUSES[status]}
    </span>
  );
}

function AssetCard({ a, locked, actions }: { a: DesignAssetView; locked: boolean; actions: DesignAssetActions }) {
  const titleId = `da-${a.id}`;
  const ids = { assetId: a.id, revision: a.revision };
  const versions = [...a.versions].sort((x, y) => y.version - x.version);
  return (
    <li className={`${da.daCard} ${a.archivedAt ? da.daCardArchived : ""}`} aria-labelledby={titleId}>
      <h3 id={titleId} className={da.daCardTitle}>
        {a.title}
      </h3>
      <p className={da.daBadges}>
        <span className={`${da.daBadge} ${da[`daOrigin_${a.origin}`]}`}>{DESIGN_ASSET_ORIGINS[a.origin]}</span>
        <StatusBadge status={a.status} />
        {a.archivedAt && (
          <span className={`${da.daBadge} ${da.daBadge_archived}`}>
            <BadgeArchived />
            {DA_LABELS.archivedBadge}
          </span>
        )}
        <span className={f.tag}>{`v${a.version}`}</span>
      </p>
      <p className={`${styles.muted} ${f.keep}`}>{assetMetaLine(a)}</p>
      <div className={da.daUsages}>
        <p className={da.daUsagesHead}>{a.usages.length ? `${DA_LABELS.usages} (${a.usages.length}):` : `${DA_LABELS.usages}:`}</p>
        {a.usages.length ? (
          <ul className={da.daUsageList}>
            {a.usages.map((u) => (
              <li key={u.id}>{u.label}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>{DA_LABELS.noUsages}</p>
        )}
      </div>

      <details className={f.inlineDetails}>
        <summary>{DA_LABELS.detailsSummary}</summary>
        <div className={da.daCardBody}>
          {a.archivedAt && (
            <div className={styles.notice} role="note">
              <p className={f.keep}>{DA_COPY.archivedNote}</p>
            </div>
          )}
          {!locked && <p className={`${styles.muted} ${f.keep}`}>{P3_COMMON_COPY.restoreHint}</p>}
          <ol className={da.daVersions}>
            {versions.map((v) => (
              <li key={v.version} className={`${da.daVersion} ${v.current ? da.daVersionCurrent : ""}`}>
                <p className={f.keep}>
                  <strong>{v.current ? `v${v.version} ${DA_LABELS.currentVersionMark}` : `v${v.version}`}</strong>
                  {` · ${formatKstMinute(v.savedAt)}${v.note ? ` · ${v.note}` : ""}`}
                </p>
                {v.current ? (
                  <span className={f.tag}>{DA_LABELS.inUse}</span>
                ) : locked ? null : (
                  <BriefActionButton action={actions.restore} hidden={{ ...ids, version: v.version }} submitLabel={DA_COPY.restore} pendingLabel={P3_COMMON_COPY.savePending} />
                )}
              </li>
            ))}
          </ol>
          {!locked && (
            <>
              <AssetEditForm a={a} action={actions.save} />
              <ReplaceForm a={a} action={actions.replace} />
              <details className={`${f.inlineDetails} ${da.daDanger}`}>
                <summary>{DA_COPY.archive}</summary>
                <BriefActionButton action={actions.archive} hidden={ids} submitLabel={DA_COPY.archive} pendingLabel={P3_COMMON_COPY.archivePending}>
                  <p className={`${styles.muted} ${f.keep}`}>{P3_COMMON_COPY.archiveConfirm}</p>
                </BriefActionButton>
              </details>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

function Counter({ id, n, max, label }: { id: string; n: number; max: number; label: string }) {
  return (
    <>
      <span id={id} className={n > max ? `${da.daCount} ${da.daCountOver}` : da.daCount}>
        {counterText(n, max)}
      </span>
      {/* 한도 근처·넘침일 때만 읽어 준다(QA-P3A-UI-01 R2 와 같은 방식) */}
      <span className={da.daSrOnly} aria-live="polite">
        {nearLimit(n, max) ? `${label} ${counterText(n, max)}` : ""}
      </span>
    </>
  );
}

function AssetEditForm({ a, action }: { a: DesignAssetView; action?: BriefAction }) {
  const id = useId();
  const [v, setV] = useState(assetToForm(a));
  const [touched, setTouched] = useState(false);
  const issues = checkAssetForm(v);
  const L = DESIGN_ASSET_LIMITS;
  const nTitle = countChars(v.title);
  const nLicense = countChars(v.licenseNote);
  const titleMsg = nTitle > L.title || touched ? issues.title : undefined;
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => {
    setTouched(true);
    setV((p) => ({ ...p, [k]: val }));
  };
  return (
    <ActionForm action={action ?? notConnectedAction} submitLabel={DA_COPY.save} pendingLabel={P3_COMMON_COPY.savePending} className={`${f.form} ${da.daForm}`}>
      <input type="hidden" name="assetId" value={a.id} />
      <input type="hidden" name="revision" value={a.revision} />
      <input type="hidden" name="payload" value={JSON.stringify(toAssetPayload(v))} />
      <div className={styles.field}>
        <div className={da.daFieldHead}>
          <label htmlFor={`${id}-title`}>
            {DA_LABELS.title} <span className={da.daReq}>(필수)</span>
          </label>
          <Counter id={`${id}-title-count`} n={nTitle} max={L.title} label={DA_LABELS.title} />
        </div>
        <input
          id={`${id}-title`}
          type="text"
          value={v.title}
          onChange={(e) => set("title", e.target.value)}
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
      <div className={styles.field}>
        <div className={da.daFieldHead}>
          <label htmlFor={`${id}-license`}>
            {DA_LABELS.licenseNote} <span className={da.daReq}>(선택)</span>
          </label>
          <Counter id={`${id}-license-count`} n={nLicense} max={L.licenseNote} label={DA_LABELS.licenseNote} />
        </div>
        <textarea
          id={`${id}-license`}
          rows={2}
          value={v.licenseNote}
          onChange={(e) => set("licenseNote", e.target.value)}
          aria-invalid={issues.licenseNote ? true : undefined}
          aria-describedby={`${id}-license-count${issues.licenseNote ? ` ${id}-license-msg` : ""}`}
        />
        {issues.licenseNote && (
          <span id={`${id}-license-msg`} className={styles.error}>
            {issues.licenseNote}
          </span>
        )}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-status`}>{DA_LABELS.status}</label>
        <select id={`${id}-status`} value={v.status} onChange={(e) => set("status", e.target.value as DesignAssetStatus)}>
          {DESIGN_ASSET_STATUS_KEYS.map((s) => (
            <option key={s} value={s}>
              {DESIGN_ASSET_STATUSES[s]}
            </option>
          ))}
        </select>
      </div>
    </ActionForm>
  );
}

/** 새 버전으로 교체(실제 파일 올리기는 서버 연결 뒤 — 지금은 교체 사유만 받는 자리) */
function ReplaceForm({ a, action }: { a: DesignAssetView; action?: BriefAction }) {
  const id = useId();
  const [note, setNote] = useState("");
  const n = countChars(note);
  const max = DESIGN_ASSET_LIMITS.changeNote;
  return (
    <ActionForm action={action ?? notConnectedAction} submitLabel={DA_COPY.replaceFile} pendingLabel={P3_COMMON_COPY.savePending} variant="secondary" className={`${f.form} ${da.daForm}`}>
      <input type="hidden" name="assetId" value={a.id} />
      <input type="hidden" name="revision" value={a.revision} />
      <div className={styles.field}>
        <div className={da.daFieldHead}>
          <label htmlFor={`${id}-note`}>
            {DA_LABELS.changeNote} <span className={da.daReq}>(선택)</span>
          </label>
          <Counter id={`${id}-note-count`} n={n} max={max} label={DA_LABELS.changeNote} />
        </div>
        <input id={`${id}-note`} type="text" name="changeNote" value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={`${id}-note-count`} />
      </div>
    </ActionForm>
  );
}
