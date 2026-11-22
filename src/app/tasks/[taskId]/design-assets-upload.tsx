"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { maxLengthMessage, requiredMessage } from "../../_components/josa";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import da from "./design-assets.module.css";
import {
  DA_COPY,
  DA_LABELS,
  DESIGN_ASSET_KINDS,
  DESIGN_ASSET_LIMITS,
  P3_COMMON_COPY,
  UPLOAD_RULE_LINE,
  countChars,
  counterText,
  formatBytes,
  guessMime,
  kindsForMime,
  precheckFile,
  titleFromFileName,
  uploadProgressText,
  type DesignAssetKind,
} from "./design-assets-model";
import { runDesignUpload, type PutJob, type UploadActions, type UploadPhase } from "./design-upload";

export type { UploadActions };

/**
 * 외부 파일 올리기·새 버전으로 교체(시안 assets.html '업로드·확정').
 * 대기(끌어 놓기·파일 고르기) → 올리는 중(실제 바이트) → 확정 중 → 성공 또는 실패(확정 문구 + 다시 시도·올리기 취소).
 * 새 자산은 분류·자산 이름(필수)·라이선스 메모를, 교체는 분류 고정 + 교체 사유를 받는다. 값은 자르지 않는다.
 */
export function DesignUploadPanel({
  mode,
  briefId,
  asset,
  actions,
  apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
}: {
  mode: "create" | "replace";
  briefId: string;
  asset?: { id: string; revision: number; kind: DesignAssetKind };
  actions?: UploadActions;
  apiKey?: string;
}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<DesignAssetKind>(asset?.kind ?? "logo");
  const [title, setTitle] = useState("");
  const [license, setLicense] = useState("");
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<UploadPhase>({ k: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const job = useRef<PutJob | null>(null);
  const L = DESIGN_ASSET_LIMITS;
  const busy = phase.k === "uploading" || phase.k === "confirming";

  const pick = (fl: File | null | undefined) => {
    if (!fl || busy) return;
    const mime = guessMime(fl.name, fl.type);
    const kinds = kindsForMime(mime);
    const k = mode === "replace" ? (asset?.kind ?? kind) : kinds.includes(kind) ? kind : (kinds[0] ?? kind);
    setFile(fl);
    setKind(k);
    if (mode === "create" && !title.trim()) setTitle(titleFromFileName(fl.name));
    const bad = precheckFile(k, fl);
    setPhase(bad ? { k: "error", text: bad } : { k: "idle" });
  };

  async function start() {
    if (!file || busy) return;
    if (!actions) {
      setPhase({ k: "error", text: P3_COMMON_COPY.notConnected });
      return;
    }
    if (mode === "create" && (countChars(title) === 0 || countChars(title) > L.title)) return;
    const last = await runDesignUpload(
      { briefId, asset: mode === "replace" && asset ? { id: asset.id, revision: asset.revision } : undefined, kind, file, title, licenseNote: license, changeNote: note },
      { actions, apiKey },
      setPhase,
      (j) => (job.current = j),
    );
    if (last.k === "done") {
      setFile(null);
      setTitle("");
      setLicense("");
      setNote("");
    }
  }

  const cancel = () => {
    if (job.current) job.current.cancel();
    else setPhase({ k: "idle" });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const nTitle = countChars(title);
  const titleMsg = mode === "create" && file ? (nTitle === 0 ? requiredMessage(DA_LABELS.title) : nTitle > L.title ? maxLengthMessage(DA_LABELS.title, L.title) : undefined) : undefined;
  const nLicense = countChars(license);
  const licenseMsg = nLicense > L.licenseNote ? maxLengthMessage(DA_LABELS.licenseNote, L.licenseNote) : undefined;
  const nNote = countChars(note);
  const noteMsg = nNote > L.changeNote ? maxLengthMessage(DA_LABELS.changeNote, L.changeNote) : undefined;
  const canStart = Boolean(file) && !busy && phase.k !== "error" && !titleMsg && !licenseMsg && !noteMsg;
  const allowedKinds = file ? kindsForMime(guessMime(file.name, file.type)) : (Object.keys(DESIGN_ASSET_KINDS) as DesignAssetKind[]);

  return (
    <div className={`${f.form} ${da.daUpload}`}>
      <div
        className={`${da.daDrop} ${dragOver ? da.daDropOver : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p className={f.keep}>{DA_COPY.uploadDropTitle}</p>
        <p className={`${styles.muted} ${f.keep}`}>{UPLOAD_RULE_LINE}</p>
        <label className={`${styles.secondaryButton} ${f.touch} ${da.daPick}`}>
          {DA_COPY.uploadPickFile}
          <input type="file" className={da.daSrOnly} disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {file && <p className={`${f.keep} ${da.daFileName}`}>{`${file.name} (${formatBytes(file.size)})`}</p>}
      </div>

      {mode === "create" ? (
        <>
          <div className={styles.field}>
            <label htmlFor={`${id}-kind`}>{DA_LABELS.kindGroup}</label>
            <select id={`${id}-kind`} value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as DesignAssetKind)}>
              {allowedKinds.map((k) => (
                <option key={k} value={k}>
                  {DESIGN_ASSET_KINDS[k]}
                </option>
              ))}
            </select>
          </div>
          <Field id={`${id}-title`} label={DA_LABELS.title} req="(필수)" value={title} onChange={setTitle} n={nTitle} max={L.title} msg={titleMsg} disabled={busy} />
          <Field id={`${id}-license`} label={DA_LABELS.licenseNote} req="(선택)" value={license} onChange={setLicense} n={nLicense} max={L.licenseNote} msg={licenseMsg} disabled={busy} multiline />
        </>
      ) : (
        <Field id={`${id}-note`} label={DA_LABELS.changeNote} req="(선택)" value={note} onChange={setNote} n={nNote} max={L.changeNote} msg={noteMsg} disabled={busy} />
      )}

      <div className={da.daUploadState} aria-live="polite">
        {phase.k === "uploading" && <p className={f.keep}>{uploadProgressText(phase.loaded, phase.total)}</p>}
        {phase.k === "confirming" && <p className={f.keep}>{DA_COPY.uploadConfirming}</p>}
        {phase.k === "done" && <p className={`${f.keep} ${da.daUploadOk}`}>{phase.text}</p>}
      </div>
      {phase.k === "error" && (
        <p className={styles.error} role="alert">
          {phase.text}
        </p>
      )}
      <div className={da.daUploadButtons}>
        {phase.k === "error" ? (
          <button type="button" className={`${styles.button} ${f.touch}`} onClick={() => (file ? (setPhase({ k: "idle" }), void start()) : setPhase({ k: "idle" }))}>
            {DA_COPY.uploadRetry}
          </button>
        ) : (
          <button type="button" className={`${styles.button} ${f.touch}`} disabled={!canStart} onClick={() => void start()}>
            {mode === "create" ? DA_COPY.createUpload : DA_COPY.replaceFile}
          </button>
        )}
        {(phase.k === "uploading" || phase.k === "error") && (
          <button type="button" className={`${styles.secondaryButton} ${f.touch}`} onClick={cancel}>
            {DA_COPY.uploadCancel}
          </button>
        )}
      </div>
    </div>
  );
}

function Field(p: { id: string; label: string; req: string; value: string; onChange: (v: string) => void; n: number; max: number; msg?: string; disabled: boolean; multiline?: boolean }) {
  const describedBy = `${p.id}-count${p.msg ? ` ${p.id}-msg` : ""}`;
  return (
    <div className={styles.field}>
      <div className={da.daFieldHead}>
        <label htmlFor={p.id}>
          {p.label} <span className={da.daReq}>{p.req}</span>
        </label>
        <span id={`${p.id}-count`} className={p.n > p.max ? `${da.daCount} ${da.daCountOver}` : da.daCount}>
          {counterText(p.n, p.max)}
        </span>
      </div>
      {p.multiline ? (
        <textarea id={p.id} rows={2} value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value)} aria-invalid={p.msg ? true : undefined} aria-describedby={describedBy} />
      ) : (
        <input id={p.id} type="text" value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value)} aria-invalid={p.msg ? true : undefined} aria-describedby={describedBy} />
      )}
      {p.msg && (
        <span id={`${p.id}-msg`} className={styles.error}>
          {p.msg}
        </span>
      )}
    </div>
  );
}
