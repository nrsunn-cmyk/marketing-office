import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P3B-BACKEND-IMPL-01: 홈페이지 문서 서버 함수 단위 시험. DB 는 조회·RPC 를 기록하는 흉내 클라이언트로 바꾼다
 * (실제 RLS·RPC 규칙은 tests/db/p3b-web-copy.test.ts 가 맡는다).
 */
const calls = vi.hoisted(() => ({ queries: [] as Array<{ table: string; ops: string[] }>, rpc: [] as Array<{ fn: string; args: Record<string, unknown> }> }));
const ROWS = vi.hoisted(() => ({
  production_briefs: [] as unknown[],
  projects: [] as unknown[],
  artifacts: [] as unknown[],
  tasks: [] as unknown[],
  web_copy_docs: [] as unknown[],
  web_copy_versions: [] as unknown[],
  research_sources: [] as unknown[],
  rpcError: null as null | { code: string; message: string },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "w1" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const q = { table, ops: [] as string[] };
      calls.queries.push(q);
      const filters: Array<[string, unknown]> = [];
      const rows = () => (ROWS[table as "projects"] as Record<string, unknown>[]).filter((r) => filters.every(([k, v]) => k === "workspace_id" || !(k in r) || r[k] === v));
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "order"]) {
        chain[op] = (...args: unknown[]) => {
          q.ops.push(`${op}(${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(",")})`);
          if (op === "eq") filters.push([String(args[0]), args[1]]);
          return chain;
        };
      }
      chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
      chain.then = (res: (v: unknown) => unknown) => res({ data: rows(), error: null });
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.rpc.push({ fn, args });
      return ROWS.rpcError ? { data: null, error: ROWS.rpcError } : { data: fn.startsWith("create") ? "new-doc" : 9, error: null };
    },
  }),
}));

import { archiveWebCopy, createWebCopyDoc, getWebCopyFor, getWebCopyVersion, rebaseWebCopy, restoreWebCopyVersion, saveWebCopy } from "./server";

const content = { pages: [{ id: "pg1", title: "홈", slug: "/", sort_order: 1, sections: [{ id: "s1", section_name: "첫 화면", purpose: null, headline: "제목", body: null, cta_label: null, cta_target: null, citation_ids: [], sort_order: 1, excluded: false }] }] };

beforeEach(() => {
  calls.queries.length = 0;
  calls.rpc.length = 0;
  ROWS.production_briefs = [{ id: "b1", title: "봄", revision: 5, status: "ready", archived_at: null, project_id: "p1", strategy_artifact_id: "a1", deliverable_types: ["web_copy"] }];
  ROWS.projects = [{ id: "p1", status: "active" }];
  ROWS.artifacts = [{ id: "a1", task_id: "t1" }];
  ROWS.tasks = [{ id: "t1", status: "in_progress" }];
  ROWS.web_copy_docs = [];
  ROWS.web_copy_versions = [];
  ROWS.research_sources = [{ id: "r1", title: "출처", url: "https://a.com/", review_status: "verified", project_id: "p1" }];
  ROWS.rpcError = null;
});

