import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P2G-BACKEND-01: 채널 초안 서버 함수 단위 시험. DB 는 조회·RPC 를 기록하는 흉내 클라이언트로 바꾼다
 * (실제 RLS·RPC 규칙은 tests/db/p2-channel-draft.test.ts 가 맡는다).
 */
const calls = vi.hoisted(() => ({ queries: [] as Array<{ table: string; ops: string[] }>, rpc: [] as Array<{ fn: string; args: Record<string, unknown> }> }));
const ROWS = vi.hoisted(() => ({
  channel_drafts: [] as unknown[],
  channel_publications: [] as unknown[],
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
      chain.then = (res: (v: unknown) => unknown) => res({ data: ROWS[table as "channel_drafts"], error: null });
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.rpc.push({ fn, args });
      return ROWS.rpcError ? { data: null, error: ROWS.rpcError } : { data: fn.startsWith("create") || fn.endsWith("publication") ? "new-id" : 7, error: null };
    },
  }),
}));

import type { BriefDetail } from "@/features/brief/server";
import type { FunnelBoard } from "@/features/funnel/server";
import {
  archiveChannelDraft,
  createChannelDraft,
  getChannelDraftsFor,
  rebaseChannelDraft,
  recordChannelPublication,
  updateChannelDraft,
  voidChannelPublication,
} from "./server";

const BOARD = {
  state: "board",
  strategy: { artifactId: "a1", approvedVersion: { id: "v2", version: 2 }, basis: { goals: [], offers: [], audiences: [] } },
  funnel: { id: "f1", revision: 1, strategyVersion: { id: "v1", version: 1 }, stale: true },
  stages: [],
  warnings: [],
} as unknown as FunnelBoard;
const detail = (o: Partial<BriefDetail["brief"]> = {}) => ({ brief: { id: "b1", channel: "blog", status: "ready", archived: false, revision: 4, ...o } }) as unknown as BriefDetail;

const row = (id: string, o: Record<string, unknown> = {}) => ({
  id, brief_id: "b1", title: `초안 ${id}`, body: "## 소제목\n<script>alert(1)</script> [x](javascript:alert(1)) [y](https://a.tistory.com/1)",
  tags: ["SEO"], image_note: null, meta_description: "요약", status: "drafting", revision: 1, archived_at: null,
  created_at: "2026-11-19T00:00:00Z", updated_at: "2026-11-19T00:00:00Z", strategy_version_id: "v1", source_brief_revision: 4, source_snapshot: { title: "t" }, ...o,
});
const pub = (id: string, draft: string, o: Record<string, unknown> = {}) => ({
  id, draft_id: draft, kind: "record", url: "https://a.tistory.com/1", published_at: "2026-11-19T00:00:00Z", note: null, voids_id: null, created_at: "2026-11-19T00:00:00Z", ...o,
});

beforeEach(() => {
  calls.queries = [];
  calls.rpc = [];
  ROWS.channel_drafts = [];
  ROWS.channel_publications = [];
  ROWS.artifact_versions = [];
  ROWS.rpcError = null;
});

describe("초안 목록 읽기", () => {
  it("퍼널·브리프가 없으면 DB 를 읽지 않는다", async () => {
    expect(await getChannelDraftsFor(null, detail())).toBeNull();
    expect(await getChannelDraftsFor(BOARD, null)).toBeNull();
    expect(calls.queries).toHaveLength(0);
  });

  it("상태 4종 계산·stale·브리프 바뀜·보관은 뒤로·주소는 https 만 href·내보내기는 허용 태그만", async () => {
    ROWS.channel_drafts = [
      row("d1"),
      row("d2", { archived_at: "2026-11-19T01:00:00Z", strategy_version_id: "v2" }),
      row("d3", { status: "reviewed", strategy_version_id: "v0", source_brief_revision: 3 }),
    ];
    ROWS.channel_publications = [
      pub("p1", "d1"),
      pub("p2", "d3"),
      pub("p3", "d3", { kind: "void", url: null, published_at: null, note: "오타", voids_id: "p2" }),
      pub("p4", "d1", { url: "javascript:alert(1)" }),
      pub("p5", "d1", { url: "https://blog.example.com/1" }),
    ];
    ROWS.artifact_versions = [{ id: "v0", version: 0 }];
    const r = (await getChannelDraftsFor(BOARD, detail()))!;
    expect(r.drafts.map((d) => [d.id, d.displayStatus, d.displayLabel, d.stale, d.briefChanged, d.strategyVersion.version])).toEqual([
      ["d1", "published", "게시 기록됨", true, false, 1],
      ["d3", "reviewed", "검토 완료", true, true, 0],
      ["d2", "archived", "보관", false, false, 2],
    ]);
    expect(r.activeCount).toBe(2);
    expect(r.canCreate).toBe(true);
    const d1 = r.drafts[0]!;
    expect(d1.publications.map((p) => [p.id, p.url, p.nonTistoryHost, p.voided])).toEqual([
      ["p1", "https://a.tistory.com/1", false, false],
      ["p4", null, false, false],
      ["p5", "https://blog.example.com/1", true, false],
    ]);
    expect(r.drafts[1]!.publications.map((p) => [p.id, p.kind, p.voided, p.voidsId])).toEqual([["p2", "record", true, null], ["p3", "void", false, "p2"]]);
    expect(d1.export.html).toBe('<h2>소제목</h2>\n<p>&lt;script&gt;alert(1)&lt;/script&gt; [x](javascript:alert(1)) <a href="https://a.tistory.com/1">y</a></p>');
    expect(d1.export.fileNames).toEqual({ html: "초안 d1.html", md: "초안 d1.md", txt: "초안 d1.txt" });
    expect(d1.export.info.tags).toBe("SEO");
    // 조회는 본인 업무실·이 브리프로만
    expect(calls.queries.find((q) => q.table === "channel_drafts")!.ops).toEqual(expect.arrayContaining(["eq(workspace_id,w1)", "eq(brief_id,b1)"]));
    expect(calls.queries.find((q) => q.table === "channel_publications")!.ops).toEqual(expect.arrayContaining(["eq(workspace_id,w1)", "in(draft_id,[d1|d2|d3])"]));
    expect(calls.queries.find((q) => q.table === "artifact_versions")!.ops).toEqual(expect.arrayContaining(["eq(workspace_id,w1)", "in(id,[v0])"]));
  });

  it("만들 수 없는 이유: 다른 채널·보관·drafting·한도 5", async () => {
    expect((await getChannelDraftsFor(BOARD, detail({ channel: "instagram" } as never)))!.createBlockedReason).toMatch(/블로그 브리프로만/);
    expect((await getChannelDraftsFor(BOARD, detail({ archived: true })))!.createBlockedReason).toMatch(/보관한 브리프/);
    expect((await getChannelDraftsFor(BOARD, detail({ status: "drafting" })))!.createBlockedReason).toMatch(/준비 완료/);
    ROWS.channel_drafts = ["a", "b", "c", "d", "e"].map((x) => row(x));
    const r = (await getChannelDraftsFor(BOARD, detail()))!;
    expect([r.canCreate, r.createBlockedReason]).toEqual([false, "한 브리프에는 초안을 5개까지 둘 수 있습니다."]);
  });
});

