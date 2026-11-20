/**
 * P4A-UI-01 실행 승인 대기열·티스토리 수동 게시·성과 수동 입력 — 화면 쪽 모델.
 * 근거: AGY Design/p4-execution/P4A-HANDOFF.md 3절(EX_COPY·ER_COPY 확정 — 그대로), P4-ENTRY-HANDOFF.md(진입·앵커),
 * 시안 execution-queue.html·tistory-manual.html·results.html·entry.html. 서버: Backend P4A-BACKEND-IMPL-01 5절.
 * 진행률 막대·%·분수는 쓰지 않는다(개수와 상태 배지만). 시각은 한국 시간.
 */
import type { ExecutionBoard, ExecutionJobView, ExecutionResultView } from "@/features/execution/server";

export type { ExecutionBoard, ExecutionJobView, ExecutionResultView };

/** 실행 화면 문구(AGY P4A-HANDOFF 3절 가 — 그대로). {n} 키는 같은 이름의 함수 */
export const EX_COPY = {
  heading: "실행 승인 대기열 · 수동 실행",
  intro: "검토 완료된 티스토리 채널 초안을 승인 후 수동 게시하고, 실행 결과를 기록합니다.",
  enqueueBtn: "+ 실행 대기열에 올리기",
  emptyTitle: "아직 실행 대기열에 올라온 건이 없습니다.",
  emptyDesc: "검토 완료된 티스토리 초안을 선택해 대기열에 올린 뒤 승인해 주세요.",
  approveBtn: "실행 승인",
  retryBtn: (n: number) => `다시 시도 (${n}/3)`,
  holdBtn: "보류",
  resumeBtn: "재개",
  rebaseBtn: "최신 초안 기준으로 맞추기",
  archiveBtn: "이 실행 건 보관",
  recordBtn: "티스토리 게시 완료 기록",
  blockedContentChanged: "승인 이후 초안 내용이 바뀌었습니다. 맞추기로 지금 내용을 다시 승인하거나 초안을 되돌려 주세요.",
  blockedSourceArchived: "원본 초안이 보관되었습니다. 이 실행 건을 보관해 주세요.",
  blockedNotReviewed: "원본 초안이 검토 완료가 아닙니다. 초안을 검토 완료로 바꾼 뒤 맞춰 주세요.",
  alreadyDoneNotice: "이미 기록이 끝난 실행 건입니다. 기존 결과를 그대로 유지합니다.",
  publicationVoidedNotice: "연결된 티스토리 게시 기록이 나중에 취소되었습니다. 새 게시 기록이 필요하면 새로 올려 주세요.",
  channelPreparing: "준비 중 (외부 채널은 아직 연결되지 않았습니다)",
  loadError: "실행 대기열을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  noPermission: "보관한 프로젝트이거나 실행 건을 고칠 권한이 없습니다.",
} as const;

/** 성과 화면 문구(AGY P4A-HANDOFF 3절 나 — 그대로) */
export const ER_COPY = {
  heading: "성과 수동 입력 · 보기",
  intro: "출처와 집계 기간(한국 시간 기준, 최대 366일)을 함께 적어 성과 지표를 남깁니다. 고치기 대신 취소 후 새 행으로 추가합니다.",
  addBtn: "+ 성과 입력",
  voidBtn: "이 기록 취소",
  archiveBtn: "이 성과 보관",
  readonlySyncPreparing: "자동 수집 채널은 준비 중입니다. 지금은 수동 입력만 할 수 있습니다.",
  periodHint: "집계 기간은 한국 시간(KST) 기준 시작일부터 종료일까지 양 끝 포함 최대 366일까지 입력할 수 있습니다.",
  voidHint: "성과 기록은 고칠 수 없습니다. 잘못 적은 경우 취소 사유를 남기고 새 기록으로 추가해 주세요.",
} as const;

