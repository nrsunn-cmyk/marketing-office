"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import type { BlockReason, ExecutionStepResult } from "@/domain/execution";
import type { Result } from "@/server/result";
import { EXEC_ACTION_COPY } from "./copy";
import {
  cancelExecutionSchedule,
  createCrmFollowup,
  createInquiry,
  disconnectChannelConnection,
  dispatchExternalExecution,
  saveChannelConnection,
  scheduleExecution,
  syncChannelMetrics,
  updateCrmFollowup,
  type ExternalChannelKey,
} from "./channels";
import {
  addExecutionResult,
  approveExecution,
  archiveExecution,
  archiveExecutionResult,
  enqueueExecution,
  holdExecution,
  rebaseExecution,
  recordTistoryExecution,
  resumeExecution,
  retryExecution,
  voidExecutionResult,
} from "./server";

/**
 * P4A-UI-01 실행 대기열·성과 동작(서버 P4A-BACKEND-IMPL-01 5절, 인계상 Front 몫 — Backend 검토 요청). 외부 API 호출 없음.
 * 모두 폼 동작(FormState). 값 검사는 서버 zod 계약과 DB 가 한다.
 * - 성공 안내 문구는 확정본이 없어 붙이지 않는다(화면을 새로 고쳐 바뀐 상태를 보인다).
 * - 막힘(blocked_mismatch)은 오류가 아니라 저장된 결과다 → 원인별 EX_COPY 를 안내로 보이고 새로 고친다.
 * - 이미 끝난 기록(alreadyDone)은 EX_COPY.alreadyDoneNotice.
 */
const uuid = z.uuid();
const INT_MAX = 2_147_483_647;
const revision = z.coerce.number().int().positive().max(INT_MAX);
const BAD = { message: "잘못된 요청입니다." } as const;

const BLOCK_COPY: Record<BlockReason, string> = {
  content_changed: EXEC_ACTION_COPY.blockedContentChanged,
  source_archived: EXEC_ACTION_COPY.blockedSourceArchived,
  not_reviewed: EXEC_ACTION_COPY.blockedNotReviewed,
};

function jobIds(fd: FormData): { jobId: string; revision: number } | null {
  const id = uuid.safeParse(fd.get("jobId"));
  const rev = revision.safeParse(fd.get("revision"));
  return id.success && rev.success ? { jobId: id.data, revision: rev.data } : null;
}
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** 실행 건 한 단계 결과 → 화면 안내. 막힘·이미 끝남도 저장된 결과라 새로 고친다 */
function stepState(r: Result<ExecutionStepResult>): FormState {
  if (!r.ok) return { message: r.message };
  refresh();
  if (r.data.status === "blocked_mismatch") return { message: r.data.blockReason ? BLOCK_COPY[r.data.blockReason] : EXEC_ACTION_COPY.blockedContentChanged };
  if (r.data.alreadyDone) return { ok: true, message: EXEC_ACTION_COPY.alreadyDoneNotice };
  return { ok: true };
}

const channelSchema = z.enum(["tistory_manual", "crm", "search_ad", "social_api"]);
const extChannelSchema = z.enum(["crm", "search_ad", "social_api"]);

/** 대기열에 올리기: 프로젝트 id + 채널 초안 id + 실행 채널(기본 tistory_manual) */
export async function enqueueExecutionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const project = uuid.safeParse(fd.get("projectId"));
  const draft = uuid.safeParse(fd.get("draftId"));
  const rawCh = fd.get("channel");
  const ch = rawCh ? channelSchema.safeParse(rawCh) : { success: true as const, data: "tistory_manual" as const };
  if (!project.success || !draft.success || !ch.success) return BAD;
  const r = rawCh ? await enqueueExecution(project.data, draft.data, ch.data) : await enqueueExecution(project.data, draft.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true };
}

const stepAction =
  (call: (jobId: string, rev: number) => Promise<Result<ExecutionStepResult>>) =>
  async (fd: FormData): Promise<FormState> => {
    const ids = jobIds(fd);
    if (!ids) return BAD;
    return stepState(await call(ids.jobId, ids.revision));
  };
const approve = stepAction(approveExecution);
const retry = stepAction(retryExecution);
const hold = stepAction(holdExecution);
const resume = stepAction(resumeExecution);
const rebase = stepAction(rebaseExecution);

/** 실행 승인: 승인 때 서버가 지금 원본과 다시 대조한다(다르면 막힘 저장 + 원인 안내) */
export async function approveExecutionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return approve(fd);
}
/** 다시 시도(실패 건, 같은 멱등 키로 3번까지) */
export async function retryExecutionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return retry(fd);
}
export async function holdExecutionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return hold(fd);
}
/** 재개(재개 때도 내용을 다시 대조) */
export async function resumeExecutionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return resume(fd);
}
/** 최신 초안 기준으로 맞추기(막힌 건 → 승인 대기, 다시 승인 필요) */
export async function rebaseExecutionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return rebase(fd);
}

export async function archiveExecutionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = jobIds(fd);
  if (!ids) return BAD;
  const r = await archiveExecution(ids.jobId, ids.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true };
}

/** 티스토리 게시 완료 기록(직접 올린 주소·한국 시각). 게시 기록과 실행 완료를 서버가 한 번에 처리한다 */
export async function recordTistoryExecutionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = jobIds(fd);
  if (!ids) return BAD;
  const note = text(fd, "note");
  return stepState(await recordTistoryExecution(ids.jobId, ids.revision, { url: text(fd, "url"), publishedAt: text(fd, "publishedAt"), note: note.trim() ? note : null }));
}

