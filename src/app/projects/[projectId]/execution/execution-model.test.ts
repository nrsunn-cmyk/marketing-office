import { describe, expect, it } from "vitest";
import { BLOCK_REASON_LABELS, EXECUTION_STATUS_LABELS } from "@/domain/execution";
import { EXEC_ACTION_COPY } from "@/features/execution/copy";
import { ER_COPY, EX_COPY, blockText, executionCounts, formatKst, jobActions, periodDays, resultHeadline, resultMeta, splitJobs, type ExecutionJobView } from "./execution-model";

const job = (x: Partial<ExecutionJobView> = {}): ExecutionJobView => ({
  id: "j1",
  status: "pending_approval",
  statusLabel: "승인 대기",
  blockReason: null,
  blockReasonLabel: null,
  channel: "tistory_manual",
  idempotencyKey: "exec-j1",
  attemptCount: 0,
  revision: 1,
  source: { kind: "channel_draft", id: "d1", revision: 2, title: "초안" },
  payloadTitle: "초안",
  liveMatches: true,
  approvedAt: null,
  executedAt: null,
  externalUrl: null,
  publicationId: null,
  publicationVoided: false,
  archivedAt: null,
  createdAt: "2026-11-20T00:00:00Z",
  ...x,
});

describe("P4A 실행 화면 모델(AGY P4A-HANDOFF 3절)", () => {
  it("EX_COPY·ER_COPY 는 확정표 글자 수 그대로({n} 은 숫자 한 글자로)", () => {
    const ex: Array<[string, number]> = [
      [EX_COPY.heading, 17],
      [EX_COPY.intro, 46],
      [EX_COPY.enqueueBtn, 13],
      [EX_COPY.emptyTitle, 23],
      [EX_COPY.emptyDesc, 38],
      [EX_COPY.approveBtn, 5],
      [EX_COPY.retryBtn(1), 11], // 표 13자({n} 3자) → 숫자 1자
      [EX_COPY.holdBtn, 2],
      [EX_COPY.resumeBtn, 2],
      [EX_COPY.rebaseBtn, 14],
      [EX_COPY.archiveBtn, 9],
      [EX_COPY.recordBtn, 13],
      [EX_COPY.blockedContentChanged, 54],
      [EX_COPY.blockedSourceArchived, 32],
      [EX_COPY.blockedNotReviewed, 43],
      [EX_COPY.alreadyDoneNotice, 36],
      [EX_COPY.publicationVoidedNotice, 53],
      [EX_COPY.channelPreparing, 27],
      [EX_COPY.loadError, 36],
      [EX_COPY.noPermission, 30],
      [ER_COPY.heading, 13],
      [ER_COPY.intro, 73],
      [ER_COPY.addBtn, 7],
      [ER_COPY.voidBtn, 7],
      [ER_COPY.archiveBtn, 7],
      [ER_COPY.readonlySyncPreparing, 39],
      [ER_COPY.periodHint, 61],
      [ER_COPY.voidHint, 53],
    ];
    for (const [s, n] of ex) expect(Array.from(s).length, s).toBe(n);
  });

  it("막힘 원인 문구는 서버 도메인·동작 문구와 같다(한 문장)", () => {
    expect(blockText("content_changed")).toBe(BLOCK_REASON_LABELS.content_changed);
    expect(blockText("source_archived")).toBe(BLOCK_REASON_LABELS.source_archived);
    expect(blockText("not_reviewed")).toBe(BLOCK_REASON_LABELS.not_reviewed);
    expect(EXEC_ACTION_COPY.alreadyDoneNotice).toBe(EX_COPY.alreadyDoneNotice);
    expect(EXEC_ACTION_COPY.blockedContentChanged).toBe(EX_COPY.blockedContentChanged);
    expect(EXEC_ACTION_COPY.blockedSourceArchived).toBe(EX_COPY.blockedSourceArchived);
    expect(EXEC_ACTION_COPY.blockedNotReviewed).toBe(EX_COPY.blockedNotReviewed);
    expect(EXECUTION_STATUS_LABELS.blocked_mismatch).toBe("판 불일치 차단");
  });

  it("실행 건 동작은 상태 전이표대로, 보관·읽기 전용이면 없음", () => {
    expect(jobActions(job(), true)).toMatchObject({ approve: true, hold: true, record: false, archive: true });
    expect(jobActions(job({ status: "queued" }), true)).toMatchObject({ record: true, hold: true, approve: false });
    expect(jobActions(job({ status: "running" }), true)).toMatchObject({ record: true, hold: false, archive: false });
    expect(jobActions(job({ status: "failed", attemptCount: 2 }), true)).toMatchObject({ retry: true, hold: true });
    expect(jobActions(job({ status: "failed", attemptCount: 3 }), true)).toMatchObject({ retry: false });
    expect(jobActions(job({ status: "held" }), true)).toMatchObject({ resume: true, hold: false });
    expect(jobActions(job({ status: "blocked_mismatch" }), true)).toMatchObject({ rebase: true, approve: false });
    expect(jobActions(job({ status: "succeeded" }), true)).toMatchObject({ approve: false, record: false, retry: false, archive: true });
    expect(Object.values(jobActions(job(), false)).some(Boolean)).toBe(false);
    expect(Object.values(jobActions(job({ archivedAt: "x" }), true)).some(Boolean)).toBe(false);
  });

  it("요약 건수·대기열/기록 나누기: 개수만(보관 제외), 끝난 건은 기록으로", () => {
    const jobs = [job(), job({ id: "2", status: "queued" }), job({ id: "3", status: "running" }), job({ id: "4", status: "blocked_mismatch" }), job({ id: "5", status: "succeeded" }), job({ id: "6", status: "pending_approval", archivedAt: "x" })];
    const results = [
      { status: "active", archivedAt: null },
      { status: "voided", archivedAt: null },
      { status: "active", archivedAt: "x" },
    ] as never;
    expect(executionCounts({ jobs, results })).toEqual({ pending: 1, queued: 2, blocked: 1, results: 1 });
    const { queue, history } = splitJobs(jobs);
    expect(queue.map((j) => j.id)).toEqual(["j1", "2", "3", "4"]);
    expect(history.map((j) => j.id)).toEqual(["5", "6"]);
  });

  it("성과 표시: 실제 입력값만(분자·분모 있으면 괄호), 기간 일수 양 끝 포함, 시각 KST", () => {
    expect(resultHeadline({ metricName: "티스토리 글 조회수", value: 342, unit: "count", numerator: null, denominator: null })).toBe("티스토리 글 조회수 · 342건");
    expect(resultHeadline({ metricName: "클릭률", value: 18.4, unit: "percent", numerator: 23, denominator: 125 })).toBe("클릭률 · 18.4% (23 / 125)");
    expect(periodDays("2026-11-13", "2026-11-19")).toBe(7);
    expect(resultMeta({ periodStart: "2026-11-13", periodEnd: "2026-11-19", unit: "count", sourceNote: "방문자 통계" })).toBe("기간: 2026-11-13 ~ 2026-11-19 (KST 7일) · 단위: 건(count) · 출처: 방문자 통계");
    expect(formatKst("2026-11-19T18:55:00Z")).toBe("2026-11-20 03:55 KST");
    expect(formatKst(null)).toBe("-");
  });
});
