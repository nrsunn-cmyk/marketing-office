import "server-only";
import { normalizePublicationUrl, parsePublishedAt, publicationInputSchema } from "@/domain/channel-draft";
import {
  BLOCK_REASON_LABELS,
  EXECUTION_LIMITS,
  EXECUTION_STATUS_LABELS,
  executionErrorFromDb,
  executionIssueMessage,
  executionResultSchema,
  toStepResult,
  voidResultSchema,
  type BlockReason,
  type ExecutionStatus,
  type ExecutionStepResult,
  type ResultUnit,
} from "@/domain/execution";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/server/supabase/database.types";

/**
 * P4A-BACKEND-IMPL-01: 실행 승인 대기열·티스토리 수동 게시 실행·성과 수동 입력 서버 함수. 외부 API 호출 없음.
 * 설계: Plan/Claude-Backend-20261120/P4A-BACKEND-01-DESIGN.md(Master 수락 A안). 화면 인계는 Plan/Claude-Backend-20261120/P4A-BACKEND-IMPL-01.md 5절.
 */

const NULL = null as unknown as string; // RPC 인자 타입이 null 을 받지 않게 생성돼 있어 null 을 그대로 넘길 때 쓴다

function readFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  console.error(`[${where}]`, error.code, error.message);
  return fail("ERROR", "실행 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  const e = executionErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  return fail(e.code, e.message);
}

// ─────────────────────────────────────────────
// 읽기
// ─────────────────────────────────────────────
export interface ExecutionJobView {
  id: string;
  status: ExecutionStatus;
  statusLabel: string;
  blockReason: BlockReason | null;
  blockReasonLabel: string | null;
  channel: string;
  idempotencyKey: string;
  attemptCount: number;
  revision: number;
  /** 원본(채널 초안) */
  source: { kind: string; id: string; revision: number; title: string | null };
  /** 대기열에 올릴 때 고정한 승인본 사본의 제목(내용 일치 확인 화면용) */
  payloadTitle: string;
  /** 지금 원본이 고정한 사본과 같은지(읽을 때 계산한 참고값. 실제 차단은 승인·기록 때 서버가 다시 본다) */
  liveMatches: boolean;
  approvedAt: string | null;
  executedAt: string | null;
  externalUrl: string | null;
  publicationId: string | null;
  /** 게시 기록이 나중에 취소되었는지(실행 건은 succeeded 그대로, 경고만) */
  publicationVoided: boolean;
  archivedAt: string | null;
  createdAt: string;
}
export interface ExecutionResultView {
  id: string;
  executionJobId: string | null;
  metricName: string;
  value: number;
  unit: ResultUnit;
  numerator: number | null;
  denominator: number | null;
  sourceNote: string;
  periodStart: string;
  periodEnd: string;
  collectionMode: "manual_entry" | "readonly_sync";
  status: "active" | "voided";
  voidReason: string | null;
  archivedAt: string | null;
  createdAt: string;
}
export interface ExecutionBoard {
  projectId: string;
  jobs: ExecutionJobView[];
  results: ExecutionResultView[];
  /** 대기열에 올릴 수 있는 원본(같은 프로젝트의 검토 완료·보관 안 된 채널 초안, 끝나지 않은 건이 없는 것) */
  enqueueOptions: Array<{ draftId: string; title: string; revision: number }>;
  /** 보관한 프로젝트면 false(조회만) */
  canWrite: boolean;
  limits: typeof EXECUTION_LIMITS;
  counts: { jobs: number; results: number };
}

const hashOf = async (o: Record<string, unknown>) => {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(JSON.stringify(o), "utf8").digest("hex");
};

