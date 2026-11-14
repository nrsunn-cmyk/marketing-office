"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import styles from "../ui.module.css";
import { setupWorkspace, type SetupState } from "./actions";

const FIELDS: Array<{ name: string; label: string; required?: boolean; type?: string; autoComplete?: string }> = [
  { name: "name", label: "업무실 이름", required: true },
  { name: "legalName", label: "상호 (견적서 공급자)", required: true, autoComplete: "organization" },
  { name: "representative", label: "대표자" },
  { name: "businessNumber", label: "사업자등록번호" },
  { name: "phone", label: "전화번호", type: "tel", autoComplete: "tel" },
  { name: "email", label: "이메일", type: "email", autoComplete: "email" },
  { name: "address", label: "주소", autoComplete: "street-address" },
];

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(setupWorkspace, {});
  // 오류가 나도 입력한 값이 사라지지 않게 직접 보낸다 (ActionForm 과 같은 이유)
  function submitKeepingValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }
  return (
    <form action={action} onSubmit={submitKeepingValues} className={styles.form} noValidate>
      {state.message && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}
      {FIELDS.map((f) => {
        const error = state.errors?.[f.name];
        const errorId = `${f.name}-error`;
        return (
          <div className={styles.field} key={f.name}>
            <label htmlFor={f.name}>
              {f.label}
              {f.required ? " (필수)" : ""}
            </label>
            <input
              id={f.name}
              name={f.name}
              type={f.type ?? "text"}
              required={f.required}
              autoComplete={f.autoComplete}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            {error && (
              <span id={errorId} className={styles.muted} role="alert">
                {error}
              </span>
            )}
          </div>
        );
      })}
      <button type="submit" className={styles.button} disabled={pending}>
        {pending ? "저장 중…" : "업무실 만들기"}
      </button>
    </form>
  );
}
