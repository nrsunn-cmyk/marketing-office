import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P3FG-BACKEND-IMPL-01: 검수·납품 서버 함수와 납품 목록 경로 처리기 단위 시험. DB 는 흉내(규칙 자체는 tests/db/p3fg-qa-delivery.test.ts).
 */
const S = vi.hoisted(() => ({ rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>, queries: [] as Array<{ table: string; ops: string[] }>, rows: {} as Record<string, unknown[]> }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "w1" }, user: { userId: "me", email: "me@example.test" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const q = { table, ops: [] as string[] };
      S.queries.push(q);
      const f: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      const rows = () => ((S.rows[table] ?? []) as Record<string, unknown>[]).filter((r) => f.every(([k, v]) => k === "workspace_id" || !(k in r) || r[k] === v) && ins.every(([k, vs]) => vs.includes(r[k])));
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "order"])
        chain[op] = (...a: unknown[]) => {
          q.ops.push(`${op}(${a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(",")})`);
          if (op === "eq") f.push([String(a[0]), a[1]]);
          if (op === "in") ins.push([String(a[0]), a[1] as unknown[]]);
          return chain;
        };
      chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
      chain.then = (res: (v: unknown) => unknown) => res({ data: rows(), error: null });
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      S.rpc.push({ fn, args });
      return { data: 3, error: null };
    },
  }),
}));

import { GET } from "@/app/delivery-bundles/[bundleId]/manifest/route";
import { addDeliveryLog, getDeliveryBundleFor, getQaChecklistFor, setQaItem } from "./server";

const D = "11111111-1111-4111-8111-111111111111";
const base = () => ({
  production_briefs: [{ id: "b1", project_id: "p1", title: "봄", revision: 2, status: "ready", archived_at: null, production_brief_id: undefined }],
  projects: [{ id: "p1", status: "active" }],
  web_copy_docs: [],
  video_plans: [],
  design_assets: [
    { id: "a1", title: "로고", status: "reviewed", current_version_no: 2, archived_at: null, production_brief_id: "b1", project_id: "p1" },
    { id: "a2", title: "배경", status: "drafting", current_version_no: 1, archived_at: null, production_brief_id: "b1", project_id: "p1" },
  ],
  ppt_decks: [{ id: "d1", title: "제안서", status: "reviewed", current_version_no: 3, archived_at: null, production_brief_id: "b1", project_id: "p1" }],
  qa_reviews: [
    { id: "r1", target_kind: "ppt_deck", target_id: "d1", ppt_deck_version_id: "v2", target_version_no: 2, round_no: 1, status: "reviewed", archived_at: null, approved_at: "2026-11-20T04:00:00Z", revision: 5, created_at: "t", updated_at: "t", project_id: "p1" },
    { id: "r2", target_kind: "design_assets", target_id: "a1", design_asset_version_id: "av2", target_version_no: 2, round_no: 1, status: "drafting", archived_at: null, approved_at: null, revision: 2, created_at: "t", updated_at: "t", project_id: "p1" },
  ],
  qa_check_items: [
    { id: "i1", review_id: "r2", sort_order: 1, item_title: "필수", is_required: true, is_default: true, verdict: "passed", memo: null, checked_by: "me", checked_at: "t" },
    { id: "i2", review_id: "r2", sort_order: 2, item_title: "필수2", is_required: true, is_default: true, verdict: "pending", memo: null, checked_by: null, checked_at: null },
    { id: "i3", review_id: "r2", sort_order: 3, item_title: "선택", is_required: false, is_default: false, verdict: "needs_fix", memo: "고침", checked_by: "other", checked_at: "t" },
  ],
  delivery_bundles: [],
  delivery_bundle_items: [],
  delivery_logs: [],
});
beforeEach(() => Object.assign(S, { rpc: [], queries: [], rows: base() }));

