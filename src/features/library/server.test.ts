import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeCursor, PAGE_SIZE } from "@/domain/paging";

/**
 * UX-F1-RESULTS-BACKEND-01: /results 결과물 + 납품 묶음 목록 단위 시험(합성 데이터).
 * DB 는 흉내 — eq·is·in·not·or(커서)·order 2단·limit·count(head)를 흉내 낸다. 실제 정책(본인 업무실 select)은 각 표의 DB 시험 몫.
 */
type R = Record<string, unknown>;
const S = vi.hoisted(() => ({ rows: {} as Record<string, R[]>, fail: null as string | null, queries: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "w1" }, user: { userId: "me" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      S.queries.push(table);
      const f: Array<(r: R) => boolean> = [];
      let head = false;
      let lim = Infinity;
      const orders: Array<[string, boolean]> = [];
      const chain: R = {};
      chain.select = (_c: string, o?: { head?: boolean }) => ((head = !!o?.head), chain);
      chain.eq = (k: string, v: unknown) => (f.push((r) => r[k] === v), chain);
      chain.in = (k: string, vs: unknown[]) => (f.push((r) => vs.includes(r[k])), chain);
      chain.is = (k: string, v: unknown) => (f.push((r) => (r[k] ?? null) === v), chain);
      chain.not = (k: string, _op: string, v: unknown) => (f.push((r) => (r[k] ?? null) !== v), chain);
      chain.or = (expr: string) => {
        // afterCursor 형식: col.lt."AT",and(col.eq."AT",id.lt."ID")
        const m = /^(\w+)\.lt\."([^"]+)",and\(\w+\.eq\."[^"]+",id\.lt\."([^"]+)"\)$/.exec(expr);
        if (!m) throw new Error(`알 수 없는 or: ${expr}`);
        const [, col, at, id] = m;
        f.push((r) => String(r[col]) < at || (String(r[col]) === at && String(r.id) < id));
        return chain;
      };
      chain.order = (k: string, o: { ascending: boolean }) => (orders.push([k, o.ascending]), chain);
      chain.limit = (n: number) => ((lim = n), chain);
      chain.then = (res: (v: unknown) => unknown) => {
        if (S.fail === table) return res({ data: null, count: null, error: { code: "XX", message: "x" } });
        let rows = (S.rows[table] ?? []).filter((r) => f.every((p) => p(r)));
        rows = [...rows].sort((a, b) => {
          for (const [k, asc] of orders) {
            if (a[k] === b[k]) continue;
            return (String(a[k]) < String(b[k]) ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        });
        rows = rows.slice(0, lim);
        return res(head ? { data: null, count: rows.length, error: null } : { data: rows, count: null, error: null });
      };
      return chain;
    },
  }),
}));

import { listResultEntries, listResults, microsOf, type DeliveryBundleResultItem, type ResultEntry } from "./server";

const P1 = "10000000-0000-4000-8000-000000000001";
const P2 = "10000000-0000-4000-8000-000000000002";
const P3 = "10000000-0000-4000-8000-000000000003";
const uid = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// 마이크로초 6자리 시각(DB 형식). 같은 초 안에서 마이크로초만 다른 행을 일부러 만든다
const ts = (sec: number, micro = 0) => `2026-11-${String(10 + Math.floor(sec / 86400)).padStart(2, "0")}T00:00:${String(sec % 60).padStart(2, "0")}.${String(micro).padStart(6, "0")}+00:00`;
const proj = (title: string, client: string | null) => ({ title, clients: client ? { name: client } : null });

function artifact(n: number, at: string, o: R = {}): R {
  return {
    id: uid("a", n), workspace_id: "w1", type: "strategy", task_id: uid("c", n), project_id: P1, updated_at: at,
    approved_version_id: null, tasks: { status: "review" }, projects: proj("합성 프로젝트", "가상고객"),
    current: { version: 2 }, approved: null, ...o,
  };
}
function bundle(n: number, at: string, o: R = {}): R {
  return {
    id: uid("b", n), workspace_id: "w1", project_id: P1, bundle_no: n, status: "drafting", item_count: 3, restored_from_id: null,
    archived_at: null, created_at: at, updated_at: at, projects: proj("합성 프로젝트", "가상고객"), ...o,
  };
}
const task = (id: string, project: string, status: string, at: string, o: R = {}): R => ({
  id, workspace_id: "w1", project_id: project, type: "strategy", status, updated_at: at, ...o,
});

beforeEach(() => {
  S.fail = null;
  S.queries = [];
  S.rows = { artifacts: [], delivery_bundles: [], tasks: [] };
});

