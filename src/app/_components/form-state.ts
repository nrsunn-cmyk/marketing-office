/** 화면 폼과 서버 동작이 주고받는 결과 */
export interface FormState {
  ok?: boolean;
  message?: string;
  /** 'warn': 실패 오류가 아니라 안전 보호로 막힌 결과(경고 색·role=status, AGY P4A-HANDOFF 1절 3번) */
  tone?: "warn";
  errors?: Partial<Record<string, string>>;
}

export const EMPTY_FORM_STATE: FormState = {};

/** Zod 오류를 칸별 첫 메시지로 모은다. */
export function fieldErrors(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return errors;
}
