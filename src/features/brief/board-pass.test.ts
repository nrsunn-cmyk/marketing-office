import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P2F-FRONT-01: 화면이 이미 읽은 퍼널 보드를 넘기면 보드(=작업 상세)를 다시 읽지 않는다.
 * listContentBriefs(taskId) 는 예전처럼 한 번 읽는다. 조회 조건(본인 업무실·그 퍼널·보관 제외)은 그대로.
 * DB 는 조회 내용을 기록하는 흉내 클라이언트(실제 RLS 는 tests/db/p2-brief.test.ts).
 */
const calls = vi.hoisted(() => ({ board: 0, queries: [] as Array<{ table: string; ops: string[] }> }));
const BOARD = vi.hoisted(() => ({
  state: "board",
  strategy: { artifactId: "a1", approvedVersion: { id: "v2", version: 2 }, basis: { goals: [], offers: [], audiences: [] } },
  funnel: { id: "f1", revision: 1, strategyVersion: { id: "v2", version: 2 }, stale: false },
  stages: [],
  warnings: [],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "w1" } }) }));
vi.mock("@/features/funnel/server", () => ({
  getFunnelBoard: async () => {
    calls.board++;
    return structuredClone(BOARD);
  },
}));
const ROWS: Record<string, unknown> = {
  content_briefs: [
    { id: "b1", funnel_item_id: "i1", channel: "blog", title: "글", status: "drafting", revision: 1, strategy_version_id: "v2" },
    { id: "b2", funnel_item_id: "i1", channel: "instagram", title: "피드", status: "ready", revision: 2, strategy_version_id: "v1" },
  ],
};
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const q = { table, ops: [] as string[] };
      calls.queries.push(q);
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "order", "in", "limit"]) {
        chain[op] = (...args: unknown[]) => {
          q.ops.push(`${op}(${args.map(String).join(",")})`);
          return chain;
        };
      }
      chain.maybeSingle = async () => ({ data: null, error: null });
      chain.then = (res: (v: unknown) => unknown) => res({ data: ROWS[table] ?? [], error: null });
      return chain;
    },
  }),
}));

import type { FunnelBoard } from "@/features/funnel/server";
import { getContentBriefFor, listContentBriefs, listContentBriefsFor } from "./server";

beforeEach(() => {
  calls.board = 0;
  calls.queries = [];
});

describe("브리프 읽기: 보드 넘기기", () => {
  it("listContentBriefsFor 는 보드를 다시 읽지 않고, 결과는 listContentBriefs 와 같다", async () => {
    const viaBoard = await listContentBriefsFor(structuredClone(BOARD) as unknown as FunnelBoard);
    expect(calls.board).toBe(0);
    const viaTask = await listContentBriefs("t1");
    expect(calls.board).toBe(1);
    expect(viaBoard).toEqual(viaTask);
    expect(viaBoard?.map((b) => [b.id, b.stale])).toEqual([["b1", false], ["b2", true]]);
  });

  it("목록 조회 조건은 그대로: 본인 업무실·그 퍼널·보관 제외", async () => {
    await listContentBriefsFor(structuredClone(BOARD) as unknown as FunnelBoard);
    const ops = calls.queries.find((q) => q.table === "content_briefs")!.ops;
    expect(ops).toContain("eq(workspace_id,w1)");
    expect(ops).toContain("eq(funnel_id,f1)");
    expect(ops).toContain("is(archived_at,null)");
  });

  it("퍼널이 없거나 보드가 없으면 DB 를 읽지 않는다", async () => {
    expect(await listContentBriefsFor(null)).toBeNull();
    expect(await listContentBriefsFor({ ...structuredClone(BOARD), funnel: null } as unknown as FunnelBoard)).toEqual([]);
    expect(await getContentBriefFor({ ...structuredClone(BOARD), funnel: null } as unknown as FunnelBoard, "b1")).toBeNull();
    expect(calls.queries).toHaveLength(0);
    expect(calls.board).toBe(0);
  });

  it("상세는 그 퍼널·그 업무실의 브리프만 찾는다(없으면 null)", async () => {
    expect(await getContentBriefFor(structuredClone(BOARD) as unknown as FunnelBoard, "b9")).toBeNull();
    const ops = calls.queries.find((q) => q.table === "content_briefs")!.ops;
    expect(ops).toEqual(expect.arrayContaining(["eq(workspace_id,w1)", "eq(funnel_id,f1)", "eq(id,b9)"]));
    expect(calls.board).toBe(0);
  });
});
