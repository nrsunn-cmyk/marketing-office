"use client";

import { useId, useState } from "react";
import { ActionForm } from "../../_components/action-form";
import { BadgeArchived, BadgeDrafting, BadgeReady, BadgeStale } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import { QaFixTag } from "./qa-fix-tag";
import f from "./funnel.module.css";
import da from "./design-assets.module.css";
import { notConnectedAction, type BriefAction } from "./production-brief-edit-form";
import { BriefActionButton } from "./production-brief-buttons";
import { DesignUploadPanel, type UploadActions } from "./design-assets-upload";
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
  type DesignAssetsData,
} from "./design-assets-model";

/** 서버 동작(actions.ts). 시험에서 넘기지 않으면 단추마다 '아직 서버와 연결되지 않아…' 안내 */
export interface DesignAssetActions {
  save?: BriefAction;
  archive?: BriefAction;
  restore?: BriefAction;
  rebase?: BriefAction;
  usages?: BriefAction;
  download?: (assetId: string, version: number) => Promise<{ ok: true; data: { url: string } } | { ok: false; message: string }>;
  upload?: UploadActions;
}
/** 자산별 미리 보기(서버가 그릴 때 만든 300초 서명 주소, 색상은 글자) */
export type DesignPreviews = Record<string, { url?: string; text?: string }>;

/**
 * 디자인 자산 목록(시안 Design/p3-production/assets.html).
 * 분류 필터(전체·로고·이미지·색상·글꼴, 고른 단추 aria-pressed) → 자산 카드.
 * 고칠 수 없으면(읽기 전용·권한 없음·보관 자산) 폼·단추를 그리지 않고 내용·이력·내려받기만 보인다.
 */
