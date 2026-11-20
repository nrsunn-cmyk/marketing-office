"use client";

import { useRef, useState } from "react";
import styles from "../ui.module.css";
import { SOURCE_UPLOAD_COPY, precheckSourceFile, runSourceUpload, uploadProgressText, type PutJob, type SourceUploadActions, type SourceUploadPhase } from "./source-upload-model";

/**
 * 자료 파일 올리기(SOURCE-UPLOAD-UI-01). 운영 Vercel 함수 본문 4.5MB 한도를 피하려고 파일은 브라우저가 저장소에 직접 올린다.
 * 제목·안내·라벨은 기존 화면 그대로(파일·휴대폰 안내·'파일 올리기'), 단계 문구는 AGY SOURCE_UPLOAD_COPY.
 * 진행은 실제 보낸 바이트 글자만(%·막대 없음). 성공은 role=status, 실패는 role=alert + 다시 시도·올리기 취소.
 */
export function SourceUploadForm({
  owner,
  actions,
  apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  initialPhase = { k: "idle" },
}: {
  owner: { clientId: string | null; projectId: string | null };
  actions?: SourceUploadActions;
  apiKey?: string;
  /** 처음 단계(화면 점검·시험에서 단계별 모습을 그릴 때만 쓴다) */
  initialPhase?: SourceUploadPhase;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const job = useRef<PutJob | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<SourceUploadPhase>(initialPhase);
  // 올리기를 시도한 뒤의 실패만 '다시 시도'(고르기 단계 미리 막기는 파일을 바꾸는 것이 답이라 '파일 올리기' 그대로)
  const [tried, setTried] = useState(false);
  const busy = phase.k === "preparing" || phase.k === "uploading" || phase.k === "confirming";

  async function start() {
    const f = file ?? inputRef.current?.files?.[0] ?? null;
    if (busy) return;
    if (!f) return setPhase({ k: "error", text: "올릴 파일을 선택해 주세요." });
    if (!actions) return setPhase({ k: "error", text: "아직 서버와 연결되지 않아 저장할 수 없습니다." });
    setTried(true);
    const last = await runSourceUpload(owner, f, { actions, apiKey }, setPhase, (j) => (job.current = j));
    if (last.k === "done") {
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  const cancel = () => {
    if (job.current) job.current.cancel();
    else setPhase({ k: "idle" });
  };

  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="asset-file">파일</label>
        <input
          ref={inputRef}
          id="asset-file"
          name="file"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt"
          aria-describedby="asset-file-help"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setTried(false);
            const bad = f ? precheckSourceFile(f) : null;
            setPhase(bad ? { k: "error", text: bad } : { k: "idle" });
          }}
        />
        <span id="asset-file-help" className={styles.muted}>
          휴대폰에서는 파일 고르기 창에서 사진 찍기도 고를 수 있습니다.
        </span>
      </div>

      <div aria-live="polite">
        {phase.k === "preparing" && <p className={styles.muted}>{SOURCE_UPLOAD_COPY.uploadPreparing}</p>}
        {phase.k === "uploading" && <p className={styles.muted}>{uploadProgressText(phase.loaded, phase.total)}</p>}
        {phase.k === "confirming" && <p className={styles.muted}>{SOURCE_UPLOAD_COPY.uploadConfirming}</p>}
      </div>
      {phase.k === "done" && (
        <p className={styles.notice} role="status">
          {phase.text}
        </p>
      )}
      {phase.k === "error" && (
        <p className={styles.error} role="alert">
          {phase.text}
        </p>
      )}

      <div className={styles.row}>
        {phase.k === "error" && file && tried ? (
          <button type="button" className={styles.button} onClick={() => void start()}>
            {SOURCE_UPLOAD_COPY.uploadRetry}
          </button>
        ) : (
          <button type="button" className={styles.button} disabled={busy} onClick={() => void start()}>
            {busy ? "올리는 중…" : "파일 올리기"}
          </button>
        )}
        {(phase.k === "uploading" || phase.k === "error") && (
          <button type="button" className={styles.secondaryButton} onClick={cancel}>
            {SOURCE_UPLOAD_COPY.uploadCancel}
          </button>
        )}
      </div>
    </div>
  );
}
