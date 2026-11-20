import type { AdminP4ExecutionRow } from "@/features/admin/server";

/**
 * ADMIN-P4-01 P4 실행 현황 표시 변환(순수 함수). AGY 시안 C:/nadaum/Design/admin/p4-execution.html·P4-ADMIN-HANDOFF.md.
 * 근거 없는 진행률 금지: 분수·%·막대 없이 실제 상태별 개수만. 본문·주소·개인정보는 받지도 쓰지도 않는다.
 */

export type ChipTone = "info" | "warning" | "danger" | "neutral";
export interface StatusChip {
  label: string;
  count: number;
  /** 0 이면 회색. 차단·실패는 경고색, 보류는 경고 */
  tone: ChipTone;
}

/** 실행 건 상태 7종(시안 순서: 승인 대기·차단·실행 대기·실행 중·완료·실패·보류) */
export function statusChips(r: AdminP4ExecutionRow): StatusChip[] {
  const c = (label: string, count: number, hot: ChipTone): StatusChip => ({ label, count, tone: count === 0 ? "neutral" : hot });
  return [
    c("승인 대기", r.jobs.pendingApproval, "info"),
    c("차단", r.jobs.blockedMismatch, "danger"),
    c("실행 대기", r.jobs.queued, "info"),
    c("실행 중", r.jobs.running, "info"),
    c("완료", r.jobs.succeeded, "info"),
    c("실패", r.jobs.failed, "danger"),
    c("보류", r.jobs.held, "warning"),
  ];
}

export const chipText = (c: StatusChip) => `${c.label}(${c.count})`;

/** 막힘 원인 3종·재시도 소진 한 줄. 예: '내용 바뀜 1 · 원본 보관 0 · 미검토 0 · 재시도 소진 1' */
export const blockedText = (r: AdminP4ExecutionRow) =>
  `내용 바뀜 ${r.blocked.contentChanged} · 원본 보관 ${r.blocked.sourceArchived} · 미검토 ${r.blocked.notReviewed} · 재시도 소진 ${r.retryExhausted}`;

/** 예: '티스토리 게시 4건 · 성과 입력 6건' */
export const outputText = (r: AdminP4ExecutionRow) => `티스토리 게시 ${r.tistoryPublished}건 · 성과 입력 ${r.resultsActive}건`;

const jobsTotal = (r: AdminP4ExecutionRow) => Object.values(r.jobs).reduce((n, x) => n + x, 0);

/** 위쪽 합계 4칸(시안: 전체 실행 건·불일치 차단·재시도 소진·티스토리 게시·성과 입력) */
export function totals(rows: readonly AdminP4ExecutionRow[]) {
  return {
    projects: rows.length,
    jobs: rows.reduce((n, r) => n + jobsTotal(r), 0),
    blocked: rows.reduce((n, r) => n + r.jobs.blockedMismatch, 0),
    retryExhausted: rows.reduce((n, r) => n + r.retryExhausted, 0),
    published: rows.reduce((n, r) => n + r.tistoryPublished, 0),
    results: rows.reduce((n, r) => n + r.resultsActive, 0),
  };
}