export function DesignAssetList({
  data,
  locked,
  previews = {},
  actions = {},
  fixRequestedIds = [],
}: {
  data: Pick<DesignAssetsData, "assets" | "usageOptions" | "brief">;
  locked: boolean;
  previews?: DesignPreviews;
  actions?: DesignAssetActions;
  /** 검수에서 보완 요청된 자산 id(P3FG-UI-CONNECT-01-R1) */
  fixRequestedIds?: readonly string[];
}) {
  const [kind, setKind] = useState<DesignAssetKind | "all">("all");
  const counts = kindCounts(data.assets);
  const shown = filterAssets(data.assets, kind);
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
          <AssetCard key={a.id} a={a} briefId={data.brief.id} usageOptions={data.usageOptions} preview={previews[a.id]} locked={locked || a.archivedAt !== null} actions={actions} fixRequested={fixRequestedIds.includes(a.id)} />
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

/** 미리 보기: 그림은 <img> 로만(SVG 인라인 금지, 실행 막음), 색상·토큰은 글자로만, 글꼴은 없음 */
function Preview({ a, preview }: { a: DesignAssetView; preview?: { url?: string; text?: string } }) {
  if (preview?.url && a.mimeType.startsWith("image/")) {
    return (
      <figure className={da.daPreview}>
        {/* 서명 주소 그림(next/image 최적화를 거치지 않음 — 300초 서명 주소·SVG 를 그대로 보인다) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.url} alt={`${a.title} 미리 보기`} className={da.daPreviewImg} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        {a.mimeType === "image/svg+xml" && <figcaption className={`${styles.muted} ${f.keep}`}>{DA_COPY.svgPreviewNotice}</figcaption>}
      </figure>
    );
  }
  if (preview?.text !== undefined) {
    return (
      <pre className={da.daPreviewText} tabIndex={0} aria-label={`${a.title} 미리 보기`}>
        {preview.text}
      </pre>
    );
  }
  return null;
}

function DownloadButton({ assetId, version, action }: { assetId: string; version: number; action?: DesignAssetActions["download"] }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <span className={da.daDownload}>
      <button
        type="button"
        className={`${styles.secondaryButton} ${f.touch}`}
        disabled={busy}
        onClick={async () => {
          if (!action) return setErr(P3_COMMON_COPY.notConnected);
          setBusy(true);
          setErr("");
          const r = await action(assetId, version);
          setBusy(false);
          if (r.ok) window.location.assign(r.data.url);
          else setErr(r.message);
        }}
        aria-label={`v${version} 내려받기`}
      >
        내려받기
      </button>
      {err && (
        <span className={styles.error} role="alert">
          {err}
        </span>
      )}
    </span>
  );
}

function AssetCard({
  a,
  briefId,
  usageOptions,
  preview,
  locked,
  actions,
  fixRequested = false,
}: {
  a: DesignAssetView;
  briefId: string;
  usageOptions: DesignAssetsData["usageOptions"];
  preview?: { url?: string; text?: string };
  locked: boolean;
  actions: DesignAssetActions;
  fixRequested?: boolean;
}) {
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
        {a.stale && !a.archivedAt && (
          <span className={`${f.tag} ${f.tag_warn} ${da.daTagIcon}`}>
            <BadgeStale />
            이전 기준
          </span>
        )}
        <span className={f.tag}>{`v${a.version}`}</span>
        <QaFixTag show={fixRequested} />
      </p>
      <p className={`${styles.muted} ${f.keep}`}>{assetMetaLine(a)}</p>
      <Preview a={a} preview={preview} />
      <div className={da.daUsages}>
        <p className={da.daUsagesHead}>{a.usages.length ? `${DA_LABELS.usages} (${a.usages.length}):` : `${DA_LABELS.usages}:`}</p>
        {a.usages.length ? (
          <ul className={da.daUsageList}>
            {a.usages.map((u) => (
              <li key={u.id}>
                {u.label ?? (
                  // 홈페이지 문서 지금 판에서 사라진 섹션(또는 보관한 문서): 서버가 label 을 비워 준다
                  <span className={`${f.tag} ${f.tag_warn} ${da.daTagIcon}`}>
                    <BadgeStale />
                    이전 기준
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>{DA_LABELS.noUsages}</p>
        )}
      </div>
      {a.stale && !locked && <BriefActionButton action={actions.rebase} hidden={ids} submitLabel={DA_COPY.rebase} pendingLabel={P3_COMMON_COPY.rebasePending} />}

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
              <li key={v.id} className={`${da.daVersion} ${v.current ? da.daVersionCurrent : ""}`}>
                <p className={f.keep}>
                  <strong>{v.current ? `v${v.version} ${DA_LABELS.currentVersionMark}` : `v${v.version}`}</strong>
                  {` · ${formatKstMinute(v.savedAt)}${v.note ? ` · ${v.note}` : ""}${v.restoredFromVersion ? ` · v${v.restoredFromVersion}에서 되돌림` : ""}`}
                </p>
                <div className={da.daVersionTools}>
                  <DownloadButton assetId={a.id} version={v.version} action={actions.download} />
                  {v.current ? (
                    <span className={f.tag}>{DA_LABELS.inUse}</span>
                  ) : locked ? null : (
                    <BriefActionButton action={actions.restore} hidden={{ ...ids, version: v.version }} submitLabel={DA_COPY.restore} pendingLabel={P3_COMMON_COPY.savePending} />
                  )}
                </div>
              </li>
            ))}
          </ol>
          {!locked && (
            <>
              <AssetEditForm a={a} action={actions.save} />
              <UsagesForm a={a} options={usageOptions} action={actions.usages} />
              <DesignUploadPanel mode="replace" briefId={briefId} asset={{ id: a.id, revision: a.revision, kind: a.kind }} actions={actions.upload} />
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

/** 사용처(홈페이지 섹션) 고르기 — 전체 교체, 자산당 20곳. 지금 판에서 사라진 사용처는 목록에 없어 저장하면 빠진다 */
function UsagesForm({ a, options, action }: { a: DesignAssetView; options: DesignAssetsData["usageOptions"]; action?: BriefAction }) {
  const id = useId();
  const key = (o: { docId: string; sectionId: string }) => `${o.docId}:${o.sectionId}`;
  const [sel, setSel] = useState<Set<string>>(() => new Set(a.usages.map(key)));
  if (options.length === 0) return null;
  const max = DESIGN_ASSET_LIMITS.usagesPerAsset;
  const chosen = options.filter((o) => sel.has(key(o)));
  const over = chosen.length > max;
  return (
    <ActionForm action={action ?? notConnectedAction} submitLabel={DA_COPY.save} pendingLabel={P3_COMMON_COPY.savePending} variant="secondary" className={`${f.form} ${da.daForm}`}>
      <input type="hidden" name="assetId" value={a.id} />
      <input type="hidden" name="revision" value={a.revision} />
      <input type="hidden" name="payload" value={JSON.stringify(chosen.map((o) => ({ docId: o.docId, sectionId: o.sectionId })))} />
      <fieldset className={da.daUsagePick} aria-describedby={`${id}-count`}>
        <legend>{`${DA_LABELS.usages} (${chosen.length} / ${max})`}</legend>
        <div className={da.daUsageGrid}>
          {options.map((o) => (
            <label key={key(o)} className={da.daCheck}>
              <input
                type="checkbox"
                checked={sel.has(key(o))}
                onChange={(e) => {
                  const next = new Set(sel);
                  if (e.target.checked) next.add(key(o));
                  else next.delete(key(o));
                  setSel(next);
                }}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
        <span id={`${id}-count`} className={over ? `${da.daCount} ${da.daCountOver}` : da.daSrOnly}>
          {over ? `사용처는 자산당 ${max}곳까지입니다.` : `${chosen.length} / ${max}`}
        </span>
      </fieldset>
    </ActionForm>
  );
}