/** 시안(execution-queue·tistory-manual·results·entry.html)의 라벨 — 그대로 */
export const EX_LABELS = {
  pageTitle: "실행 · 성과",
  back: "프로젝트로 돌아가기",
  jumpQueue: "실행 대기열 · 수동 게시",
  jumpResults: "성과 기록 · 수동 입력",
  jumpChannels: "준비 중인 채널",
  firstSource: "1차 입력: P2-g 티스토리 초안",
  channelLine: (key: string) => `채널: 티스토리 수동 게시 · 멱등 키: ${key}`,
  matchOk: "지문 일치",
  matchOkNote: "내용 일치 확인: 승인본 고정 사본(5개 칸)과 현재 초안 지문이 일치합니다.",
  blockedSaved: "차단 저장됨",
  blockReasonPrefix: (code: string) => `막힘 원인 (${code}):`,
  historyHeading: "실행 기록 (멱등 키 · 재시도 최대 3회 · already_done)",
  historyHint: "이미 끝난 실행 건은 다시 실행하지 않고 기존 결과(already_done)를 유지합니다. 실패 건만 같은 멱등 키로 최대 3회까지 재시도할 수 있습니다.",
  manualSteps: "티스토리 기본 경로 (초안 내보내기 → 수동 게시 → 기록)",
  step1: "1단계 · 내보내기: 작업 화면의 티스토리 초안에서 서식째 복사 또는 .html 내려받기",
  step2: "2단계 · 수동 게시: 이미지는 본문의 [이미지: …] 자리에 티스토리에서 직접 올린 뒤 발행을 완료해 주세요. (자동 게시 없음)",
  step3: "3단계 · 게시 기록",
  noApi: "외부 API 호출 0건",
  url: "게시 주소 (https://로 시작)",
  publishedAt: "게시 시각 (한국 시간)",
  note: "메모 (선택)",
  manualBadge: "수동 입력",
  syncBadge: "준비 중 (읽기 전용 수집)",
  autoSyncPreparing: "자동 수집: 준비 중 (수동 입력만)",
  resultEmpty: "아직 기록된 성과 수치가 없습니다.",
  resultEmptyDesc: "출처와 집계 기간(KST, 최대 366일)을 적어 성과 수치를 수동 입력할 수 있습니다.",
  resultFormHeading: "+ 성과 입력 (수동 입력만 · 취소 후 새 행)",
  metricName: "성과 지표 (필수 · 1~60자)",
  value: "수치",
  unit: "단위",
  sourceNote: "출처 (필수 · 1~200자)",
  numerator: "분자 (선택 · 정수)",
  denominator: "분모 (선택 · 정수)",
  periodStart: "집계 시작일 (KST, 필수)",
  periodEnd: "집계 종료일 (KST, 양 끝 포함 366일 이하)",
  linkedJob: "연결할 실행 건 (선택)",
  noJob: "연결 안 함",
  voidReason: "취소 사유 (필수 · 1~300자)",
  voided: "취소됨",
  archived: "보관",
  channelsHeading: "준비 중인 외부 채널",
  channels: ["검색 광고", "SNS", "고객 관리(CRM)"],
  // 진입(entry.html)
  entryHeading: "실행 · 성과",
  entryQueue: "실행 대기열 · 수동 게시 관리",
  entryResults: "성과 기록 · 수동 입력",
  draftNotReviewed: "검토 완료 상태의 초안만 실행 대기열에 올릴 수 있습니다. 초안 상태를 검토 완료로 바꾼 뒤 다시 확인해 주세요.",
  viewQueue: "실행 대기열 보기",
  // 진입 ③ P3 납품 묶음 하단(AGY P4-ENTRY-HANDOFF 1절 ③, entry.html 3번) — 1차 연결 단추 없음, 안내 + 실행 화면 링크만
  bundleNextBadge: "준비 중 (1차 연결 없음)",
  bundleNextNotice: "다음 단계: 실행 · 성과 (P4) — 현재 1차 실행 대기열은 티스토리 채널 초안(검토 완료)에서 올릴 수 있습니다. P3 납품 묶음과의 연결은 준비 중입니다.",
  bundleNextLink: "프로젝트 실행 화면 보기",
} as const;

