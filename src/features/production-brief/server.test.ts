import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P3A-BACKEND-01: 제작 브리프 서버 함수 단위 시험. DB 는 조회·RPC 를 기록하는 흉내 클라이언트로 바꾼다
 * (실제 RLS·RPC 규칙은 tests/db/p3a-production-brief.test.ts 가 맡는다).
 */
const calls = vi.hoisted(() => ({ queries: [] as Array<{ table: string; ops: string[] }>, rpc: [] as Array<{ fn: string; args: Record<string, unknown> }> }));
const ROWS = vi.hoisted(() => ({
  projects: [] as unknown[],
  production_briefs: [] as unknown[],
  artifacts: [] as unknown[],
  tasks: [] as unknown[],
  artifact_versions: [] as unknown[],
  rpcError: null as null | { code: string; message: string },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "w1" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const q = { table, ops: [] as string[] };
      calls.queries.push(q);
      const rows = () => ROWS[table as "projects"];
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "order"]) {
        chain[op] = (...args: unknown[]) => {
          q.ops.push(`${op}(${args.map((a) => (Array.isArray(a) ? `[${a.join("|")}]` : typeof a === "object" ? JSON.stringify(a) : String(a))).join(",")})`);
          return chain;
        };
      }
      chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
      chain.then = (res: (v: unknown) => unknown) => res({ data: rows(), error: null });
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.rpc.push({ fn, args });
      return ROWS.rpcError ? { data: null, error: ROWS.rpcError } : { data: fn.startsWith("create") ? "new-id" : 7, error: null };
    },
  }),
}));

import { archiveProductionBrief, createProductionBrief, getProductionBriefsFor, rebaseProductionBrief, updateProductionBrief } from "./server";

const brief = (id: string, o: Record<string, unknown> = {}) => ({
  id, workspace_id: "w1", project_id: "p1", strategy_artifact_id: "a1", strategy_version_id: "v1", title: `제목 ${id}`, target_audience: "대상", core_message: "메시지",
  deliverable_types: ["web_copy"], scope_summary: "범위", brand_tone_constraints: null, reference_notes: null, status: "drafting", source_snapshot: { strategy_version: 1 },
  archived_at: null, revision: 3, created_by: "u1", created_at: "2026-11-20T00:00:00Z", updated_at: "2026-11-20T00:00:00Z", ...o,
});
const input = { title: " 제목 ", targetAudience: "대상", coreMessage: "메시지", deliverableTypes: ["web_copy", "ppt_deck"], scopeSummary: "범위" };

beforeEach(() => {
  calls.queries.length = 0;
  calls.rpc.length = 0;
  ROWS.projects = [{ id: "p1", status: "active" }];
  ROWS.production_briefs = [];
  ROWS.artifacts = [{ id: "a1", approved_version_id: "v2", task_id: "t1" }];
  ROWS.tasks = [{ id: "t1", status: "in_progress" }];
  ROWS.artifact_versions = [{ id: "v1", version: 1 }, { id: "v2", version: 2 }];
  ROWS.rpcError = null;
});

describe("getProductionBriefsFor", () => {
  it("본인 업무실 조건으로만 읽고, 이전 전략 기준·맞추기 가능·보관을 계산한다", async () => {
    ROWS.production_briefs = [brief("b1"), brief("b2", { strategy_version_id: "v2", status: "ready" }), brief("b3", { archived_at: "2026-11-20T01:00:00Z" })];
    const r = await getProductionBriefsFor("p1");
    if (!r.ok) throw new Error(r.message);
    for (const q of calls.queries) expect(q.ops, q.table).toContain("eq(workspace_id,w1)");
    const [b1, b2, b3] = r.data.briefs;
    expect(b1).toMatchObject({ id: "b1", stale: true, staleLabel: "이전 전략 기준", canRebase: true, readOnlyReason: null, displayLabel: "작성 중", strategyVersion: { id: "v1", version: 1 } });
    expect(b2).toMatchObject({ id: "b2", stale: false, staleLabel: null, canRebase: false, displayLabel: "확정", revision: 3 });
    expect(b3).toMatchObject({ id: "b3", archived: true, displayLabel: "보관", canRebase: false, readOnlyReason: expect.stringMatching(/보관한 제작 브리프/) });
    expect(r.data).toMatchObject({ canCreate: true, createBlockedReason: null, activeCount: 2, limit: 10 });
    expect(r.data.strategies).toEqual([{ artifactId: "a1", approvedVersionId: "v2", approvedVersion: 2, cancelled: false, selectable: true }]);
  });

  it("승인본이 없어진 전략을 바탕으로 한 브리프도 경고하지만 맞추기는 못 누른다(R-Q3)", async () => {
    ROWS.artifacts = [{ id: "a1", approved_version_id: null, task_id: "t1" }];
    ROWS.production_briefs = [brief("b1")];
    const r = await getProductionBriefsFor("p1");
    if (!r.ok) throw new Error(r.message);
    expect(r.data.briefs[0]).toMatchObject({ stale: true, canRebase: false });
    expect(r.data).toMatchObject({ canCreate: false, createBlockedReason: expect.stringMatching(/승인된 전략이 있어야/) });
  });

  it("만들 수 없는 이유: 프로젝트 보관 > 승인 전략 없음(작업 취소 포함) > 한도 10", async () => {
    ROWS.projects = [{ id: "p1", status: "archived" }];
    ROWS.production_briefs = [brief("b1")];
    let r = await getProductionBriefsFor("p1");
    if (!r.ok) throw new Error(r.message);
    expect(r.data.createBlockedReason).toMatch(/보관한 프로젝트/);
    expect(r.data.briefs[0].readOnlyReason).toMatch(/보관한 프로젝트/);

    ROWS.projects = [{ id: "p1", status: "active" }];
    ROWS.tasks = [{ id: "t1", status: "cancelled" }];
    r = await getProductionBriefsFor("p1");
    if (!r.ok) throw new Error(r.message);
    expect(r.data.createBlockedReason).toMatch(/승인된 전략이 있어야/);
    expect(r.data.briefs[0].readOnlyReason).toMatch(/취소된 전략 작업/);
    expect(r.data.strategies[0]).toMatchObject({ cancelled: true, selectable: false });

    ROWS.tasks = [{ id: "t1", status: "in_progress" }];
    ROWS.production_briefs = Array.from({ length: 10 }, (_, i) => brief(`b${i}`));
    r = await getProductionBriefsFor("p1");
    if (!r.ok) throw new Error(r.message);
    expect(r.data.createBlockedReason).toMatch(/10개까지/);
  });

  it("없는(남의) 프로젝트는 NOT_FOUND 이고 브리프를 읽지 않는다", async () => {
    ROWS.projects = [];
    const r = await getProductionBriefsFor("p9");
    expect(r).toEqual({ ok: false, code: "NOT_FOUND", message: "프로젝트를 찾을 수 없습니다." });
    expect(calls.queries.map((q) => q.table)).toEqual(["projects"]);
  });
});

