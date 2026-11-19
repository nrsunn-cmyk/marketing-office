import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SOURCES-SERVER-01: listResearchSourceCitations(projectId) — 출처별 인용 브리프.
 * DB 는 eq·is·in 조건을 실제로 적용하는 흉내 클라이언트로 바꾼다(실제 RLS 는 tests/db 가 맡는다).
 * 확인: 묶기 모양, 해제된 연결·보관한 주장·다른 프로젝트 브리프·다른 업무실 행 제외, 모든 조회에 본인 업무실 조건, 긴 목록 나눠 조회.
 */
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, queries: [] as Array<{ table: string; ops: string[] }> }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "w1", timezone: "Asia/Seoul" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const q = { table, ops: [] as string[] };
      db.queries.push(q);
      let rows = [...(db.tables[table] ?? [])];
      let cols: string[] | null = null;
      const chain: Record<string, unknown> = {
        select(c: string) {
          cols = c.split(",").map((s) => s.trim());
          q.ops.push(`select(${c})`);
          return chain;
        },
        eq(k: string, v: unknown) {
          q.ops.push(`eq(${k},${String(v)})`);
          rows = rows.filter((r) => r[k] === v);
          return chain;
        },
        is(k: string, v: unknown) {
          q.ops.push(`is(${k},${String(v)})`);
          rows = rows.filter((r) => (r[k] ?? null) === v);
          return chain;
        },
        in(k: string, vs: unknown[]) {
          q.ops.push(`in(${k},${vs.length})`);
          rows = rows.filter((r) => vs.includes(r[k]));
          return chain;
        },
        then(res: (v: unknown) => unknown) {
          const data = rows.map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c]])) : r));
          return Promise.resolve(res({ data, error: null }));
        },
      };
      return chain;
    },
  }),
}));

const { listResearchSourceCitations } = await import("./server");

beforeEach(() => {
  db.queries.length = 0;
  db.tables = {
    research_sources: [
      { id: "rs1", workspace_id: "w1", project_id: "p1" },
      { id: "rs2", workspace_id: "w1", project_id: "p1" },
      { id: "rs3", workspace_id: "w1", project_id: "p1" }, // 인용 없음
      { id: "rsX", workspace_id: "w1", project_id: "p2" }, // 다른 프로젝트
      { id: "rsW", workspace_id: "w2", project_id: "p1" }, // 다른 업무실
    ],
    content_claim_sources: [
      { claim_id: "c1", research_source_id: "rs1", kind: "research", workspace_id: "w1", unlinked_at: null },
      { claim_id: "c2", research_source_id: "rs1", kind: "research", workspace_id: "w1", unlinked_at: null },
      { claim_id: "c3", research_source_id: "rs1", kind: "research", workspace_id: "w1", unlinked_at: null },
      { claim_id: "c4", research_source_id: "rs2", kind: "research", workspace_id: "w1", unlinked_at: "2026-11-19T00:00:00Z" }, // 해제됨
      { claim_id: "c5", research_source_id: "rs2", kind: "research", workspace_id: "w1", unlinked_at: null }, // 보관한 주장
      { claim_id: "c6", research_source_id: "rs2", kind: "research", workspace_id: "w1", unlinked_at: null }, // 다른 프로젝트 브리프
      { claim_id: "c7", research_source_id: "rsX", kind: "research", workspace_id: "w1", unlinked_at: null },
      { claim_id: "cW", research_source_id: "rs1", kind: "research", workspace_id: "w2", unlinked_at: null },
    ],
    content_brief_claims: [
      { id: "c1", text: "주장 1", brief_id: "b1", workspace_id: "w1", archived_at: null },
      { id: "c2", text: "주장 2", brief_id: "b1", workspace_id: "w1", archived_at: null },
      { id: "c3", text: "주장 3", brief_id: "b2", workspace_id: "w1", archived_at: null },
      { id: "c4", text: "주장 4", brief_id: "b2", workspace_id: "w1", archived_at: null },
      { id: "c5", text: "주장 5", brief_id: "b2", workspace_id: "w1", archived_at: "2026-11-19T00:00:00Z" },
      { id: "c6", text: "주장 6", brief_id: "bX", workspace_id: "w1", archived_at: null },
      { id: "cW", text: "남의 주장", brief_id: "bW", workspace_id: "w2", archived_at: null },
    ],
    content_briefs: [
      { id: "b1", title: "나 블로그", channel: "blog", strategy_artifact_id: "a1", project_id: "p1", workspace_id: "w1" },
      { id: "b2", title: "가 인스타", channel: "instagram", strategy_artifact_id: "a1", project_id: "p1", workspace_id: "w1" },
      { id: "bX", title: "다른 프로젝트", channel: "blog", strategy_artifact_id: "a2", project_id: "p2", workspace_id: "w1" },
    ],
    artifacts: [
      { id: "a1", task_id: "t1", workspace_id: "w1" },
      { id: "a2", task_id: "t2", workspace_id: "w1" },
    ],
  };
});

