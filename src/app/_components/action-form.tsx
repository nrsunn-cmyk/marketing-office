"use client";

import { startTransition, useActionState, useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import styles from "../ui.module.css";
// useState 는 따로 가져온다(위 react import 줄은 다른 브랜치가 고친 줄이라 병합 충돌을 피한다)
import { useState } from "react";
import { useFlash } from "./flash";
import { EMPTY_FORM_STATE, type FormState } from "./form-state";
import { HYDRATION_HINT_TEXT, useHydrationHint } from "./hydration-hint";
import { useHydrated } from "./use-hydrated";

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
  // 성공과 함께 이 폼이 화면에서 빠지면 안내를 공용 안내 영역으로 넘긴다(flash.tsx, BUNDLE-C-PREP-01)
  const flash = useFlash();
  const [flashKey] = useState(() => ({})); // 이 폼 하나를 가리키는 변하지 않는 표지(렌더 중 ref 읽기를 피한다)
  const [state, formAction, pending] = useActionState(flash ? flash.wrap(flashKey, action) : action, EMPTY_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const hydrated = useHydrated(); // hydration 전 제출 차단(BUG-SESSION-HYDRATION-01)
  const localWaitId = useId();
  const sharedHintId = useHydrationHint(); // 화면당 한 번만 보이는 공용 준비 안내(BUNDLE-D-FRONT-01)
  const waitId = sharedHintId ?? localWaitId;

  // 저장에 성공하면 폼을 서버가 보낸 최신 값(정리된 저장 값)으로 다시 맞춘다.
  // 오류일 때는 그대로 두어 입력한 값이 남는다. 는 이전 호출과의 호환을 위해 남겨 둔다.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
    if (state.ok && state.message) flash?.claim(flashKey); // 폼이 남아 안내를 직접 그린다
  }, [state, flash, flashKey]);
  useEffect(() => {
    flash?.mount(flashKey);
    return () => flash?.release(flashKey); // 폼이 사라질 때 맡겨 둔 성공 안내가 있으면 공용 영역에 보인다
  }, [flash, flashKey]);

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
      <button
        type="submit"
        className={variant === "primary" ? styles.button : styles.secondaryButton}
        disabled={pending || !hydrated}
        aria-describedby={hydrated ? undefined : waitId}
      >
        {pending ? pendingLabel : submitLabel}
      </button>
      {/* BUG-MOBILE-NEWTASK-01: 느린 연결에서는 준비 전 비활성 버튼이 몇 초 동안 '눌러도 반응 없음'으로 보인다. 이유를 글로 알린다(준비되면 사라짐).
          공용 안내(hydration-hint.tsx)가 있으면 그 하나를 가리키고, 없을 때만 여기 그린다 */}
      {!hydrated && !sharedHintId && (
        <span id={localWaitId} className={styles.muted}>
          {HYDRATION_HINT_TEXT}
        </span>
      )}
    </form>
  );
}