describe("쓰기", () => {
  it("만들기: 정리한 값으로 RPC, 빈 선택 칸은 보내지 않음", async () => {
    const r = await createProductionBrief("p1", "a1", { ...input, brandToneConstraints: "  " });
    expect(r).toEqual({ ok: true, data: { briefId: "new-id" } });
    expect(calls.rpc[0]).toEqual({
      fn: "create_production_brief",
      args: { p_project_id: "p1", p_strategy_artifact_id: "a1", p_title: "제목", p_target_audience: "대상", p_core_message: "메시지", p_deliverable_types: ["web_copy", "ppt_deck"], p_scope_summary: "범위", p_brand_tone_constraints: undefined, p_reference_notes: undefined },
    });
  });

  it("입력 계약 실패는 RPC 를 부르지 않는다", async () => {
    expect(await createProductionBrief("p1", "a1", { ...input, deliverableTypes: [] })).toEqual({ ok: false, code: "VALIDATION", message: "포함 산출물을 1개 이상 골라 주세요." });
    expect(await updateProductionBrief("b1", 3, { ...input, status: "done" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(calls.rpc).toHaveLength(0);
  });

  it("수정·맞추기·보관 인자와 DB 오류 문구 변환(한도·충돌·날것 오류 숨김)", async () => {
    expect(await updateProductionBrief("b1", 3, { ...input, status: "ready" })).toEqual({ ok: true, data: { revision: 7 } });
    expect(calls.rpc[0].args).toMatchObject({ p_brief_id: "b1", p_expected_revision: 3, p_status: "ready", p_brand_tone_constraints: null, p_reference_notes: null });
    expect(await rebaseProductionBrief("b1", 4)).toEqual({ ok: true, data: { revision: 7 } });
    expect(await archiveProductionBrief("b1", 5)).toEqual({ ok: true, data: { revision: 7 } });
    expect(calls.rpc.slice(1)).toEqual([
      { fn: "rebase_production_brief", args: { p_brief_id: "b1", p_expected_revision: 4 } },
      { fn: "archive_production_brief", args: { p_brief_id: "b1", p_expected_revision: 5 } },
    ]);
    ROWS.rpcError = { code: "P0001", message: "LIMIT_REACHED: 한 프로젝트에는 제작 브리프를 10개까지 둘 수 있습니다" };
    expect(await createProductionBrief("p1", "a1", input)).toMatchObject({ ok: false, code: "VALIDATION", message: expect.stringMatching(/10개까지/) });
    ROWS.rpcError = { code: "P0001", message: "CONFLICT: 다른 곳에서 먼저 수정되었습니다" };
    expect(await rebaseProductionBrief("b1", 1)).toMatchObject({ ok: false, code: "CONFLICT" });
    ROWS.rpcError = { code: "23505", message: 'duplicate key value violates unique constraint "x"' };
    const e = await archiveProductionBrief("b1", 1);
    expect(e).toMatchObject({ ok: false, code: "ERROR" });
    if (!e.ok) expect(e.message).not.toMatch(/duplicate|constraint/);
  });
});