describe("쓰기", () => {
  it("만들기·고치기·다시 맞추기·보관은 RPC 인자 그대로", async () => {
    expect(await createChannelDraft("b1")).toEqual({ ok: true, data: { draftId: "new-id" } });
    expect(await updateChannelDraft("d1", 3, { title: " 제목 ", body: "a\r\nb", tags: [" SEO "], imageNote: "", metaDescription: "요약", status: "reviewed" })).toEqual({ ok: true, data: { revision: 7 } });
    expect(await rebaseChannelDraft("d1", 4)).toEqual({ ok: true, data: { revision: 7 } });
    expect(await archiveChannelDraft("d1", 5)).toEqual({ ok: true, data: { revision: 7 } });
    expect(calls.rpc).toEqual([
      { fn: "create_channel_draft", args: { p_brief_id: "b1" } },
      { fn: "update_channel_draft", args: { p_draft_id: "d1", p_expected_revision: 3, p_title: "제목", p_body: "a\nb", p_tags: ["SEO"], p_image_note: null, p_meta_description: "요약", p_status: "reviewed" } },
      { fn: "rebase_channel_draft", args: { p_draft_id: "d1", p_expected_revision: 4 } },
      { fn: "archive_channel_draft", args: { p_draft_id: "d1", p_expected_revision: 5 } },
    ]);
  });

  it("입력 계약 실패는 RPC 를 부르지 않는다", async () => {
    for (const raw of [{ title: "" }, { title: "a", status: "published" }, { title: "a", tags: ["x", "X"] }, { title: "a", extra: 1 }, null, "문자열"]) {
      const r = await updateChannelDraft("d1", 1, raw);
      expect(r.ok, JSON.stringify(raw)).toBe(false);
    }
    expect(calls.rpc).toHaveLength(0);
  });

  it("게시 기록: 주소 정규화·시간대 없는 값은 한국 시간, 잘못된 주소·미래 시각은 RPC 전에 거절", async () => {
    expect(await recordChannelPublication("d1", { url: " https://A.Tistory.com/1 ", publishedAt: "2026-11-19T09:00", note: "  메모 " })).toEqual({ ok: true, data: { publicationId: "new-id" } });
    expect(calls.rpc[0]).toEqual({ fn: "record_channel_publication", args: { p_draft_id: "d1", p_url: "https://a.tistory.com/1", p_published_at: "2026-11-19T00:00:00.000Z", p_note: "메모" } });
    for (const raw of [
      { url: "http://a.com", publishedAt: "2026-11-19T09:00" },
      { url: "javascript:alert(1)", publishedAt: "2026-11-19T09:00" },
      { url: "https://a.com/​", publishedAt: "2026-11-19T09:00" },
      { url: "https://a.com/", publishedAt: "2999-01-01T00:00" },
      { url: "https://a.com/", publishedAt: "어제" },
      { url: "https://a.com/", publishedAt: "2026-11-19T09:00", extra: 1 },
    ]) expect((await recordChannelPublication("d1", raw)).ok, JSON.stringify(raw)).toBe(false);
    expect(calls.rpc).toHaveLength(1);
  });

  it("취소: 이유 필요, DB 오류는 한국어 문구와 코드로", async () => {
    expect((await voidChannelPublication("p1", { reason: " " })).ok).toBe(false);
    expect(calls.rpc).toHaveLength(0);
    expect(await voidChannelPublication("p1", { reason: " 오타 " })).toEqual({ ok: true, data: { voidId: "new-id" } });
    expect(calls.rpc[0]!.args).toEqual({ p_publication_id: "p1", p_reason: "오타" });
    ROWS.rpcError = { code: "P0001", message: "INVALID_TRANSITION: 이미 취소한 게시 기록입니다" };
    expect(await voidChannelPublication("p1", { reason: "오타" })).toEqual({ ok: false, code: "INVALID_TRANSITION", message: "이미 취소한 게시 기록입니다" });
    ROWS.rpcError = { code: "P0002", message: "NOT_FOUND: 초안을 찾을 수 없습니다" };
    expect(await createChannelDraft("b1")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
