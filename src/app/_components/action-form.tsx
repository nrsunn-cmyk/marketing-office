"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import styles from "../ui.module.css";
import { EMPTY_FORM_STATE, type FormState } from "./form-state";

/**
 * 서버 동작을 쓰는 폼. 저장 중 표시, 성공·오류 안내, 칸별 오류를 공통으로 처리한다.
 * 칸별 오류는 children 안의 <FieldError name="..."/> 가 아니라 아래 목록으로 보여 준다(단순화).
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel = "저장 중…",
  children,
  resetOnSuccess = false,
  className,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel?: string;
  children?: ReactNode;
  resetOnSuccess?: boolean;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  const errors = Object.entries(state.errors ?? {});
  return (
    <form ref={formRef} action={formAction} className={className ?? styles.form} noValidate>
      {children}
      {errors.length > 0 && (
        <ul className={styles.error} role="alert">
          {errors.map(([field, msg]) => (
            <li key={field}>{msg}</li>
          ))}
        </ul>
      )}
      {state.message && (
        <p className={state.ok ? styles.notice : styles.error} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      )}
      <button type="submit" className={styles.button} disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
