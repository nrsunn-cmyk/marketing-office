import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UX-COUNTS-BACKEND-01(Front 요청 UX F4·F5): 건수 읽기 단위 시험. DB 는 흉내 — eq·in·is 거르기와 count(head) 를 흉내 낸다.
 * 실제 정책(본인 업무실 select)은 각 표의 DB 시험이 이미 확인한다.
 */
const S = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, fail: null as string | null, queries: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "w1" }, user: { userId: "me" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      S.queries.push(table);
      const f: Array<(r: Record<string, unknown>) => boolean> = [];
      let head = false;
      let lim = Infinity;
      let order: [string, boolean] | null = null;
      const chain: Record<string, unknown> = {};
      chain.select = (_c: string, o?: { head?: boolean }) => ((head = !!o?.head), chain);
      chain.eq = (k: string, v: unknown) => (f.push((r) => r[k] === v), chain);
      chain.in = (k: string, vs: unknown[]) => (f.push((r) => vs.includes(r[k])), chain);
      chain.is = (k: string, v: unknown) => (f.push((r) => (r[k] ?? null) === v), chain);
      chain.order = (k: string, o: { ascending: boolean }) => ((order = [k, o.ascending]), chain);
      chain.limit = (n: number) => ((lim = n), chain);
      chain.then = (res: (v: unknown) => unknown) => {
        if (S.fail === table) return res({ data: null, count: null, error: { code: "XX", message: "x" } });
        let rows = (S.rows[table] ?? []).filter((r) => f.every((p) => p(r)));
        if (order) {
          const [k, asc] = order;
          rows = [...rows].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : 1) * (asc ? 1 : -1));
        }
        rows = rows.slice(0, lim);
        return res(head ? { data: null, count: rows.length, error: null } : { data: rows, count: null, error: null });
      };
      return chain;
    },
  }),
}));

import { getPendingCounts, getProjectProductionCounts } from "./server";

const P = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";
const row = (o: Record<string, unknown>) => ({ workspace_id: "w1", project_id: P, archived_at: null, ...o });
beforeEach(() => {
  S.fail = null;
  S.queries = [];
  S.rows = {
    qa_reviews: [row({ status: "drafting" }), row({ status: "fix_requested" }), row({ status: "reviewed" }), row({ status: "reviewed" }), row({ status: "drafting", archived_at: "t" }), row({ status: "drafting", workspace_id: "w2" })],
    execution_jobs: [row({ status: "pending_approval" }), row({ status: "queued" }), row({ status: "pending_approval", archived_at: "t" })],
    production_briefs: [row({ status: "ready" }), row({ status: "drafting" }), row({ status: "ready", archived_at: "t" }), row({ status: "ready", project_id: O })],
    web_copy_docs: [row({ status: "reviewed" }), row({ status: "drafting", archived_at: "t" })],
    design_assets: [row({ status: "drafting" }), row({ status: "reviewed" }), row({ status: "reviewed" })],
    video_plans: [row({ status: "drafting" })],
    ppt_decks: [row({ status: "reviewed", project_id: O })],
    delivery_bundles: [row({ status: "drafting" }), row({ status: "reviewed", archived_at: "t" })],
    tasks: [row({ id: "t-old", type: "strategy", updated_at: "2026-11-01" }), row({ id: "t-new", type: "strategy", updated_at: "2026-11-20" }), row({ id: "t-x", type: "logo_brief", updated_at: "2026-11-21" })],
  };
});

describe("F4 현황 건수", () => {
  it("검수 대기 = 열린 회차(작성 중·보완 요청), 실행 승인 대기 = pending_approval, 보관·남의 업무실 제외", async () => {
    expect(await getPendingCounts()).toEqual({ ok: true, data: { qaPending: 2, executionPendingApproval: 1 } });
  });
  it("읽기 실패면 0 이 아니라 오류", async () => {
    S.fail = "execution_jobs";
    const r = await getPendingCounts();
    expect(r.ok).toBe(false);
  });
});

describe("F5 프로젝트 건수", () => {
  it("확정 브리프·산출물 상태별·검수 승인·납품 묶음·최근 전략 작업 id, 보관·다른 프로젝트 제외", async () => {
    const r = await getProjectProductionCounts(P);
    expect(r).toEqual({
      ok: true,
      data: {
        briefsReady: 1,
        outputs: { drafting: 2, reviewed: 3 },
        byKind: {
          web_copy: { drafting: 0, reviewed: 1 },
          design_asset: { drafting: 1, reviewed: 2 },
          video_plan: { drafting: 1, reviewed: 0 },
          ppt_deck: { drafting: 0, reviewed: 0 },
        },
        qaApproved: 2,
        deliveryBundles: 1,
        strategyTaskId: "t-new",
      },
    });
  });
  it("전략 작업이 없으면 null, 데이터가 없으면 모두 0", async () => {
    S.rows = {};
    const r = await getProjectProductionCounts(P);
    expect(r.ok && r.data).toMatchObject({ briefsReady: 0, outputs: { drafting: 0, reviewed: 0 }, qaApproved: 0, deliveryBundles: 0, strategyTaskId: null });
  });
  it("uuid 아님은 DB 전에 NOT_FOUND, 읽기 실패면 오류", async () => {
    expect(await getProjectProductionCounts("x")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(S.queries).toEqual([]);
    S.fail = "video_plans";
    expect((await getProjectProductionCounts(P)).ok).toBe(false);
  });
});
