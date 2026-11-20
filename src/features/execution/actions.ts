"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import type { BlockReason, ExecutionStepResult } from "@/domain/execution";
import type { Result } from "@/server/result";
import { EXEC_ACTION_COPY } from "./copy";
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

/** 대기열에 올리기: 프로젝트 id + 채널 초안 id(검토 완료·보관 안 됨은 서버가 다시 본다) */
export async function enqueueExecutionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const project = uuid.safeParse(fd.get("projectId"));
  const draft = uuid.safeParse(fd.get("draftId"));
  if (!project.success || !draft.success) return BAD;
  const r = await enqueueExecution(project.data, draft.data);
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
