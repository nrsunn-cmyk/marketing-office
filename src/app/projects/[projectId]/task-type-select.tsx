"use client";

import { useEffect, useRef } from "react";

/** 브라우저에 남겨 둔 마지막 작업 유형 키(업무실·기기마다, 실패해도 기본값) */
export const LAST_TASK_TYPE_KEY = "marketing-office:last-task-type";

/** 남겨 둔 값이 이 프로젝트에서 고를 수 있는 유형이면 그것, 아니면 기본값(UX-SCENARIO-AUDIT-01 F3) */
export function pickTaskType(stored: string | null, allowed: readonly string[], fallback: string): string {
  return stored && allowed.includes(stored) ? stored : fallback;
}

/**
 * 새 작업 유형 고르기. 처음 그릴 때는 기본값(로고)으로 그리고(서버와 같게), 브라우저가 준비되면
 * 마지막으로 고른 유형으로 바꾼다. 브라우저 저장소를 못 쓰면(사생활 모드 등) 기본값 그대로.
 */
export function TaskTypeSelect({ options, fallback }: { options: ReadonlyArray<{ value: string; label: string }>; fallback: string }) {
  const ref = useRef<HTMLSelectElement>(null);
  const allowed = options.map((o) => o.value);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LAST_TASK_TYPE_KEY);
    } catch {
      stored = null;
    }
    if (ref.current) ref.current.value = pickTaskType(stored, allowed, fallback);
    // 고를 수 있는 유형이 바뀔 때만 다시 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed.join(","), fallback]);
  return (
    <select
      ref={ref}
      id="task-type"
      name="type"
      defaultValue={fallback}
      onChange={(e) => {
        try {
          window.localStorage.setItem(LAST_TASK_TYPE_KEY, e.target.value);
        } catch {
          /* 저장 못 해도 고르기는 된다 */
        }
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
