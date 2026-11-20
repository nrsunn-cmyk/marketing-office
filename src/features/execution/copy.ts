/**
 * 실행 동작이 돌려주는 안내 문구 — AGY P4A-HANDOFF.md 3절 EX_COPY 와 같은 문장(화면 모델 시험이 대조).
 * "use server" 파일은 비동기 함수만 내보낼 수 있어 따로 둔다.
 */
export const EXEC_ACTION_COPY = {
  alreadyDoneNotice: "이미 기록이 끝난 실행 건입니다. 기존 결과를 그대로 유지합니다.",
  blockedContentChanged: "승인 이후 초안 내용이 바뀌었습니다. 맞추기로 지금 내용을 다시 승인하거나 초안을 되돌려 주세요.",
  blockedSourceArchived: "원본 초안이 보관되었습니다. 이 실행 건을 보관해 주세요.",
  blockedNotReviewed: "원본 초안이 검토 완료가 아닙니다. 초안을 검토 완료로 바꾼 뒤 맞춰 주세요.",
} as const;
