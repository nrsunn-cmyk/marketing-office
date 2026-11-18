/**
 * P2D-BACKEND-01: 마케팅 퍼널 보드 DB(20261118001000_p2d_funnel_board) 시험.
 * 설계: Plan/Claude-Backend-20261118/P2D-BACKEND-01-DESIGN.md 8절. 모든 값은 합성이다.
 * 전략은 실제 경로(generate_strategy → decide_version)로 만들고 승인한다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft } from "@/domain/strategy";
import { asUser, createArtifactWithVersion, createDb, createTask, expectDbError, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "funnel-owner-a@example.test");
  b = await seedOwner(db, "funnel-owner-b@example.test");
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
  await asUser(db, a.userId, (tx) => approveProfile(tx, a.profileA1));
  await asUser(db, b.userId, (tx) => approveProfile(tx, b.profileA1));
}, 60_000); // 병렬 부하에서 PGlite 준비가 10초를 넘을 수 있다(QA-SEC-RELEASE-04 T1)

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const asAnon = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn);
const count = async (sql: string, p: unknown[] = []) => (await one<{ n: number }>(db, `select count(*)::int as n from (${sql}) x`, p)).n;

const approveProfile = (tx: Tx, id: string, decision = "approved") =>
  tx.query(
    "select approve_company_profile_version($1, $2, coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
    [id, decision],
  );

function strategyDraft(f: Fixture, goal = "합성 목표") {
  const input = {
    templateVersion: STRATEGY_TEMPLATE_VERSION,
    projectId: f.projectA,
    profile: { id: f.profileA1, version: 1, projectId: f.projectA, clientId: f.clientA, projectKind: "client" },
    sections: {
      goals: { facts: [{ text: goal, sources: [{ kind: "profile", profileId: f.profileA1, version: 1 }] }], inferences: [] },
      offers: { facts: [], inferences: [{ text: "합성 제안" }] },
    },
    unknowns: [],
  };
  const r = buildStrategyDraft(input);
  if (!r.ok) throw new Error(`계약 실패: ${JSON.stringify(r.issues)}`);
  return { input, content: r.result };
}

/** 전략 작업 생성 → 초안 → (선택) 승인. 결과물·버전 id 를 돌려준다 */
async function strategy(f: Fixture, approve = true) {
  return asUser(db, f.userId, async (tx) => {
    const taskId = (
      await one<{ id: string }>(
        tx,
        "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id",
        [f.workspaceId, f.projectA, strategyTpl, newKey()],
      )
    ).id;
    const d = strategyDraft(f);
    const g = await one<{ artifact_id: string; version_id: string }>(tx, "select * from generate_strategy($1, $2, $3, $4, $5)", [
      taskId, newKey(), f.profileA1, JSON.stringify(d.input), JSON.stringify(d.content),
    ]);
    if (approve) await tx.query("select decide_version($1, $2, 'approved', null)", [g.artifact_id, g.version_id]);
    return { taskId, artifactId: g.artifact_id, versionId: g.version_id, content: d.content };
  });
}

const createFunnel = (tx: Tx, artifactId: string) =>
  one<{ funnel_id: string; reused: boolean }>(tx, "select * from create_funnel($1)", [artifactId]);
const stagesOf = async (funnelId: string) =>
  (await db.query<{ id: string; stage_key: string; position: number; revision: number }>(
    "select id, stage_key, position, revision from funnel_stages where funnel_id = $1 order by position", [funnelId],
  )).rows;
const addItem = (tx: Tx, stageId: string, o: { kind?: string; title?: string; status?: string; details?: unknown; channel?: string | null } = {}) =>
  one<{ id: string }>(tx, "select add_funnel_item($1, $2, $3, $4, $5, $6, $7, $8) as id", [
    stageId, o.kind ?? "content", o.title ?? "합성 카드", "합성 설명", o.channel === undefined ? "블로그" : o.channel, o.status ?? "planned", null,
    o.details === undefined ? null : JSON.stringify(o.details),
  ]).then((r) => r.id);
