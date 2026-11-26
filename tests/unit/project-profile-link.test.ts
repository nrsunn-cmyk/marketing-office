import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * linkLatestProfileToUnlinkedProjects(AUDIT-05 C1-2, PROJECT-PROFILE-LINK-BACKEND-01).
 * - 연결이 없는 고객 프로젝트에만 최신 판을 한 줄씩 넣는다. 이미 연결된 것은 그대로(R06)
 * - 프로필이 없으면 아무것도 넣지 않는다. 잘못된 id 는 DB 를 부르지 않는다
 * - 모든 읽기에 본인 업무실 조건을 건다
 */
const C = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333331";
const P2 = "33333333-3333-4333-8333-333333333332";
const P3 = "33333333-3333-4333-8333-333333333333";

const fake = {
  latest: { id: "v-9" } as { id: string } | null,
  projects: [{ id: P1 }, { id: P2 }, { id: P3 }] as Array<{ id: string }>,
  links: [{ project_id: P2 }] as Array<{ project_id: string }>,
  inserted: [] as Array<Record<string, unknown>>,
  filters: {} as Record<string, Array<[string, unknown]>>,
  insertError: null as { code: string; message: string } | null,
  calls: 0,
};

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "ws-1" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      fake.calls += 1;
      const f: Array<[string, unknown]> = (fake.filters[table] ??= []);
      const result = () =>
        table === "company_profile_versions"
          ? { data: fake.latest, error: null }
          : table === "projects"
            ? { data: fake.projects.filter((p) => f.every(([c, v]) => c !== "id" || v === p.id)), error: null }
            : { data: fake.links, error: null };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          f.push([c, v]);
          return q;
        },
        in: (c: string, v: unknown) => {
          f.push([c, v]);
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => result(),
        insert: async (rows: Array<Record<string, unknown>>) => {
          fake.inserted.push(...rows);
          return { error: fake.insertError };
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
      };
      return q;
    },
  }),
}));

const { linkLatestProfileToUnlinkedProjects } = await import("@/features/projects/server");

beforeEach(() => {
  Object.assign(fake, {
    latest: { id: "v-9" },
    projects: [{ id: P1 }, { id: P2 }, { id: P3 }],
    links: [{ project_id: P2 }],
    inserted: [],
    filters: {},
    insertError: null,
    calls: 0,
  });
});

describe("linkLatestProfileToUnlinkedProjects", () => {
  it("연결이 없는 프로젝트에만 최신 판을 넣고, 이미 연결된 것은 그대로 둔다", async () => {
    const r = await linkLatestProfileToUnlinkedProjects(C);
    expect(r).toEqual({ ok: true, data: { linked: 2, versionId: "v-9" } });
    expect(fake.inserted).toEqual([
      { workspace_id: "ws-1", project_id: P1, client_id: C, company_profile_version_id: "v-9" },
      { workspace_id: "ws-1", project_id: P3, client_id: C, company_profile_version_id: "v-9" },
    ]);
    // 모든 표에 본인 업무실 조건, 프로젝트는 그 고객의 고객 프로젝트만
    for (const t of ["company_profile_versions", "projects", "project_profiles"]) expect(fake.filters[t], t).toContainEqual(["workspace_id", "ws-1"]);
    expect(fake.filters.projects).toEqual(expect.arrayContaining([["client_id", C], ["kind", "client"]]));
  });

  it("projectId 를 주면 그 한 건만 본다", async () => {
    const r = await linkLatestProfileToUnlinkedProjects(C, { projectId: P3 });
    expect(r).toEqual({ ok: true, data: { linked: 1, versionId: "v-9" } });
    expect(fake.inserted.map((x) => x.project_id)).toEqual([P3]);
    expect(await linkLatestProfileToUnlinkedProjects(C, { projectId: P2 })).toEqual({ ok: true, data: { linked: 0, versionId: "v-9" } });
  });

  it("프로필이 없으면 아무것도 넣지 않는다", async () => {
    fake.latest = null;
    expect(await linkLatestProfileToUnlinkedProjects(C)).toEqual({ ok: true, data: { linked: 0, versionId: null } });
    expect(fake.inserted).toEqual([]);
  });

  it("모두 연결돼 있으면 넣지 않는다", async () => {
    fake.links = [{ project_id: P1 }, { project_id: P2 }, { project_id: P3 }];
    expect(await linkLatestProfileToUnlinkedProjects(C)).toEqual({ ok: true, data: { linked: 0, versionId: "v-9" } });
    expect(fake.inserted).toEqual([]);
  });

  it("잘못된 id 는 DB 를 부르지 않는다", async () => {
    expect(await linkLatestProfileToUnlinkedProjects("abc")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await linkLatestProfileToUnlinkedProjects(C, { projectId: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(fake.calls).toBe(0);
  });

  it("넣기 실패의 원문은 내보내지 않는다", async () => {
    fake.insertError = { code: "23503", message: "insert or update on table project_profiles violates foreign key constraint" };
    const r = await linkLatestProfileToUnlinkedProjects(C);
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(JSON.stringify(r)).not.toContain("foreign key");
  });
});
