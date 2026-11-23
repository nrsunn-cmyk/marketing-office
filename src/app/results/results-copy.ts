/**
 * 결과물 목록 문구 — AGY 확정본(Plan/AGY-Operations-20261123/DESIGN-F1-RESULTS-COPY-01.md 2·3절) 그대로.
 * '스냅샷' 쓰지 않음, '납품 묶음'·'판' 통일. 진행률·%·분수 없음.
 */
export const RESULTS_COPY = {
  intro: "모든 프로젝트의 결과물과 납품 묶음을 모아 봅니다. 승인본과 검토 완료된 납품 묶음은 고객에게 전달할 수 있습니다.",
  typeBundle: "납품 묶음",
  emptyTitle: "아직 만든 결과물이나 납품 묶음이 없습니다.",
  emptyDesc: "프로젝트 화면에서 로고 브리프·견적·마케팅 전략 작업을 만들거나, 검수를 마친 뒤 납품 묶음을 생성하면 여기에 모입니다.",
  emptyCta: "프로젝트 화면으로",
  bundleFilterEmptyTitle: "조건에 맞는 납품 묶음이 없습니다.",
  bundleFilterEmptyDesc: "종류를 ‘전체’로 바꾸거나, 작업 상세의 납품 묶음 영역에서 승인된 결과물로 새 묶음을 만들어 보세요.",
  filterEmptyTitle: "조건에 맞는 결과물이 없습니다.",
  filterEmptyDesc: "종류를 ‘전체’로 바꾸거나 ‘승인본 있는 것만’을 끄고 다시 찾아 보세요.",
  filterClear: "조건 지우기",
  bundleReviewed: "검토 완료",
  bundleDrafting: "작성 중",
} as const;

/** 납품 묶음 판 이름: bundle_no 1 → "v1.0" */
export const bundleVersion = (bundleNo: number) => `v1.${Math.max(0, bundleNo - 1)}`;
export const bundleTitle = (bundleNo: number) => `${RESULTS_COPY.typeBundle} ${bundleVersion(bundleNo)}`;
export const bundleRestoredNote = (fromNo: number) => `${bundleVersion(fromNo)}에서 복구`;
export const bundleItemCount = (n: number) => `포함 ${n.toLocaleString("ko-KR")}건`;
export const bundleStatusLabel = (s: "drafting" | "reviewed") => (s === "reviewed" ? RESULTS_COPY.bundleReviewed : RESULTS_COPY.bundleDrafting);
