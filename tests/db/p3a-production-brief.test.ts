/**
 * P3A-BACKEND-01: 공통 제작 브리프 DB(20261121001000_p3a_production_briefs) 시험. 설계: Plan/Claude-Backend-20261120/P3A-BACKEND-01-DESIGN.md 7절.
 * Tester QA-PLAN-P3A-01 Q1~Q10 답(D1~D13)을 따른다. 모든 값은 합성이다.
 * 전략은 실제 경로(generate_strategy → decide_version)로 만들고 승인한다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft } from "@/domain/strategy";
import { asUser, createDb, expectDbError, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "pbrief-owner-a@example.test");
  b = await seedOwner(db, "pbrief-owner-b@example.test");
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
  await asUser(db, a.userId, (tx) => approveProfile(tx, a.profileA1));
  await asUser(db, b.userId, (tx) => approveProfile(tx, b.profileA1));
}, 60_000);

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const asAnon = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn);
const count = async (sql: string, p: unknown[] = []) => (await one<{ n: number }>(db, `select count(*)::int as n from (${sql}) x`, p)).n;
const audits = (id: string) => count("select 1 from audit_events where entity_type = 'production_brief' and entity_id = $1", [id]);
const replica = async (fn: () => Promise<unknown>) => {
  await db.exec("set session_replication_role = replica");
  try {
    await fn();
  } finally {
    await db.exec("set session_replication_role = origin");
  }
};

const approveProfile = (tx: Tx, id: string) =>
  tx.query(
    "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
    [id],
  );

type Strategy = { taskId: string; artifactId: string; versionId: string; content: Record<string, unknown> & { facts: { text: string }[] } };
async function strategy(f: Fixture, approve = true): Promise<Strategy> {
  return asUser(db, f.userId, async (tx) => {
    const taskId = (
      await one<{ id: string }>(
        tx,
        "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id",
        [f.workspaceId, f.projectA, strategyTpl, newKey()],
      )
    ).id;
    const input = {
      templateVersion: STRATEGY_TEMPLATE_VERSION,
      projectId: f.projectA,
      profile: { id: f.profileA1, version: 1, projectId: f.projectA, clientId: f.clientA, projectKind: "client" },
      sections: {
        goals: { facts: [{ text: "합성 목표", sources: [{ kind: "profile", profileId: f.profileA1, version: 1 }] }], inferences: [] },
        offers: { facts: [], inferences: [{ text: "합성 제안" }] },
      },
      unknowns: [],
    };
    const d = buildStrategyDraft(input);
    if (!d.ok) throw new Error(`계약 실패: ${JSON.stringify(d.issues)}`);
    const g = await one<{ artifact_id: string; version_id: string }>(tx, "select * from generate_strategy($1, $2, $3, $4, $5)", [
      taskId, newKey(), f.profileA1, JSON.stringify(input), JSON.stringify(d.result),
    ]);
    if (approve) await tx.query("select decide_version($1, $2, 'approved', null)", [g.artifact_id, g.version_id]);
    return { taskId, artifactId: g.artifact_id, versionId: g.version_id, content: d.result as unknown as Strategy["content"] };
  });
}

/** 새 판을 저장하고 승인한다(이전 전략 기준 만들기) */
async function approveV2(f: Fixture, s: Strategy) {
  const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [s.artifactId])).revision;
  const edited = { ...s.content, facts: s.content.facts.map((x) => ({ ...x, text: `${x.text} v2` })) };
  return asUser(db, f.userId, async (tx) => {
    const v = await one<{ version_id: string }>(tx, "select * from save_strategy_manual_version($1, $2, $3)", [s.artifactId, rev, JSON.stringify(edited)]);
    await tx.query("select decide_version($1, $2, 'approved', null)", [s.artifactId, v.version_id]);
    return v.version_id;
  });
}

