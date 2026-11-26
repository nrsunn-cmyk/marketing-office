import "server-only";
import { z } from "zod";
import { executionErrorFromDb, toStepResult, type ExecutionStepResult } from "@/domain/execution";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { approvedChannelEndpoint, configuredSigningKey, signedChannelCall } from "./channel-boundary";

export type ExternalChannelKey = "crm" | "search_ad" | "social_api";

export const EXTERNAL_CHANNEL_META: Record<
  ExternalChannelKey,
  { label: string; description: string; defaultEndpointHint: string }
> = {
  crm: {
    label: "고객 관리 (CRM)",
    description: "상담·리드 마그넷 후속 처리 및 웹훅 발송 연동",
    defaultEndpointHint: "https://hooks.example.com/crm/dispatch",
  },
  search_ad: {
    label: "검색 광고",
    description: "검색 광고 캠페인 집행 및 성과 지표 읽기 전용 수집",
    defaultEndpointHint: "https://api.example.com/search-ad/dispatch",
  },
  social_api: {
    label: "SNS",
    description: "공식 SNS 게시 API 실행 및 노출·전환 지표 수집",
    defaultEndpointHint: "https://api.example.com/social/dispatch",
  },
};

export interface ChannelConnectionView {
  id: string;
  channel: ExternalChannelKey;
  status: "disconnected" | "connected" | "error";
  accountLabel: string;
  endpointUrl: string;
  metricsUrl: string;
  monthlyBudgetWon: number;
  perRunLimitWon: number;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
}

export interface ExecutionScheduleView {
  id: string;
  executionJobId: string;
  scheduledAt: string;
  /** P4-SCHEDULE-RUNNER-01: due = 예약 시각이 지나 실행할 차례(사람이 대기열에서 실행) */
  status: "scheduled" | "due" | "paused_version_changed" | "cancelled" | "executed";
  dueAt: string | null;
}

export interface MaskedInquiryView {
  id: string;
  sourceKind: "lead_magnet" | "web_copy_contact" | "manual";
  maskedName: string;
  maskedPhone: string;
  maskedEmail: string;
  status: "new" | "linked" | "closed";
  createdAt: string;
}

export interface CrmFollowupView {
  id: string;
  inquiryId: string;
  assigneeName: string;
  dueDate: string;
  status: "todo" | "in_progress" | "done" | "hold";
  linkedResultId: string | null;
}

export interface P4ExternalBoard {
  connections: ChannelConnectionView[];
  schedules: ExecutionScheduleView[];
  inquiries: MaskedInquiryView[];
  followups: CrmFollowupView[];
}

type RpcCaller = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
};

function rpcErr<T>(where: string, error: { code?: string; message: string }): Result<T> {
  const e = executionErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  return fail(e.code, e.message);
}