describe("검수 읽기", () => {
  it("자산은 자산마다 대상, 게이트는 실제 개수(필수 1/2, 선택 보완 1)·막힘 원인, 검수자는 나/구성원, 이전 기준", async () => {
    const r = await getQaChecklistFor("b1");
    if (!r.ok) throw new Error(r.message);
    for (const q of S.queries) expect(q.ops, q.table).toContain("eq(workspace_id,w1)");
    const kinds = r.data.targets.map((t) => [t.kind, t.targetId, t.exists]);
    expect(kinds).toEqual([["web_copy", null, false], ["design_assets", "a1", true], ["design_assets", "a2", true], ["video_plan", null, false], ["ppt_deck", "d1", true]]);
    const a1 = r.data.targets[1];
    expect(a1.canOpen).toBe(false); // 열린 회차 있음
    expect(a1.rounds[0].gate).toEqual({ requiredTotal: 2, requiredPassed: 1, optionalNeedsFix: 1, blockedBy: "pending" });
    expect(a1.rounds[0].items.map((x) => x.checkedByName)).toEqual(["나", null, "구성원"]);
    expect(r.data.targets[2]).toMatchObject({ baseNotReady: true, canOpen: false });
    const d1 = r.data.targets[4];
    expect(d1.rounds[0]).toMatchObject({ status: "reviewed", stale: true, targetVersionNo: 2, targetVersionId: "v2" });
    expect(d1.canOpen).toBe(true); // 승인 뒤 새 판 → 새 회차 열 수 있음
  });
});

describe("납품 읽기", () => {
  it("포함 = 확정 브리프 + 승인본(승인 뒤 새 판이면 승인 판 + 안내), 제외 = 사유 코드, 묶음 만들 수 있음", async () => {
    const r = await getDeliveryBundleFor("b1");
    if (!r.ok) throw new Error(r.message);
    expect(r.data.included.map((x) => [x.kind, x.targetId, x.versionNo, x.qaRoundNo, x.detail])).toEqual([
      ["production_brief", "b1", 2, null, null],
      ["ppt_deck", "d1", 2, 1, "이후 새 판 v3 있음(재검수 필요)"],
    ]);
    expect(r.data.excluded.map((x) => [x.targetId, x.reasonCode])).toEqual([["a1", "qa_open"], ["a2", "not_reviewed"]]);
    expect(r.data).toMatchObject({ canCreate: true, createBlockedCode: null, stale: false, baseArchived: false });
  });
});

describe("쓰기 입력 검사", () => {
  it("보완 필요 메모 없음·제어 문자·미래 형식 아닌 시각은 RPC 전에 거절, 정상은 정리해서", async () => {
    expect(await setQaItem("r2", 2, { itemId: D, verdict: "needs_fix", memo: " " })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await addDeliveryLog("x", 1, { method: "fax", deliveredAt: "2026-11-20T05:00:00+09:00", note: null })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(S.rpc).toEqual([]);
    expect(await setQaItem("r2", 2, { itemId: D, verdict: "passed", memo: " 확인 " })).toEqual({ ok: true, data: { revision: 3 } });
    expect(S.rpc[0]).toEqual({ fn: "set_qa_item", args: { p_review_id: "r2", p_expected_revision: 2, p_item_id: D, p_verdict: "passed", p_memo: "확인" } });
  });
});

describe("납품 목록 경로 처리기", () => {
  const call = (id: string) => GET(new Request(`http://localhost/delivery-bundles/${id}/manifest`), { params: Promise.resolve({ bundleId: id }) } as never);
  it("본인 묶음은 .md(첨부·no-store), 틀린 id·남의 것·없는 것은 같은 404", async () => {
    S.rows.delivery_bundles = [{ id: D, bundle_no: 2, status: "reviewed", archived_at: "t", created_at: "2026-11-20T03:00:00Z", restored_from_id: null }];
    S.rows.delivery_bundle_items = [{ bundle_id: D, sort_order: 1, kind: "ppt_deck", ppt_deck_id: "d1", version_no: 2, qa_review_id: "r1", content_sha256: "c".repeat(64) }];
    const r = await call(D);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toBe(`attachment; filename="delivery-v1.1.md"; filename*=UTF-8''${encodeURIComponent("납품묶음-v1.1.md")}`);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const md = await r.text();
    expect(md).toMatch(/^# 납품 묶음 v1\.1\n/);
    expect(md).toContain("| 1 | PPT | 제안서 | v2 | 1회차 통과 |");
    expect(md).toContain("[열기](/ppt-decks/d1/export?format=pptx&version=2)");
    for (const id of ["x", "22222222-2222-4222-8222-222222222222"]) expect((await call(id)).status).toBe(404);
  });
});
