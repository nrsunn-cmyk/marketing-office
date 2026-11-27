/**
 * 처음 쓰는 사람 안내 문구(ONBOARDING-PROFILE-HINT-FRONT-01, UX-SCENARIO-AUDIT-05 C1-1·C4).
 * 1차 문구는 AGY 원안 확정(msg_19fd6eaab038).
 * PROJECT-PROFILE-AUTOLINK-FRONT-01(주인님 결정: 프로필 저장 때 자동 연결)로 바꾼 3곳
 *   profileStepNote·noProfileBeforeProject·logoPrefillNoProfile 도 AGY 원안 확정(msg_13e9e001d79f).
 */
export const ONBOARDING_COPY = {
  /** 첫 화면 빈 상태의 2단계(고객 등록과 프로젝트 만들기 사이) */
  profileStepTitle: "회사 프로필 저장",
  profileStepNote: "고객 화면의 '회사 프로필'에 상품·주요 고객·강점을 적어 둡니다. 저장하면 그 고객의 프로젝트 로고 브리프에 미리 채워집니다.",
  /** 고객 화면 '새 프로젝트' 폼 위 안내(그 고객의 회사 프로필이 아직 없을 때만) */
  noProfileBeforeProject:
    "이 고객의 회사 프로필이 아직 없습니다. 프로젝트를 먼저 만들어도 됩니다. 나중에 위 '회사 프로필'을 저장하면 이 프로젝트에 자동으로 연결됩니다.",
  /** 로고 입력 안내 3가지 */
  logoPrefillLast: "지난번에 입력한 내용을 다시 채웠습니다. 목록 항목은 한 줄에 하나씩 적습니다.",
  logoPrefillProfile: "고객 정보와 회사 프로필에서 미리 채웠습니다. 목록 항목은 한 줄에 하나씩 적습니다.",
  logoPrefillNoProfile:
    "이 프로젝트에는 연결된 회사 프로필이 없어 주요 고객·강점은 비어 있습니다. 고객 화면에서 회사 프로필을 저장하면 연결됩니다. 지금은 직접 적어 주세요. 목록 항목은 한 줄에 하나씩 적습니다.",
  /** /setup (C4) */
  setupDocTitle: "업무실 처음 설정 · 마케팅 업무실",
  setupBusinessNumberHelp: "예: 123-45-67890",
  setupLaterNote: "업태·종목·입금 계좌·담당자는 처음 설정을 마친 뒤 '설정' 화면에서 더할 수 있습니다.",
} as const;

/** 로고 입력 안내 고르기: 지난 입력 > 회사 프로필 > 프로필 없음 (logoDefaults 와 같은 순서) */
export function logoPrefillNote({ hasLastInput, hasProfile }: { hasLastInput: boolean; hasProfile: boolean }): string {
  if (hasLastInput) return ONBOARDING_COPY.logoPrefillLast;
  if (hasProfile) return ONBOARDING_COPY.logoPrefillProfile;
  return ONBOARDING_COPY.logoPrefillNoProfile;
}
