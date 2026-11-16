/**
 * P2-STRATEGY-APP-01: 전략 RPC 오류 코드 → 사용자 안내 문구(한국어). DB 원문·내부 경로는 보여 주지 않는다.
 * DB 함수는 "CODE: 설명" 형식으로 오류를 낸다(20261117001000_p2_strategy.sql).
 */
export const STRATEGY_ERROR_MESSAGES = {
  NOT_AUTHENTICATED: "로그인이 필요합니다. 다시 로그인해 주세요.",
  NOT_FOUND: "작업이나 결과물을 찾을 수 없습니다. 목록에서 다시 열어 주세요.",
  PROFILE_REQUIRED: "전략은 지금 고객 프로젝트에서만 만들 수 있습니다.",
  PROFILE_MISMATCH: "이 프로젝트 고객의 회사 프로필이 아닙니다. 프로필을 다시 골라 주세요.",
  PROFILE_NOT_APPROVED: "승인된 회사 프로필 버전만 쓸 수 있습니다. 프로필을 먼저 승인해 주세요.",
  CONTENT_MISMATCH: "입력과 결과가 맞지 않습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.",
  SOURCE_MISMATCH: "출처를 확인해 주세요. 선택한 프로필 버전, 이 프로젝트의 자료, http(s) 주소만 쓸 수 있습니다.",
  IDEMPOTENCY_MISMATCH: "같은 요청이 다른 내용으로 두 번 들어왔습니다. 화면을 새로 고쳐 주세요.",
  CONFLICT: "다른 곳에서 먼저 수정되었습니다. 화면을 새로 고친 뒤 다시 저장해 주세요.",
  DIRECT_WRITE_FORBIDDEN: "전략은 정해진 기능으로만 저장할 수 있습니다.",
  INVALID_TRANSITION: "지금 상태에서는 할 수 없는 동작입니다.",
  VALIDATION: "입력값이 규칙에 맞지 않습니다. 사실에는 출처가 하나 이상 필요합니다.",
} as const;

export type StrategyErrorCode = keyof typeof STRATEGY_ERROR_MESSAGES;
export const STRATEGY_ERROR_FALLBACK = "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";

/**
 * 계약(strategyInputSchema) 검사 실패 → 사용자 문구. 계약의 한국어 문구는 그대로 쓰고,
 * Zod 기본(영어) 문구는 경로로 구분해 안내한다(출처 주소·자료 id 등). 원문·경로는 보여 주지 않는다.
 */
export function strategyContractIssueMessage(issue: { path: ReadonlyArray<PropertyKey>; message: string } | undefined): string {
  if (!issue) return "입력값이 규칙에 맞지 않습니다.";
  if (/[가-힣]/.test(issue.message) && !/^\s*Unrecognized/i.test(issue.message)) return issue.message;
  const last = String(issue.path.at(-1) ?? "");
  if (last === "url") return "출처 주소는 http:// 또는 https:// 로 시작해야 합니다.";
  if (last === "assetId" || last === "profileId") return "출처로 고른 자료나 프로필을 다시 확인해 주세요.";
  return "입력값이 규칙에 맞지 않습니다.";
}

/** DB 오류 메시지 앞의 코드를 찾아 안내 문구를 돌려준다. 모르는 오류는 일반 문구(원문 노출 없음) */
export function strategyErrorFromDb(message: string | null | undefined): { code: StrategyErrorCode | "ERROR"; message: string } {
  const head = /^\s*([A-Z_]+):/.exec(message ?? "")?.[1];
  if (head && head in STRATEGY_ERROR_MESSAGES) {
    const code = head as StrategyErrorCode;
    return { code, message: STRATEGY_ERROR_MESSAGES[code] };
  }
  return { code: "ERROR", message: STRATEGY_ERROR_FALLBACK };
}
