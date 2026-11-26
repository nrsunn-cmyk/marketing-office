/**
 * 업무실 이름 바꾸기 문구(WORKSPACE-RENAME-FRONT-01, AUDIT-05 C3).
 * AGY 원안 확정(msg_46dc593778a5).
 * 충돌 안내(WORKSPACE_CONFLICT_MESSAGE)와 칸 오류는 Backend 서버가 준 문구를 그대로 보인다.
 */
export const WORKSPACE_NAME_COPY = {
  heading: "업무실 이름",
  intro: "화면 맨 위와 첫 화면 제목에 보이는 이름입니다. 견적서의 상호는 아래 공급자 정보에서 따로 정합니다.",
  label: "업무실 이름 (필수)",
  submit: "이름 저장",
  loadError: "업무실 이름을 불러오지 못했습니다. 지금 저장하면 다른 곳에서 바꾼 이름을 덮어쓸 수 있어 입력 칸을 보이지 않습니다.",
} as const;

export const WORKSPACE_RENAME_SAVED = "업무실 이름을 저장했습니다.";
