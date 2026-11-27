import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * renameWorkspace 서버 함수(AUDIT-05 C3, WORKSPACE-RENAME-BACKEND-01).
 * - 입력 검사는 RPC 전에 한다(빈 이름·201자·잘못된 revision 은 DB 를 부르지 않음)
 * - RPC 오류를 CONFLICT·VALIDATION·일반 오류로 나누고 원문은 내보내지 않는다
 */
const fake = {
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  result: { data: 2 as number | null, error: null as { code?: string; message: string } | null },
};

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "ws-1" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      fake.calls.push({ fn, args });
      return fake.result;
    },
  }),
}));

const { renameWorkspace } = await import("@/features/settings/server");

beforeEach(() => {
  fake.calls = [];
  fake.result = { data: 2, error: null };
});

describe("renameWorkspace", () => {
  it("공백을 지운 이름과 revision 으로 RPC 를 부르고 새 revision 을 돌려준다", async () => {
    expect(await renameWorkspace("  나다움  ", 1)).toEqual({ ok: true, data: { revision: 2 } });
    expect(fake.calls).toEqual([{ fn: "rename_workspace", args: { p_name: "나다움", p_expected_revision: 1 } }]);
  });

  it("잘못된 입력은 DB 를 부르지 않는다", async () => {
    expect(await renameWorkspace("   ", 1)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await renameWorkspace("가".repeat(201), 1)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await renameWorkspace("이름", 0)).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await renameWorkspace("이름", 1.5)).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(fake.calls).toHaveLength(0);
  });

  it("RPC 오류를 나눠 돌려주고 원문은 내보내지 않는다", async () => {
    fake.result = { data: null, error: { code: "P0001", message: "CONFLICT: 다른 곳에서 먼저 수정되었습니다" } };
    expect(await renameWorkspace("이름", 1)).toMatchObject({ ok: false, code: "CONFLICT" });
    fake.result = { data: null, error: { code: "22023", message: "VALIDATION: 업무실 이름은 1~200자여야 합니다" } };
    expect(await renameWorkspace("이름", 1)).toMatchObject({ ok: false, code: "VALIDATION" });
    fake.result = { data: null, error: { code: "42883", message: "function public.rename_workspace does not exist" } };
    const r = await renameWorkspace("이름", 1);
    expect(r).toMatchObject({ ok: false, code: "ERROR" });
    expect(JSON.stringify(r)).not.toContain("does not exist");
  });
});