type Vals = Partial<{ title: string; target: string; message: string; kinds: unknown; scope: string; tone: string | null; refs: string | null; status: string }>;
const V = (v: Vals = {}) => ({ title: "  봄 캠페인 제작  ", target: "30대 직장인", message: "쉽고 빠른 마케팅", kinds: ["web_copy", "ppt_deck"], scope: "홈페이지 3쪽과 소개 PPT. 영상 제외", tone: null, refs: null, status: "drafting", ...v });
const create = (tx: Tx, projectId: string, artifactId: string, v: Vals = {}) => {
  const x = V(v);
  return one<{ id: string }>(tx, "select create_production_brief($1, $2, $3, $4, $5, $6::text[], $7, $8, $9) as id", [
    projectId, artifactId, x.title, x.target, x.message, x.kinds, x.scope, x.tone, x.refs,
  ]).then((r) => r.id);
};
const update = (tx: Tx, id: string, rev: number, v: Vals = {}) => {
  const x = V(v);
  return one<{ r: number }>(tx, "select update_production_brief($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10) as r", [
    id, rev, x.title, x.target, x.message, x.kinds, x.scope, x.tone, x.refs, x.status,
  ]).then((r) => r.r);
};
const row = (id: string) => one<Record<string, unknown>>(db, "select * from production_briefs where id = $1", [id]);

describe("만들기(A)", () => {
  it("승인 전략으로 만들면 정리된 값·drafting·revision 1·바탕 사본·감사 1행(본문 없음)", async () => {
    const s = await strategy(a);
    const id = await asA((tx) => create(tx, a.projectA, s.artifactId, { tone: "  ", refs: " 참고 링크 안내 " }));
    const r = await row(id);
    expect(r).toMatchObject({
      workspace_id: a.workspaceId, project_id: a.projectA, strategy_artifact_id: s.artifactId, strategy_version_id: s.versionId,
      title: "봄 캠페인 제작", deliverable_types: ["web_copy", "ppt_deck"], status: "drafting", revision: 1, archived_at: null,
      brand_tone_constraints: null, reference_notes: "참고 링크 안내", created_by: a.userId,
    });
    const snap = r.source_snapshot as { strategy_version: number; profile_ref?: unknown };
    expect(snap.strategy_version).toBe(1);
    expect(Object.keys(snap).every((k) => ["strategy_version", "profile_ref"].includes(k))).toBe(true);
    const au = await one<{ action: string; revision: number; details: Record<string, unknown> }>(db, "select action, revision, details from audit_events where entity_type = 'production_brief' and entity_id = $1", [id]);
    expect(au).toEqual({ action: "production_brief_create", revision: 1, details: { project_id: a.projectA, strategy_version_id: s.versionId, deliverable_types: ["web_copy", "ppt_deck"] } });
    expect(JSON.stringify(au.details)).not.toMatch(/봄 캠페인|30대|마케팅|참고/);
  });

  it("승인 없는 전략·다른 프로젝트·남의 프로젝트·전략이 아닌 결과물은 만들 수 없다(행 0)", async () => {
    const unapproved = await strategy(a, false);
    await expectDbError(asA((tx) => create(tx, a.projectA, unapproved.artifactId)), /STRATEGY_NOT_APPROVED/);
    const s = await strategy(a);
    await expectDbError(asA((tx) => create(tx, a.projectB, s.artifactId)), /NOT_FOUND: 이 프로젝트의 전략을 찾을 수 없습니다/);
    await expectDbError(asB((tx) => create(tx, a.projectA, s.artifactId)), /NOT_FOUND: 프로젝트를 찾을 수 없습니다/);
    await expectDbError(asA((tx) => create(tx, a.projectA, "00000000-0000-0000-0000-000000000000")), /NOT_FOUND: 이 프로젝트의 전략/);
    await expectDbError(asAnon((tx) => create(tx, a.projectA, s.artifactId)), /permission denied/);
    expect(await count("select 1 from production_briefs where strategy_artifact_id = any($1)", [[unapproved.artifactId, s.artifactId]])).toBe(0);
  });

  it("값 경계: 제목 120자·종류 1~4개·중복·모르는 값·선택 칸 1000자", async () => {
    const s = await strategy(a);
    const ok = await asA((tx) => create(tx, a.projectA, s.artifactId, { title: "가".repeat(120), kinds: ["web_copy", "design_assets", "video_plan", "ppt_deck"], tone: "톤".repeat(1000) }));
    expect((await row(ok)).title).toBe("가".repeat(120));
    for (const [v, re] of [
      [{ title: "가".repeat(121) }, /제목은 1~120자/],
      [{ title: "   " }, /제목은 1~120자/],
      [{ target: "" }, /핵심 대상은 1~500자/],
      [{ target: "가".repeat(501) }, /핵심 대상은 1~500자/],
      [{ message: "가".repeat(1001) }, /핵심 전달 메시지는 1~1000자/],
      [{ kinds: [] }, /1개 이상 골라/],
      [{ kinds: ["web_copy", "web_copy"] }, /두 번 고를 수 없습니다/],
      [{ kinds: ["blog"] }, /알 수 없는 산출물 종류/],
      [{ kinds: ["web_copy", null] }, /알 수 없는 산출물 종류/],
      [{ kinds: ["web_copy", "design_assets", "video_plan", "ppt_deck", "web_copy"] }, /두 번 고를 수 없습니다/],
      [{ scope: "가".repeat(2001) }, /제작 범위는 1~2000자/],
      [{ tone: "가".repeat(1001) }, /브랜드 톤·금기 사항은 1000자 이하/],
      [{ refs: "가".repeat(1001) }, /참고 자료 안내는 1000자 이하/],
    ] as [Vals, RegExp][]) await expectDbError(asA((tx) => create(tx, a.projectA, s.artifactId, v)), re);
    expect(await count("select 1 from production_briefs where strategy_artifact_id = $1", [s.artifactId])).toBe(1);
  });
});