export async function getExecutionBoard(projectId: string): Promise<Result<ExecutionBoard>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const pr = await sb.from("projects").select("id, status").eq("id", projectId).eq("workspace_id", workspace.id).maybeSingle();
  if (pr.error) return readFail("getExecutionBoard.project", pr.error);
  if (!pr.data) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  const [jobs, results, briefs] = await Promise.all([
    sb.from("execution_jobs").select("*").eq("workspace_id", workspace.id).eq("project_id", projectId).order("created_at", { ascending: false }),
    sb.from("execution_results").select("*").eq("workspace_id", workspace.id).eq("project_id", projectId).order("period_end", { ascending: false }),
    sb.from("content_briefs").select("id").eq("workspace_id", workspace.id).eq("project_id", projectId),
  ]);
  for (const [where, r] of [["jobs", jobs], ["results", results], ["briefs", briefs]] as const) if (r.error) return readFail(`getExecutionBoard.${where}`, r.error);
  const briefIds = (briefs.data ?? []).map((b) => b.id);
  const drafts = briefIds.length
    ? await sb.from("channel_drafts").select("id, title, body, tags, image_note, meta_description, status, revision, archived_at").eq("workspace_id", workspace.id).in("brief_id", briefIds)
    : { data: [], error: null };
  if (drafts.error) return readFail("getExecutionBoard.drafts", drafts.error);
  const pubIds = (jobs.data ?? []).map((j) => j.publication_id).filter((x): x is string => !!x);
  const voids = pubIds.length ? await sb.from("channel_publications").select("voids_id").eq("workspace_id", workspace.id).in("voids_id", pubIds) : { data: [], error: null };
  if (voids.error) return readFail("getExecutionBoard.voids", voids.error);
  const voided = new Set((voids.data ?? []).map((v) => v.voids_id));
  const draftById = new Map((drafts.data ?? []).map((d) => [d.id, d]));

  const jobViews: ExecutionJobView[] = [];
  for (const j of jobs.data ?? []) {
    const d = draftById.get(j.source_id);
    const payload = (j.payload ?? {}) as Record<string, unknown>;
    // 같은 칸 순서로 모아 비교한다(지문 계산 방식과 무관하게 내용 같음만 본다)
    const live = d ? { title: d.title, body: d.body, tags: d.tags, image_note: d.image_note, meta_description: d.meta_description } : null;
    const fixed = { title: payload.title, body: payload.body, tags: payload.tags, image_note: payload.image_note, meta_description: payload.meta_description };
    const liveMatches = !!live && d?.status === "reviewed" && d?.archived_at === null && (await hashOf(live)) === (await hashOf(fixed));
    const status = j.status as ExecutionStatus;
    const reason = (j.block_reason as BlockReason | null) ?? null;
    jobViews.push({
      id: j.id,
      status,
      statusLabel: EXECUTION_STATUS_LABELS[status],
      blockReason: reason,
      blockReasonLabel: reason ? BLOCK_REASON_LABELS[reason] : null,
      channel: j.channel,
      idempotencyKey: j.idempotency_key,
      attemptCount: j.attempt_count,
      revision: j.revision,
      source: { kind: j.source_kind, id: j.source_id, revision: j.source_revision, title: d?.title ?? null },
      payloadTitle: String(payload.title ?? ""),
      liveMatches,
      approvedAt: j.approved_at,
      executedAt: j.executed_at,
      externalUrl: j.external_url,
      publicationId: j.publication_id,
      publicationVoided: !!j.publication_id && voided.has(j.publication_id),
      archivedAt: j.archived_at,
      createdAt: j.created_at,
    });
  }
  const open = new Set((jobs.data ?? []).filter((j) => j.archived_at === null && j.status !== "succeeded").map((j) => j.source_id));
  return ok({
    projectId,
    jobs: jobViews,
    results: (results.data ?? []).map((r) => ({
      id: r.id,
      executionJobId: r.execution_job_id,
      metricName: r.metric_name,
      value: Number(r.value),
      unit: r.unit as ResultUnit,
      numerator: r.numerator === null ? null : Number(r.numerator),
      denominator: r.denominator === null ? null : Number(r.denominator),
      sourceNote: r.source_note,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      collectionMode: r.collection_mode as ExecutionResultView["collectionMode"],
      status: r.status as ExecutionResultView["status"],
      voidReason: r.void_reason,
      archivedAt: r.archived_at,
      createdAt: r.created_at,
    })),
    enqueueOptions: (drafts.data ?? [])
      .filter((d) => d.status === "reviewed" && d.archived_at === null && !open.has(d.id))
      .map((d) => ({ draftId: d.id, title: d.title, revision: d.revision })),
    canWrite: pr.data.status !== "archived",
    limits: EXECUTION_LIMITS,
    counts: { jobs: (jobs.data ?? []).length, results: (results.data ?? []).length },
  });
}

// ─────────────────────────────────────────────
// 실행 건 쓰기
// ─────────────────────────────────────────────
/** 대기열에 올리기(지금은 티스토리 수동 게시·채널 초안만) */
export async function enqueueExecution(projectId: string, draftId: string): Promise<Result<{ jobId: string }>> {
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("enqueue_execution", { p_project_id: projectId, p_source_kind: "channel_draft", p_source_id: draftId, p_channel: "tistory_manual" });
  if (r.error) return rpcFail("enqueueExecution", r.error);
  return ok({ jobId: r.data });
}