const itemRow = (id: string) =>
  one<{ stage_id: string; position: number; revision: number; title: string; status: string; archived_at: string | null; kind: string; details: unknown }>(
    db, "select stage_id, position, revision, title, status, archived_at, kind, details from funnel_items where id = $1", [id],
  );
const updateItem = (tx: Tx, id: string, rev: number, stageId: string, o: { kind?: string; title?: string; status?: string; details?: unknown } = {}) =>
  one<{ r: number }>(tx, "select update_funnel_item($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as r", [
    id, rev, stageId, o.kind ?? "content", o.title ?? "고친 카드", null, "링크드인", o.status ?? "drafting", "합성 메모",
    o.details === undefined ? null : JSON.stringify(o.details),
  ]).then((x) => x.r);

describe("정상 흐름", () => {
  it("승인된 전략 → 퍼널(단계 5개) → 카드 추가·수정·이동·보관, 감사 기록", async () => {
    const s = await strategy(a);
    const f = await asA((tx) => createFunnel(tx, s.artifactId));
    expect(f.reused).toBe(false);
    const fr = await one<{ strategy_version_id: string; project_id: string; created_by: string }>(db, "select strategy_version_id, project_id, created_by from funnels where id = $1", [f.funnel_id]);
    expect(fr).toEqual({ strategy_version_id: s.versionId, project_id: a.projectA, created_by: a.userId });
    const st = await stagesOf(f.funnel_id);
    expect(st.map((x) => x.stage_key)).toEqual(["inflow", "awareness", "consideration", "conversion", "retention"]);

    // 같은 전략으로 다시 만들면 기존 것
    expect(await asA((tx) => createFunnel(tx, s.artifactId))).toEqual({ funnel_id: f.funnel_id, reused: true });

    // 카드 2개 추가 → 순서 1, 2
    const i1 = await asA((tx) => addItem(tx, st[0].id, { title: "  숏폼 카드  " }));
    const i2 = await asA((tx) => addItem(tx, st[0].id));
    expect((await itemRow(i1)).position).toBe(1);
    expect((await itemRow(i1)).title).toBe("숏폼 카드");
    expect((await itemRow(i2)).position).toBe(2);

    // 리드마그넷 카드(P2-e 상세)
    const lm = await asA((tx) =>
      addItem(tx, st[2].id, { kind: "lead_magnet", title: "진단 체크리스트", details: { deliverable: "PDF", leadFields: ["회사 이메일", "회사명"], outline: ["1장 자가진단"] } }),
    );
    expect((await itemRow(lm)).details).toEqual({ deliverable: "PDF", leadFields: ["회사 이메일", "회사명"], outline: ["1장 자가진단"] });

    // 수정 + 다른 단계(인지)로 이동 → 그 단계 맨 끝
    const r = await asA((tx) => updateItem(tx, i1, 1, st[1].id, { status: "published" }));
    expect(r).toBe(2);
    expect(await itemRow(i1)).toMatchObject({ stage_id: st[1].id, position: 1, status: "published", title: "고친 카드" });

    // 단계 타깃 문구
    const sr = await asA((tx) => one<{ r: number }>(tx, "select update_funnel_stage($1, 1, '  검색 유입  ') as r", [st[0].id]));
    expect(sr.r).toBe(2);
    expect((await one<{ focus: string }>(db, "select focus from funnel_stages where id = $1", [st[0].id])).focus).toBe("검색 유입");

    // 보관
    await asA((tx) => tx.query("select archive_funnel_item($1, 1)", [i2]));
    expect((await itemRow(i2)).archived_at).not.toBeNull();

    const acts = (await db.query<{ action: string; actor_id: string }>(
      `select action, actor_id from audit_events where entity_type in ('funnel', 'funnel_item')
         and (entity_id = $1 or details ->> 'funnel_id' = $1::text) order by seq`, [f.funnel_id],
    )).rows;
    expect(acts.map((x) => x.action)).toEqual(["funnel_create", "item_add", "item_add", "item_add", "item_update", "stage_update", "item_archive"]);
    expect(acts.every((x) => x.actor_id === a.userId)).toBe(true);
  });
});

