import type { AdminP3ProgressRow } from "@/features/admin/server";

/**
 * ADMIN-P3-01 P3 진행 현황 표시 변환(순수 함수). AGY 시안 C:/nadaum/Design/admin/p3-progress.html·P3-ADMIN-HANDOFF.md.
 * 근거 없는 진행률 금지: 분수(n/7)·막대 없이, 구현된 단계(P3-a·P3-b)만 실제 개수, 나머지는 '준비 중'.
 * 사용자 글은 받지도 쓰지도 않는다(개수·상태·시각만).
 */

export interface StageChip {
  label: string;
  /** 실제 개수. null 이면 아직 없는 단계 — '준비 중' */
  count: number | null;
}

/** P3 7단계 순서. 구현된 것은 개수, 나머지는 준비 중 */
export function stageChips(r: AdminP3ProgressRow): StageChip[] {
  return [
    { label: "브리프 확정", count: r.briefs.ready },
    { label: "홈페이지", count: r.webDocs.drafting + r.webDocs.reviewed },
    { label: "디자인 자산", count: null },
    { label: "영상", count: null },
    { label: "PPT", count: null },
    { label: "검수", count: null },
    { label: "납품", count: null },
  ];
}

export const chipText = (c: StageChip) => (c.count === null ? `${c.label}(준비 중)` : `${c.label}(${c.count})`);

/** 구현된 단계 요약 한 줄. 예: '브리프 작성 중 1 · 확정 2 · 보관 0 / 홈페이지 작성 중 1 · 검토 완료 0 · 판 3' */
export function stageSummary(r: AdminP3ProgressRow): string {
  const b = `브리프 작성 중 ${r.briefs.drafting} · 확정 ${r.briefs.ready} · 보관 ${r.briefs.archived}`;
  const w = `홈페이지 작성 중 ${r.webDocs.drafting} · 검토 완료 ${r.webDocs.reviewed} · 보관 ${r.webDocs.archived} · 판 ${r.webDocs.versions}`;
  return `${b} / ${w}`;
}

/** 막힌 곳 한 줄. 승인 대기는 검수 단계 전이라 '준비 중' */
export function blockedText(r: AdminP3ProgressRow): string {
  const stale = r.blocked.staleBriefs + r.blocked.staleWebDocs;
  const limit = (r.blocked.briefLimitReached ? 1 : 0) + r.blocked.webVersionLimitReached;
  const limitNote = [r.blocked.briefLimitReached ? "브리프 10개" : null, r.blocked.webVersionLimitReached > 0 ? `판 100개 문서 ${r.blocked.webVersionLimitReached}` : null].filter(Boolean).join(", ");
  const approvals = r.blocked.pendingApprovals === null ? "준비 중" : String(r.blocked.pendingApprovals);
  return `이전 기준 ${stale} · 한도 ${limit}${limitNote ? `(${limitNote})` : ""} · 승인 대기 ${approvals}`;
}

/** 위쪽 합계(프로젝트 수, 이전 기준 경고 수, 한도 도달 수, 승인 대기) */
export function totals(rows: readonly AdminP3ProgressRow[]) {
  return {
    projects: rows.length,
    stale: rows.reduce((n, r) => n + r.blocked.staleBriefs + r.blocked.staleWebDocs, 0),
    limit: rows.reduce((n, r) => n + (r.blocked.briefLimitReached ? 1 : 0) + r.blocked.webVersionLimitReached, 0),
    /** 모든 행이 null 이면 아직 없는 기능 — '준비 중' */
    pendingApprovals: rows.some((r) => r.blocked.pendingApprovals !== null) ? rows.reduce((n, r) => n + (r.blocked.pendingApprovals ?? 0), 0) : null,
  };
}