describe("listResearchSourceCitations", () => {
  it("출처별로 인용 브리프를 주장 단위로 묶는다(브리프 제목 순), 제외 조건을 지킨다", async () => {
    const out = await listResearchSourceCitations("p1");
    expect(out).toEqual({
      rs1: [
        { briefId: "b2", briefTitle: "가 인스타", channel: "instagram", taskId: "t1", claimText: "주장 3" },
        { briefId: "b1", briefTitle: "나 블로그", channel: "blog", taskId: "t1", claimText: "주장 1" },
        { briefId: "b1", briefTitle: "나 블로그", channel: "blog", taskId: "t1", claimText: "주장 2" },
      ],
    });
    // rs2 는 해제(c4)·보관 주장(c5)·다른 프로젝트 브리프(c6)뿐이라 키가 없다. rs3 은 인용 없음.
    expect(out.rs2).toBeUndefined();
    expect(out.rs3).toBeUndefined();
  });

  it("모든 조회에 본인 업무실 조건, 근거 연결은 research·해제 안 됨, 주장은 보관 안 됨, 브리프는 같은 프로젝트", async () => {
    await listResearchSourceCitations("p1");
    expect(db.queries.map((q) => q.table)).toEqual(["research_sources", "content_claim_sources", "content_brief_claims", "content_briefs", "artifacts"]);
    for (const q of db.queries) expect(q.ops).toContain("eq(workspace_id,w1)");
    const op = (t: string) => db.queries.find((q) => q.table === t)!.ops;
    expect(op("research_sources")).toContain("eq(project_id,p1)");
    expect(op("content_claim_sources")).toEqual(expect.arrayContaining(["eq(kind,research)", "is(unlinked_at,null)"]));
    expect(op("content_brief_claims")).toContain("is(archived_at,null)");
    expect(op("content_briefs")).toContain("eq(project_id,p1)");
  });

  it("출처가 없거나 인용이 없으면 빈 객체, 그 뒤 조회는 하지 않는다", async () => {
    expect(await listResearchSourceCitations("p9")).toEqual({});
    expect(db.queries.map((q) => q.table)).toEqual(["research_sources"]);
    db.queries.length = 0;
    db.tables.content_claim_sources = [];
    expect(await listResearchSourceCitations("p1")).toEqual({});
    expect(db.queries.map((q) => q.table)).toEqual(["research_sources", "content_claim_sources"]);
  });

  it("출처가 100개를 넘으면 in(...) 목록을 100개씩 나눠 조회한다", async () => {
    db.tables.research_sources = Array.from({ length: 230 }, (_, i) => ({ id: `r${i}`, workspace_id: "w1", project_id: "p1" }));
    db.tables.content_claim_sources = [{ claim_id: "c1", research_source_id: "r229", kind: "research", workspace_id: "w1", unlinked_at: null }];
    const out = await listResearchSourceCitations("p1");
    const ins = db.queries.filter((q) => q.table === "content_claim_sources").map((q) => q.ops.find((o) => o.startsWith("in("))!);
    expect(ins).toEqual(["in(research_source_id,100)", "in(research_source_id,100)", "in(research_source_id,30)"]);
    expect(out.r229).toEqual([{ briefId: "b1", briefTitle: "나 블로그", channel: "blog", taskId: "t1", claimText: "주장 1" }]);
  });
});
