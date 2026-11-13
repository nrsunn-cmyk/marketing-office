"use client";

import { useState } from "react";
import styles from "../ui.module.css";

/**
 * 복사 버튼. 클립보드를 쓸 수 없는 환경이면 대상 글을 선택해 주어 직접 복사할 수 있게 한다 (F03 실패 대안).
 */
export function CopyButton({ targetId, label }: { targetId: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "select">("idle");

  async function copy() {
    const el = document.getElementById(targetId);
    const text = el?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setStatus("select");
    }
  }

  return (
    <span className={styles.row}>
      <button type="button" className={styles.secondaryButton} onClick={copy}>
        {label}
      </button>
      <span role="status" className={styles.muted}>
        {status === "copied" && "복사했습니다."}
        {status === "select" && "자동 복사가 안 되어 글을 선택해 두었습니다. Ctrl+C로 복사해 주세요."}
      </span>
    </span>
  );
}
