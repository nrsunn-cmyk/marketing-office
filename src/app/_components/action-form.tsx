"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
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
  className,
  variant = "primary",
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel?: string;
  children?: ReactNode;
  className?: string;
  /** primary: 화면의 주된 동작 / secondary: 상태 바꾸기·보관 같은 보조 동작 */
  variant?: "primary" | "secondary";
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  // 저장에 성공하면 폼을 서버가 보낸 최신 값(정리된 저장 값)으로 다시 맞춘다.
  // 오류일 때는 그대로 두어 입력한 값이 남는다. 는 이전 호출과의 호환을 위해 남겨 둔다.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  /**
   * React 19는 `<form action>`으로 보낸 뒤 입력을 자동으로 비운다. 그러면 칸 하나가 틀려도
   * 입력한 값이 모두 사라진다. 그래서 자바스크립트가 있으면 직접 보내서 값을 남기고,
   * 성공했을 때만 저장된 값으로 다시 맞춘다. 자바스크립트가 없으면 기존 action 으로 그대로 보낸다.
   */
  function submitKeepingValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const errors = Object.entries(state.errors ?? {});
  return (
    <form ref={formRef} action={formAction} onSubmit={submitKeepingValues} className={className ?? styles.form} noValidate>
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
      <button type="submit" className={variant === "primary" ? styles.button : styles.secondaryButton} disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
