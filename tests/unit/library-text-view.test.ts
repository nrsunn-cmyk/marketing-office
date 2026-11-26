import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 메모 보기(AUDIT-05 C2, LIBRARY-TEXT-VIEW-BACKEND-01).
 * - 본인 업무실·그 id·메모 종류(text) 세 조건을 모두 걸어 읽는다
 * - 잘못된 id 는 DB 를 부르지 않고 NOT_FOUND, 없는 행도 NOT_FOUND
 * - DB 오류 원문은 화면에 내보내지 않는다
 */
const ID = "11111111-1111-4111-8111-111111111111";
const fake = {
  calls: 0,
  filters: [] as Array<[string, unknown]>,
  selected: "",
  row: null as Record<string, unknown> | null,
  error: null as { code: string; message: string } | null,
};

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "ws-1" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      fake.calls += 1;
      expect(table).toBe("source_assets");
      const q = {
        select: (cols: string) => {
          fake.selected = cols;
          return q;
        },
        eq: (c: string, v: unknown) => {
          fake.filters.push([c, v]);
          return q;
        },
        maybeSingle: async () => ({ data: fake.row, error: fake.error }),
      };
      return q;
    },
  }),
}));

const { getTextAsset } = await import("@/features/library/server");

beforeEach(() => {
  Object.assign(fake, { calls: 0, filters: [], selected: "", row: null, error: null });
});

describe("getTextAsset", () => {
  it("본인 업무실·id·메모 종류를 모두 걸어 본문을 돌려준다", async () => {
    fake.row = { id: ID, display_name: "회의 메모", text_content: "첫 줄\n둘째 줄", created_at: "2026-11-27T00:00:00Z" };
    const r = await getTextAsset(ID);
    expect(r).toEqual({ ok: true, data: { id: ID, title: "회의 메모", text: "첫 줄\n둘째 줄", created_at: "2026-11-27T00:00:00Z" } });
    expect(fake.filters).toEqual([
      ["workspace_id", "ws-1"],
      ["id", ID],
      ["kind", "text"],
    ]);
    expect(fake.selected).toContain("text_content");
  });

  it("잘못된 id 는 DB 를 부르지 않고 NOT_FOUND", async () => {
    for (const bad of ["", "abc", `${ID} `, "11111111-1111-4111-8111-11111111111g", `${ID}' or '1'='1`]) {
      const r = await getTextAsset(bad);
      expect(r, bad).toMatchObject({ ok: false, code: "NOT_FOUND" });
    }
    expect(fake.calls).toBe(0);
  });

  it("없는 행(다른 업무실·다른 종류 포함)은 NOT_FOUND", async () => {
    fake.row = null;
    expect(await getTextAsset(ID)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("DB 오류 원문은 내보내지 않는다", async () => {
    fake.error = { code: "42501", message: "permission denied for table source_assets" };
    const r = await getTextAsset(ID);
    expect(r).toMatchObject({ ok: false, code: "ERROR" });
    expect(JSON.stringify(r)).not.toContain("permission denied");
  });

  it("본문이 비어 있으면 빈 글자로 돌려준다", async () => {
    fake.row = { id: ID, display_name: null, text_content: null, created_at: "2026-11-27T00:00:00Z" };
    expect(await getTextAsset(ID)).toMatchObject({ ok: true, data: { title: null, text: "" } });
  });
});
