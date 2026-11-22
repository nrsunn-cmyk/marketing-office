import { describe, expect, it } from "vitest";
import type { AdminP3ProgressRow } from "@/features/admin/server";
import { blockedText, chipText, stageChips, stageSummary, totals } from "./p3-progress-view";

const row = (o: Partial<AdminP3ProgressRow> = {}): AdminP3ProgressRow => ({
  workspaceId: "w1",
  workspaceName: "업무실",
  ownerEmail: "a@example.test",
  projectId: "p1",
  briefs: { drafting: 1, ready: 2, archived: 0 },
  webDocs: { drafting: 1, reviewed: 0, archived: 1, versions: 3 },
  blocked: { staleBriefs: 1, staleWebDocs: 0, briefLimitReached: false, webVersionLimitReached: 0, pendingApprovals: null },
  lastActivityAt: "2026-11-19T19:30:00Z",
  ...o,
});

describe("P3 진행 현황 표시(근거 없는 진행률 금지)", () => {
  it("7단계 칩: 구현된 두 단계만 실제 개수, 나머지 다섯은 '준비 중', 분수·퍼센트 없음", () => {
    const chips = stageChips(row()).map(chipText);
    expect(chips).toEqual(["브리프 확정(2)", "홈페이지(1)", "디자인 자산(준비 중)", "영상(준비 중)", "PPT(준비 중)", "검수(준비 중)", "납품(준비 중)"]);
    expect(chips.join(" ")).not.toMatch(/\/\s*7|%/);
  });

  it("요약·막힌 곳: 개수만, 승인 대기는 준비 중, 한도는 이유를 괄호로", () => {
    expect(stageSummary(row())).toBe("브리프 작성 중 1 · 확정 2 · 보관 0 / 홈페이지 작성 중 1 · 검토 완료 0 · 보관 1 · 판 3");
    expect(blockedText(row())).toBe("이전 기준 1 · 한도 0 · 승인 대기 준비 중");
    expect(blockedText(row({ blocked: { staleBriefs: 2, staleWebDocs: 1, briefLimitReached: true, webVersionLimitReached: 1, pendingApprovals: null } }))).toBe(
      "이전 기준 3 · 한도 2(브리프 10개, 판 100개 문서 1) · 승인 대기 준비 중",
    );
  });

  it("합계: 프로젝트·이전 기준·한도, 승인 대기는 모든 행이 null 이면 null(준비 중)", () => {
    const t = totals([row(), row({ projectId: "p2", blocked: { staleBriefs: 0, staleWebDocs: 2, briefLimitReached: true, webVersionLimitReached: 0, pendingApprovals: null } })]);
    expect(t).toEqual({ projects: 2, stale: 3, limit: 1, pendingApprovals: null });
    expect(totals([])).toEqual({ projects: 0, stale: 0, limit: 0, pendingApprovals: null });
  });
});
