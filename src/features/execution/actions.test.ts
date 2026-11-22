import { beforeEach, describe, expect, it, vi } from "vitest";

/** P4A-UI-01 실행·성과 동작: 형식 검사 → 서버 함수 → refresh. 막힘·이미 끝남은 저장된 결과(새로 고침 + 안내). 서버 함수는 가짜 */
const m = vi.hoisted(() => ({
  enqueue: vi.fn(),
  approve: vi.fn(),
  retry: vi.fn(),
  hold: vi.fn(),
  resume: vi.fn(),
  rebase: vi.fn(),
  archive: vi.fn(),
  record: vi.fn(),
  add: vi.fn(),
  voidR: vi.fn(),
  archiveR: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./server", () => ({
  enqueueExecution: (...a: unknown[]) => m.enqueue(...a),
  approveExecution: (...a: unknown[]) => m.approve(...a),
  retryExecution: (...a: unknown[]) => m.retry(...a),
  holdExecution: (...a: unknown[]) => m.hold(...a),
  resumeExecution: (...a: unknown[]) => m.resume(...a),
  rebaseExecution: (...a: unknown[]) => m.rebase(...a),
  archiveExecution: (...a: unknown[]) => m.archive(...a),
  recordTistoryExecution: (...a: unknown[]) => m.record(...a),
  addExecutionResult: (...a: unknown[]) => m.add(...a),
  voidExecutionResult: (...a: unknown[]) => m.voidR(...a),
  archiveExecutionResult: (...a: unknown[]) => m.archiveR(...a),
}));
vi.mock("next/cache", () => ({ refresh: () => m.refresh() }));

const A = await import("./actions");
const P = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const D = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const J = "cccccccc-cccc-4ccc-8ccc-000000000001";
const R = "dddddddd-dddd-4ddd-8ddd-000000000001";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const stepOk = (x: Record<string, unknown> = {}) => ({ ok: true, data: { jobId: J, status: "queued", blockReason: null, revision: 4, attemptCount: 0, publicationId: null, idempotencyKey: `exec-${J}`, ...x } });

beforeEach(() => vi.clearAllMocks());

describe("실행 건 동작", () => {
  it("대기열에 올리기: 프로젝트·초안 id, 틀린 값은 서버 전에 거절, 서버 문구 그대로", async () => {
    m.enqueue.mockResolvedValueOnce({ ok: true, data: { jobId: J } });
    expect(await A.enqueueExecutionAction({}, fd({ projectId: P, draftId: D }))).toEqual({ ok: true });
    expect(m.enqueue).toHaveBeenCalledWith(P, D);
    expect(m.refresh).toHaveBeenCalledTimes(1);
    m.enqueue.mockResolvedValueOnce({ ok: false, code: "VALIDATION", message: "같은 초안의 끝나지 않은 실행 건이 이미 있습니다." });
    expect(await A.enqueueExecutionAction({}, fd({ projectId: P, draftId: D }))).toEqual({ message: "같은 초안의 끝나지 않은 실행 건이 이미 있습니다." });
    expect(await A.enqueueExecutionAction({}, fd({ projectId: "x", draftId: D }))).toEqual({ message: "잘못된 요청입니다." });
  });

  it("승인: 성공은 안내 없이 새로 고침, 막힘은 저장된 결과라 새로 고침 + 원인별 확정 문구(3종)", async () => {
    m.approve.mockResolvedValueOnce(stepOk());
    expect(await A.approveExecutionAction({}, fd({ jobId: J, revision: "3" }))).toEqual({ ok: true });
    expect(m.approve).toHaveBeenCalledWith(J, 3);
    const msgs: Record<string, string> = {
      content_changed: "승인 이후 초안 내용이 바뀌었습니다. 맞추기로 지금 내용을 다시 승인하거나 초안을 되돌려 주세요.",
      source_archived: "원본 초안이 보관되었습니다. 이 실행 건을 보관해 주세요.",
      not_reviewed: "원본 초안이 검토 완료가 아닙니다. 초안을 검토 완료로 바꾼 뒤 맞춰 주세요.",
    };
    for (const [reason, msg] of Object.entries(msgs)) {
      m.approve.mockResolvedValueOnce(stepOk({ status: "blocked_mismatch", blockReason: reason }));
      expect(await A.approveExecutionAction({}, fd({ jobId: J, revision: "3" }))).toEqual({ message: msg });
    }
    expect(m.refresh).toHaveBeenCalledTimes(4);
    for (const revision of ["0", "x", "2147483648"]) expect(await A.approveExecutionAction({}, fd({ jobId: J, revision }))).toEqual({ message: "잘못된 요청입니다." });
  });

  it("다시 시도·보류·재개·맞추기·보관: jobId·revision, 서버 오류(끝난 건 다시 하기 거절)는 그 문구", async () => {
    for (const k of ["retry", "hold", "resume", "rebase"] as const) m[k].mockResolvedValue(stepOk());
    m.archive.mockResolvedValue({ ok: true, data: { revision: 4 } });
    const f = () => fd({ jobId: J, revision: "3" });
    expect(await A.retryExecutionAction({}, f())).toEqual({ ok: true });
    expect(await A.holdExecutionAction({}, f())).toEqual({ ok: true });
    expect(await A.resumeExecutionAction({}, f())).toEqual({ ok: true });
    expect(await A.rebaseExecutionAction({}, f())).toEqual({ ok: true });
    expect(await A.archiveExecutionAction({}, f())).toEqual({ ok: true });
    expect(m.rebase).toHaveBeenCalledWith(J, 3);
    m.retry.mockResolvedValueOnce({ ok: false, code: "INVALID_TRANSITION", message: "이미 끝난 실행 건은 다시 할 수 없습니다." });
    expect(await A.retryExecutionAction({}, f())).toEqual({ message: "이미 끝난 실행 건은 다시 할 수 없습니다." });
  });

  it("게시 기록: 주소·한국 시각·메모(빈칸은 null), 이미 끝난 건은 alreadyDoneNotice, 막힘은 원인 문구", async () => {
    m.record.mockResolvedValueOnce(stepOk({ status: "succeeded", publicationId: "p1" }));
    expect(await A.recordTistoryExecutionAction({}, fd({ jobId: J, revision: "3", url: "https://a.tistory.com/1", publishedAt: "2026-11-20T03:55", note: " " }))).toEqual({ ok: true });
    expect(m.record).toHaveBeenCalledWith(J, 3, { url: "https://a.tistory.com/1", publishedAt: "2026-11-20T03:55", note: null });
    m.record.mockResolvedValueOnce(stepOk({ status: "succeeded", alreadyDone: true }));
    expect(await A.recordTistoryExecutionAction({}, fd({ jobId: J, revision: "3", url: "https://a.tistory.com/1", publishedAt: "2026-11-20T03:55" }))).toEqual({ ok: true, message: "이미 기록이 끝난 실행 건입니다. 기존 결과를 그대로 유지합니다." });
    m.record.mockResolvedValueOnce(stepOk({ status: "blocked_mismatch", blockReason: "content_changed" }));
    expect((await A.recordTistoryExecutionAction({}, fd({ jobId: J, revision: "3", url: "https://a", publishedAt: "x" }))).message).toContain("승인 이후 초안 내용이 바뀌었습니다.");
  });
});