export async function listP4ExternalBoard(projectId: string): Promise<Result<P4ExternalBoard>> {
  if (!z.uuid().safeParse(projectId).success) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  const { workspace } = await requireWorkspace();
  const workspaceId = workspace.id;
  const supabase = await createSupabaseServerClient();

  // P4-SCHEDULE-RUNNER-01: 크론(pg_cron)이 없거나 늦어도 화면이 맞게 보이도록 본인 업무실 예약을 먼저 따라잡는다(상태만 바꿈, 외부 호출 없음)
  const caught = await (supabase as unknown as RpcCaller).rpc("refresh_due_execution_schedules", {});
  if (caught.error) console.error("[listP4ExternalBoard] refresh_due_execution_schedules", caught.error);

  const [connRes, schedRes, inqRes, crmRes] = await Promise.all([
    supabase
      .from("channel_connections" as never)
      .select("id, channel, status, account_label, endpoint_url, metrics_url, monthly_budget_won, per_run_limit_won, last_checked_at, last_error_code")
      .eq("workspace_id", workspaceId)
      .order("channel"),
    supabase
      .from("execution_schedules" as never)
      .select("id, execution_job_id, scheduled_at, status, due_at")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .is("archived_at", null)
      .order("scheduled_at", { ascending: false }),
    (supabase as unknown as RpcCaller).rpc("list_masked_inquiries", { p_project_id: projectId }),
    supabase
      .from("crm_followups" as never)
      .select("id, inquiry_id, assignee_name, due_date, status, linked_result_id")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .is("archived_at", null)
      .order("due_date", { ascending: true }),
  ]);

  if (connRes.error || schedRes.error || inqRes.error || crmRes.error) {
    console.error("[listP4ExternalBoard]", connRes.error ?? schedRes.error ?? inqRes.error ?? crmRes.error);
    return fail("ERROR", "외부 채널 및 CRM 정보를 불러오지 못했습니다.");
  }

  const connections = ((connRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    channel: r.channel as ExternalChannelKey,
    status: r.status as ChannelConnectionView["status"],
    accountLabel: String(r.account_label ?? ""),
    endpointUrl: String(r.endpoint_url ?? ""),
    metricsUrl: String(r.metrics_url ?? ""),
    monthlyBudgetWon: Number(r.monthly_budget_won ?? 0),
    perRunLimitWon: Number(r.per_run_limit_won ?? 0),
    lastCheckedAt: (r.last_checked_at as string | null) ?? null,
    lastErrorCode: (r.last_error_code as string | null) ?? null,
  }));

  const schedules = ((schedRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    executionJobId: String(r.execution_job_id),
    scheduledAt: String(r.scheduled_at),
    status: r.status as ExecutionScheduleView["status"],
    dueAt: (r.due_at as string | null) ?? null,
  }));

  const inquiries = (Array.isArray(inqRes.data) ? (inqRes.data as Array<Record<string, unknown>>) : []).map((r) => ({
    id: String(r.id),
    sourceKind: r.source_kind as MaskedInquiryView["sourceKind"],
    maskedName: String(r.masked_name ?? ""),
    maskedPhone: String(r.masked_phone ?? ""),
    maskedEmail: String(r.masked_email ?? ""),
    status: r.status as MaskedInquiryView["status"],
    createdAt: String(r.created_at),
  }));

  const followups = ((crmRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    inquiryId: String(r.inquiry_id),
    assigneeName: String(r.assignee_name),
    dueDate: String(r.due_date),
    status: r.status as CrmFollowupView["status"],
    linkedResultId: (r.linked_result_id as string | null) ?? null,
  }));

  return ok({ connections, schedules, inquiries, followups });
}