describe("전략 승인본 참조 (I6)", () => {
  it("승인하지 않은 전략은 퍼널을 만들 수 없다", async () => {
    const s = await strategy(a, false);
    await expectDbError(asA((tx) => createFunnel(tx, s.artifactId)), /STRATEGY_NOT_APPROVED/);
  });

  it("전략 v2 승인 뒤: 참조는 v1 그대로(자동 없음), 다시 맞추기로만 v2", async () => {
    const s = await strategy(a);
    const f = await asA((tx) => createFunnel(tx, s.artifactId));
    // 같으면 다시 맞추기 거절
    await expectDbError(asA((tx) => tx.query("select rebase_funnel($1, 1)", [f.funnel_id])), /VALIDATION: 이미/);
    // 직접 고치기로 v2 → 승인
    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [s.artifactId])).revision;
    const edited = { ...s.content, facts: s.content.facts.map((x) => ({ ...x, text: `${x.text} v2` })) };
    const v2 = await asA(async (tx) => {
      const v = await one<{ version_id: string }>(tx, "select * from save_strategy_manual_version($1, $2, $3)", [s.artifactId, rev, JSON.stringify(edited)]);
      await tx.query("select decide_version($1, $2, 'approved', null)", [s.artifactId, v.version_id]);
      return v.version_id;
    });
    expect((await one<{ v: string }>(db, "select strategy_version_id as v from funnels where id = $1", [f.funnel_id])).v).toBe(s.versionId);
    // 이전 전략 기준이어도 카드 편집은 된다(DEC-P2-01-A 는 승인 처리에 관한 것, 퍼널에는 승인 없음)
    const st = await stagesOf(f.funnel_id);
    await asA((tx) => addItem(tx, st[3].id, { kind: "cta" }));
    // 오래된 revision 은 충돌
    await expectDbError(asA((tx) => tx.query("select rebase_funnel($1, 99)", [f.funnel_id])), /CONFLICT/);
    expect(await asA((tx) => one<{ r: number }>(tx, "select rebase_funnel($1, 1) as r", [f.funnel_id]))).toEqual({ r: 2 });
    expect((await one<{ v: string }>(db, "select strategy_version_id as v from funnels where id = $1", [f.funnel_id])).v).toBe(v2);
  });

  it("로고 결과물로는 만들 수 없다, 없는 id 는 NOT_FOUND", async () => {
    const logo = await asA(async (tx) => {
      const t = await createTask(tx, a, a.projectA, "logo_brief");
      return createArtifactWithVersion(tx, a, a.projectA, t);
    });
    await expectDbError(asA((tx) => createFunnel(tx, logo.artifactId)), /VALIDATION: 전략 결과물이 아닙니다/);
    await expectDbError(asA((tx) => createFunnel(tx, "00000000-0000-4000-8000-000000000000")), /NOT_FOUND/);
  });

  it("N2 미결: 기준 프로필을 철회해도 퍼널 생성·편집은 막지 않는다", async () => {
    const c = await seedOwner(db, "funnel-owner-c@example.test");
    await asUser(db, c.userId, (tx) => approveProfile(tx, c.profileA1));
    const s = await strategy(c);
    await asUser(db, c.userId, (tx) => approveProfile(tx, c.profileA1, "revoked"));
    const f = await asUser(db, c.userId, (tx) => createFunnel(tx, s.artifactId));
    const st = await stagesOf(f.funnel_id);
    await asUser(db, c.userId, (tx) => addItem(tx, st[0].id));
    expect(await count("select 1 from funnel_items where funnel_id = $1", [f.funnel_id])).toBe(1);
  });

  it("전략 작업이 취소되면 고칠 수 없다", async () => {
    const s = await strategy(a);
    const f = await asA((tx) => createFunnel(tx, s.artifactId));
    const st = await stagesOf(f.funnel_id);
    // 승인된 작업(completed)은 전이표상 취소로 못 간다. 시험용으로 관리자 권한에서 트리거를 끄고 상태만 바꾼다
    await db.exec("set session_replication_role = replica");
    await db.query("update tasks set status = 'cancelled' where id = $1", [s.taskId]);
    await db.exec("set session_replication_role = origin");
    await expectDbError(asA((tx) => addItem(tx, st[0].id)), /INVALID_TRANSITION/);
  });
});