describe("성과 동작", () => {
  it("입력: 숫자 칸 변환(빈칸 null), 연결 실행 건 선택 안 하면 null, 서버 검사 문구 그대로", async () => {
    m.add.mockResolvedValueOnce({ ok: true, data: { resultId: R } });
    const base = { projectId: P, metricName: "조회수", value: "342", unit: "count", sourceNote: "방문자 통계", periodStart: "2026-11-13", periodEnd: "2026-11-19" };
    expect(await A.addExecutionResultAction({}, fd({ ...base, numerator: "", denominator: "", executionJobId: "" }))).toEqual({ ok: true });
    expect(m.add).toHaveBeenCalledWith(P, { executionJobId: null, metricName: "조회수", value: 342, unit: "count", numerator: null, denominator: null, sourceNote: "방문자 통계", periodStart: "2026-11-13", periodEnd: "2026-11-19" });
    m.add.mockResolvedValueOnce({ ok: false, code: "VALIDATION", message: "수치를 입력해 주세요." });
    expect(await A.addExecutionResultAction({}, fd({ ...base, value: "", executionJobId: J, numerator: "23", denominator: "125" }))).toEqual({ message: "수치를 입력해 주세요." });
    const sent = m.add.mock.calls[1][1];
    expect(Number.isNaN(sent.value)).toBe(true);
    expect(sent).toMatchObject({ executionJobId: J, numerator: 23, denominator: 125 });
  });

  it("취소(사유)·보관: 결과 id, 틀린 id 거절", async () => {
    m.voidR.mockResolvedValue({ ok: true, data: { revision: 2 } });
    m.archiveR.mockResolvedValue({ ok: true, data: { revision: 2 } });
    expect(await A.voidExecutionResultAction({}, fd({ resultId: R, reason: "기간을 잘못 적음" }))).toEqual({ ok: true });
    expect(m.voidR).toHaveBeenCalledWith(R, { reason: "기간을 잘못 적음" });
    expect(await A.archiveExecutionResultAction({}, fd({ resultId: R }))).toEqual({ ok: true });
    expect(await A.voidExecutionResultAction({}, fd({ resultId: "x", reason: "a" }))).toEqual({ message: "잘못된 요청입니다." });
  });
});
