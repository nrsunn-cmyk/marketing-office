import { beforeEach, describe, expect, it, vi } from "vitest";

/** ADMIN-IMPL-01 서버 함수: RPC 결과 변환·거절 숨김·입력 검사(흉내 클라이언트). DB 규칙은 tests/db/admin.test.ts */
const st = vi.hoisted(() => ({
  user: { id: "u1" } as unknown,
  calls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
  result: {} as Record<string, { data: unknown; error: unknown }>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: st.user } }) },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      st.calls.push({ fn, args });
      return st.result[fn] ?? { data: null, error: null };
    },
  }),
}));
const { isAdmin, listAdminAccounts, getAdminUsage, listAdminAudit, getAdminP3Progress, getAdminP4Execution } = await import("./server");

const account = (i: number) => ({
  user_id: `u${i}`, email: `u${i}@example.test`, signed_up_at: `2026-11-1${i}T00:00:00Z`, last_sign_in_at: null, email_confirmed: true,
  workspace_id: `w${i}`, workspace_name: "업무실", workspace_created_at: "2026-11-10T00:00:00Z", clients: 1, projects: 2, tasks: 3, allowlisted: true,
});

beforeEach(() => {
  st.user = { id: "u1" };
  st.calls.length = 0;
  st.result = {};
});

