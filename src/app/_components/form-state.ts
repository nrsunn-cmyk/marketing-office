/** 화면 폼과 서버 동작이 주고받는 결과 */
export interface FormState {
  ok?: boolean;
  message?: string;
  errors?: Partial<Record<string, string>>;
}

export const EMPTY_FORM_STATE: FormState = {};

/** Zod 오류를 칸별 첫 메시지로 모은다. */
export function fieldErrors(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return errors;
}
