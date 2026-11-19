import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P2E-BACKEND-01: 리드마그넷 서버 함수 단위 시험. DB 는 조회·RPC 를 기록하는 흉내 클라이언트로 바꾼다
 * (실제 RLS·RPC 규칙은 tests/db/p2-lead-magnet.test.ts 가 맡는다).
 */
const calls = vi.hoisted(() => ({ queries: [] as Array<{ table: string; ops: string[] }>, rpc: [] as Array<{ fn: string; args: Record<string, unknown> }> }));
const ROWS = vi.hoisted(() => ({
  lead_magnets: [] as unknown[],
  archived: [] as unknown[],
  funnel_items: [] as unknown[],
  artifact_versions: [] as unknown[],
  rpcError: null as null | { code: string; message: string },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "w1", timezone: "Asia/Seoul" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const q = { table, ops: [] as string[] };
      calls.queries.push(q);
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "not", "in", "order"]) {
        chain[op] = (...args: unknown[]) => {
          q.ops.push(`${op}(${args.map((a) => (Array.isArray(a) ? `[${a.join("|")}]` : String(a))).join(",")})`);
          return chain;
        };
      }
      chain.then = (res: (v: unknown) => unknown) => {
        const data = table === "lead_magnets" ? (q.ops.some((o) => o.startsWith("in(")) ? ROWS.archived : ROWS.lead_magnets) : ROWS[table as "funnel_items" | "artifact_versions"];
        return res({ data, error: null });
      };
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.rpc.push({ fn, args });
      return ROWS.rpcError ? { data: null, error: ROWS.rpcError } : { data: fn === "create_lead_magnet" ? "lm-new" : 7, error: null };
    },
  }),
}));

import type { FunnelBoard } from "@/features/funnel/server";
import { archiveLeadMagnet, createLeadMagnet, getLeadMagnetsFor, rebaseLeadMagnet, setFunnelItemLeadMagnet, updateLeadMagnet } from "./server";

const BOARD = {
  state: "board",
  strategy: { artifactId: "a1", approvedVersion: { id: "v2", version: 2 }, basis: { goals: [], offers: [], audiences: [] } },
  funnel: { id: "f1", revision: 1, strategyVersion: { id: "v1", version: 1 }, stale: true },
  stages: [
    { id: "s3", key: "consideration", label: "고려", position: 3, focus: null, revision: 1, items: [] },
    { id: "s4", key: "conversion", label: "전환", position: 4, focus: null, revision: 1, items: [] },
  ],
  warnings: [],
} as unknown as FunnelBoard;

const row = (id: string, o: Record<string, unknown> = {}) => ({
  id, stage_id: "s3", title: `리드 ${id}`, format: "checklist", audience: null, promise: "가치", delivery: "email",
  lead_fields: ["이메일"], outline: ["1장"], status: "planned", revision: 1, updated_at: "", archived_at: null, strategy_version_id: "v1", ...o,
});

beforeEach(() => {
  calls.queries = [];
  calls.rpc = [];
  ROWS.lead_magnets = [];
  ROWS.archived = [];
  ROWS.funnel_items = [];
  ROWS.artifact_versions = [];
  ROWS.rpcError = null;
});