describe("수정·맞추기·보관(A)", () => {
  it("수정: ready 로 확정·다시 drafting, 바뀐 칸 이름만 감사, 바뀐 것 없으면 거절(감사 0), revision 충돌", async () => {
    const s = await strategy(a);
    const id = await asA((tx) => create(tx, a.projectA, s.artifactId));
    expect(await asA((tx) => update(tx, id, 1, { status: "ready", message: "새 메시지" }))).toBe(2);
    expect(await row(id)).toMatchObject({ status: "ready", core_message: "새 메시지" });
    const d = await one<{ details: unknown }>(db, "select details from audit_events where entity_type = 'production_brief' and entity_id = $1 and action = 'production_brief_update'", [id]);
    expect(d.details).toEqual({ changed: ["core_message", "status"], status_from: "drafting", status_to: "ready" });
    await expectDbError(asA((tx) => update(tx, id, 2, { status: "ready", message: "새 메시지" })), /VALIDATION: 바뀐 내용이 없습니다/);
    await expectDbError(asA((tx) => update(tx, id, 1, { status: "drafting" })), /CONFLICT/);
    expect(await asA((tx) => update(tx, id, 2, { status: "drafting", message: "새 메시지" }))).toBe(3);
    await expectDbError(asA((tx) => update(tx, id, 3, { status: "approved" })), /알 수 없는 진행 상태/);
    expect(await audits(id)).toBe(3);
  });

  it("이전 전략 기준: 막지 않고(수정 가능) 맞추기로만 새 판·사본, 같으면 거절(감사 0)", async () => {
    const s = await strategy(a);
    const id = await asA((tx) => create(tx, a.projectA, s.artifactId));
    await expectDbError(asA((tx) => tx.query("select rebase_production_brief($1, 1)", [id])), /VALIDATION: 이미 지금 승인된 전략 기준입니다/);
    const v2 = await approveV2(a, s);
    expect(await asA((tx) => update(tx, id, 1, { title: "수정" }))).toBe(2);
    expect((await row(id)).strategy_version_id).toBe(s.versionId);
    await expectDbError(asA((tx) => tx.query("select rebase_production_brief($1, 1)", [id])), /CONFLICT/);
    expect(await asA((tx) => one<{ r: number }>(tx, "select rebase_production_brief($1, 2) as r", [id]))).toEqual({ r: 3 });
    const r = await row(id);
    expect(r.strategy_version_id).toBe(v2);
    expect((r.source_snapshot as { strategy_version: number }).strategy_version).toBe(2);
    const d = await one<{ details: unknown }>(db, "select details from audit_events where entity_type = 'production_brief' and entity_id = $1 and action = 'production_brief_rebase'", [id]);
    expect(d.details).toEqual({ from_version_id: s.versionId, to_version_id: v2, from_version: 1, to_version: 2 });
    expect(await audits(id)).toBe(3);
  });

  it("보관: 되돌리기 없음, 보관 뒤·프로젝트 보관·전략 작업 취소면 쓰기 RPC 모두 거절(감사 0)", async () => {
    const c = await seedOwner(db, "pbrief-owner-c@example.test");
    await asUser(db, c.userId, (tx) => approveProfile(tx, c.profileA1));
    const asC = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, c.userId, fn);
    const s = await strategy(c);
    const id = await asC((tx) => create(tx, c.projectA, s.artifactId));
    const all = async (re: RegExp) => {
      await expectDbError(asC((tx) => update(tx, id, 1, { title: "x" })), re);
      await expectDbError(asC((tx) => tx.query("select rebase_production_brief($1, 1)", [id])), re);
      await expectDbError(asC((tx) => tx.query("select archive_production_brief($1, 1)", [id])), re);
      await expectDbError(asC((tx) => create(tx, c.projectA, s.artifactId)), re);
    };
    await replica(() => db.query("update projects set status = 'archived' where id = $1", [c.projectA]));
    await all(/INVALID_TRANSITION: 보관한 프로젝트/);
    await replica(async () => {
      await db.query("update projects set status = 'active' where id = $1", [c.projectA]);
      await db.query("update tasks set status = 'cancelled' where id = $1", [s.taskId]);
    });
    await all(/INVALID_TRANSITION: 취소된 전략 작업/);
    await replica(() => db.query("update tasks set status = 'completed' where id = $1", [s.taskId]));
    expect(await audits(id)).toBe(1);

    expect(await asC((tx) => one<{ r: number }>(tx, "select archive_production_brief($1, 1) as r", [id]))).toEqual({ r: 2 });
    await expectDbError(asC((tx) => update(tx, id, 2, { title: "x" })), /INVALID_TRANSITION: 보관한 제작 브리프/);
    await expectDbError(asC((tx) => tx.query("select rebase_production_brief($1, 2)", [id])), /INVALID_TRANSITION: 보관한 제작 브리프/);
    await expectDbError(asC((tx) => tx.query("select archive_production_brief($1, 2)", [id])), /INVALID_TRANSITION: 이미 보관한/);
    // 슈퍼유저가 직접 고쳐도(보관 되돌리기 포함) 트리거가 막는다
    await expectDbError(db.query("update production_briefs set archived_at = null where id = $1", [id]), /FROZEN_COLUMN: 보관한 제작 브리프/);
    await expectDbError(db.query("update production_briefs set title = 'x' where id = $1", [id]), /FROZEN_COLUMN/);
    expect(await audits(id)).toBe(2);
  });
});

