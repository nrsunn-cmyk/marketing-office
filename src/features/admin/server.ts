import "server-only";
import { cache } from "react";
import { fail, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import {
  isPublicInquiryStatus,
  serviceLabel,
  type AdminPublicInquiry,
  type PublicInquiryStatus,
} from "@/features/public-inquiries/contract";

/**
 * ADMIN-IMPL-01: 관리자 페이지 1단계(읽기 전용) 서버 함수. 설계 Plan/Claude-Backend-20261118/ADMIN-DESIGN-01.md.
 * - 로그인 사용자 토큰으로 관리자 RPC 만 부른다(service_role 없음). 관리자 판별·열람 기록은 DB(20261119003000_admin_readonly)가 한다.
 * - 비관리자에게는 관리자 화면이 있다는 것도 알리지 않는다: FORBIDDEN 은 NOT_FOUND 로 돌려준다(화면은 notFound()).
 * - 화면(Front)은 /admin 서버 컴포넌트에서 isAdmin() 이 false 면 notFound() 를 부른다.
 */

const NOT_FOUND = "페이지를 찾을 수 없습니다.";

function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  if (error.code === "42501" || /FORBIDDEN|permission denied/.test(error.message)) return fail("NOT_FOUND", NOT_FOUND);
  const m = /^\s*VALIDATION:\s*(.+)$/s.exec(error.message);
  if (m && /[가-힣]/.test(m[1])) return fail("VALIDATION", m[1].trim());
  console.error(`[${where}]`, error.code, error.message);
  return fail("ERROR", "관리자 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

/**
 * 지금 로그인한 사람이 관리자인지. 로그인 안 했거나 오류면 false(열람 기록 없음).
 * 한 요청(서버 렌더링) 안에서는 한 번만 묻는다 — 관리자 화면은 제목(adminMetadata)과 본문(requireAdminOr404)에서 둘 다 부른다
 * (Tester QA-ADMIN-404-01 O1: Proxy 1 + 페이지 2 = 3번 → Proxy 1 + 페이지 1 = 2번)
 */
export const isAdmin = cache(async function isAdmin(): Promise<boolean> {
  const sb = await createSupabaseServerClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return false;
  const { data, error } = await sb.rpc("admin_whoami");
  if (error) {
    console.error("[isAdmin]", error.code, error.message);
    return false;
  }
  return data === true;
});

export interface AdminAccount {
  userId: string;
  email: string | null;
  signedUpAt: string | null;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceCreatedAt: string | null;
  clients: number;
  projects: number;
  tasks: number;
  allowlisted: boolean;
}
export interface AdminCursor {
  beforeCreated: string;
  beforeId: string;
}

/** ① 가입자·업무실 목록(가입 최신 순). 다음 쪽이 있으면 next 커서 */
export async function listAdminAccounts(opts: { limit?: number; before?: AdminCursor } = {}): Promise<Result<{ rows: AdminAccount[]; next: AdminCursor | null }>> {
  const limit = Math.min(200, Math.max(1, Math.trunc(opts.limit ?? 50)));
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("admin_list_accounts", {
    p_limit: limit,
    ...(opts.before ? { p_before_created: opts.before.beforeCreated, p_before_id: opts.before.beforeId } : {}),
  });
  if (error) return rpcFail("listAdminAccounts", error);
  const rows: AdminAccount[] = (data ?? []).map((r) => ({
    userId: r.user_id,
    email: r.email,
    signedUpAt: r.signed_up_at,
    lastSignInAt: r.last_sign_in_at,
    emailConfirmed: r.email_confirmed,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    workspaceCreatedAt: r.workspace_created_at,
    clients: r.clients,
    projects: r.projects,
    tasks: r.tasks,
    allowlisted: r.allowlisted,
  }));
  const last = rows.at(-1);
  return ok({ rows, next: rows.length === limit && last?.signedUpAt ? { beforeCreated: last.signedUpAt, beforeId: last.userId } : null });
}

export interface AdminPendingInvite {
  email: string;
  note: string | null;
  addedAt: string;
}
/** ① 보조: 허용 목록에 있지만 아직 가입하지 않은 이메일 */
export async function listPendingAllowlist(): Promise<Result<AdminPendingInvite[]>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("admin_list_pending_allowlist");
  if (error) return rpcFail("listPendingAllowlist", error);
  return ok((data ?? []).map((r) => ({ email: r.email, note: r.note, addedAt: r.added_at })));
}

export interface AdminUsageRow {
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string | null;
  tasksCreated: number;
  artifactVersionsCreated: number;
  briefsCreated: number;
  aiRuns: number;
  /** AI 문구 추정 비용(마이크로달러, 예약 중은 예약 추정치) */
  aiCostUsdMicro: number;
  assetsAdded: number;
  assetBytes: number;
  lastActivityAt: string | null;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ② 이용 현황: 한국 날짜 [from, to](끝일 포함 최대 367일, 두 날짜 차이 366일 이하). 합계는 화면이 rows 를 더한다 */
export async function getAdminUsage(from: string, to: string): Promise<Result<AdminUsageRow[]>> {
  if (!DATE.test(from) || !DATE.test(to)) return fail("VALIDATION", "날짜는 YYYY-MM-DD 로 넣어 주세요.");
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("admin_usage_summary", { p_from: from, p_to: to });
  if (error) return rpcFail("getAdminUsage", error);
  return ok(
    (data ?? []).map((r) => ({
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_name,
      ownerEmail: r.owner_email,
      tasksCreated: r.tasks_created,
      artifactVersionsCreated: r.artifact_versions_created,
      briefsCreated: r.briefs_created,
      aiRuns: r.ai_runs,
      aiCostUsdMicro: Number(r.ai_cost_usd_micro),
      assetsAdded: r.assets_added,
      assetBytes: Number(r.asset_bytes),
      lastActivityAt: r.last_activity_at,
    })),
  );
}

export interface AdminAuditRow {
  seq: number;
  occurredAt: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  action: string;
  revision: number | null;
  /** 문자열은 200자에서 잘려 온다 */
  details: unknown;
}
export interface AdminAuditFilter {
  workspaceId?: string;
  action?: string;
  /** ISO 시각 */
  from?: string;
  to?: string;
  limit?: number;
  beforeSeq?: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ③ 감사 기록(최신 순). 다음 쪽이 있으면 nextBeforeSeq */
export async function listAdminAudit(f: AdminAuditFilter = {}): Promise<Result<{ rows: AdminAuditRow[]; nextBeforeSeq: number | null }>> {
  if (f.workspaceId !== undefined && !UUID.test(f.workspaceId)) return fail("VALIDATION", "업무실 id 형식이 올바르지 않습니다.");
  for (const t of [f.from, f.to]) if (t !== undefined && Number.isNaN(Date.parse(t))) return fail("VALIDATION", "시각 형식이 올바르지 않습니다.");
  const limit = Math.min(200, Math.max(1, Math.trunc(f.limit ?? 100)));
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("admin_list_audit", {
    p_limit: limit,
    ...(f.workspaceId ? { p_workspace_id: f.workspaceId } : {}),
    ...(f.action ? { p_action: f.action.slice(0, 100) } : {}),
    ...(f.from ? { p_from: f.from } : {}),
    ...(f.to ? { p_to: f.to } : {}),
    ...(f.beforeSeq ? { p_before_seq: f.beforeSeq } : {}),
  });
  if (error) return rpcFail("listAdminAudit", error);
  const rows: AdminAuditRow[] = (data ?? []).map((r) => ({
    seq: Number(r.seq),
    occurredAt: r.occurred_at,
    workspaceId: r.workspace_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    actorId: r.actor_id,
    action: r.action,
    revision: r.revision,
    details: r.details,
  }));
  return ok({ rows, nextBeforeSeq: rows.length === limit ? (rows.at(-1)?.seq ?? null) : null });
}

export interface AdminP3ProgressRow {
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string | null;
  projectId: string;
  /** P3-a 제작 브리프(보관 안 됨: 작성 중·확정, 보관) */
  briefs: { drafting: number; ready: number; archived: number };
  /** P3-b 홈페이지 문서(보관 안 됨: 작성 중·검토 완료, 보관)와 판 수 합 */
  webDocs: { drafting: number; reviewed: number; archived: number; versions: number };
  /** 막힌 곳: 이전 기준(브리프는 전략, 문서는 브리프), 한도(브리프 10개 찼는지, 판 100개 찬 문서 수), 승인 대기(P3-f 전이라 null = 준비 중) */
  blocked: { staleBriefs: number; staleWebDocs: number; briefLimitReached: boolean; webVersionLimitReached: number; pendingApprovals: number | null };
  lastActivityAt: string | null;
}

/**
 * ④ P3 제작 진행 현황(ADMIN-P3-01): 제작 브리프가 있는 업무실·프로젝트별 개수·상태·시각. 사용자 글(제목·문구·프로젝트 이름)은 오지 않는다.
 * 구현된 단계(P3-a·P3-b)만 실제 개수다. 화면은 나머지 단계를 '준비 중'으로 둔다(근거 없는 진행률 금지).
 */
export async function getAdminP3Progress(limit = 200): Promise<Result<AdminP3ProgressRow[]>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("admin_p3_progress", { p_limit: Math.min(500, Math.max(1, Math.trunc(limit))) });
  if (error) return rpcFail("getAdminP3Progress", error);
  return ok(
    (data ?? []).map((r) => ({
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_name,
      ownerEmail: r.owner_email,
      projectId: r.project_id,
      briefs: { drafting: r.briefs_drafting, ready: r.briefs_ready, archived: r.briefs_archived },
      webDocs: { drafting: r.web_docs_drafting, reviewed: r.web_docs_reviewed, archived: r.web_docs_archived, versions: r.web_versions },
      blocked: {
        staleBriefs: r.stale_briefs,
        staleWebDocs: r.stale_web_docs,
        briefLimitReached: r.brief_limit_reached,
        webVersionLimitReached: r.web_version_limit_reached,
        pendingApprovals: r.pending_approvals ?? null,
      },
      lastActivityAt: r.last_activity_at,
    })),
  );
}

export interface AdminP4ExecutionRow {
  workspaceId: string;
  projectId: string;
  /** 실행 건 상태 7종 개수 */
  jobs: { pendingApproval: number; blockedMismatch: number; queued: number; running: number; succeeded: number; failed: number; held: number };
  /** 차단(blocked_mismatch) 건의 막힘 원인 3종 개수 */
  blocked: { contentChanged: number; sourceArchived: number; notReviewed: number };
  /** 재시도 3회를 다 쓴 실행 건 수 */
  retryExhausted: number;
  /** 티스토리 수동 게시 기록이 연결된 실행 건 수 */
  tistoryPublished: number;
  /** 취소되지 않은 성과 입력 수 */
  resultsActive: number;
  lastActivityAt: string | null;
}

/**
 * ⑤ P4 실행 현황(ADMIN-P4-01): 실행 건이나 성과 입력이 있는 업무실·프로젝트별 개수·상태·시각.
 * 초안 사본·게시 주소·성과 출처·업무실 이름·주인 이메일은 오지 않는다(AGY 인계 1절 — 업무실·프로젝트는 id 만).
 */
export async function getAdminP4Execution(limit = 200): Promise<Result<AdminP4ExecutionRow[]>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("admin_p4_execution", { p_limit: Math.min(500, Math.max(1, Math.trunc(limit))) });
  if (error) return rpcFail("getAdminP4Execution", error);
  return ok(
    (data ?? []).map((r) => ({
      workspaceId: r.workspace_id,
      projectId: r.project_id,
      jobs: {
        pendingApproval: r.jobs_pending_approval,
        blockedMismatch: r.jobs_blocked_mismatch,
        queued: r.jobs_queued,
        running: r.jobs_running,
        succeeded: r.jobs_succeeded,
        failed: r.jobs_failed,
        held: r.jobs_held,
      },
      blocked: { contentChanged: r.blocked_content_changed, sourceArchived: r.blocked_source_archived, notReviewed: r.blocked_not_reviewed },
      retryExhausted: r.retry_exhausted,
      tistoryPublished: r.tistory_published,
      resultsActive: r.results_active,
      lastActivityAt: r.last_activity_at,
    })),
  );
}

// ─────────────────────────────────────────────
// ⑥ 나다움 공개 상담(NADAUM-BRAND-BACKEND-01, migration 20261123010000). P4 문의와 별개.
//    관리자만(아니면 NOT_FOUND). 열람·변경마다 DB 가 admin_access_log 를 남긴다(개인정보 없이).
//    화면(Front)은 /admin/inquiries 후보에서 아래 세 함수만 쓴다. 참고 URL 은 글자로만 보여 준다(링크 금지).
// ─────────────────────────────────────────────
type PublicInquiryRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
};
const publicInquiryRpc = async () => (await createSupabaseServerClient()) as unknown as PublicInquiryRpc;