describe("업무실 경계 (P0)", () => {
  it("남의 전략·퍼널·단계·카드는 NOT_FOUND, 잠그지 않는다", async () => {
    const s = await strategy(a);
    const f = await asA((tx) => createFunnel(tx, s.artifactId));
    const st = await stagesOf(f.funnel_id);
    const item = await asA((tx) => addItem(tx, st[0].id));
    await expectDbError(asB((tx) => createFunnel(tx, s.artifactId)), /NOT_FOUND/);
    await expectDbError(asB((tx) => tx.query("select rebase_funnel($1, 1)", [f.funnel_id])), /NOT_FOUND/);
    await expectDbError(asB((tx) => tx.query("select update_funnel_stage($1, 1, 'x')", [st[0].id])), /NOT_FOUND/);
    await expectDbError(asB((tx) => addItem(tx, st[0].id)), /NOT_FOUND/);
    await expectDbError(asB((tx) => updateItem(tx, item, 1, st[0].id)), /NOT_FOUND/);
    await expectDbError(asB((tx) => tx.query("select archive_funnel_item($1, 1)", [item])), /NOT_FOUND/);

    // 잠금 확인: A가 카드 행을 잠근 채로 B의 호출이 기다리지 않고 바로 NOT_FOUND 로 끝난다
    // (PGlite 는 한 연결이라 동시 실행 대신, 정의자 함수의 조회가 소유 조건을 WHERE 안에 두는지 본문으로 확인)
    const bodies = (await db.query<{ proname: string; src: string }>(
      `select proname, prosrc as src from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('create_funnel','rebase_funnel','update_funnel_stage','add_funnel_item','update_funnel_item','archive_funnel_item')`,
    )).rows;
    expect(bodies).toHaveLength(6);
    for (const x of bodies) expect(x.src, x.proname).toMatch(/and exists \(select 1 from public\.workspaces w where w\.id = x\.workspace_id and w\.owner_user_id = uid\)\s+for update of x/);
  });

  it("다른 퍼널의 단계로 옮길 수 없다(같은 업무실이어도)", async () => {
    const s1 = await strategy(a);
    const s2 = await strategy(a);
    const f1 = await asA((tx) => createFunnel(tx, s1.artifactId));
    const f2 = await asA((tx) => createFunnel(tx, s2.artifactId));
    const st1 = await stagesOf(f1.funnel_id);
    const st2 = await stagesOf(f2.funnel_id);
    const item = await asA((tx) => addItem(tx, st1[0].id));
    await expectDbError(asA((tx) => updateItem(tx, item, 1, st2[1].id)), /같은 퍼널의 단계로만/);
    // 표 수준에서도: 관리자가 직접 바꿔도 FK 가 막는다
    await expectDbError(db.query("update funnel_items set stage_id = $1 where id = $2", [st2[1].id, item]), /foreign key|violates/);
  });

  it("직접 쓰기 거절, 남의 업무실 조회 0행, anon 실행 거절", async () => {
    const s = await strategy(a);
    const f = await asA((tx) => createFunnel(tx, s.artifactId));
    const st = await stagesOf(f.funnel_id);
    const item = await asA((tx) => addItem(tx, st[0].id));
    await expectDbError(
      asA((tx) => tx.query("insert into funnels (workspace_id, project_id, strategy_artifact_id, strategy_version_id, created_by) values ($1, $2, $3, $4, $5)", [a.workspaceId, a.projectA, s.artifactId, s.versionId, a.userId])),
      /permission denied/,
    );
    await expectDbError(
      asA((tx) => tx.query("insert into funnel_items (workspace_id, funnel_id, stage_id, kind, title, position, created_by) values ($1, $2, $3, 'content', 'x', 9, $4)", [a.workspaceId, f.funnel_id, st[0].id, a.userId])),
      /permission denied/,
    );
    await expectDbError(asA((tx) => tx.query("update funnel_items set title = 'x' where id = $1", [item])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("update funnel_stages set focus = 'x' where id = $1", [st[0].id])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("update funnels set strategy_version_id = $1 where id = $2", [s.versionId, f.funnel_id])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("delete from funnel_items where id = $1", [item])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("truncate funnel_items")), /permission denied/);

    expect(await asA((tx) => tx.query("select 1 from funnel_items where id = $1", [item]).then((r) => r.rows.length))).toBe(1);
    expect(await asB((tx) => tx.query("select 1 from funnels where id = $1", [f.funnel_id]).then((r) => r.rows.length))).toBe(0);
    expect(await asB((tx) => tx.query("select 1 from funnel_stages where funnel_id = $1", [f.funnel_id]).then((r) => r.rows.length))).toBe(0);
    expect(await asB((tx) => tx.query("select 1 from funnel_items where id = $1", [item]).then((r) => r.rows.length))).toBe(0);

    await expectDbError(asAnon((tx) => createFunnel(tx, s.artifactId)), /permission denied/);
    await expectDbError(asAnon((tx) => tx.query("select * from funnels")), /permission denied/);
    // 도우미 함수는 로그인 역할이 부를 수 없다
    await expectDbError(asA((tx) => tx.query("select app.assert_funnel_open($1)", [f.funnel_id])), /permission denied/);
  });

  it("정의자 함수 설정: search_path 고정, public·anon 실행 불가", async () => {
    const rows = (await db.query<{ proname: string; prosecdef: boolean; cfg: string; anon: boolean; pub: boolean; auth: boolean }>(
      `select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e where e.grantee = 0 and e.privilege_type = 'EXECUTE') as pub,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.pronamespace = 'public'::regnamespace
          and p.proname in ('create_funnel','rebase_funnel','update_funnel_stage','add_funnel_item','update_funnel_item','archive_funnel_item')`,
    )).rows;
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r, r.proname).toMatchObject({ prosecdef: true, cfg: "search_path=\"\"", anon: false, pub: false, auth: true });
  });
});

