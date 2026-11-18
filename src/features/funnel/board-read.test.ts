import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P2D-FRONT-01-R1(QA O-b): 전략 작업 화면에서 getTaskDetail 이 두 번 불리던 것을 한 번으로.
 * - getFunnelBoardFor(detail): 작업 상세를 다시 읽지 않는다
 * - getFunnelBoard(taskId): 예전과 같이 한 번 읽고 같은 결과
 * - 퍼널 표 조회 조건(본인 업무실 workspace_id·퍼널 id·보관 안 한 카드)은 그대로
 * DB 는 조회 내용을 기록하는 흉내 클라이언트로 바꾼다(실제 RLS 는 tests/db/p2-funnel.test.ts 가 맡는다).
 */
const calls = vi.hoisted(() => ({ getTaskDetail: 0, queries: [] as Array<{ table: string; ops: string[] }> }));
const DETAIL = vi.hoisted(() => ({
  task: { id: "t1", type: "strategy", status: "review", created_at: "", project_id: "p1", revision: 1 },
  project: { id: "p1", title: "프로젝트", kind: "client", client_id: "c1" },
  client: null,
  profile: null,
  workspaceName: "업무실",
  artifact: { id: "a1", revision: 1, current_draft_version_id: "v2", approved_version_id: "v2" },
  versions: [
    { id: "v2", version: 2, generator: "template", created_at: "", content: { facts: [{ section: "goals", text: "목표 문장" }] }, input_snapshot_id: null },
    { id: "v1", version: 1, generator: "template", created_at: "", content: {}, input_snapshot_id: null },
  ],
  approvals: [],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "w1", timezone: "Asia/Seoul" } }) }));
vi.mock("@/features/tasks/server", () => ({
  getTaskDetail: async () => {
    calls.getTaskDetail++;
    return structuredClone(DETAIL);
  },
}));
const ROWS: Record<string, unknown> = {
  funnels: { id: "f1", revision: 3, strategy_version_id: "v1" },
  funnel_stages: [
    { id: "s1", stage_key: "inflow", position: 1, focus: null, revision: 1 },
    { id: "s3", stage_key: "consideration", position: 3, focus: "비교", revision: 1 },
  ],
  funnel_items: [
    { id: "i1", stage_id: "s1", kind: "content", title: "글", description: null, channel: null, status: "planned", target_note: null, details: null, position: 1, revision: 1, updated_at: "" },
  ],
};
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const q = { table, ops: [] as string[] };
      calls.queries.push(q);
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "order"]) {
        chain[op] = (...args: unknown[]) => {
          q.ops.push(`${op}(${args.map(String).join(",")})`);
          return chain;
        };
      }
      chain.maybeSingle = async () => ({ data: ROWS[table], error: null });
      chain.then = (res: (v: unknown) => unknown) => res({ data: ROWS[table], error: null });
      return chain;
    },
  }),
}));

import { getFunnelBoard, getFunnelBoardFor } from "./server";
import type { TaskDetail } from "@/features/tasks/server";

beforeEach(() => {
  calls.getTaskDetail = 0;
  calls.queries = [];
});

describe("퍼널 보드 읽기: 작업 상세 중복 조회 제거", () => {
  it("getFunnelBoardFor 는 getTaskDetail 을 부르지 않는다", async () => {
    const b = await getFunnelBoardFor(structuredClone(DETAIL) as unknown as TaskDetail);
    expect(calls.getTaskDetail).toBe(0);
    expect(b?.state).toBe("board");
  });

  it("getFunnelBoard(taskId) 는 한 번만 읽고, 결과는 getFunnelBoardFor 와 같다", async () => {
    const viaId = await getFunnelBoard("t1");
    expect(calls.getTaskDetail).toBe(1);
    const viaDetail = await getFunnelBoardFor(structuredClone(DETAIL) as unknown as TaskDetail);
    expect(viaDetail).toEqual(viaId);
    expect(viaId?.funnel).toMatchObject({ id: "f1", stale: true, strategyVersion: { id: "v1", version: 1 } });
    expect(viaId?.strategy.basis.goals).toEqual([]); // 퍼널이 참조한 v1 기준(v2 문장이 섞이지 않음)
  });

  it("퍼널 표 조회 조건은 그대로: 세 표 모두 본인 업무실, 카드는 보관 안 한 것만", async () => {
    await getFunnelBoardFor(structuredClone(DETAIL) as unknown as TaskDetail);
    const by = Object.fromEntries(calls.queries.map((q) => [q.table, q.ops]));
    expect(Object.keys(by).sort()).toEqual(["funnel_items", "funnel_stages", "funnels"]);
    for (const t of ["funnels", "funnel_stages", "funnel_items"]) expect(by[t]).toContain("eq(workspace_id,w1)");
    expect(by.funnels).toContain("eq(strategy_artifact_id,a1)");
    expect(by.funnel_stages).toContain("eq(funnel_id,f1)");
    expect(by.funnel_items).toContain("eq(funnel_id,f1)");
    expect(by.funnel_items).toContain("is(archived_at,null)");
  });

  it("전략이 아니거나 작업이 없으면 DB 를 읽지 않고 null", async () => {
    expect(await getFunnelBoardFor(null)).toBeNull();
    expect(await getFunnelBoardFor({ ...structuredClone(DETAIL), task: { ...DETAIL.task, type: "quote" } } as unknown as TaskDetail)).toBeNull();
    expect(calls.queries).toHaveLength(0);
    expect(calls.getTaskDetail).toBe(0);
  });
});
