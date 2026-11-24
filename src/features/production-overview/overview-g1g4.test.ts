import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UX-G1-G4-BACKEND-01: 현황 G1(대기 프로젝트 바로가기)·G4(CRM 후속 기한) 읽기 단위 시험.
 * DB 는 흉내 — eq·in·is·lte·order 거르기를 흉내 내고, 부른 표와 고른 칸을 기록한다(개인정보 칸·문의 표를 부르지 않는지).
 * 실제 정책(본인 업무실 select)·열 권한은 tests/db/overview-g1g4.test.ts 가 확인한다.
 */
const S = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  fail: null as string | null,
  calls: [] as Array<{ table: string; cols: string }>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "w1" }, user: { userId: "me" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const f: Array<(r: Record<string, unknown>) => boolean> = [];
      let order: [string, boolean] | null = null;
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => (S.calls.push({ table, cols }), chain);
      chain.eq = (k: string, v: unknown) => (f.push((r) => r[k] === v), chain);
      chain.in = (k: string, vs: unknown[]) => (f.push((r) => vs.includes(r[k])), chain);
      chain.is = (k: string, v: unknown) => (f.push((r) => (r[k] ?? null) === v), chain);
      chain.lte = (k: string, v: string) => (f.push((r) => String(r[k]) <= v), chain);
      chain.order = (k: string, o: { ascending: boolean }) => ((order = [k, o.ascending]), chain);
      chain.then = (res: (v: unknown) => unknown) => {
        if (S.fail === table) return res({ data: null, error: { code: "XX", message: "x" } });
        let rows = (S.rows[table] ?? []).filter((r) => f.every((p) => p(r)));
        if (order) {
          const [k, asc] = order;
          rows = [...rows].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : 1) * (asc ? 1 : -1));
        }
        // 고른 칸만 돌려준다(흉내가 다른 칸을 새어 내지 않게)
        const cols = S.calls.filter((c) => c.table === table).at(-1)!.cols.split(",").map((c) => c.trim());
        return res({ data: rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), error: null });
      };
      return chain;
    },
  }),
}));

import { getOverviewCrmFollowups, getOverviewWaitingProjects } from "./server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D, E, ARCH, OTHER] = [1, 2, 3, 4, 5, 6, 7].map(id);
const proj = (pid: string, title: string, status = "active", ws = "w1") => ({ id: pid, title, status, workspace_id: ws });
const row = (o: Record<string, unknown>) => ({ workspace_id: "w1", archived_at: null, ...o });

beforeEach(() => {
  S.fail = null;
  S.calls = [];
  S.rows = {
    projects: [proj(A, "가 프로젝트"), proj(B, "나 프로젝트"), proj(C, "다 프로젝트"), proj(D, "라 프로젝트"), proj(E, "마 프로젝트"), proj(ARCH, "보관됨", "archived"), proj(OTHER, "남의 것", "active", "w2")],
    qa_reviews: [
      row({ project_id: A, status: "drafting" }), row({ project_id: A, status: "fix_requested" }), row({ project_id: A, status: "reviewed" }),
      row({ project_id: B, status: "drafting" }), row({ project_id: B, status: "drafting", archived_at: "t" }),
      row({ project_id: C, status: "drafting" }), row({ project_id: C, status: "drafting" }),
      row({ project_id: D, status: "drafting" }),
      row({ project_id: ARCH, status: "drafting" }), row({ project_id: ARCH, status: "drafting" }), row({ project_id: ARCH, status: "drafting" }),
      row({ project_id: OTHER, status: "drafting", workspace_id: "w2" }),
    ],
    execution_jobs: [row({ project_id: B, status: "pending_approval" }), row({ project_id: B, status: "queued" }), row({ project_id: E, status: "pending_approval", archived_at: "t" })],
    tasks: [
      row({ id: "t-a-old", project_id: A, type: "strategy", updated_at: "2026-11-01" }), row({ id: "t-a-new", project_id: A, type: "strategy", updated_at: "2026-11-20" }),
      row({ id: "t-a-logo", project_id: A, type: "logo_brief", updated_at: "2026-11-23" }), row({ id: "t-c", project_id: C, type: "strategy", updated_at: "2026-11-10" }),
    ],
    crm_followups: [
      row({ project_id: A, due_date: "2026-11-20", status: "todo", assignee_name: "담당", inquiry_id: "q1" }), // 지남
      row({ project_id: A, due_date: "2026-11-28", status: "in_progress" }),
      row({ project_id: B, due_date: "2026-12-01", status: "todo" }), // today+7 = 12-01 경계 포함
      row({ project_id: B, due_date: "2026-12-02", status: "todo" }), // 범위 밖
      row({ project_id: C, due_date: "2026-11-24", status: "todo" }), // 오늘
      row({ project_id: C, due_date: "2026-11-10", status: "done" }), // 완료 제외
      row({ project_id: D, due_date: "2026-11-23", status: "hold" }), // 보류 제외
      row({ project_id: D, due_date: "2026-11-23", status: "todo", archived_at: "t" }), // 보관 행 제외
      row({ project_id: E, due_date: "2026-11-30", status: "todo" }),
      row({ project_id: ARCH, due_date: "2026-11-01", status: "todo" }), // 보관 프로젝트 제외
      row({ project_id: OTHER, due_date: "2026-11-01", status: "todo", workspace_id: "w2" }),
    ],
  };
});

