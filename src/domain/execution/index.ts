/**
 * P4A-BACKEND-IMPL-01: 실행 승인 대기열·성과(P4 첫 단계) 순수 모듈. 값 규칙의 최종 판정은 DB(20261121012000_p4a_execution, 처음 이름 007000)가 한다.
 * 게시 주소·시각은 P2-g 채널 초안 규칙(normalizePublicationUrl·parsePublishedAt)을 그대로 쓴다.
 */
import { z } from "zod";
import { funnelErrorFromDb, funnelIssueMessage } from "@/domain/funnel";
import { briefTrim, charLength } from "@/domain/production-brief/constants";

export const EXECUTION_LIMITS = {
  jobsPerProject: 200, // 보관 포함
  attemptsMax: 3,
  resultsPerProject: 500, // 보관·취소 포함
  metricName: 60,
  sourceNote: 200,
  voidReason: 300,
  periodDaysMax: 366, // 양 끝 포함
} as const;

/** AGY P4-HANDOFF-CONSISTENCY 1절 상태(실행 대기열) */
export const EXECUTION_STATUSES = ["pending_approval", "blocked_mismatch", "queued", "running", "succeeded", "failed", "held"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  pending_approval: "승인 대기",
  blocked_mismatch: "판 불일치 차단",
  queued: "실행 대기",
  running: "실행 중",
  succeeded: "완료",
  failed: "실패",
  held: "보류",
};
export const BLOCK_REASONS = ["content_changed", "source_archived", "not_reviewed"] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];
export const BLOCK_REASON_LABELS: Record<BlockReason, string> = {
  content_changed: "승인 이후 초안 내용이 바뀌었습니다. 맞추기로 지금 내용을 다시 승인하거나 초안을 되돌려 주세요.",
  source_archived: "원본 초안이 보관되었습니다. 이 실행 건을 보관해 주세요.",
  not_reviewed: "원본 초안이 검토 완료가 아닙니다. 초안을 검토 완료로 바꾼 뒤 맞춰 주세요.",
};
/** 지금 실행할 수 있는 채널(나머지는 자리만 — 만들기 거절) */
export const EXECUTION_CHANNELS = ["tistory_manual", "crm", "search_ad", "social_api"] as const;
export const ENABLED_EXECUTION_CHANNELS = ["tistory_manual"] as const;
export const RESULT_UNITS = ["count", "percent", "won", "seconds"] as const;
export type ResultUnit = (typeof RESULT_UNITS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const reqText = (max: number, obj: string, topic: string) =>
  z.string().transform(briefTrim).pipe(z.string().min(1, `${obj} 입력해 주세요.`).refine((s) => charLength(s) <= max, `${topic} ${max}자까지입니다.`));

/** 성과 수동 입력(화면 → 서버). 값·기간의 최종 판정은 DB 가 한다 */
export const executionResultSchema = z
  .strictObject({
    executionJobId: z.uuid("실행 건 id 가 올바르지 않습니다.").nullable(),
    metricName: reqText(EXECUTION_LIMITS.metricName, "성과 지표를", "성과 지표는"),
    value: z.number("수치를 입력해 주세요.").nonnegative("수치는 0 이상이어야 합니다."),
    unit: z.enum(RESULT_UNITS, "알 수 없는 단위입니다."),
    numerator: z.number().int().nonnegative().nullable(),
    denominator: z.number().int().positive().nullable(),
    sourceNote: reqText(EXECUTION_LIMITS.sourceNote, "출처를", "출처는"),
    periodStart: z.string().regex(DATE_RE, "집계 시작일 형식이 올바르지 않습니다."),
    periodEnd: z.string().regex(DATE_RE, "집계 종료일 형식이 올바르지 않습니다."),
  })
  .refine((v) => (v.numerator === null) === (v.denominator === null), "분자·분모는 둘 다 넣거나 둘 다 비워 주세요.")
  .refine((v) => v.periodStart <= v.periodEnd, "집계 시작일이 종료일보다 늦습니다.");
export type ExecutionResultInput = z.infer<typeof executionResultSchema>;

export const voidResultSchema = z.strictObject({ reason: reqText(EXECUTION_LIMITS.voidReason, "취소 이유를", "취소 이유는") });

export type ExecutionErrorCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "INVALID_TRANSITION" | "ERROR";
const hangul = (d: string) => (/[가-힣]/.test(d) && d.length <= 200 ? (/[.다요]$/.test(d) ? d : `${d}.`) : null);
/** DB 오류 "CODE: 설명" → 안내. VALIDATION·INVALID_TRANSITION·LIMIT_REACHED·NOT_FOUND 는 migration 의 한국어 설명을 그대로, 모르는 오류는 일반 문구 */
export function executionErrorFromDb(message: string | null | undefined): { code: ExecutionErrorCode; message: string } {
  const m = /^\s*([A-Z_]+):\s*(.*)$/s.exec(message ?? "");
  const head = m?.[1] ?? "";
  const detail = m?.[2]?.trim() ?? "";
  switch (head) {
    case "CONFLICT":
      return { code: "CONFLICT", message: funnelErrorFromDb("CONFLICT: x").message };
    case "NOT_FOUND":
      return { code: "NOT_FOUND", message: hangul(detail) ?? "실행 건이나 원본을 찾을 수 없습니다. 화면을 새로 고쳐 주세요." };
    case "LIMIT_REACHED":
    case "VALIDATION":
      return { code: "VALIDATION", message: hangul(detail) ?? "입력값이 규칙에 맞지 않습니다." };
    case "INVALID_TRANSITION":
    case "FROZEN_COLUMN":
      return { code: "INVALID_TRANSITION", message: hangul(detail) ?? "지금 상태에서는 할 수 없는 동작입니다." };
    case "NOT_AUTHENTICATED":
      return { code: "ERROR", message: "로그인이 필요합니다. 다시 로그인해 주세요." };
    default:
      return { code: "ERROR", message: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
export const executionIssueMessage = funnelIssueMessage;

/** RPC 가 돌려주는 실행 건 요약(approve·record·retry·hold·resume·rebase) */
export interface ExecutionStepResult {
  jobId: string;
  status: ExecutionStatus;
  blockReason: BlockReason | null;
  revision: number;
  attemptCount: number;
  publicationId: string | null;
  idempotencyKey: string;
  /** record 에서만: 이미 끝난 건이라 실행하지 않고 기존 결과를 돌려줌 */
  alreadyDone?: boolean;
}
export function toStepResult(j: unknown): ExecutionStepResult {
  const r = (j ?? {}) as Record<string, unknown>;
  return {
    jobId: String(r.job_id ?? ""),
    status: r.status as ExecutionStatus,
    blockReason: (r.block_reason as BlockReason | null) ?? null,
    revision: Number(r.revision ?? 0),
    attemptCount: Number(r.attempt_count ?? 0),
    publicationId: (r.publication_id as string | null) ?? null,
    idempotencyKey: String(r.idempotency_key ?? ""),
    ...(r.already_done === undefined ? {} : { alreadyDone: Boolean(r.already_done) }),
  };
}