async function walk(opts: Parameters<typeof listResultEntries>[0] = {}): Promise<{ ids: string[]; totals: number[]; pages: number }> {
  const ids: string[] = [];
  const totals: number[] = [];
  let cursor = null;
  let pages = 0;
  do {
    const p = await listResultEntries({ ...opts, cursor });
    pages++;
    ids.push(...p.items.map((i) => i.id));
    totals.push(p.total);
    cursor = p.nextCursor ? decodeCursor(p.nextCursor) : null;
    if (p.nextCursor) expect(cursor).not.toBeNull();
  } while (cursor && pages < 20);
  return { ids, totals, pages };
}

describe("listResultEntries — 섞기·커서·총계", () => {
  it("결과물과 납품 묶음을 (updated_at desc, id desc) 한 순서로 섞고 kind 로 구분한다", async () => {
    S.rows.artifacts = [artifact(1, ts(10)), artifact(2, ts(30))];
    S.rows.delivery_bundles = [bundle(1, ts(20)), bundle(2, ts(40))];
    const p = await listResultEntries();
    expect(p.items.map((i) => [i.kind, i.id])).toEqual([
      ["delivery_bundle", uid("b", 2)],
      ["artifact", uid("a", 2)],
      ["delivery_bundle", uid("b", 1)],
      ["artifact", uid("a", 1)],
    ]);
    expect(p.total).toBe(4);
    expect(p.nextCursor).toBeNull();
    const a = p.items[1] as Extract<ResultEntry, { kind: "artifact" }>;
    expect(a).toMatchObject({ type: "strategy", task_status: "review", project_title: "합성 프로젝트", client_name: "가상고객", current_version: 2, approved_version: null });
  });

  it("쪽 넘김: 결과물 60 + 묶음 45(같은 시각·마이크로초만 다른 행 포함)를 빠짐·겹침 없이 모두 돌고 총계는 매 쪽 105", async () => {
    // 같은 초 안에서 마이크로초만 다른 행 + 완전히 같은 시각 행(→ id 로 순서)을 섞는다
    S.rows.artifacts = Array.from({ length: 60 }, (_, i) => artifact(i + 1, ts(Math.floor(i / 3), (2 - (i % 3)) * 7)));
    S.rows.delivery_bundles = Array.from({ length: 45 }, (_, i) => bundle(i + 1, ts(Math.floor(i / 3), (2 - (i % 3)) * 7)));
    const { ids, totals, pages } = await walk();
    expect(pages).toBe(3);
    expect(new Set(ids).size).toBe(105);
    expect(ids).toHaveLength(105);
    expect(totals).toEqual([105, 105, 105]);
    // 돌려준 순서 = 전체를 (시각 desc, id desc)로 정렬한 순서
    const all = [...S.rows.artifacts!, ...S.rows.delivery_bundles!]
      .sort((x, y) => (x.updated_at === y.updated_at ? (String(x.id) < String(y.id) ? 1 : -1) : String(x.updated_at) < String(y.updated_at) ? 1 : -1))
      .map((r) => r.id);
    expect(ids).toEqual(all);
  });

  it("결과물만 51개 이상이고 묶음이 없을 때도 다음 쪽이 있다", async () => {
    S.rows.artifacts = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => artifact(i + 1, ts(i)));
    const first = await listResultEntries();
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const { ids } = await walk();
    expect(ids).toHaveLength(PAGE_SIZE + 1);
  });

  it("마이크로초 비교: 밀리초가 같고 마이크로초만 다른 시각의 순서를 지킨다", () => {
    expect(microsOf("2026-11-10T00:00:01.000002+00:00")).toBeGreaterThan(microsOf("2026-11-10T00:00:01.000001+00:00"));
    expect(microsOf("2026-11-10T09:00:01+09:00")).toBe(microsOf("2026-11-10T00:00:01.000000+00:00"));
  });
});

