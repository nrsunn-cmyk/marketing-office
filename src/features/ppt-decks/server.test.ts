import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P3E-BACKEND-IMPL-01: PPT 구성안 서버 함수·내보내기 경로 처리기 단위 시험. DB 는 호출을 기록하는 흉내로 바꾼다
 * (실제 RLS·RPC 규칙은 tests/db/p3e-ppt-decks.test.ts, 파일 모양은 src/server/export/export.test.ts 가 맡는다).
 */
const S = vi.hoisted(() => ({
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  queries: [] as Array<{ table: string; ops: string[] }>,
  rpcError: null as null | { code: string; message: string },
  rows: {} as Record<string, unknown[]>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "w1" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const q = { table, ops: [] as string[] };
      S.queries.push(q);
      const filters: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      const rows = () =>
        ((S.rows[table] ?? []) as Record<string, unknown>[]).filter((r) => filters.every(([k, v]) => k === "workspace_id" || !(k in r) || r[k] === v) && ins.every(([k, vs]) => vs.includes(r[k])));
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "order"]) {
        chain[op] = (...args: unknown[]) => {
          q.ops.push(`${op}(${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(",")})`);
          if (op === "eq") filters.push([String(args[0]), args[1]]);
          if (op === "in") ins.push([String(args[0]), args[1] as unknown[]]);
          return chain;
        };
      }
      chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
      chain.then = (res: (v: unknown) => unknown) => res({ data: rows(), error: null });
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      S.rpc.push({ fn, args });
      if (S.rpcError) return { data: null, error: S.rpcError };
      return { data: fn === "create_ppt_deck" ? "deck-new" : 5, error: null };
    },
  }),
}));

import { GET } from "@/app/ppt-decks/[deckId]/export/route";
import { createPptDeck, getPptDeckFor, getPptExportInput, savePptDeck } from "./server";

const D = "11111111-1111-4111-8111-111111111111";
const sl = (o: Record<string, unknown> = {}) => ({ id: null, slideTitle: " 표지 ", bulletPoints: "요점\r\n둘", speakerNotes: "", assetIds: [], ...o });
const deckRows = () => ({
  ppt_decks: [{ id: D, project_id: "p1", current_version_no: 3, production_brief_id: "b1", title: "봄 제안서", template_key: "brand_deck", status: "reviewed", archived_at: null, revision: 4, source_brief_revision: 5, updated_at: "2" }],
  ppt_deck_versions: [
    { deck_id: D, version_no: 3, kind: "save", title: "봄 제안서", template_key: "brand_deck", status: "reviewed", slide_count: 2, restored_from_version_no: null, created_at: "t3",
      slides: [{ id: "s1", title: "표지", bullets: "대상", notes: null, assets: [] }, { id: "s2", title: "본문", bullets: "하나", notes: "메모", assets: [{ asset_id: "a1", version_no: 1 }, { asset_id: "a2", version_no: 1 }] }] },
    { deck_id: D, version_no: 1, kind: "create", title: "옛 제목", template_key: "royal_grid", status: "drafting", slide_count: 1, restored_from_version_no: null, created_at: "t1", slides: [{ id: "s1", title: "표지", bullets: null, notes: null, assets: [] }] },
  ],
  design_assets: [{ id: "a1", title: "로고", current_version_no: 2, archived_at: null, project_id: "p1" }, { id: "a2", title: "배경", current_version_no: 1, archived_at: "t", project_id: "p1" }],
});

beforeEach(() => Object.assign(S, { rpc: [], queries: [], rpcError: null, rows: {} }));

