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
const { isAdmin, listAdminAccounts, getAdminUsage, listAdminAudit } = await import("./server");

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
});
