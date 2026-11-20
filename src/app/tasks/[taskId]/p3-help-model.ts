/**
 * P3-HELP-UI-01 작업 상세 P3 사용 안내(접힌 도움말).
 * 문구: AGY Design/p3-production/P3-HELP-HANDOFF.md 2절 HELP_COPY 26키 그대로. 시안 p3-help.html.
 */

export const HELP_COPY = {
  toggleSummary: "P3 제작 단계 사용 안내 (처음 쓰실 때 열어 보세요)",
  intro: "확정된 P2 전략을 바탕으로 결과물을 만들고 검수해 납품하는 7단계 흐름입니다. 연결된 단계만 지금 쓸 수 있고, 나머지 단계는 준비 중입니다.",
  statusAvailable: "지금 사용 가능",
  statusPreparing: "준비 중",
  stepBriefTitle: "1. 공통 제작 브리프",
  stepBriefDesc: "P2 승인 전략을 바탕으로 목표 고객·핵심 메시지·포함 결과물을 정합니다. 다른 모든 제작 단계의 기준이 되며, 먼저 확정해야 다음 단계를 열 수 있습니다.",
  stepWebCopyTitle: "2. 홈페이지 구조·문구",
  stepWebCopyDesc: "확정된 브리프에 맞춰 페이지별 섹션 제목·본문·행동 문구(CTA)를 작성하고 근거 출처를 연결합니다.",
  stepAssetsTitle: "3. 디자인 자산 관리",
  stepAssetsDesc: "로고·이미지·색상·글꼴 파일을 올리고 사용처와 판 이력을 관리합니다.",
  stepVideoTitle: "4. 영상 구성·파일 관리",
  stepVideoDesc: "장면별 대사·자막·길이(초)를 기획하고 외부에서 만든 완성 영상 파일을 버전별로 첨부합니다.",
  stepPptTitle: "5. PPT 구성·템플릿",
  stepPptDesc: "슬라이드별 제목·요점·발표자 메모를 구성하고 템플릿을 골라 내보낼 뼈대를 만듭니다.",
  stepQaTitle: "6. 검수 체크리스트",
  stepQaDesc: "결과물 판마다 필수 확인 항목을 점검합니다. 모든 필수 항목이 통과해야 납품 묶음에 넣을 수 있습니다.",
  stepBundleTitle: "7. 납품 묶음",
  stepBundleDesc: "검수를 통과한 승인 판만 모아 스냅샷을 만들고, 고객에게 직접 전달한 기록을 남깁니다.",
  termStaleTitle: "이전 기준",
  termStaleDesc: "바탕이 된 브리프나 연결 자산이 새 판으로 바뀌었다는 뜻입니다. 편집은 막지 않으며, 바뀐 내용을 확인한 뒤 맞추기를 누르면 최신 기준과 연결됩니다.",
  termRebaseTitle: "최신 기준으로 맞추기",
  termRebaseDesc: "현재 작업 중인 문서의 기준 판 번호를 최신 브리프·자산 판으로 올리는 동작입니다. 바탕이 보관되었거나 확정 전이면 맞출 수 없습니다.",
  termArchiveTitle: "보관",
  termArchiveDesc: "더 이상 고치지 않을 문서를 읽기 전용으로 잠그는 동작입니다. 보관은 되돌릴 수 없으며, 필요하면 보관한 내용을 복사해 새 문서를 만들 수 있습니다.",
  termRestoreTitle: "판 되돌리기",
  termRestoreDesc: "과거 기록을 지우지 않고, 선택한 옛 판의 내용을 새 번호의 판으로 다시 불러와 복원합니다. 목록에서 뺀 항목도 옛 판 되돌리기로 살릴 수 있습니다.",
} as const;

/** 시안의 구획 제목·머리 배지(인계표 밖, 시안 글자 그대로) */
export const HELP_LABELS = {
  badge: "도움말",
  stepsHeading: "7단계 흐름과 지금 쓸 수 있는 단계",
  termsHeading: "자주 나오는 상태·동작 안내",
} as const;

export const P3_STEPS = ["brief", "webCopy", "assets", "video", "ppt", "qa", "bundle"] as const;
export type P3Step = (typeof P3_STEPS)[number];

/**
 * ★ 이 브랜치에서 작업 상세에 실제로 서버 연결된 단계 — 배포 묶음마다 여기 한 곳만 맞춘다.
 * 지금(claude/p3fg-connect, P3FG-UI-CONNECT-01): 7단계 모두 작업 상세에 서버 연결(P3-a~g).
 */
export const P3_CONNECTED_STEPS: readonly P3Step[] = ["brief", "webCopy", "assets", "video", "ppt", "qa", "bundle"];

const KEY = {
  brief: "Brief",
  webCopy: "WebCopy",
  assets: "Assets",
  video: "Video",
  ppt: "Ppt",
  qa: "Qa",
  bundle: "Bundle",
} as const satisfies Record<P3Step, string>;

export type HelpStepView = { step: P3Step; title: string; desc: string; available: boolean; status: string };

export function helpSteps(connected: readonly P3Step[] = P3_CONNECTED_STEPS): HelpStepView[] {
  return P3_STEPS.map((step) => {
    const available = connected.includes(step);
    return {
      step,
      title: HELP_COPY[`step${KEY[step]}Title`],
      desc: HELP_COPY[`step${KEY[step]}Desc`],
      available,
      status: available ? HELP_COPY.statusAvailable : HELP_COPY.statusPreparing,
    };
  });
}

export const HELP_TERMS = (["Stale", "Rebase", "Archive", "Restore"] as const).map((k) => ({
  title: HELP_COPY[`term${k}Title`],
  desc: HELP_COPY[`term${k}Desc`],
}));
