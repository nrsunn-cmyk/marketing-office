/** 화면 표시용 상태 이름. 색상만으로 상태를 구분하지 않도록 항상 글자와 함께 쓴다 (Codex 05 §3). */
export const PROJECT_STATUS_LABELS: Record<string, string> = {
  received: "접수",
  waiting_material: "자료 대기",
  active: "진행 중",
  review: "검토 중",
  delivered: "납품함",
  completed: "완료",
  archived: "보관",
};

export const PROJECT_KIND_LABELS: Record<string, string> = {
  client: "고객 프로젝트",
  internal_brand: "자체 브랜드",
  personal: "개인 채널",
};

export const UPLOAD_STATUS_LABELS: Record<string, string> = {
  pending: "올리는 중",
  stored: "보관됨",
  failed: "실패",
};

/** P1은 본문을 자동으로 읽지 않는다. '읽음/분석됨'으로 보이지 않게 한다 (T05). */
export const EXTRACTION_STATUS_LABELS: Record<string, string> = {
  uploaded: "내용 읽기 전 (보관만 됨)",
  extraction_pending: "내용 읽기 대기",
  extraction_failed: "내용 읽기 실패",
  extracted: "내용 읽음",
};

export const ASSET_KIND_LABELS: Record<string, string> = {
  file: "파일",
  url: "링크",
  text: "메모",
};