export interface AdminPublicInquiryCursor {
  beforeCreated: string;
  beforeId: string;
}

/** 공개 상담 목록(최신 순, 쪽당 limit 최대 200). status 를 주면 그 상태만 */
export async function listAdminPublicInquiries(
  opts: { status?: PublicInquiryStatus; limit?: number; before?: AdminPublicInquiryCursor } = {},
): Promise<Result<{ rows: AdminPublicInquiry[]; next: AdminPublicInquiryCursor | null }>> {
  if (opts.status !== undefined && !isPublicInquiryStatus(opts.status)) return fail("VALIDATION", "알 수 없는 상담 상태입니다.");
  const limit = Math.min(200, Math.max(1, Math.trunc(opts.limit ?? 50)));
  const sb = await publicInquiryRpc();
  const { data, error } = await sb.rpc("admin_list_public_inquiries", {
    p_status: opts.status ?? null,
    p_limit: limit,
    p_before_created: opts.before?.beforeCreated ?? null,
    p_before_id: opts.before?.beforeId ?? null,
  });
  if (error) return rpcFail("listAdminPublicInquiries", error);
  const rows: AdminPublicInquiry[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const services = Array.isArray(r.services) ? (r.services as unknown[]).map(String) : [];
    const opt = (v: unknown) => (v === null || v === undefined ? null : String(v));
    return {
      id: String(r.id),
      refCode: String(r.ref_code),
      createdAt: String(r.created_at),
      status: (isPublicInquiryStatus(r.status) ? r.status : "new") as PublicInquiryStatus,
      companyName: String(r.company_name),
      contactName: String(r.contact_name),
      phone: String(r.phone),
      services,
      serviceLabels: services.map(serviceLabel),
      otherService: opt(r.other_service),
      message: String(r.message),
      referenceUrl: opt(r.reference_url),
      desiredTimeline: opt(r.desired_timeline),
      budgetRange: opt(r.budget_range),
      privacyConsentAt: String(r.privacy_consent_at),
      consentVersion: String(r.consent_version),
      statusChangedAt: opt(r.status_changed_at),
      updatedAt: String(r.updated_at),
    };
  });
  const last = rows.at(-1);
  return ok({ rows, next: rows.length === limit && last ? { beforeCreated: last.createdAt, beforeId: last.id } : null });
}

