"use client";

import { useRef, useState } from "react";
import styles from "../../ui.module.css";
import s from "./strategy.module.css";

/**
 * P2-STRATEGY-UI-GAP-01 결함 1: 보고 있는 전략 버전의 데이터(JSON, 2칸 들여쓰기)를 복사한다(시안 v2.4 copyDraftToClipboard 와 같은 형식).
 * 클립보드를 쓸 수 없으면 아래 JSON 상자를 펼쳐 글을 선택해 두고 Ctrl+C 를 안내한다(공용 CopyButton 과 같은 대안).
 * JSON 은 서버가 만든 텍스트이며 화면에는 <pre> 텍스트로만 넣는다.
 */
export function StrategyJsonCopy({ json, versionLabel }: { json: string; versionLabel: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "select">("idle");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard 없음");
      await navigator.clipboard.writeText(json);
      setStatus("copied");
    } catch {
      if (detailsRef.current) detailsRef.current.open = true;
      const pre = preRef.current;
      if (pre) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        pre.focus();
      }
      setStatus("select");
    }
  }

  return (
    <div className={s.copyBox}>
      <span className={styles.row}>
        <button type="button" className={styles.secondaryButton} onClick={copy}>
          전략 데이터(JSON) 복사
        </button>
        <span role="status" className={styles.muted}>
          {status === "copied" && `${versionLabel} 데이터를 복사했습니다.`}
          {status === "select" && "자동 복사가 안 되어 아래 JSON 글을 선택해 두었습니다. Ctrl+C로 복사해 주세요."}
        </span>
      </span>
      <details ref={detailsRef}>
        <summary>복사할 JSON 보기</summary>
        <pre ref={preRef} className={styles.pre} tabIndex={-1} data-testid="strategy-json">
          {json}
        </pre>
      </details>
    </div>
  );
}

/**
 * P2-STRATEGY-UI-GAP-01 결함 2: 결과가 있을 때 긴 입력 폼 앞에서 결과로 바로 간다.
 * 자바스크립트가 없어도 #strategy-result 로 이동하고, 있으면 그 제목(tabIndex=-1)에 키보드 포커스를 옮긴다.
 */
export function SkipToResult() {
  return (
    <a
      href="#strategy-result"
      className={s.skipLink}
      onClick={(e) => {
        const target = document.getElementById("strategy-result");
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ block: "start" });
        target.focus();
        history.replaceState(null, "", "#strategy-result");
      }}
    >
      결과 바로 보기
    </a>
  );
}