describe("한도·동시성(L)", () => {
  it("프로젝트당 보관 안 된 것 10개, 보관하면 다시 만들 수 있다", async () => {
    const d = await seedOwner(db, "pbrief-owner-d@example.test");
    await asUser(db, d.userId, (tx) => approveProfile(tx, d.profileA1));
    const asD = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, d.userId, fn);
    const s = await strategy(d);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await asD((tx) => create(tx, d.projectA, s.artifactId, { title: `브리프 ${i}` })));
    await expectDbError(asD((tx) => create(tx, d.projectA, s.artifactId)), /LIMIT_REACHED: 한 프로젝트에는 제작 브리프를 10개까지/);
    await asD((tx) => tx.query("select archive_production_brief($1, 1)", [ids[0]]));
    await asD((tx) => create(tx, d.projectA, s.artifactId));
    expect(await count("select 1 from production_briefs where project_id = $1", [d.projectA])).toBe(11);
    expect(await count("select 1 from production_briefs where project_id = $1 and archived_at is null", [d.projectA])).toBe(10);
  });

  it("만들기는 프로젝트 행 FOR SHARE + 두 인자 advisory lock, 나머지는 브리프 한 행만 잠근다", async () => {
    const src = async (n: string) => (await one<{ s: string }>(db, "select prosrc as s from pg_proc where proname = $1", [n])).s;
    const cr = await src("create_production_brief");
    expect(cr).toMatch(/pg_advisory_xact_lock\(28001, hashtext\(p\.id::text\)\)/);
    expect(cr).toMatch(/from public\.projects x\s+where x\.id = p_project_id\s+and exists \(select 1 from public\.workspaces w where w\.id = x\.workspace_id and w\.owner_user_id = uid\)\s+for share of x/);
    expect(cr.indexOf("for share of x")).toBeLessThan(cr.indexOf("pg_advisory_xact_lock"));
    for (const n of ["create_production_brief", "update_production_brief", "rebase_production_brief", "archive_production_brief"]) {
      expect(await src(n), n).not.toMatch(/public\.(artifacts|tasks|funnels|content_briefs)[^;]*for (no key )?(update|share)/);
      if (n !== "create_production_brief") expect(await src(n), n).not.toMatch(/public\.projects[^;]*for (no key )?(update|share)/);
    }
    expect(await src("lock_own_production_brief")).toMatch(/and exists \(select 1 from public\.workspaces w where w\.id = x\.workspace_id and w\.owner_user_id = auth\.uid\(\)\)\s+for update of x/);
  });
});

