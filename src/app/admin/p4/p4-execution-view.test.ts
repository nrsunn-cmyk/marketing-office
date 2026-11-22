import { describe, expect, it } from "vitest";
import type { AdminP4ExecutionRow } from "@/features/admin/server";
import { blockedText, chipText, outputText, statusChips, totals } from "./p4-execution-view";

/** ADMIN-P4-01 표시 변환: 상태 7종 칩(0 은 회색)·막힘 원인 한 줄·합계. 분수·% 없음 */
const row = (o: Partial<AdminP4ExecutionRow> = {}): AdminP4ExecutionRow => ({
  workspaceId: "w1",
  projectId: "p1",
  jobs: { pendingApproval: 1, blockedMismatch: 1, queued: 1, running: 0, succeeded: 4, failed: 1, held: 0 },
  blocked: { contentChanged: 1, sourceArchived: 0, notReviewed: 0 },
  retryExhausted: 1,
  tistoryPublished: 4,
  resultsActive: 6,
  lastActivityAt: "2026-11-20T01:50:00Z",
  ...o,
});

describe("P4 실행 현황 표시", () => {
  it("상태 7종 칩은 시안 순서·실제 개수, 0 은 회색, 차단·실패는 경고색", () => {
    const c = statusChips(row());
    expect(c.map(chipText)).toEqual(["승인 대기(1)", "차단(1)", "실행 대기(1)", "실행 중(0)", "완료(4)", "실패(1)", "보류(0)"]);
    expect(c.map((x) => x.tone)).toEqual(["info", "danger", "info", "neutral", "info", "danger", "neutral"]);
    expect(c.map(chipText).join(" ")).not.toMatch(/%|\//);
  });
  it("막힘 원인·재시도 소진, 게시·성과 한 줄(시안 문구)", () => {
    expect(blockedText(row())).toBe("내용 바뀜 1 · 원본 보관 0 · 미검토 0 · 재시도 소진 1");
    expect(outputText(row())).toBe("티스토리 게시 4건 · 성과 입력 6건");
  });
  it("합계: 7종 합계·차단·재시도 소진·게시·성과, 빈 목록은 0", () => {
    const r2 = row({ jobs: { pendingApproval: 0, blockedMismatch: 2, queued: 0, running: 0, succeeded: 2, failed: 0, held: 0 }, retryExhausted: 0, tistoryPublished: 2, resultsActive: 3 });
    expect(totals([row(), r2])).toEqual({ projects: 2, jobs: 12, blocked: 3, retryExhausted: 1, published: 6, results: 9 });
    expect(totals([])).toEqual({ projects: 0, jobs: 0, blocked: 0, retryExhausted: 0, published: 0, results: 0 });
  });
});
