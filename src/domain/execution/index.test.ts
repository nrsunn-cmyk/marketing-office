import { describe, expect, it } from "vitest";
import { executionErrorFromDb, executionResultSchema, toStepResult, voidResultSchema } from "./index";

describe("실행 대기열·성과 순수 규칙(P4A)", () => {
  it("DB 오류 → 안내: 한국어 설명은 그대로, 한도는 VALIDATION, 동결은 INVALID_TRANSITION, 모르는 것은 일반 문구", () => {
    expect(executionErrorFromDb("LIMIT_REACHED: 실행 건은 프로젝트당 200개까지입니다(보관 포함)")).toEqual({ code: "VALIDATION", message: "실행 건은 프로젝트당 200개까지입니다(보관 포함)." });
    expect(executionErrorFromDb("NOT_FOUND: 채널 초안을 찾을 수 없습니다")).toEqual({ code: "NOT_FOUND", message: "채널 초안을 찾을 수 없습니다" });
    expect(executionErrorFromDb("FROZEN_COLUMN: 보관한 실행 건은 바꿀 수 없습니다").code).toBe("INVALID_TRANSITION");
    expect(executionErrorFromDb("CONFLICT: x").code).toBe("CONFLICT");
    expect(executionErrorFromDb("boom")).toEqual({ code: "ERROR", message: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  });
  it("RPC 결과 → 화면 모양(already_done 은 있을 때만)", () => {
    expect(toStepResult({ job_id: "j", status: "blocked_mismatch", block_reason: "content_changed", revision: 3, attempt_count: 0, publication_id: null, idempotency_key: "exec-j" })).toEqual({
      jobId: "j", status: "blocked_mismatch", blockReason: "content_changed", revision: 3, attemptCount: 0, publicationId: null, idempotencyKey: "exec-j",
    });
    expect(toStepResult({ job_id: "j", status: "succeeded", already_done: true }).alreadyDone).toBe(true);
  });
  it("성과 입력 계약: 앞뒤 공백 정리, 분자·분모 짝, 기간 순서, 받침 맞춘 문구", () => {
    const ok = { executionJobId: null, metricName: " 조회수 ", value: 342, unit: "count", numerator: null, denominator: null, sourceNote: " 통계 화면 ", periodStart: "2026-11-13", periodEnd: "2026-11-19" };
    expect(executionResultSchema.parse(ok)).toMatchObject({ metricName: "조회수", sourceNote: "통계 화면" });
    expect(executionResultSchema.safeParse({ ...ok, numerator: 1 }).error?.issues[0].message).toBe("분자·분모는 둘 다 넣거나 둘 다 비워 주세요.");
    expect(executionResultSchema.safeParse({ ...ok, periodStart: "2026-11-20" }).error?.issues[0].message).toBe("집계 시작일이 종료일보다 늦습니다.");
    expect(executionResultSchema.safeParse({ ...ok, sourceNote: " " }).error?.issues[0].message).toBe("출처를 입력해 주세요.");
    expect(voidResultSchema.safeParse({ reason: "" }).error?.issues[0].message).toBe("취소 이유를 입력해 주세요.");
  });
});
