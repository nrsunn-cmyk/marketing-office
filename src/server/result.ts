/** 서버 기능의 결과. 예외 대신 화면에 보여 줄 수 있는 오류를 돌려준다. */
export type ErrorCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "INVALID_TRANSITION" | "UPLOAD_FAILED" | "ERROR";

export type Result<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = <T = never>(code: ErrorCode, message: string): Result<T> => ({ ok: false, code, message });

export const CONFLICT_MESSAGE = "다른 곳에서 먼저 수정되었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.";

interface PgError {
  code?: string;
  message?: string;
}

/** DB 오류를 화면용 결과로 바꾼다. 원문은 서버 기록에만 남긴다. */
export function fromDbError<T = never>(where: string, error: PgError): Result<T> {
  console.error(`[${where}]`, error.code, error.message);
  const msg = error.message ?? "";
  if (error.code === "23505") return fail("CONFLICT", "이미 같은 항목이 있습니다.");
  if (error.code === "23503") return fail("VALIDATION", "연결할 수 없는 대상입니다. 다른 고객·프로젝트의 자료는 섞을 수 없습니다.");
  if (error.code === "23514") return fail("VALIDATION", "입력값이 규칙에 맞지 않습니다.");
  if (msg.includes("INVALID_TRANSITION")) return fail("INVALID_TRANSITION", "지금 상태에서는 그 상태로 바꿀 수 없습니다.");
  if (msg.includes("FROZEN_COLUMN")) return fail("VALIDATION", "바꿀 수 없는 항목입니다.");
  return fail("ERROR", "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

/** 검색어를 LIKE 패턴 안에 안전하게 넣는다. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
