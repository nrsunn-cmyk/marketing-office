"use client";

import { useEffect, useState } from "react";
import styles from "../ui.module.css";

export const THEME_STORAGE_KEY = "mo-theme";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 라이트/다크 전환 (AGY 04 §3.2). 처음에는 OS 설정을 따르고, 누르면 선택을 기억한다. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    // 화면 준비 뒤에 실제 적용된 테마를 읽는다(서버는 알 수 없으므로)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(currentTheme());
  }, []);

  function toggle() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 저장이 막힌 브라우저에서는 이번 화면에만 적용
    }
    setTheme(next);
  }

  return (
    <button type="button" className={styles.iconButton} onClick={toggle} aria-pressed={theme === "dark"} aria-label="어두운 화면">
      <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>
    </button>
  );
}
