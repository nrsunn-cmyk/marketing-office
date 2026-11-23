import { PUBLIC_INQUIRY_STATUSES, PUBLIC_INQUIRY_STATUS_LABELS } from "@/features/public-inquiries/contract";

/**
 * NADAUM-BRAND-CONNECT-01 /admin/inquiries 화면 문구(AGY 확정 msg_ed6cda9e89ef).
 * 상태 이름(신규·연락함·견적 발송·종료)은 Backend r2(df65df6) 계약 상수와 같아 그대로 쓴다.
 */
export const INQ_STATUS_LABEL = PUBLIC_INQUIRY_STATUS_LABELS;
export const INQ_STATUS_ORDER = PUBLIC_INQUIRY_STATUSES;

export const INQ_COPY = {
  title: "공개 상담",
  lead: "홈페이지 상담 폼으로 들어온 신청을 최신 순으로 봅니다. 줄을 고르면 오른쪽에 자세한 내용이 나옵니다.",
  notice: "홈페이지에서 접수된 공개 상담을 확인하고 처리 상태(신규·연락함·견적 발송·종료)를 관리합니다. 모든 열람과 상태 변경은 감사 기록에 남습니다.",
  all: "전체",
  listHeading: "상담 목록",
  detailHeading: "상담 내용",
  empty: "아직 들어온 공개 상담이 없습니다.",
  emptyFiltered: "이 상태의 공개 상담이 없습니다.",
  pickOne: "목록에서 상담을 고르면 자세한 내용과 상태 바꾸기가 여기에 나옵니다.",
  notInPage: "이 쪽 목록에 없는 상담입니다. 목록에서 다시 골라 주세요.",
  loadError: "공개 상담을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  next: "다음 쪽",
  first: "처음 쪽으로",
  view: "보기",
  statusLabel: "처리 상태",
  statusSubmit: "상태 바꾸기",
  statusPending: "바꾸는 중…",
  statusDone: "처리 상태를 바꿨습니다.",
  urlNote: "고객이 적은 주소입니다. 링크로 열지 말고 주소를 확인한 뒤 직접 입력해 주세요.",
} as const;
