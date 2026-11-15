"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import s from "./auth.module.css";
import { EMPTY_FORM_STATE, type FormState } from "./form-state";

/**
 * 인증 화면 폼 (1안 모던 슬레이트). 동작은 ActionForm 과 같다:
 * 오류 때 입력을 남기고, 칸별 오류·결과 안내를 보여 주며, 성공하면 폼을 비운다.
 */
export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  tone,
  icon,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel: string;
  /** 버튼 색: primary 로그인(파랑) / success 가입(초록) / dark 재설정(네이비) */
  tone: "primary" | "success" | "dark";
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  function submitKeepingValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const errors = Object.entries(state.errors ?? {});
  const toneClass = tone === "success" ? s.submitSuccess : tone === "dark" ? s.submitDark : s.submitPrimary;
  return (
    <form ref={formRef} action={formAction} onSubmit={submitKeepingValues} className={s.form} noValidate>
      {children}
      {errors.length > 0 && (
        <ul className={s.error} role="alert">
          {errors.map(([field, msg]) => (
            <li key={field}>{msg}</li>
          ))}
        </ul>
      )}
      {state.message && (
        <p className={state.ok ? s.notice : s.error} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      )}
      <button type="submit" className={`${s.submit} ${toneClass}`} disabled={pending}>
        {pending ? pendingLabel : submitLabel}
        {!pending && icon && <span aria-hidden="true">{icon}</span>}
      </button>
    </form>
  );
}

/** 이메일 입력 칸 */
export function EmailField({ label = "이메일", help, placeholder = "name@company.com" }: { label?: string; help?: string; placeholder?: string }) {
  const id = useId();
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={s.input}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder={placeholder}
        required
        aria-describedby={help ? `${id}-help` : undefined}
      />
      {help && (
        <span id={`${id}-help`} className={s.help}>
          {help}
        </span>
      )}
    </div>
  );
}

/** 비밀번호 입력 + 보기/숨기기 단추 */
export function PasswordField({
  name,
  label,
  autoComplete,
  placeholder,
  help,
  value,
  onChange,
  describedBy,
}: {
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  help?: ReactNode;
  value?: string;
  onChange?: (v: string) => void;
  describedBy?: string;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const helpId = help ? `${id}-help` : undefined;
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>
        {label}
      </label>
      <div className={s.withToggle}>
        <input
          id={id}
          className={s.input}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          aria-describedby={[helpId, describedBy].filter(Boolean).join(" ") || undefined}
        />
        <button
          type="button"
          className={s.toggle}
          aria-label={shown ? `${label} 숨기기` : `${label} 보기`}
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
        >
          <EyeIcon off={shown} />
        </button>
      </div>
      {help && (
        <span id={helpId} className={s.help}>
          {help}
        </span>
      )}
    </div>
  );
}

/** 0(없음)–3(강함). 앱 규칙(8자·영문+숫자)을 채우면 2, 12자 이상이거나 기호까지 섞으면 3 */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  const meetsRule = pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
  if (!meetsRule) return 1;
  return pw.length >= 12 || /[^A-Za-z0-9]/.test(pw) ? 3 : 2;
}

const STRENGTH_TEXT = ["", "약함 — 8자 이상, 영문과 숫자를 모두 넣어 주세요.", "보통 — 사용할 수 있습니다.", "강함"];

/** 새 비밀번호 + 확인 칸 (강도 막대, 일치 여부를 바로 보여 준다) */
export function NewPasswordFields({ label = "비밀번호", help }: { label?: string; help: string }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const strength = passwordStrength(pw);
  const meterId = useId();
  const matchId = useId();
  const strengthClass = [s.strength0, s.strength1, s.strength2, s.strength3][strength];
  return (
    <>
      <PasswordField
        name="password"
        label={label}
        autoComplete="new-password"
        placeholder="8자 이상"
        value={pw}
        onChange={setPw}
        describedBy={meterId}
        help={help}
      />
      <div className={s.field}>
        <div className={s.meter} aria-hidden="true">
          <div className={`${s.meterFill} ${strengthClass}`} />
        </div>
        <span id={meterId} className={s.help} aria-live="polite">
          {strength > 0 ? `비밀번호 강도: ${STRENGTH_TEXT[strength]}` : ""}
        </span>
      </div>
      <PasswordField
        name="passwordConfirm"
        label={`${label} 확인`}
        autoComplete="new-password"
        placeholder="한 번 더 입력"
        value={confirm}
        onChange={setConfirm}
        describedBy={matchId}
      />
      <span id={matchId} className={s.help} aria-live="polite">
        {confirm && (pw === confirm ? <span className={s.matchOk}>✓ 비밀번호가 같습니다</span> : <span className={s.matchBad}>비밀번호가 다릅니다</span>)}
      </span>
    </>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}