describe("쓰기", () => {
  it("만들기: 정리한 값(앞뒤 공백·\\r\\n)을 snake_case 로, 제어 문자·41장·모르는 템플릿은 RPC 전에 거절", async () => {
    expect(await createPptDeck({ productionBriefId: D, title: " 봄 ", templateKey: "royal_grid", slides: [sl()] })).toEqual({ ok: true, data: { deckId: "deck-new" } });
    expect(S.rpc[0]).toEqual({ fn: "create_ppt_deck", args: { p_production_brief_id: D, p_title: "봄", p_template_key: "royal_grid", p_slides: [{ id: null, title: "표지", bullets: "요점\n둘", notes: null, asset_ids: [] }] } });
    S.rpc = [];
    for (const bad of [
      { productionBriefId: D, title: "봄", templateKey: "royal_grid", slides: [sl({ slideTitle: "제어\u0001" })] },
      { productionBriefId: D, title: "봄", templateKey: "royal_grid", slides: Array.from({ length: 41 }, () => sl()) },
      { productionBriefId: D, title: "봄", templateKey: "../x", slides: [sl()] },
      { productionBriefId: D, title: "봄", templateKey: "royal_grid", slides: [sl({ sortOrder: 1 })] },
    ])
      expect(await createPptDeck(bad)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await savePptDeck(D, 1, { title: "봄", templateKey: "royal_grid", status: "approved", slides: [sl()] })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(S.rpc).toEqual([]);
  });
  it("DB 오류는 한글 안내로(판 20은 PPT_COPY 와 같은 문장)", async () => {
    S.rpcError = { code: "P0001", message: "LIMIT_REACHED: PPT 구성안 판 이력이 20개에 도달해 더 저장하거나 되돌릴 수 없습니다. 보관한 뒤 새 구성안으로 만들어 주세요" };
    expect(await savePptDeck(D, 1, { title: "봄", templateKey: "royal_grid", status: "drafting", slides: [sl()] })).toEqual({
      ok: false, code: "VALIDATION", message: "PPT 구성안 판 이력이 20개에 도달해 더 저장하거나 되돌릴 수 없습니다. 보관한 뒤 새 구성안으로 만들어 주세요.",
    });
  });
});

describe("읽기", () => {
  it("대표 구성안·판 목록·stale(asset, 바뀐 자산 수)·보관 자산 수·맞추기 막힘 키·내보내기 가능", async () => {
    S.rows = {
      production_briefs: [{ id: "b1", title: "봄 브리프", revision: 5, status: "drafting", archived_at: null, project_id: "p1", strategy_artifact_id: "s1", deliverable_types: ["ppt_deck"] }],
      projects: [{ id: "p1", status: "active" }],
      artifacts: [{ id: "s1", task_id: null }],
      ...deckRows(),
    };
    const r = await getPptDeckFor("b1");
    if (!r.ok) throw new Error(r.message);
    for (const q of S.queries) expect(q.ops, q.table).toContain("eq(workspace_id,w1)");
    expect(r.data).toMatchObject({ canWrite: true, canCreate: false, createBlockedCode: "brief_drafting", canExport: true, activeDeckCount: 1, briefTitle: "봄 브리프", assets: [{ id: "a1", label: "로고" }] });
    expect(r.data.deck).toMatchObject({ versionNo: 3, templateKey: "brand_deck", stale: true, staleReasons: ["asset"], staleAssetCount: 1, archivedAssetCount: 1, rebaseBlockedReason: "rebaseBlockedBriefDraft", versionLimitReached: false });
    expect(r.data.deck!.slides.map((s) => [s.sortOrder, s.slideTitle, s.speakerNotes])).toEqual([[1, "표지", ""], [2, "본문", "메모"]]);
    expect(r.data.deck!.deckVersions.map((v) => [v.version, v.slideCount, v.current])).toEqual([[3, 2, true], [1, 1, false]]);
  });
  it("내보내기 입력: 현재 판·옛 판·없는 판, 자산 이름(같은 프로젝트만)", async () => {
    S.rows = deckRows();
    const now = new Date("2026-11-20T05:05:00Z");
    expect(await getPptExportInput(D, null, now)).toMatchObject({ title: "봄 제안서", templateKey: "brand_deck", versionNo: 3, exportedAt: now });
    expect((await getPptExportInput(D, null, now))!.assetNames).toEqual(new Map([["a1", "로고"], ["a2", "배경"]]));
    expect(await getPptExportInput(D, 1, now)).toMatchObject({ title: "옛 제목", templateKey: "royal_grid", versionNo: 1 });
    expect(await getPptExportInput(D, 2, now)).toBeNull();
    S.rows = {};
    expect(await getPptExportInput(D, null, now)).toBeNull();
  });
});

describe("내보내기 경로 처리기 GET /ppt-decks/[deckId]/export", () => {
  const call = (id: string, qs: string) => GET(new Request(`http://localhost/ppt-decks/${id}/export${qs}`), { params: Promise.resolve({ deckId: id }) } as never);
  it("pptx·md: 머리글(첨부·RFC 5987·no-store·nosniff), 옛 판", async () => {
    S.rows = deckRows();
    const p = await call(D, "?format=pptx");
    expect(p.status).toBe(200);
    expect(p.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(p.headers.get("content-disposition")).toBe(`attachment; filename="ppt-deck-v3.pptx"; filename*=UTF-8''${encodeURIComponent("봄 제안서-v3.pptx")}`);
    expect(p.headers.get("cache-control")).toBe("private, no-store");
    expect(p.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = new Uint8Array(await p.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // zip 머리 PK
    const m = await call(D, "?format=md&version=1");
    expect(m.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(m.headers.get("content-disposition")).toContain('filename="ppt-deck-v1.md"');
    expect(await m.text()).toMatch(/^# 옛 제목\n/);
  });
  it("모양이 틀린 id·형식·판, 남의 것(읽기 0)·없는 판은 모두 같은 404", async () => {
    S.rows = deckRows();
    for (const [id, qs] of [["x", "?format=pptx"], [D, ""], [D, "?format=pdf"], [D, "?format=pptx&version=0"], [D, "?format=pptx&version=21"], [D, "?format=pptx&version=2"]] as const) {
      const r = await call(id, qs);
      expect(r.status, `${id}${qs}`).toBe(404);
      expect(await r.text()).toBe("찾을 수 없습니다.");
    }
    S.rows = {};
    expect((await call(D, "?format=pptx")).status).toBe(404);
  });
});