describe("리드마그넷 목록 읽기", () => {
  it("퍼널이 없으면 DB 를 읽지 않고 빈 목록", async () => {
    expect(await getLeadMagnetsFor(null)).toEqual([]);
    expect(await getLeadMagnetsFor({ ...BOARD, funnel: null })).toEqual([]);
    expect(calls.queries).toHaveLength(0);
  });

  it("stale·단계 이름·연결 카드·보관한 것(활성 카드가 가리키는 것만)·버전 번호", async () => {
    ROWS.lead_magnets = [row("m1"), row("m2", { strategy_version_id: "v2", stage_id: "s4" }), row("m3", { strategy_version_id: "v0" })];
    ROWS.archived = [row("m9", { archived_at: "2026-11-19T00:00:00Z" })];
    ROWS.funnel_items = [
      { id: "i1", title: "무료 진단 신청", kind: "cta", stage_id: "s4", lead_magnet_id: "m1" },
      { id: "i2", title: "예전 카드", kind: "lead_magnet", stage_id: "s3", lead_magnet_id: "m9" },
    ];
    ROWS.artifact_versions = [{ id: "v0", version: 0 }];
    const list = await getLeadMagnetsFor(BOARD);
    expect(list.map((x) => [x.id, x.stale, x.stageLabel, x.archived, x.strategyVersion.version, x.linkedItems.map((i) => i.id)])).toEqual([
      ["m1", true, "고려", false, 1, ["i1"]],
      ["m2", false, "전환", false, 2, []],
      ["m3", true, "고려", false, 0, []],
      ["m9", true, "고려", true, 1, ["i2"]],
    ]);
    expect(list[0]).toMatchObject({ format: "checklist", delivery: "email", leadFields: ["이메일"], outline: ["1장"], promise: "가치" });

    // 조회 조건: 모두 본인 업무실·이 퍼널, 활성 목록은 보관 안 한 것만, 보관분은 가리키는 id 만, 버전은 모르는 것만
    const lm = calls.queries.filter((q) => q.table === "lead_magnets");
    expect(lm).toHaveLength(2);
    for (const q of calls.queries) expect(q.ops, q.table).toContain("eq(workspace_id,w1)");
    for (const q of [...lm, calls.queries.find((q) => q.table === "funnel_items")!]) expect(q.ops).toContain("eq(funnel_id,f1)");
    expect(lm[0].ops).toContain("is(archived_at,null)");
    expect(lm[1].ops).toContain("in(id,[m9])");
    expect(calls.queries.find((q) => q.table === "funnel_items")!.ops).toEqual(expect.arrayContaining(["is(archived_at,null)", "not(lead_magnet_id,is,null)"]));
    expect(calls.queries.find((q) => q.table === "artifact_versions")!.ops).toContain("in(id,[v0])");
  });

  it("보관분·모르는 버전이 없으면 추가 조회를 하지 않는다", async () => {
    ROWS.lead_magnets = [row("m1")];
    await getLeadMagnetsFor(BOARD);
    expect(calls.queries.map((q) => q.table).sort()).toEqual(["funnel_items", "lead_magnets"]);
  });
});

describe("쓰기", () => {
  it("만들기: 계약 통과 값만 RPC 로, 빈 선택값은 보내지 않는다", async () => {
    const r = await createLeadMagnet("s3", { title: " 진단 ", format: "diagnosis", audience: " ", leadFields: ["이메일"] });
    expect(r).toEqual({ ok: true, data: { leadMagnetId: "lm-new" } });
    expect(calls.rpc[0]).toEqual({
      fn: "create_lead_magnet",
      args: { p_stage_id: "s3", p_title: "진단", p_format: "diagnosis", p_audience: undefined, p_promise: undefined, p_delivery: undefined, p_lead_fields: ["이메일"], p_outline: [], p_status: "planned" },
    });
  });

  it("계약 실패면 RPC 를 부르지 않는다", async () => {
    const r = await createLeadMagnet("s3", { title: "x", format: "ebook" });
    expect(r.ok).toBe(false);
    expect(calls.rpc).toHaveLength(0);
  });

  it("수정·다시 맞추기·보관·카드 연결 인자, DB 오류는 안내 문구로", async () => {
    await updateLeadMagnet("m1", 3, "s4", { title: "t", format: "guide", delivery: "web_page" });
    expect(calls.rpc[0]).toMatchObject({ fn: "update_lead_magnet", args: { p_lead_magnet_id: "m1", p_expected_revision: 3, p_stage_id: "s4", p_delivery: "web_page", p_audience: null } });
    expect(await rebaseLeadMagnet("m1", 4)).toEqual({ ok: true, data: { revision: 7 } });
    expect(await archiveLeadMagnet("m1", 5)).toEqual({ ok: true, data: { revision: 7 } });
    await setFunnelItemLeadMagnet("i1", 2, null);
    expect(calls.rpc.slice(1).map((c) => c.fn)).toEqual(["rebase_lead_magnet", "archive_lead_magnet", "set_funnel_item_lead_magnet"]);
    expect(calls.rpc[3].args).toEqual({ p_item_id: "i1", p_expected_revision: 2, p_lead_magnet_id: null });

    ROWS.rpcError = { code: "P0001", message: "CONFLICT: 다른 곳에서 먼저 수정되었습니다" };
    expect(await archiveLeadMagnet("m1", 1)).toMatchObject({ ok: false, code: "CONFLICT" });
    ROWS.rpcError = { code: "22023", message: "VALIDATION: 같은 퍼널의 리드마그넷만 연결할 수 있습니다" };
    expect(await setFunnelItemLeadMagnet("i1", 1, "m8")).toMatchObject({ ok: false, code: "VALIDATION", message: "같은 퍼널의 리드마그넷만 연결할 수 있습니다" });
  });
});
