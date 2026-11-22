/** 검수 저장이 중간에 실패했을 때 앞서 저장된 개수 안내 — AGY 확정 QA_COPY.partialSavedNotice 와 같은 문장(시험이 대조).
 * "use server" 파일은 비동기 함수만 내보낼 수 있어 따로 둔다 */
export const partialSavedNotice = (n: number) => `앞의 ${n}건은 이미 저장되었습니다. 화면을 새로 고친 뒤 남은 변경 내용만 다시 저장해 주세요.`;
