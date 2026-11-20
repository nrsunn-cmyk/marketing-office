"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import da from "./design-assets.module.css";
import { DA_COPY, P3_COMMON_COPY, uploadProgressText } from "./design-assets-model";
import type { PutJob, UploadPhase } from "./design-upload";
import { runVideoUpload, type VideoUploadActions } from "./video-upload";
import { VIDEO_PLAN_LIMITS, VP_COPY, countChars, counterText, formatBytes, precheckVideoFile } from "./video-plan-model";

/**
 * 영상 파일 첨부(시안 video-plan.html 업로드 상태 = P3-c 업로드·확정 재사용).
 * 대기(끌어 놓기·파일 고르기) → 올리는 중(실제 바이트) → 확정 중 → 첨부됨 또는 실패(다시 시도·올리기 취소). 버전 메모 300자.
 */
export function VideoUploadPanel({
  planId,
  revision,
  limitBytes = VIDEO_PLAN_LIMITS.maxFileBytes,
  actions,
  apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
}: {
  planId: string;
  revision: number;
  limitBytes?: number;
  actions?: VideoUploadActions;
  apiKey?: string;
}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<UploadPhase>({ k: "idle" });
  const [tried, setTried] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const job = useRef<PutJob | null>(null);
  const busy = phase.k === "uploading" || phase.k === "confirming";
  const nNote = countChars(note);
  const noteOver = nNote > VIDEO_PLAN_LIMITS.changeNote;

  const pick = (fl: File | null | undefined) => {
    if (!fl || busy) return;
    setFile(fl);
    setTried(false);
    const bad = precheckVideoFile(fl, limitBytes);
    setPhase(bad ? { k: "error", text: bad } : { k: "idle" });
  };
  async function start() {
    if (!file || busy || noteOver) return;
    if (!actions) return setPhase({ k: "error", text: P3_COMMON_COPY.notConnected });
    setTried(true);
    const last = await runVideoUpload({ planId, revision, file, changeNote: note, limitBytes }, { actions, apiKey }, setPhase, (j) => (job.current = j));
    if (last.k === "done") {
      setFile(null);
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
        <label className={`${styles.secondaryButton} ${f.touch} ${da.daPick}`}>
          {DA_COPY.uploadPickFile}
          <input type="file" accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm" className={da.daSrOnly} disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {file && <p className={`${f.keep} ${da.daFileName}`}>{`${file.name} (${formatBytes(file.size)})`}</p>}
      </div>
      <div className={styles.field}>
        <div className={da.daFieldHead}>
          <label htmlFor={`${id}-note`}>
            버전 메모 <span className={da.daReq}>(선택)</span>
          </label>
          <span id={`${id}-note-count`} className={noteOver ? `${da.daCount} ${da.daCountOver}` : da.daCount}>
            {counterText(nNote, VIDEO_PLAN_LIMITS.changeNote)}
          </span>
        </div>
        <input id={`${id}-note`} type="text" value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} aria-invalid={noteOver ? true : undefined} aria-describedby={`${id}-note-count`} />
      </div>
      <div className={da.daUploadState} aria-live="polite">
        {phase.k === "uploading" && <p className={f.keep}>{uploadProgressText(phase.loaded, phase.total)}</p>}
        {phase.k === "confirming" && <p className={f.keep}>{DA_COPY.uploadConfirming}</p>}
        {phase.k === "done" && (
          <p className={`${f.keep} ${da.daUploadOk}`} role="status">
            {phase.text}
          </p>
        )}
      </div>
      {phase.k === "error" && (
        <p className={styles.error} role="alert">
          {phase.text}
        </p>
      )}
      <div className={da.daUploadButtons}>
        {phase.k === "error" && tried && file ? (
          <button type="button" className={`${styles.button} ${f.touch}`} onClick={() => void start()}>
            {DA_COPY.uploadRetry}
          </button>
        ) : (
          <button type="button" className={`${styles.button} ${f.touch}`} disabled={!file || busy || phase.k === "error" || noteOver} onClick={() => void start()}>
            {VP_COPY.attachFile}
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