describe("getWebCopyFor", () => {
  it("문서가 없으면 만들 수 있고, 본인 업무실 조건으로만 읽는다", async () => {
    const r = await getWebCopyFor("b1");
    if (!r.ok) throw new Error(r.message);
    for (const q of calls.queries) expect(q.ops, q.table).toContain("eq(workspace_id,w1)");
    expect(r.data).toMatchObject({ doc: null, versions: [], canCreate: true, createBlockedReason: null, docCount: 0, sources: [{ id: "r1", title: "출처", url: "https://a.com/", reviewStatus: "verified" }] });
  });

  it("작업 중 문서: 지금 판 내용(camelCase)·판 목록(본문 없음)·이전 브리프 기준·맞추기 가능", async () => {
    ROWS.web_copy_docs = [{ id: "d1", status: "reviewed", archived_at: null, revision: 4, current_version_no: 2, source_brief_revision: 3, created_at: "c", updated_at: "u", production_brief_id: "b1" }];
    ROWS.web_copy_versions = [
      { id: "v2", doc_id: "d1", version_no: 2, kind: "restore", status: "reviewed", source_brief_revision: 3, restored_from_version_no: 1, created_at: "c2", content },
      { id: "v1", doc_id: "d1", version_no: 1, kind: "create", status: "drafting", source_brief_revision: 3, restored_from_version_no: null, created_at: "c1", content },
    ];
    const r = await getWebCopyFor("b1");
    if (!r.ok) throw new Error(r.message);
    expect(r.data.doc).toMatchObject({ id: "d1", displayLabel: "검토 완료", revision: 4, currentVersionNo: 2, currentVersionId: "v2", stale: true, staleLabel: "이전 브리프 기준", canRebase: true, versionsFull: false, readOnlyReason: null });
    expect(r.data.doc?.pages[0].sections[0]).toMatchObject({ id: "s1", sectionName: "첫 화면", citationIds: [] });
    expect(r.data.versions.map((v) => [v.versionNo, v.kindLabel, v.current])).toEqual([[2, "되돌림", true], [1, "처음 만듦", false]]);
    expect(r.data.versions[0]).not.toHaveProperty("content");
    expect(r.data).toMatchObject({ canCreate: false, createBlockedReason: expect.stringMatching(/작업 중인 홈페이지 문서가 이미/) });
  });

  it("만들 수 없는 이유 순서와 읽기 전용: 프로젝트 보관 > 전략 작업 취소 > 브리프 보관 > 확정 아님 > web_copy 없음", async () => {
    const reason = async () => {
      const r = await getWebCopyFor("b1");
      if (!r.ok) throw new Error(r.message);
      return r.data.createBlockedReason;
    };
    ROWS.production_briefs = [{ ...(ROWS.production_briefs[0] as object), deliverable_types: ["ppt_deck"] }];
    expect(await reason()).toMatch(/홈페이지 구조·문구가 없습니다/);
    ROWS.production_briefs = [{ ...(ROWS.production_briefs[0] as object), status: "drafting" }];
    expect(await reason()).toMatch(/확정해야/);
    ROWS.production_briefs = [{ ...(ROWS.production_briefs[0] as object), archived_at: "x" }];
    expect(await reason()).toMatch(/보관한 제작 브리프/);
    ROWS.tasks = [{ id: "t1", status: "cancelled" }];
    expect(await reason()).toMatch(/취소된 전략 작업/);
    ROWS.projects = [{ id: "p1", status: "archived" }];
    expect(await reason()).toMatch(/보관한 프로젝트/);
  });

  it("없는(남의) 브리프는 NOT_FOUND, 판 하나 보기", async () => {
    ROWS.production_briefs = [];
    expect(await getWebCopyFor("b9")).toEqual({ ok: false, code: "NOT_FOUND", message: "제작 브리프를 찾을 수 없습니다." });
    ROWS.web_copy_versions = [{ id: "v1", doc_id: "d1", version_no: 1, content }];
    expect(await getWebCopyVersion("d1", 1)).toMatchObject({ ok: true, data: { versionId: "v1", versionNo: 1, pages: [{ id: "pg1", slug: "/" }] } });
    expect(await getWebCopyVersion("d1", 7)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("쓰기", () => {
  it("저장: camelCase 값을 snake_case pages 로 바꿔 RPC, 계약 실패는 RPC 를 부르지 않음", async () => {
    const pages = [{ id: null, title: "홈", slug: "/", sortOrder: 1, sections: [{ id: null, sectionName: "첫 화면", purpose: null, headline: "제목", body: null, ctaLabel: null, ctaTarget: null, citationIds: [], sortOrder: 1, excluded: true }] }];
    expect(await saveWebCopy("d1", 4, { status: "drafting", pages })).toEqual({ ok: true, data: { revision: 9 } });
    expect(calls.rpc[0]).toMatchObject({ fn: "save_web_copy", args: { p_doc_id: "d1", p_expected_revision: 4, p_status: "drafting", p_pages: [{ id: null, sort_order: 1, sections: [{ section_name: "첫 화면", excluded: true, citation_ids: [] }] }] } });
    expect(await saveWebCopy("d1", 4, { status: "drafting", pages: [] })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(calls.rpc).toHaveLength(1);
  });

  it("만들기·되돌리기·맞추기·보관 인자, DB 오류 문구(한도·없는 판·충돌·날것 숨김)", async () => {
    expect(await createWebCopyDoc("b1")).toEqual({ ok: true, data: { docId: "new-doc" } });
    expect(await createWebCopyDoc("b1", "d0")).toEqual({ ok: true, data: { docId: "new-doc" } });
    expect(await restoreWebCopyVersion("d1", 4, 2)).toEqual({ ok: true, data: { revision: 9 } });
    expect(await rebaseWebCopy("d1", 4)).toEqual({ ok: true, data: { revision: 9 } });
    expect(await archiveWebCopy("d1", 4)).toEqual({ ok: true, data: { revision: 9 } });
    expect(calls.rpc.map((c) => [c.fn, c.args])).toEqual([
      ["create_web_copy_doc", { p_production_brief_id: "b1", p_copy_from_doc_id: undefined }],
      ["create_web_copy_doc", { p_production_brief_id: "b1", p_copy_from_doc_id: "d0" }],
      ["restore_web_copy_version", { p_doc_id: "d1", p_expected_revision: 4, p_version_no: 2 }],
      ["rebase_web_copy", { p_doc_id: "d1", p_expected_revision: 4 }],
      ["archive_web_copy", { p_doc_id: "d1", p_expected_revision: 4 }],
    ]);
    ROWS.rpcError = { code: "P0001", message: "LIMIT_REACHED: 한 문서의 판은 100개까지입니다. 문서를 보관하고 새 문서를 만들어 주세요" };
    expect(await restoreWebCopyVersion("d1", 4, 1)).toMatchObject({ ok: false, code: "VALIDATION", message: expect.stringMatching(/100개까지/) });
    ROWS.rpcError = { code: "P0002", message: "NOT_FOUND: 이 문서에 그 판이 없습니다" };
    expect(await restoreWebCopyVersion("d1", 4, 99)).toEqual({ ok: false, code: "NOT_FOUND", message: "이 문서에 그 판이 없습니다" });
    ROWS.rpcError = { code: "P0001", message: "CONFLICT: 다른 곳에서 먼저 수정되었습니다" };
    expect(await rebaseWebCopy("d1", 1)).toMatchObject({ ok: false, code: "CONFLICT" });
    ROWS.rpcError = { code: "23505", message: 'duplicate key value violates unique constraint "web_copy_docs_one_active"' };
    const e = await createWebCopyDoc("b1");
    expect(e).toMatchObject({ ok: false, code: "ERROR" });
    if (!e.ok) expect(e.message).not.toMatch(/duplicate|constraint/);
  });
});