describe("listResultEntries — 범위·필터", () => {
  it("다른 업무실·보관한 묶음은 빠지고 총계에도 들어가지 않는다", async () => {
    S.rows.artifacts = [artifact(1, ts(1)), artifact(2, ts(2), { workspace_id: "w2" })];
    S.rows.delivery_bundles = [bundle(1, ts(3)), bundle(2, ts(4), { archived_at: ts(5) }), bundle(3, ts(6), { workspace_id: "w2" })];
    const p = await listResultEntries();
    expect(p.items.map((i) => i.id)).toEqual([uid("b", 1), uid("a", 1)]);
    expect(p.total).toBe(2);
  });

  it("type=delivery_bundle 은 묶음만(결과물 표를 읽지 않음), type=quote 는 결과물만(묶음 표를 읽지 않음)", async () => {
    S.rows.artifacts = [artifact(1, ts(1), { type: "quote" }), artifact(2, ts(2))];
    S.rows.delivery_bundles = [bundle(1, ts(3))];
    const b = await listResultEntries({ type: "delivery_bundle" });
    expect(b.items.map((i) => i.kind)).toEqual(["delivery_bundle"]);
    expect(b.total).toBe(1);
    expect(S.queries).not.toContain("artifacts");

    S.queries = [];
    const q = await listResultEntries({ type: "quote" });
    expect(q.items.map((i) => i.id)).toEqual([uid("a", 1)]);
    expect(q.total).toBe(1);
    expect(S.queries).not.toContain("delivery_bundles");
  });

  it("approvedOnly: 결과물은 승인본 있는 것, 묶음은 검토 완료(reviewed)만", async () => {
    S.rows.artifacts = [artifact(1, ts(1), { approved_version_id: "v", approved: { version: 1 } }), artifact(2, ts(2))];
    S.rows.delivery_bundles = [bundle(1, ts(3), { status: "reviewed" }), bundle(2, ts(4))];
    const p = await listResultEntries({ approvedOnly: true });
    expect(p.items.map((i) => i.id)).toEqual([uid("b", 1), uid("a", 1)]);
    expect(p.total).toBe(2);
  });

  it("조회 오류는 감추지 않고 throw 한다", async () => {
    S.fail = "delivery_bundles";
    await expect(listResultEntries()).rejects.toThrow(/결과물을 불러오지 못했습니다/);
  });
});

describe("listResultEntries — 링크·복구 표시", () => {
  it("같은 프로젝트 strategy 작업: 취소 아닌 것 → 최신 순, 취소뿐이면 그것, 없으면 null", async () => {
    S.rows.delivery_bundles = [bundle(1, ts(1)), bundle(2, ts(2), { project_id: P2 }), bundle(3, ts(3), { project_id: P3 })];
    S.rows.tasks = [
      task(uid("d", 1), P1, "approved", ts(1)),
      task(uid("d", 2), P1, "cancelled", ts(9)),          // 더 최신이지만 취소
      task(uid("d", 3), P1, "review", ts(5)),             // 취소 아닌 것 중 최신 → 선택
      task(uid("d", 4), P1, "review", ts(8), { type: "logo_brief" }), // 다른 종류
      task(uid("d", 5), P1, "review", ts(9), { workspace_id: "w2" }), // 다른 업무실
      task(uid("d", 6), P2, "cancelled", ts(2)),          // 취소뿐 → 그것
    ];
    const p = await listResultEntries({ type: "delivery_bundle" });
    const byId = new Map(p.items.map((i) => [i.id, i as DeliveryBundleResultItem]));
    expect(byId.get(uid("b", 1))).toMatchObject({ task_id: uid("d", 3), href: `/tasks/${uid("d", 3)}#delivery-bundle` });
    expect(byId.get(uid("b", 2))).toMatchObject({ task_id: uid("d", 6), href: `/tasks/${uid("d", 6)}#delivery-bundle` });
    expect(byId.get(uid("b", 3))).toMatchObject({ task_id: null, href: null });
  });

  it("묶음 필드와 복구 원본 번호(보관된 원본이어도 번호는 보인다), 내부용 필드는 새지 않는다", async () => {
    S.rows.delivery_bundles = [
      bundle(1, ts(1), { archived_at: ts(2) }),
      bundle(2, ts(3), { status: "reviewed", item_count: 7, restored_from_id: uid("b", 1), projects: proj("합성 납품", null) }),
    ];
    const p = await listResultEntries();
    expect(p.items).toHaveLength(1);
    const b = p.items[0] as DeliveryBundleResultItem;
    expect(b).toEqual({
      kind: "delivery_bundle", id: uid("b", 2), type: "delivery_bundle", project_id: P1, project_title: "합성 납품", client_name: null,
      bundle_no: 2, status: "reviewed", item_count: 7, restored_from_bundle_no: 1, created_at: ts(3), updated_at: ts(3), task_id: null, href: null,
    });
  });
});

describe("listResults(기존) — 그대로", () => {
  it("결과물만, kind 없이, 기존 필드·총계·커서 그대로", async () => {
    S.rows.artifacts = Array.from({ length: PAGE_SIZE + 2 }, (_, i) => artifact(i + 1, ts(i)));
    S.rows.delivery_bundles = [bundle(1, ts(100))];
    const p = await listResults();
    expect(p.items).toHaveLength(PAGE_SIZE);
    expect(p.total).toBe(PAGE_SIZE + 2);
    expect(p.nextCursor).not.toBeNull();
    expect(p.items[0]).not.toHaveProperty("kind");
    expect(Object.keys(p.items[0]!).sort()).toEqual(
      ["approved_version", "client_name", "current_version", "id", "project_id", "project_title", "task_id", "task_status", "type", "updated_at"].sort(),
    );
    expect(S.queries).not.toContain("delivery_bundles");
  });
});
