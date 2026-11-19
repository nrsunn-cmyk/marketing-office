import "server-only";
import { fail, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

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

/** 지금 로그인한 사람이 관리자인지. 로그인 안 했거나 오류면 false(열람 기록 없음) */
export async function isAdmin(): Promise<boolean> {
  const sb = await createSupabaseServerClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return false;
  const { data, error } = await sb.rpc("admin_whoami");
  if (error) {
    console.error("[isAdmin]", error.code, error.message);
    return false;
  }
  return data === true;
}

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