export async function saveChannelConnection(input: {
  channel: ExternalChannelKey;
  accountLabel: string;
  endpointUrl: string;
  metricsUrl: string;
  monthlyBudgetWon: number;
  perRunLimitWon: number;
  secretKey?: string;
}): Promise<Result<{ id: string }>> {
  await requireWorkspace();
  if (!approvedChannelEndpoint(input.channel, "dispatch", input.endpointUrl)
    || (input.metricsUrl && !approvedChannelEndpoint(input.channel, "metrics", input.metricsUrl))) {
    return fail("VALIDATION", "서버에 승인된 외부 연동 주소를 입력해 주세요.");
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await (supabase as unknown as RpcCaller).rpc("upsert_channel_connection", {
    p_channel: input.channel,
    p_account_label: input.accountLabel,
    p_endpoint_url: input.endpointUrl,
    p_metrics_url: input.metricsUrl,
    p_monthly_budget_won: input.monthlyBudgetWon,
    p_per_run_limit_won: input.perRunLimitWon,
    p_secret_key: input.secretKey ?? null,
  });
  if (error) return rpcErr("saveChannelConnection", error);
  return ok({ id: String(data) });
}

export async function disconnectChannelConnection(channel: ExternalChannelKey): Promise<Result<true>> {
  await requireWorkspace();
  const supabase = await createSupabaseServerClient();
  const { error } = await (supabase as unknown as RpcCaller).rpc("disconnect_channel_connection", { p_channel: channel });
  if (error) return rpcErr("disconnectChannelConnection", error);
  return ok(true);
}

export async function dispatchExternalExecution(
  jobId: string,
  expectedRevision: number,
): Promise<Result<ExecutionStepResult>> {
  const { user } = await requireWorkspace();
  const key = configuredSigningKey();
  if (!key) return fail("ERROR", "외부 채널 실행을 사용할 수 없습니다.");
  const supabase = await createSupabaseServerClient();
  const rpc = supabase as unknown as RpcCaller;
  const prepRes = await rpc.rpc("p4_server_channel_call", signedChannelCall(
    "prepare", user.userId, { jobId, revision: expectedRevision }, key,
  ));
  if (prepRes.error) return rpcErr("dispatchExternalExecution.prepare", prepRes.error);

  const prep = prepRes.data as {
    blocked?: boolean;
    step?: unknown;
    job_id?: string;
    revision?: number;
    channel?: ExternalChannelKey;
    idempotency_key?: string;
    payload?: unknown;
    endpoint_url?: string;
    secret_value?: string;
    per_run_limit_won?: number;
  };
  if (prep.blocked) return ok(toStepResult(prep.step));

  let success = false;
  let externalUrl: string | null = null;
  let errorCode: string | null = null;

  try {
    const endpoint = prep.channel && approvedChannelEndpoint(prep.channel, "dispatch", prep.endpoint_url ?? "");
    if (!endpoint) {
      errorCode = "destination_not_allowed";
      throw new Error(errorCode);
    }
    const res = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${String(prep.secret_value ?? "")}`,
        "Idempotency-Key": String(prep.idempotency_key ?? ""),
      },
      body: JSON.stringify({
        idempotencyKey: prep.idempotency_key,
        channel: prep.channel,
        payload: prep.payload,
        perRunLimitWon: prep.per_run_limit_won ?? 0,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      success = true;
      try {
        const json = (await res.json()) as { externalUrl?: string; url?: string };
        const candidate = json.externalUrl ?? json.url ?? null;
        if (typeof candidate === "string" && /^https?:\/\//.test(candidate)) {
          externalUrl = candidate;
        }
      } catch {
        // 응답 본문이 JSON이 아니어도 2xx면 성공으로 기록
      }
    } else {
      errorCode = `http_${res.status}`;
    }
  } catch (err) {
    errorCode ??= err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network_error";
  }

  const finRes = await rpc.rpc("p4_server_channel_call", signedChannelCall("finish", user.userId, {
    jobId, revision: Number(prep.revision ?? expectedRevision), success, externalUrl, errorCode,
  }, key));
  if (finRes.error) return rpcErr("dispatchExternalExecution.finish", finRes.error);
  const step = toStepResult(finRes.data);
  if (!success) {
    return fail("ERROR", `외부 채널 실행에 실패했습니다 (${errorCode ?? "unknown"}). 실패 건에서 다시 시도할 수 있습니다.`);
  }
  return ok(step);
}

const syncMetricItemSchema = z.object({
  metricName: z.string().min(1).max(60),
  value: z.number().nonnegative(),
  unit: z.enum(["count", "percent", "won", "seconds"]).default("count"),
  numerator: z.number().int().nonnegative().nullable().optional(),
  denominator: z.number().int().positive().nullable().optional(),
  sourceNote: z.string().min(1).max(200).optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function syncChannelMetrics(
  projectId: string,
  channel: ExternalChannelKey,
  executionJobId: string | null = null,
): Promise<Result<{ syncedCount: number }>> {
  const { user } = await requireWorkspace();
  const key = configuredSigningKey();
  if (!key) return fail("ERROR", "외부 성과 가져오기를 사용할 수 없습니다.");
  const supabase = await createSupabaseServerClient();
  const rpc = supabase as unknown as RpcCaller;

  const credRes = await rpc.rpc("p4_server_channel_call", signedChannelCall("metrics", user.userId, { channel }, key));
  if (credRes.error) return rpcErr("syncChannelMetrics.creds", credRes.error);

  const cred = credRes.data as { metrics_url: string; secret_value: string; account_label: string };
  const endpoint = approvedChannelEndpoint(channel, "metrics", cred.metrics_url);
  if (!endpoint) return fail("VALIDATION", "서버에 승인된 외부 성과 주소가 필요합니다.");
  let rawItems: unknown[] = [];
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${cred.secret_value}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return fail("ERROR", `외부 성과 수집 호출에 실패했습니다 (HTTP ${res.status}).`);
    const body = (await res.json()) as unknown;
    rawItems = Array.isArray(body) ? body : [body];
  } catch {
    return fail("ERROR", "외부 성과 수집 주소를 불러오지 못했습니다.");
  }

  let syncedCount = 0;
  for (const item of rawItems) {
    const parsed = syncMetricItemSchema.safeParse(item);
    if (!parsed.success) continue;
    const v = parsed.data;
    const r = await rpc.rpc("p4_server_channel_call", signedChannelCall("recordMetric", user.userId, {
      projectId, executionJobId, metricName: v.metricName, value: v.value, unit: v.unit,
      numerator: v.numerator ?? null, denominator: v.denominator ?? null,
      sourceNote: v.sourceNote ?? `${EXTERNAL_CHANNEL_META[channel].label} (${cred.account_label}) 자동 수집`,
      periodStart: v.periodStart, periodEnd: v.periodEnd,
    }, key));
    if (!r.error) syncedCount++;
  }
  if (syncedCount === 0) {
    return fail("VALIDATION", "수집된 유효한 성과 지표가 없습니다.");
  }
  return ok({ syncedCount });
}

export async function scheduleExecution(jobId: string, scheduledAt: string): Promise<Result<{ id: string }>> {
  await requireWorkspace();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await (supabase as unknown as RpcCaller).rpc("schedule_execution", {
    p_execution_job_id: jobId,
    p_scheduled_at: scheduledAt,
  });
  if (error) return rpcErr("scheduleExecution", error);
  return ok({ id: String(data) });
}

export async function cancelExecutionSchedule(scheduleId: string): Promise<Result<true>> {
  await requireWorkspace();
  const supabase = await createSupabaseServerClient();
  const { error } = await (supabase as unknown as RpcCaller).rpc("cancel_execution_schedule", {
    p_schedule_id: scheduleId,
  });
  if (error) return rpcErr("cancelExecutionSchedule", error);
  return ok(true);
}

export async function createInquiry(input: {
  projectId: string;
  sourceKind: "lead_magnet" | "web_copy_contact" | "manual";
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  note: string;
}): Promise<Result<{ id: string }>> {
  await requireWorkspace();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await (supabase as unknown as RpcCaller).rpc("create_inquiry", {
    p_project_id: input.projectId,
    p_source_kind: input.sourceKind,
    p_source_id: null,
    p_contact_name: input.contactName,
    p_contact_phone: input.contactPhone,
    p_contact_email: input.contactEmail,
    p_note: input.note,
  });
  if (error) return rpcErr("createInquiry", error);
  return ok({ id: String(data) });
}

export async function createCrmFollowup(input: {
  inquiryId: string;
  assigneeName: string;
  dueDate: string;
}): Promise<Result<{ id: string }>> {
  await requireWorkspace();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await (supabase as unknown as RpcCaller).rpc("create_crm_followup", {
    p_inquiry_id: input.inquiryId,
    p_assignee_name: input.assigneeName,
    p_due_date: input.dueDate,
  });
  if (error) return rpcErr("createCrmFollowup", error);
  return ok({ id: String(data) });
}

export async function updateCrmFollowup(input: {
  followupId: string;
  status: "todo" | "in_progress" | "done" | "hold";
  linkedResultId: string | null;
}): Promise<Result<true>> {
  await requireWorkspace();
  const supabase = await createSupabaseServerClient();
  const { error } = await (supabase as unknown as RpcCaller).rpc("update_crm_followup", {
    p_followup_id: input.followupId,
    p_status: input.status,
    p_linked_result_id: input.linkedResultId,
  });
  if (error) return rpcErr("updateCrmFollowup", error);
  return ok(true);
}
