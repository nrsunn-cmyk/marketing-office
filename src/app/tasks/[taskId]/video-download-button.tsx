"use client";

import { useState } from "react";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import vp from "./video-plan.module.css";

/** 영상 파일 판 내려받기: 서버가 60초 서명 주소(attachment)를 주면 그 주소로 이동한다. 보관한 구성안도 된다 */
export function VideoDownloadButton({
  planId,
  version,
  action,
}: {
  planId: string;
  version: number;
  action?: (planId: string, version: number) => Promise<{ ok: true; data: { url: string } } | { ok: false; message: string }>;
}) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <span className={vp.vpDownload}>
      <button
        type="button"
        className={`${styles.secondaryButton} ${f.touch}`}
        disabled={busy}
        aria-label={`v${version} 내려받기`}
        onClick={async () => {
          if (!action) return setErr("아직 서버와 연결되지 않아 저장할 수 없습니다.");
          setBusy(true);
          setErr("");
          const r = await action(planId, version);
          setBusy(false);
          if (r.ok) window.location.assign(r.data.url);
          else setErr(r.message);
        }}
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