describe("보안(S)", () => {
  it("남의 업무실 NOT_FOUND·RLS 0행, 직접 쓰기 거절, anon 거절, 도우미 실행 불가", async () => {
    const s = await strategy(a);
    const id = await asA((tx) => create(tx, a.projectA, s.artifactId));
    for (const q of [
      () => asB((tx) => update(tx, id, 1, { title: "x" })),
      () => asB((tx) => tx.query("select rebase_production_brief($1, 1)", [id])),
      () => asB((tx) => tx.query("select archive_production_brief($1, 1)", [id])),
    ]) await expectDbError(q(), /NOT_FOUND: 제작 브리프를 찾을 수 없습니다/);
    expect(await asB((tx) => tx.query("select 1 from production_briefs where id = $1", [id]).then((r) => r.rows.length))).toBe(0);
    expect(await asA((tx) => tx.query("select 1 from production_briefs where id = $1", [id]).then((r) => r.rows.length))).toBe(1);
    await expectDbError(
      asA((tx) => tx.query(
        "insert into production_briefs (workspace_id, project_id, strategy_artifact_id, strategy_version_id, title, target_audience, core_message, deliverable_types, scope_summary, source_snapshot, created_by) values ($1, $2, $3, $4, 'x', 'x', 'x', '{web_copy}', 'x', '{\"strategy_version\":1}', $5)",
        [a.workspaceId, a.projectA, s.artifactId, s.versionId, a.userId],
      )),
      /permission denied/,
    );
    await expectDbError(asA((tx) => tx.query("update production_briefs set title = 'x' where id = $1", [id])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("delete from production_briefs where id = $1", [id])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("truncate production_briefs")), /permission denied/);
    await expectDbError(asAnon((tx) => tx.query("select * from production_briefs")), /permission denied/);
    for (const f of [
      "select app.check_production_brief('x', 'x', 'x', '{web_copy}', 'x', null, null, 'drafting')",
      `select app.production_brief_audit('${a.workspaceId}', '${id}', 'x', 1, '{}')`,
      `select app.assert_production_open('${a.projectA}', '${s.artifactId}')`,
      `select app.lock_own_production_brief('${id}')`,
      `select app.production_snapshot('${s.versionId}')`,
    ]) await expectDbError(asA((tx) => tx.query(f)), /permission denied/);
  });

  it("복합 FK: 다른 프로젝트·다른 업무실의 전략, 다른 결과물의 판은 슈퍼유저가 써도 막힌다. 고정 열도 못 바꾼다", async () => {
    const s = await strategy(a);
    const sb = await strategy(b);
    const ins = (project: string, artifact: string, version: string) =>
      db.query(
        "insert into production_briefs (workspace_id, project_id, strategy_artifact_id, strategy_version_id, title, target_audience, core_message, deliverable_types, scope_summary, source_snapshot, created_by) values ($1, $2, $3, $4, 'x', 'x', 'x', '{web_copy}', 'x', '{\"strategy_version\":1}', $5)",
        [a.workspaceId, project, artifact, version, a.userId],
      );
    await expectDbError(ins(a.projectA, sb.artifactId, sb.versionId), /foreign key/);
    await expectDbError(ins(a.projectB, s.artifactId, s.versionId), /foreign key/);
    await expectDbError(ins(a.projectA, s.artifactId, sb.versionId), /foreign key/);
    await expectDbError(ins(b.projectA, sb.artifactId, sb.versionId), /foreign key/);
    // 바탕이 전략이 아닌 결과물이면 트리거가 막는다(R-Q4)
    const quoteTpl = (await one<{ id: string }>(db, "select id from templates where type = 'quote' limit 1")).id;
    const qTask = (await one<{ id: string }>(db, "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'quote', $3, $4) returning id", [a.workspaceId, a.projectA, quoteTpl, newKey()])).id;
    const qArt = (await one<{ id: string }>(db, "insert into artifacts (workspace_id, project_id, task_id, type) values ($1, $2, $3, 'quote') returning id", [a.workspaceId, a.projectA, qTask])).id;
    await expectDbError(ins(a.projectA, qArt, s.versionId), /VALIDATION: 제작 브리프의 바탕은 전략이어야 합니다/);
    // 사본 모양·종류 CHECK
    const id = await asA((tx) => create(tx, a.projectA, s.artifactId));
    await expectDbError(db.query("update production_briefs set source_snapshot = '{\"strategy_version\":1,\"x\":1}' where id = $1", [id]), /check constraint/);
    // NULL 판정으로 CHECK 를 빠져나가지 않는다(Tester D1): 빈 객체·판 번호 없음·0·글자·배열·null 값
    for (const bad of ['{}', '{"profile_ref":{}}', '{"strategy_version":0}', '{"strategy_version":"1"}', '{"strategy_version":1.5}', '[]', '{"strategy_version":null}']) {
      await expectDbError(db.query("update production_briefs set source_snapshot = $2::jsonb where id = $1", [id, bad]), /check constraint/);
    }
    for (const bad of ["{}", "{web_copy,NULL}", "{web_copy,web_copy}", "{web_copy,design_assets,video_plan,ppt_deck,web_copy}"]) {
      await expectDbError(db.query("update production_briefs set deliverable_types = $2::text[] where id = $1", [id, bad]), /check constraint/);
    }
    expect(await one(db, "select app.production_snapshot_ok('{}') as a, app.production_kinds_ok(null) as b, app.production_kinds_ok('{}') as c")).toEqual({ a: false, b: false, c: false });
    await expectDbError(db.query("update production_briefs set deliverable_types = '{video_script}' where id = $1", [id]), /check constraint/);
    for (const [col, v] of [["workspace_id", "gen_random_uuid()"], ["project_id", "gen_random_uuid()"], ["strategy_artifact_id", "gen_random_uuid()"], ["created_by", "gen_random_uuid()"], ["created_at", "now() - interval '1 day'"], ["id", "gen_random_uuid()"]]) {
      await expectDbError(db.query(`update production_briefs set ${col} = ${v} where id = $1`, [id]), /FROZEN_COLUMN/);
    }
  });

  it("정의자 함수 설정: search_path 고정, public·anon 실행 불가, 로그인 실행 가능", async () => {
    const names = ["create_production_brief", "update_production_brief", "rebase_production_brief", "archive_production_brief"];
    const rows = (await db.query<{ proname: string; prosecdef: boolean; cfg: string; anon: boolean; pub: boolean; auth: boolean }>(
      `select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e where e.grantee = 0 and e.privilege_type = 'EXECUTE') as pub,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`,
      [names],
    )).rows;
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r, r.proname).toMatchObject({ prosecdef: true, cfg: "search_path=\"\"", anon: false, pub: false, auth: true });
  });
});