export const RESULT_UNIT_LABELS = { count: "건", percent: "%", won: "원", seconds: "초" } as const;
export const RESULT_UNIT_OPTIONS = { count: "건 (count)", percent: "% (percent)", won: "원 (won)", seconds: "초 (seconds)" } as const;

// ── 표시 도우미 ──
/** "2026-11-20 03:55 KST" */
export function formatKst(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "-";
  const d = new Date(t + 9 * 3600 * 1000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} KST`;
}
/** 한국 날짜 오늘(YYYY-MM-DD) — 날짜 칸 최댓값 */
export const todayKst = (now = new Date()) => new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
/** 집계 일수(양 끝 포함) */
export function periodDays(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86_400_000) + 1;
}
/** "티스토리 글 조회수 · 342건", 비율이면 "(23 / 125)" — 실제 입력값만 */
export function resultHeadline(r: Pick<ExecutionResultView, "metricName" | "value" | "unit" | "numerator" | "denominator">): string {
  const v = `${r.value.toLocaleString("ko-KR")}${RESULT_UNIT_LABELS[r.unit]}`;
  const frac = r.numerator !== null && r.denominator !== null ? ` (${r.numerator.toLocaleString("ko-KR")} / ${r.denominator.toLocaleString("ko-KR")})` : "";
  return `${r.metricName} · ${v}${frac}`;
}
export function resultMeta(r: Pick<ExecutionResultView, "periodStart" | "periodEnd" | "unit" | "sourceNote">): string {
  return `기간: ${r.periodStart} ~ ${r.periodEnd} (KST ${periodDays(r.periodStart, r.periodEnd)}일) · 단위: ${RESULT_UNIT_LABELS[r.unit]}(${r.unit}) · 출처: ${r.sourceNote}`;
}

/** 막힘 원인 → 확정 문구 */
export const blockText = (reason: ExecutionJobView["blockReason"]) =>
  reason === "source_archived" ? EX_COPY.blockedSourceArchived : reason === "not_reviewed" ? EX_COPY.blockedNotReviewed : EX_COPY.blockedContentChanged;

/** 실행 건마다 할 수 있는 동작(서버 전이표와 같음 — 최종 판단은 서버). 보관·읽기 전용이면 없음 */
export function jobActions(j: Pick<ExecutionJobView, "status" | "attemptCount" | "archivedAt">, canWrite: boolean) {
  const open = canWrite && j.archivedAt === null;
  const s = j.status;
  return {
    approve: open && s === "pending_approval",
    record: open && (s === "queued" || s === "running"),
    retry: open && s === "failed" && j.attemptCount < 3,
    hold: open && (s === "pending_approval" || s === "queued" || s === "failed"),
    resume: open && s === "held",
    rebase: open && s === "blocked_mismatch",
    archive: open && s !== "running",
  };
}

/** 프로젝트 상세 요약 건수(분수·% 없이 개수만, entry.html) */
export function executionCounts(b: Pick<ExecutionBoard, "jobs" | "results">) {
  const live = b.jobs.filter((j) => j.archivedAt === null);
  return {
    pending: live.filter((j) => j.status === "pending_approval").length,
    queued: live.filter((j) => j.status === "queued" || j.status === "running").length,
    blocked: live.filter((j) => j.status === "blocked_mismatch").length,
    results: b.results.filter((r) => r.status === "active" && r.archivedAt === null).length,
  };
}
/** 대기열(끝나지 않은 건) / 실행 기록(끝난 건·보관) 나누기 — 최근 것이 위 */
export function splitJobs(jobs: readonly ExecutionJobView[]) {
  const done = (j: ExecutionJobView) => j.archivedAt !== null || j.status === "succeeded" || j.status === "failed";
  return { queue: jobs.filter((j) => !done(j)), history: jobs.filter(done) };
}