// ── 성과(수동 입력만) ──
/** 숫자 칸: 비면 null, 숫자가 아니면 NaN(서버 zod 가 '수치를 입력해 주세요' 등으로 거절) */
function num(fd: FormData, k: string): number | null {
  const v = text(fd, k).trim();
  return v === "" ? null : Number(v);
}

export async function addExecutionResultAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const project = uuid.safeParse(fd.get("projectId"));
  if (!project.success) return BAD;
  const job = text(fd, "executionJobId");
  const value = num(fd, "value");
  const r = await addExecutionResult(project.data, {
    executionJobId: job ? job : null,
    metricName: text(fd, "metricName"),
    value: value ?? Number.NaN,
    unit: text(fd, "unit"),
    numerator: num(fd, "numerator"),
    denominator: num(fd, "denominator"),
    sourceNote: text(fd, "sourceNote"),
    periodStart: text(fd, "periodStart"),
    periodEnd: text(fd, "periodEnd"),
  });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true };
}

/** 성과 취소(고치기 대신 취소 + 새 행) */
export async function voidExecutionResultAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("resultId"));
  if (!id.success) return BAD;
  const r = await voidExecutionResult(id.data, { reason: text(fd, "reason") });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true };
}

export async function archiveExecutionResultAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("resultId"));
  if (!id.success) return BAD;
  const r = await archiveExecutionResult(id.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true };
}

// ── 외부 채널 연결 · 실행 · 성과 자동 수집(readonly_sync) ──
export async function saveChannelConnectionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ch = extChannelSchema.safeParse(fd.get("channel"));
  if (!ch.success) return BAD;
  const monthly = Number(text(fd, "monthlyBudgetWon") || "0");
  const perRun = Number(text(fd, "perRunLimitWon") || "0");
  const secret = text(fd, "secretKey");
  const r = await saveChannelConnection({
    channel: ch.data as ExternalChannelKey,
    accountLabel: text(fd, "accountLabel"),
    endpointUrl: text(fd, "endpointUrl"),
    metricsUrl: text(fd, "metricsUrl"),
    monthlyBudgetWon: Number.isFinite(monthly) ? monthly : 0,
    perRunLimitWon: Number.isFinite(perRun) ? perRun : 0,
    secretKey: secret.trim() ? secret.trim() : undefined,
  });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "외부 채널 연결을 저장했습니다." };
}

export async function disconnectChannelConnectionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ch = extChannelSchema.safeParse(fd.get("channel"));
  if (!ch.success) return BAD;
  const r = await disconnectChannelConnection(ch.data as ExternalChannelKey);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "외부 채널 연결을 끊고 저장된 키를 폐기했습니다." };
}

export async function dispatchExternalExecutionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ids = jobIds(fd);
  if (!ids) return BAD;
  return stepState(await dispatchExternalExecution(ids.jobId, ids.revision));
}

export async function syncChannelMetricsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const project = uuid.safeParse(fd.get("projectId"));
  const ch = extChannelSchema.safeParse(fd.get("channel"));
  if (!project.success || !ch.success) return BAD;
  const jobRaw = text(fd, "executionJobId");
  const jobId = jobRaw && uuid.safeParse(jobRaw).success ? jobRaw : null;
  const r = await syncChannelMetrics(project.data, ch.data as ExternalChannelKey, jobId);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: `${r.data.syncedCount}건의 성과 지표를 읽기 전용으로 수집했습니다.` };
}

// ── P4B: 예약 실행 · 상담/문의 · CRM 후속 작업 ──
export async function scheduleExecutionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const job = uuid.safeParse(fd.get("executionJobId"));
  const at = text(fd, "scheduledAt").trim();
  if (!job.success || !at) return BAD;
  const iso = at.includes("+") || at.endsWith("Z") ? at : `${at}:00+09:00`;
  const r = await scheduleExecution(job.data, iso);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true };
}

export async function cancelScheduleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("scheduleId"));
  if (!id.success) return BAD;
  const r = await cancelExecutionSchedule(id.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true };
}

export async function createInquiryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const project = uuid.safeParse(fd.get("projectId"));
  const src = z.enum(["lead_magnet", "web_copy_contact", "manual"]).safeParse(fd.get("sourceKind") || "manual");
  if (!project.success || !src.success) return BAD;
  const r = await createInquiry({
    projectId: project.data,
    sourceKind: src.data,
    contactName: text(fd, "contactName"),
    contactPhone: text(fd, "contactPhone"),
    contactEmail: text(fd, "contactEmail"),
    note: text(fd, "note"),
  });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true };
}

export async function createCrmFollowupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const inq = uuid.safeParse(fd.get("inquiryId"));
  const due = text(fd, "dueDate").trim();
  if (!inq.success || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return BAD;
  const r = await createCrmFollowup({
    inquiryId: inq.data,
    assigneeName: text(fd, "assigneeName"),
    dueDate: due,
  });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true };
}

export async function updateCrmFollowupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("followupId"));
  const st = z.enum(["todo", "in_progress", "done", "hold"]).safeParse(fd.get("status"));
  if (!id.success || !st.success) return BAD;
  const resRaw = text(fd, "linkedResultId").trim();
  const linkedResultId = resRaw && uuid.safeParse(resRaw).success ? resRaw : null;
  const r = await updateCrmFollowup({ followupId: id.data, status: st.data, linkedResultId });
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true };
}