describe("값 규칙·충돌", () => {
  let stages: { id: string }[];
  beforeAll(async () => {
    const s = await strategy(a);
    const f = await asA((tx) => createFunnel(tx, s.artifactId));
    stages = await stagesOf(f.funnel_id);
  }, 60_000);

  it("제목·유형·상태·길이", async () => {
    await expectDbError(asA((tx) => addItem(tx, stages[0].id, { title: "   " })), /제목은 1~200자/);
    await expectDbError(asA((tx) => addItem(tx, stages[0].id, { title: "가".repeat(201) })), /제목은 1~200자/);
    await expectDbError(asA((tx) => addItem(tx, stages[0].id, { kind: "poll" })), /알 수 없는 카드 유형/);
    await expectDbError(asA((tx) => addItem(tx, stages[0].id, { status: "done" })), /알 수 없는 진행 상태/);
    await expectDbError(asA((tx) => addItem(tx, stages[0].id, { channel: "가".repeat(101) })), /채널은 100자/);
    await expectDbError(asA((tx) => tx.query("select update_funnel_stage($1, 1, $2)", [stages[1].id, "가".repeat(301)])), /300자/);
    // 빈 채널은 null 로 저장
    const id = await asA((tx) => addItem(tx, stages[0].id, { channel: "  " }));
    expect((await one<{ channel: string | null }>(db, "select channel from funnel_items where id = $1", [id])).channel).toBeNull();
  });

  it("리드마그넷 상세 모양: 다른 유형에는 넣을 수 없고, 모르는 키·긴 값은 거절", async () => {
    await expectDbError(asA((tx) => addItem(tx, stages[2].id, { kind: "content", details: { deliverable: "PDF" } })), /리드마그넷 기획 내용/);
    await expectDbError(asA((tx) => addItem(tx, stages[2].id, { kind: "lead_magnet", details: { price: 1 } })), /리드마그넷 기획 내용/);
    await expectDbError(asA((tx) => addItem(tx, stages[2].id, { kind: "lead_magnet", details: { leadFields: Array(11).fill("x") } })), /리드마그넷 기획 내용/);
    await expectDbError(asA((tx) => addItem(tx, stages[2].id, { kind: "lead_magnet", details: { outline: [""] } })), /리드마그넷 기획 내용/);
    await expectDbError(asA((tx) => addItem(tx, stages[2].id, { kind: "lead_magnet", details: ["x"] })), /리드마그넷 기획 내용/);
    // 상세 없이도 리드마그넷 카드는 만들 수 있다
    await asA((tx) => addItem(tx, stages[2].id, { kind: "lead_magnet" }));
    // 유형을 content 로 바꾸면서 상세를 남기면 거절
    const lm = await asA((tx) => addItem(tx, stages[2].id, { kind: "lead_magnet", details: { deliverable: "PDF" } }));
    await expectDbError(asA((tx) => updateItem(tx, lm, 1, stages[2].id, { kind: "content", details: { deliverable: "PDF" } })), /리드마그넷 기획 내용/);
    // 표 CHECK 도 같은 규칙(관리자 직접 쓰기)
    await expectDbError(db.query("update funnel_items set kind = 'cta' where id = $1", [lm]), /check constraint/);
  });

  it("revision 충돌, 보관한 카드 수정·재보관 거절", async () => {
    const id = await asA((tx) => addItem(tx, stages[4].id));
    await expectDbError(asA((tx) => updateItem(tx, id, 5, stages[4].id)), /CONFLICT/);
    await expectDbError(asA((tx) => tx.query("select update_funnel_stage($1, 99, 'x')", [stages[4].id])), /CONFLICT/);
    await asA((tx) => tx.query("select archive_funnel_item($1, 1)", [id]));
    await expectDbError(asA((tx) => updateItem(tx, id, 2, stages[4].id)), /보관한 카드는 고칠 수 없습니다/);
    await expectDbError(asA((tx) => tx.query("select archive_funnel_item($1, 2)", [id])), /이미 보관한 카드/);
  });

  it("한 단계에 보관하지 않은 카드는 50개까지(보관하면 다시 넣을 수 있다)", async () => {
    const s = await strategy(a);
    const f = await asA((tx) => createFunnel(tx, s.artifactId));
    const st = await stagesOf(f.funnel_id);
    const ids = await asA(async (tx) => {
      const out: string[] = [];
      for (let i = 0; i < 50; i++) out.push(await addItem(tx, st[1].id, { title: `카드 ${i}` }));
      return out;
    });
    await expectDbError(asA((tx) => addItem(tx, st[1].id)), /50개까지/);
    // 다른 단계에서 꽉 찬 단계로 옮기기도 거절
    const other = await asA((tx) => addItem(tx, st[0].id));
    await expectDbError(asA((tx) => updateItem(tx, other, 1, st[1].id)), /50개까지/);
    await asA((tx) => tx.query("select archive_funnel_item($1, 1)", [ids[0]]));
    const again = await asA((tx) => addItem(tx, st[1].id));
    expect((await itemRow(again)).position).toBe(51);
  }, 60_000);

  it("고정 열은 관리자도 바꿀 수 없다(guard_update)", async () => {
    await expectDbError(db.query("update funnel_stages set stage_key = 'retention' where id = $1", [stages[0].id]), /FROZEN_COLUMN/);
    const id = await asA((tx) => addItem(tx, stages[0].id));
    await expectDbError(db.query("update funnel_items set created_by = $1 where id = $2", [b.userId, id]), /FROZEN_COLUMN/);
  });
});

