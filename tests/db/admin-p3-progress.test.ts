/**
 * ADMIN-P3-01: 관리자 P3 제작 진행 현황 RPC(20261121003000_admin_p3_progress) 시험.
 * 관리자만, 개수·상태·시각만(사용자 글 0바이트), 구현된 단계(P3-a·P3-b)만 실제 개수, 열람 기록 1행. 모든 값은 합성이다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft } from "@/domain/strategy";
import { asUser, createDb, expectDbError, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let admin: Fixture;
let a: Fixture;
let strategyTpl: string;

beforeAll(async () => {
  db = await createDb();
  admin = await seedOwner(db, "p3admin-admin@example.test");
  a = await seedOwner(db, "p3admin-owner@example.test");
  await db.query("insert into app.admins (user_id, note) values ($1, '합성 관리자')", [admin.userId]);
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
  await asUser(db, a.userId, (tx) =>
    tx.query("select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))", [a.profileA1]),
  );
}, 60_000);

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, admin.userId, fn);

async function strategy(f: Fixture) {
  return asUser(db, f.userId, async (tx) => {
    const taskId = (await one<{ id: string }>(tx, "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id", [f.workspaceId, f.projectA, strategyTpl, newKey()])).id;
    const input = {
      templateVersion: STRATEGY_TEMPLATE_VERSION,
      projectId: f.projectA,
      profile: { id: f.profileA1, version: 1, projectId: f.projectA, clientId: f.clientA, projectKind: "client" },
      sections: { goals: { facts: [{ text: "합성 목표", sources: [{ kind: "profile", profileId: f.profileA1, version: 1 }] }], inferences: [] }, offers: { facts: [], inferences: [{ text: "합성 제안" }] } },
      unknowns: [],
    };
    const d = buildStrategyDraft(input);
    if (!d.ok) throw new Error("계약 실패");
    const g = await one<{ artifact_id: string; version_id: string }>(tx, "select * from generate_strategy($1, $2, $3, $4, $5)", [taskId, newKey(), f.profileA1, JSON.stringify(input), JSON.stringify(d.result)]);
    await tx.query("select decide_version($1, $2, 'approved', null)", [g.artifact_id, g.version_id]);
    return { artifactId: g.artifact_id, content: d.result as unknown as { facts: { text: string }[] } };
  });
}

type Row = Record<string, unknown>;
const progress = (tx: Tx, limit = 200) => tx.query<Row>("select * from admin_p3_progress($1)", [limit]).then((r) => r.rows);

describe("admin_p3_progress", () => {
  it("관리자 아니면 FORBIDDEN, 개수 범위 밖은 VALIDATION, P3 를 시작하지 않은 업무실은 나오지 않음", async () => {
    await expectDbError(asA((tx) => progress(tx)), /FORBIDDEN: 관리자만/);
    await expectDbError(asUser(db, null, (tx) => progress(tx)), /permission denied/);
    await expectDbError(asAdmin((tx) => progress(tx, 0)), /VALIDATION/);
    expect(await asAdmin((tx) => progress(tx))).toEqual([]);
  });

  it("구현된 단계 개수·막힌 곳·최근 활동만, 사용자 글 0바이트, 열람 기록 1행", async () => {
    const s = await strategy(a);
    const SECRET = "비밀제목-XYZ";
    const mk = (title: string) =>
      asA((tx) => one<{ id: string }>(tx, "select create_production_brief($1, $2, $3, '대상 비밀', '메시지 비밀', array['web_copy'], '범위 비밀') as id", [a.projectA, s.artifactId, title]).then((r) => r.id));
    const b1 = await mk(SECRET);
    await mk("둘째"); // 작성 중으로 남는 브리프
    const b3 = await mk("셋째");
    await asA((tx) => tx.query("select update_production_brief($1, 1, $2, '대상 비밀', '메시지 비밀', array['web_copy'], '범위 비밀', null, null, 'ready')", [b1, SECRET]));
    await asA((tx) => tx.query("select archive_production_brief($1, 1)", [b3]));
    const doc = await asA((tx) => one<{ id: string }>(tx, "select create_web_copy_doc($1) as id", [b1]).then((r) => r.id));
    // 브리프를 고치면 홈페이지 문서는 '이전 브리프 기준'(막힌 곳 1)
    await asA((tx) => tx.query("select update_production_brief($1, 2, $2, '대상 비밀2', '메시지 비밀', array['web_copy'], '범위 비밀', null, null, 'ready')", [b1, SECRET]));
    // 전략 새 판 승인 → 브리프 2개 모두 '이전 전략 기준'
    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [s.artifactId])).revision;
    await asA(async (tx) => {
      const v = await one<{ version_id: string }>(tx, "select * from save_strategy_manual_version($1, $2, $3)", [s.artifactId, rev, JSON.stringify({ ...s.content, facts: s.content.facts.map((f) => ({ ...f, text: `${f.text} v2` })) })]);
      await tx.query("select decide_version($1, $2, 'approved', null)", [s.artifactId, v.version_id]);
    });

    const log0 = (await one<{ n: number }>(db, "select count(*)::int as n from admin_access_log where rpc = 'admin_p3_progress'")).n;
    const rows = await asAdmin((tx) => progress(tx));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspace_id: a.workspaceId, project_id: a.projectA, owner_email: "p3admin-owner@example.test",
      briefs_drafting: 1, briefs_ready: 1, briefs_archived: 1,
      web_docs_drafting: 1, web_docs_reviewed: 0, web_docs_archived: 0, web_versions: 1,
      stale_briefs: 2, stale_web_docs: 1, brief_limit_reached: false, web_version_limit_reached: 0, pending_approvals: null,
    });
    expect(rows[0].last_activity_at).not.toBeNull();
    // 돌려주는 칸은 정해진 것뿐이고, 사용자 글(제목·대상·메시지·범위·홈페이지 문구)은 0바이트
    expect(Object.keys(rows[0]).sort()).toEqual(
      ["workspace_id", "workspace_name", "owner_email", "project_id", "briefs_drafting", "briefs_ready", "briefs_archived", "web_docs_drafting", "web_docs_reviewed", "web_docs_archived", "web_versions", "stale_briefs", "stale_web_docs", "brief_limit_reached", "web_version_limit_reached", "pending_approvals", "last_activity_at"].sort(),
    );
    expect(JSON.stringify(rows)).not.toMatch(/비밀|직접 입력|둘째|셋째|A 로고|B 견적/);
    expect((await one<{ n: number }>(db, "select count(*)::int as n from admin_access_log where rpc = 'admin_p3_progress'")).n).toBe(log0 + 1);
    expect(doc).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("한도: 보관 안 된 브리프 10개면 brief_limit_reached", async () => {
    const c = await seedOwner(db, "p3admin-owner-c@example.test");
    await asUser(db, c.userId, (tx) =>
      tx.query("select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))", [c.profileA1]),
    );
    const s = await strategy(c);
    for (let i = 0; i < 10; i++) await asUser(db, c.userId, (tx) => tx.query("select create_production_brief($1, $2, $3, 'x', 'x', array['ppt_deck'], 'x')", [c.projectA, s.artifactId, `b${i}`]));
    const rows = await asAdmin((tx) => progress(tx));
    expect(rows.find((r) => r.workspace_id === c.workspaceId)).toMatchObject({ briefs_drafting: 10, brief_limit_reached: true, web_docs_drafting: 0, web_versions: 0 });
    expect((await asAdmin((tx) => progress(tx, 1))).length).toBe(1);
  });

  it("정의자 설정: search_path 고정, public·anon 실행 불가", async () => {
    const r = await one<{ prosecdef: boolean; cfg: string; anon: boolean; auth: boolean }>(
      db,
      "select p.prosecdef, array_to_string(p.proconfig, ',') as cfg, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth from pg_proc p where p.proname = 'admin_p3_progress'",
    );
    expect(r).toEqual({ prosecdef: true, cfg: 'search_path=""', anon: false, auth: true });
  });
});