describe("관리자 서버 함수", () => {
  it("isAdmin: 로그인 안 했으면 RPC 없이 false, 관리자면 true, 오류면 false", async () => {
    st.user = null;
    expect(await isAdmin()).toBe(false);
    expect(st.calls).toEqual([]);
    st.user = { id: "u1" };
    st.result.admin_whoami = { data: true, error: null };
    expect(await isAdmin()).toBe(true);
    st.result.admin_whoami = { data: null, error: { code: "42501", message: "permission denied" } };
    expect(await isAdmin()).toBe(false);
  });

  it("비관리자 거절(42501·FORBIDDEN)은 NOT_FOUND 로 숨긴다", async () => {
    st.result.admin_list_accounts = { data: null, error: { code: "42501", message: "FORBIDDEN: 관리자만 볼 수 있습니다" } };
    expect(await listAdminAccounts()).toEqual({ ok: false, code: "NOT_FOUND", message: "페이지를 찾을 수 없습니다." });
  });

  it("목록: 열 이름 변환, limit 1~200, 꽉 차면 다음 커서", async () => {
    st.result.admin_list_accounts = { data: [account(1), account(2)], error: null };
    const r = await listAdminAccounts({ limit: 2 });
    expect(r.ok && r.data.rows[1]).toEqual({
      userId: "u2", email: "u2@example.test", signedUpAt: "2026-11-12T00:00:00Z", lastSignInAt: null, emailConfirmed: true,
      workspaceId: "w2", workspaceName: "업무실", workspaceCreatedAt: "2026-11-10T00:00:00Z", clients: 1, projects: 2, tasks: 3, allowlisted: true,
    });
    expect(r.ok && r.data.next).toEqual({ beforeCreated: "2026-11-12T00:00:00Z", beforeId: "u2" });
    await listAdminAccounts({ limit: 9999, before: { beforeCreated: "2026-11-12T00:00:00Z", beforeId: "u2" } });
    expect(st.calls.at(-1)).toEqual({ fn: "admin_list_accounts", args: { p_limit: 200, p_before_created: "2026-11-12T00:00:00Z", p_before_id: "u2" } });
    const r3 = await listAdminAccounts({ limit: 5 });
    expect(r3.ok && r3.data.next).toBeNull();
  });

  it("이용 현황·감사: 입력 형식 검사(RPC 전), DB 기간 오류 문구는 그대로", async () => {
    expect(await getAdminUsage("2026/11/01", "2026-11-19")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await listAdminAudit({ workspaceId: "not-uuid" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await listAdminAudit({ from: "어제" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(st.calls).toEqual([]);
    st.result.admin_usage_summary = { data: null, error: { code: "22023", message: "VALIDATION: 기간은 시작일 ≤ 끝일, 최대 366일이어야 합니다" } };
    expect(await getAdminUsage("2025-01-01", "2026-11-19")).toEqual({ ok: false, code: "VALIDATION", message: "기간은 시작일 ≤ 끝일, 최대 366일이어야 합니다" });
  });

  it("감사: bigint seq·비용을 숫자로, 꽉 차면 nextBeforeSeq", async () => {
    st.result.admin_list_audit = {
      data: [{ seq: "42", occurred_at: "t", workspace_id: "w", entity_type: "content_brief", entity_id: "e", actor_id: null, action: "copy_generate", revision: null, details: { s: "x" } }],
      error: null,
    };
    const r = await listAdminAudit({ limit: 1, action: "copy_generate" });
    expect(r.ok && r.data).toEqual({
      rows: [{ seq: 42, occurredAt: "t", workspaceId: "w", entityType: "content_brief", entityId: "e", actorId: null, action: "copy_generate", revision: null, details: { s: "x" } }],
      nextBeforeSeq: 42,
    });
    expect(st.calls.at(-1)).toEqual({ fn: "admin_list_audit", args: { p_limit: 1, p_action: "copy_generate" } });
  });

  it("P3 진행 현황(ADMIN-P3-01): 열 이름 변환, 승인 대기 null 유지, limit 1~500, 비관리자는 NOT_FOUND", async () => {
    st.result.admin_p3_progress = {
      data: [
        {
          workspace_id: "w1", workspace_name: "업무실", owner_email: "a@example.test", project_id: "p1",
          briefs_drafting: 1, briefs_ready: 2, briefs_archived: 0, web_docs_drafting: 1, web_docs_reviewed: 0, web_docs_archived: 1, web_versions: 3,
          stale_briefs: 1, stale_web_docs: 0, brief_limit_reached: false, web_version_limit_reached: 0, pending_approvals: null, last_activity_at: "2026-11-19T19:30:00Z",
        },
      ],
      error: null,
    };
    const r = await getAdminP3Progress(9999);
    expect(st.calls.at(-1)).toEqual({ fn: "admin_p3_progress", args: { p_limit: 500 } });
    expect(r).toEqual({
      ok: true,
      data: [
        {
          workspaceId: "w1", workspaceName: "업무실", ownerEmail: "a@example.test", projectId: "p1",
          briefs: { drafting: 1, ready: 2, archived: 0 }, webDocs: { drafting: 1, reviewed: 0, archived: 1, versions: 3 },
          blocked: { staleBriefs: 1, staleWebDocs: 0, briefLimitReached: false, webVersionLimitReached: 0, pendingApprovals: null },
          lastActivityAt: "2026-11-19T19:30:00Z",
        },
      ],
    });
    await getAdminP3Progress(0);
    expect(st.calls.at(-1)?.args).toEqual({ p_limit: 1 });
    st.result.admin_p3_progress = { data: null, error: { code: "42501", message: "FORBIDDEN: 관리자만 볼 수 있습니다" } };
    expect(await getAdminP3Progress()).toEqual({ ok: false, code: "NOT_FOUND", message: "페이지를 찾을 수 없습니다." });
  });

  it("P4 실행 현황(ADMIN-P4-01): 열 이름 변환, 업무실 이름·이메일 칸 없음, limit 1~500, 비관리자는 NOT_FOUND", async () => {
    st.result.admin_p4_execution = {
      data: [
        {
          workspace_id: "w1", project_id: "p1",
          jobs_pending_approval: 1, jobs_blocked_mismatch: 2, jobs_queued: 0, jobs_running: 0, jobs_succeeded: 4, jobs_failed: 1, jobs_held: 0,
          blocked_content_changed: 1, blocked_source_archived: 1, blocked_not_reviewed: 0, retry_exhausted: 1, tistory_published: 3, results_active: 6,
          last_activity_at: "2026-11-20T01:50:00Z",
        },
      ],
      error: null,
    };
    const r = await getAdminP4Execution(9999);
    expect(st.calls.at(-1)).toEqual({ fn: "admin_p4_execution", args: { p_limit: 500 } });
    expect(r).toEqual({
      ok: true,
      data: [
        {
          workspaceId: "w1", projectId: "p1",
          jobs: { pendingApproval: 1, blockedMismatch: 2, queued: 0, running: 0, succeeded: 4, failed: 1, held: 0 },
          blocked: { contentChanged: 1, sourceArchived: 1, notReviewed: 0 },
          retryExhausted: 1, tistoryPublished: 3, resultsActive: 6, lastActivityAt: "2026-11-20T01:50:00Z",
        },
      ],
    });
    await getAdminP4Execution(0);
    expect(st.calls.at(-1)?.args).toEqual({ p_limit: 1 });
    st.result.admin_p4_execution = { data: null, error: { code: "42501", message: "FORBIDDEN: 관리자만 볼 수 있습니다" } };
    expect(await getAdminP4Execution()).toEqual({ ok: false, code: "NOT_FOUND", message: "페이지를 찾을 수 없습니다." });
  });
});