type StepRpc = "approve_execution" | "retry_execution" | "hold_execution" | "resume_execution" | "rebase_execution";
async function step(fn: StepRpc, jobId: string, expectedRevision: number): Promise<Result<ExecutionStepResult>> {
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc(fn, { p_job_id: jobId, p_expected_revision: expectedRevision });
  if (r.error) return rpcFail(fn, r.error);
  return ok(toStepResult(r.data));
}
/** 승인. 내용이 바뀌었으면 오류가 아니라 status 'blocked_mismatch' 와 blockReason 으로 돌아온다(저장됨) */
export const approveExecution = (jobId: string, rev: number) => step("approve_execution", jobId, rev);
/** 실패 건 다시 하기(같은 키, 3번까지). 외부 채널용 자리 — 티스토리 수동은 실패가 생기지 않는다 */
export const retryExecution = (jobId: string, rev: number) => step("retry_execution", jobId, rev);
export const holdExecution = (jobId: string, rev: number) => step("hold_execution", jobId, rev);
/** 다시 시작. 재개 때도 내용을 다시 대조한다 */
export const resumeExecution = (jobId: string, rev: number) => step("resume_execution", jobId, rev);
/** 맞추기: 막힌 건을 지금 원본 내용으로 다시 고정하고 승인 대기로(다시 승인 필요) */
export const rebaseExecution = (jobId: string, rev: number) => step("rebase_execution", jobId, rev);

export async function archiveExecution(jobId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("archive_execution", { p_job_id: jobId, p_expected_revision: expectedRevision });
  if (r.error) return rpcFail("archiveExecution", r.error);
  return ok({ revision: r.data });
}

/**
 * 티스토리 수동 게시 기록 + 실행 완료(한 트랜잭션). raw = { url, publishedAt(KST "YYYY-MM-DDTHH:mm" 또는 ISO), note }
 * - 이미 끝난 건이면 실행하지 않고 기존 결과(alreadyDone: true)
 * - 내용이 바뀌었으면 게시 기록 없이 status 'blocked_mismatch'(저장됨)
 */
export async function recordTistoryExecution(jobId: string, expectedRevision: number, raw: unknown): Promise<Result<ExecutionStepResult>> {
  const parsed = publicationInputSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION", executionIssueMessage(parsed.error.issues[0]));
  const u = normalizePublicationUrl(parsed.data.url);
  if (!u.ok) return fail("VALIDATION", u.message);
  const t = parsePublishedAt(parsed.data.publishedAt);
  if (!t.ok) return fail("VALIDATION", t.message);
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("record_tistory_execution", {
    p_job_id: jobId,
    p_expected_revision: expectedRevision,
    p_url: u.url,
    p_published_at: t.iso,
    p_note: parsed.data.note ?? undefined,
  });
  if (r.error) return rpcFail("recordTistoryExecution", r.error);
  return ok(toStepResult(r.data as Json));
}

// ─────────────────────────────────────────────
// 성과(수동 입력)
// ─────────────────────────────────────────────
/** raw = { executionJobId|null, metricName, value, unit, numerator|null, denominator|null, sourceNote, periodStart, periodEnd } (날짜는 KST "YYYY-MM-DD") */
export async function addExecutionResult(projectId: string, raw: unknown): Promise<Result<{ resultId: string }>> {
  const p = executionResultSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", executionIssueMessage(p.error.issues[0]));
  const v = p.data;
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("add_execution_result", {
    p_project_id: projectId,
    p_execution_job_id: v.executionJobId ?? NULL,
    p_metric_name: v.metricName,
    p_value: v.value,
    p_unit: v.unit,
    p_numerator: (v.numerator ?? NULL) as unknown as number,
    p_denominator: (v.denominator ?? NULL) as unknown as number,
    p_source_note: v.sourceNote,
    p_period_start: v.periodStart,
    p_period_end: v.periodEnd,
  });
  if (r.error) return rpcFail("addExecutionResult", r.error);
  return ok({ resultId: r.data });
}

/** 성과 취소(고치기 대신 취소 + 새 행). raw = { reason } */
export async function voidExecutionResult(resultId: string, raw: unknown): Promise<Result<{ revision: number }>> {
  const p = voidResultSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", executionIssueMessage(p.error.issues[0]));
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("void_execution_result", { p_result_id: resultId, p_reason: p.data.reason });
  if (r.error) return rpcFail("voidExecutionResult", r.error);
  return ok({ revision: r.data });
}

export async function archiveExecutionResult(resultId: string): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("archive_execution_result", { p_result_id: resultId });
  if (r.error) return rpcFail("archiveExecutionResult", r.error);
  return ok({ revision: r.data });
}