describe("R1 보완 (QA-P2D-BACKEND-01 W2·O1·O3)", () => {
  it("W2: 공백만 있는 설명은 null 로 저장(추가·수정), 표 CHECK 도 거절", async () => {
    const s = await strategy(a);
    const f = await asA((tx) => createFunnel(tx, s.artifactId));
    const st = await stagesOf(f.funnel_id);
    const id = await asA((tx) =>
      one<{ id: string }>(tx, "select add_funnel_item($1, 'content', '카드', '   ', null, 'planned', null, null) as id", [st[0].id]).then((r) => r.id),
    );
    expect((await one<{ d: string | null }>(db, "select description as d from funnel_items where id = $1", [id])).d).toBeNull();
    await asA((tx) => tx.query("select update_funnel_item($1, 1, $2, 'content', '카드', $3, null, 'planned', null, null)", [id, st[0].id, "  설명  "]));
    expect((await one<{ d: string | null }>(db, "select description as d from funnel_items where id = $1", [id])).d).toBe("설명");
    await asA((tx) => tx.query("select update_funnel_item($1, 2, $2, 'content', '카드', $3, null, 'planned', null, null)", [id, st[0].id, "\n\t "]));
    expect((await one<{ d: string | null }>(db, "select description as d from funnel_items where id = $1", [id])).d).toBeNull();
    await expectDbError(db.query("update funnel_items set description = '  ' where id = $1", [id]), /check constraint/);
  });

  it("O3: 보관한 프로젝트는 퍼널 생성·편집 거절(읽기는 됨), 다시 열면 고칠 수 있다", async () => {
    const d = await seedOwner(db, "funnel-owner-d@example.test");
    await asUser(db, d.userId, (tx) => approveProfile(tx, d.profileA1));
    const s1 = await strategy(d);
    const s2 = await strategy(d);
    const f = await asUser(db, d.userId, (tx) => createFunnel(tx, s1.artifactId));
    const st = await stagesOf(f.funnel_id);
    const item = await asUser(db, d.userId, (tx) => addItem(tx, st[0].id));
    await db.query("update projects set status = 'archived' where id = $1", [d.projectA]);

    await expectDbError(asUser(db, d.userId, (tx) => createFunnel(tx, s2.artifactId)), /보관한 프로젝트에는 퍼널을 만들 수 없습니다/);
    await expectDbError(asUser(db, d.userId, (tx) => addItem(tx, st[0].id)), /보관한 프로젝트의 퍼널은 고칠 수 없습니다/);
    await expectDbError(asUser(db, d.userId, (tx) => updateItem(tx, item, 1, st[0].id)), /보관한 프로젝트/);
    await expectDbError(asUser(db, d.userId, (tx) => tx.query("select archive_funnel_item($1, 1)", [item])), /보관한 프로젝트/);
    await expectDbError(asUser(db, d.userId, (tx) => tx.query("select update_funnel_stage($1, 1, 'x')", [st[0].id])), /보관한 프로젝트/);
    await expectDbError(asUser(db, d.userId, (tx) => tx.query("select rebase_funnel($1, 1)", [f.funnel_id])), /보관한 프로젝트/);
    // 이미 있는 퍼널을 다시 요청하면(reused) 그대로 돌려준다 — 새로 쓰는 것이 없다
    expect(await asUser(db, d.userId, (tx) => createFunnel(tx, s1.artifactId))).toEqual({ funnel_id: f.funnel_id, reused: true });
    expect(await asUser(db, d.userId, (tx) => tx.query("select 1 from funnel_items where funnel_id = $1", [f.funnel_id]).then((r) => r.rows.length))).toBe(1);

    await db.query("update projects set status = 'active' where id = $1", [d.projectA]);
    await asUser(db, d.userId, (tx) => addItem(tx, st[0].id));
    expect(await asUser(db, d.userId, (tx) => createFunnel(tx, s2.artifactId).then((r) => r.reused))).toBe(false);
  });

  it("O1: 보관한 카드는 한도에 넣지 않는다(활성 50 + 보관 누적 허용, 보드 조회는 활성만)", async () => {
    const s = await strategy(a);
    const f = await asA((tx) => createFunnel(tx, s.artifactId));
    const st = await stagesOf(f.funnel_id);
    await asA(async (tx) => {
      for (let i = 0; i < 60; i++) {
        const id = await addItem(tx, st[0].id, { title: `카드 ${i}` });
        if (i < 20) await tx.query("select archive_funnel_item($1, 1)", [id]);
      }
    });
    expect(await count("select 1 from funnel_items where stage_id = $1", [st[0].id])).toBe(60);
    expect(await count("select 1 from funnel_items where stage_id = $1 and archived_at is null", [st[0].id])).toBe(40);
    // 활성 카드 색인(부분 색인)이 있다
    expect(await count("select 1 from pg_indexes where indexname = 'funnel_items_active' and indexdef like '%WHERE (archived_at IS NULL)%'")).toBe(1);
  }, 60_000);
});