describe("getOverviewWaitingProjects (G1)", () => {
  it("건수 많은 순 최대 3개, 보관·남의 업무실·보관 행 제외, 링크는 최근 전략 작업(없으면 프로젝트)", async () => {
    const r = await getOverviewWaitingProjects();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.qa).toEqual({
      projects: [
        { projectId: A, projectName: "가 프로젝트", count: 2, targetHref: "/tasks/t-a-new#qa-checklist" },
        { projectId: C, projectName: "다 프로젝트", count: 2, targetHref: "/tasks/t-c#qa-checklist" },
        { projectId: B, projectName: "나 프로젝트", count: 1, targetHref: `/projects/${B}` },
      ],
      totalProjectCount: 4, // A·B·C·D (보관 ARCH·남의 OTHER 제외)
    });
    expect(r.data.execution).toEqual({
      projects: [{ projectId: B, projectName: "나 프로젝트", count: 1, targetHref: `/projects/${B}/execution#queue` }],
      totalProjectCount: 1,
    });
  });

  it("대기 0이면 빈 목록, 프로젝트·작업 표를 부르지 않는다", async () => {
    S.rows.qa_reviews = [];
    S.rows.execution_jobs = [];
    const r = await getOverviewWaitingProjects();
    expect(r).toEqual({ ok: true, data: { qa: { projects: [], totalProjectCount: 0 }, execution: { projects: [], totalProjectCount: 0 } } });
    expect(S.calls.map((c) => c.table)).toEqual(["qa_reviews", "execution_jobs"]);
  });

  it("읽기 실패는 0 이 아니라 오류", async () => {
    for (const t of ["qa_reviews", "execution_jobs", "projects", "tasks"]) {
      S.fail = t;
      expect(await getOverviewWaitingProjects()).toMatchObject({ ok: false, code: "ERROR" });
    }
  });
});

describe("getOverviewCrmFollowups (G4)", () => {
  it("지남+오늘~7일(경계 포함), 열린 건만, 보관 프로젝트·행·남의 업무실 제외, 빠른 기한 순 최대 3개", async () => {
    const r = await getOverviewCrmFollowups("2026-11-24");
    expect(r).toEqual({
      ok: true,
      data: {
        totalDueWithin7Days: 5, // A 2 · B 1 · C 1 · E 1
        overdueCount: 1, // A 11-20 (오늘 11-24 은 지남이 아님)
        projects: [
          { projectId: A, projectName: "가 프로젝트", count: 2, earliestDueDate: "2026-11-20", targetHref: `/projects/${A}/execution#p4b-ops` },
          { projectId: C, projectName: "다 프로젝트", count: 1, earliestDueDate: "2026-11-24", targetHref: `/projects/${C}/execution#p4b-ops` },
          { projectId: E, projectName: "마 프로젝트", count: 1, earliestDueDate: "2026-11-30", targetHref: `/projects/${E}/execution#p4b-ops` },
        ],
        totalProjectCount: 4,
      },
    });
  });

  it("개인정보 칸·문의 표는 부르지 않는다(후속은 project_id·due_date 만, 프로젝트는 id·title·status 만)", async () => {
    await getOverviewCrmFollowups("2026-11-24");
    await getOverviewWaitingProjects();
    const tables = new Set(S.calls.map((c) => c.table));
    expect(tables.has("inquiries")).toBe(false);
    expect(S.calls.find((c) => c.table === "crm_followups")!.cols).toBe("project_id, due_date");
    for (const c of S.calls) expect(c.cols).not.toMatch(/name|phone|email|assignee|inquiry|message|\*/);
  });

  it("0건이면 0, 날짜 형식이 틀리면 DB 를 부르지 않고 VALIDATION, 읽기 실패는 오류", async () => {
    S.rows.crm_followups = [];
    expect(await getOverviewCrmFollowups("2026-11-24")).toEqual({ ok: true, data: { totalDueWithin7Days: 0, overdueCount: 0, projects: [], totalProjectCount: 0 } });
    S.calls = [];
    for (const bad of ["", "2026-11-24T00:00", "2026-13-40", "24-11-2026"]) expect(await getOverviewCrmFollowups(bad)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(S.calls).toHaveLength(0);
    S.rows.crm_followups = [row({ project_id: A, due_date: "2026-11-25", status: "todo" })];
    for (const t of ["crm_followups", "projects"]) {
      S.fail = t;
      expect(await getOverviewCrmFollowups("2026-11-24")).toMatchObject({ ok: false, code: "ERROR" });
    }
  });

  it("월말·연말 경계: 12-28 의 7일 뒤는 다음 해 01-04", async () => {
    S.rows.crm_followups = [
      row({ project_id: A, due_date: "2027-01-04", status: "todo" }),
      row({ project_id: B, due_date: "2027-01-05", status: "todo" }),
    ];
    const r = await getOverviewCrmFollowups("2026-12-28");
    expect(r.ok && r.data.projects.map((p) => p.projectId)).toEqual([A]);
  });
});