/** 상태별 개수(새 접수·연락함·견적 보냄·종료 순서, 없는 상태도 0) */
export async function countAdminPublicInquiries(): Promise<Result<Record<PublicInquiryStatus, number>>> {
  const sb = await publicInquiryRpc();
  const { data, error } = await sb.rpc("admin_public_inquiry_counts");
  if (error) return rpcFail("countAdminPublicInquiries", error);
  const out: Record<PublicInquiryStatus, number> = { new: 0, contacted: 0, quoted: 0, closed: 0 };
  for (const r of (data ?? []) as Array<{ status?: unknown; total?: unknown }>) {
    if (isPublicInquiryStatus(r.status)) out[r.status] = Number(r.total ?? 0);
  }
  return ok(out);
}

/**
 * 상태 변경. expectedStatus = 화면이 보고 있던 상태. 그사이 다른 관리자가 바꿨으면 CONFLICT(새로 고침 안내).
 * 같은 상태로 바꾸면 아무것도 바꾸지 않고 성공.
 */
export async function setAdminPublicInquiryStatus(input: {
  id: string;
  status: PublicInquiryStatus;
  expectedStatus: PublicInquiryStatus;
}): Promise<Result<{ status: PublicInquiryStatus; statusChangedAt: string | null; updatedAt: string }>> {
  if (!isPublicInquiryStatus(input.status) || !isPublicInquiryStatus(input.expectedStatus)) return fail("VALIDATION", "알 수 없는 상담 상태입니다.");
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return fail("NOT_FOUND", "상담 접수를 찾을 수 없습니다.");
  const sb = await publicInquiryRpc();
  const { data, error } = await sb.rpc("admin_set_public_inquiry_status", {
    p_id: input.id,
    p_status: input.status,
    p_expected_status: input.expectedStatus,
  });
  if (error) {
    if (/^\s*CONFLICT:/.test(error.message)) return fail("CONFLICT", "다른 관리자가 먼저 상태를 바꿨습니다. 새로 고친 뒤 다시 시도해 주세요.");
    if (/^\s*NOT_FOUND:/.test(error.message)) return fail("NOT_FOUND", "상담 접수를 찾을 수 없습니다.");
    return rpcFail("setAdminPublicInquiryStatus", error);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { status?: unknown; status_changed_at?: unknown; updated_at?: unknown } | undefined;
  if (!row || !isPublicInquiryStatus(row.status)) return fail("ERROR", "관리자 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  return ok({
    status: row.status,
    statusChangedAt: row.status_changed_at === null || row.status_changed_at === undefined ? null : String(row.status_changed_at),
    updatedAt: String(row.updated_at),
  });
}
