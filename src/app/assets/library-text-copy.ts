/**
 * 메모 보기 문구(LIBRARY-TEXT-VIEW-FRONT-01, UX-SCENARIO-AUDIT-05 C2).
 * ⚠ AGY 확정 대기 초안. 확정본이 오면 이 블록만 바꾼다.
 */
export const LIBRARY_TEXT_COPY = {
  docTitle: "메모 · 마케팅 업무실",
  untitled: "제목 없는 메모",
  viewLink: "보기",
  fullViewLink: "전체 보기",
  back: "← 자료실로",
  createdAt: (when: string) => `만든 시각: ${when}`,
  empty: "내용이 없는 메모입니다.",
  loadError: "메모를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  retry: "다시 불러오기",
} as const;

/** 자료 칸에서 미리 보여 주는 글자 수(기존 120자와 같음) */
export const TEXT_PREVIEW_CHARS = 120;

/** 미리 보기에서 잘리는지(잘리면 '전체 보기'를 단다) */
export function isTextTruncated(text: string | null | undefined, limit = TEXT_PREVIEW_CHARS): boolean {
  return (text ?? "").length > limit;
}

/** 메모 보기 주소 */
export function textAssetHref(id: string): string {
  return `/assets/${id}`;
}
