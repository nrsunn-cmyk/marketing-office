/**
 * P2F-BACKEND-01: 콘텐츠 브리프 DB(20261118002000_p2f_content_brief) 시험.
 * 설계: Plan/Claude-Backend-20261118/P2F-BACKEND-01-DESIGN.md 8절. 모든 값은 합성이다.
 * 전략·퍼널은 실제 RPC 경로(generate_strategy → decide_version → create_funnel → add_funnel_item)로 만든다.
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
  a = await seedOwner(db, "brief-owner-a@example.test");
  b = await seedOwner(db, "brief-owner-b@example.test");
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

/** 승인된 전략 → 퍼널 → 카드 1장. 프로젝트 A 기준 */
async function setup(f: Fixture = a) {
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
        audiences: { facts: [], inferences: [{ text: "합성 타깃" }] },
      },
      unknowns: [],
    };
    const d = buildStrategyDraft(input);
    if (!d.ok) throw new Error(JSON.stringify(d.issues));
    const g = await one<{ artifact_id: string; version_id: string }>(tx, "select * from generate_strategy($1, $2, $3, $4, $5)", [
      taskId, newKey(), f.profileA1, JSON.stringify(input), JSON.stringify(d.result),
    ]);
    await tx.query("select decide_version($1, $2, 'approved', null)", [g.artifact_id, g.version_id]);
    const fn = await one<{ funnel_id: string }>(tx, "select * from create_funnel($1)", [g.artifact_id]);
    const stage = await one<{ id: string }>(tx, "select id from funnel_stages where funnel_id = $1 and stage_key = 'awareness'", [fn.funnel_id]);
    const item = await one<{ id: string }>(tx, "select add_funnel_item($1, 'content', '합성 카드', null, null, 'planned', null, null) as id", [stage.id]);
    return { taskId, artifactId: g.artifact_id, versionId: g.version_id, content: d.result, funnelId: fn.funnel_id, itemId: item.id };
  });
}

const createBrief = (tx: Tx, itemId: string, channel = "blog", spec: unknown = {}, title = "합성 브리프") =>
  one<{ brief_id: string; reused: boolean }>(tx, "select * from create_content_brief($1, $2, $3, $4, $5, $6, $7)", [
    itemId, channel, title, " 합성 타깃 ", null, "무료 진단 신청", JSON.stringify(spec),
  ]);
const updateBrief = (tx: Tx, id: string, rev: number, o: { spec?: unknown; origin?: string; status?: string; copy?: string | null; hook?: string | null } = {}) =>
  one<{ r: number }>(tx, "select update_content_brief($1, $2, '고친 브리프', '타깃', $3, '핵심 요지', 'CTA', $4, $5, $6, '이미지 가이드', $7) as r", [
    id, rev, o.hook === undefined ? "  훅 문장  " : o.hook, JSON.stringify(o.spec ?? {}), o.copy === undefined ? "카피 초안" : o.copy, o.origin ?? "manual", o.status ?? "drafting",
  ]).then((x) => x.r);
const addClaim = (tx: Tx, briefId: string, text = "합성 주장", kind = "capability") =>
  one<{ id: string }>(tx, "select add_brief_claim($1, $2, $3) as id", [briefId, text, kind]).then((r) => r.id);
const link = (tx: Tx, claimId: string, kind: string, target: string, field: string | null = null, note: string | null = null) =>
  one<{ id: string }>(tx, "select link_claim_source($1, $2, $3, $4, $5) as id", [claimId, kind, target, field, note]).then((r) => r.id);
const asset = (f: Fixture, projectId: string, url: string) =>
  asUser(db, f.userId, async (tx) =>
    (await one<{ id: string }>(tx, "insert into source_assets (workspace_id, project_id, kind, url) values ($1, $2, 'url', $3) returning id", [f.workspaceId, projectId, url])).id,
  );
const research = (f: Fixture, projectId: string) =>
  asUser(db, f.userId, async (tx) =>
    (await one<{ id: string }>(tx, "select add_research_source($1, 'https://example.com/r', '합성 리포트', now()) as id", [projectId])).id,
  );

describe("정상 흐름", () => {
  it("카드 → 브리프(전략 버전 복사) → 수정 → 주장 → 근거 3종 연결·해제 → 감사 기록", async () => {
    const s = await setup();
    const br = await asA((tx) => createBrief(tx, s.itemId, "instagram", { format: "carousel", hashtags: ["합성"] }));
    expect(br.reused).toBe(false);
    const row = await one<{ strategy_version_id: string; audience: string; status: string; copy_origin: string; project_id: string }>(
      db, "select strategy_version_id, audience, status, copy_origin, project_id from content_briefs where id = $1", [br.brief_id],
    );
    expect(row).toEqual({ strategy_version_id: s.versionId, audience: "합성 타깃", status: "drafting", copy_origin: "manual", project_id: a.projectA });
    expect(await asA((tx) => createBrief(tx, s.itemId, "instagram"))).toEqual({ brief_id: br.brief_id, reused: true });
    // 같은 카드에 다른 채널은 새 브리프
    expect((await asA((tx) => createBrief(tx, s.itemId, "ad_copy"))).reused).toBe(false);

    expect(await asA((tx) => updateBrief(tx, br.brief_id, 1, { spec: { format: "reel", captionGuide: "합성 캡션" }, origin: "template", status: "ready" }))).toBe(2);
    expect(await one(db, "select hook, copy_origin, status from content_briefs where id = $1", [br.brief_id])).toEqual({ hook: "훅 문장", copy_origin: "template", status: "ready" });

    const c1 = await asA((tx) => addClaim(tx, br.brief_id, "  합성 주장 1 ", "statistic"));
    const c2 = await asA((tx) => addClaim(tx, br.brief_id));
    expect((await one<{ text: string; position: number }>(db, "select text, position from content_brief_claims where id = $1", [c1]))).toEqual({ text: "합성 주장 1", position: 1 });
    expect(await asA((tx) => one<{ r: number }>(tx, "select update_brief_claim($1, 1, '고친 주장', 'reference') as r", [c2]))).toEqual({ r: 2 });

    const as = await asset(a, a.projectA, "https://example.com/brief-a");
    const rs = await research(a, a.projectA);
    const sp = await asA((tx) => link(tx, c1, "profile", a.profileA1, "strengths", "합성 강점 문장"));
    const sa = await asA((tx) => link(tx, c1, "asset", as));
    await asA((tx) => link(tx, c1, "research", rs));
    expect(await count("select 1 from content_claim_sources where claim_id = $1 and unlinked_at is null", [c1])).toBe(3);

    await asA((tx) => tx.query("select unlink_claim_source($1)", [sa]));
    expect(await count("select 1 from content_claim_sources where claim_id = $1 and unlinked_at is null", [c1])).toBe(2);
    // 해제 뒤 같은 대상은 다시 연결할 수 있다(새 행)
    await asA((tx) => link(tx, c1, "asset", as));
    expect(await count("select 1 from content_claim_sources where claim_id = $1", [c1])).toBe(4);
    await asA((tx) => tx.query("select archive_brief_claim($1, 2)", [c2]));

    const acts = (await db.query<{ action: string; actor_id: string }>(
      "select action, actor_id from audit_events where entity_type = 'content_brief' and entity_id = $1 order by seq", [br.brief_id],
    )).rows;
    expect(acts.map((x) => x.action)).toEqual([
      "brief_create", "brief_update", "claim_add", "claim_add", "claim_update", "source_link", "source_link", "source_link", "source_unlink", "source_link", "claim_archive",
    ]);
    expect(acts.every((x) => x.actor_id === a.userId)).toBe(true);
    expect(sp).toBeTruthy();
  });
});

describe("근거 무결성", () => {
  it("다른 프로필 버전·다른 프로젝트 자료·출처는 거절, 같은 대상 중복 거절, 해제 행 고정", async () => {
    const s = await setup();
    const br = await asA((tx) => createBrief(tx, s.itemId));
    const c = await asA((tx) => addClaim(tx, br.brief_id));
    // 같은 고객의 다른 프로필 버전(전략이 참조하지 않음)
    const pv2 = (await asA((tx) => one<{ id: string }>(tx, "insert into company_profile_versions (workspace_id, client_id, version, products) values ($1, $2, 2, '합성') returning id", [a.workspaceId, a.clientA]))).id;
    await expectDbError(asA((tx) => link(tx, c, "profile", pv2, "products")), /SOURCE_MISMATCH: 브리프가 참조한 전략/);
    await expectDbError(asA((tx) => link(tx, c, "profile", a.profileB1, "products")), /SOURCE_MISMATCH/);
    await expectDbError(asA((tx) => link(tx, c, "profile", a.profileA1, null)), /알 수 없는 프로필 항목/);
    await expectDbError(asA((tx) => link(tx, c, "profile", a.profileA1, "price")), /알 수 없는 프로필 항목/);
    const otherAsset = await asset(a, a.projectB, "https://example.com/other");
    await expectDbError(asA((tx) => link(tx, c, "asset", otherAsset)), /이 프로젝트의 자료나 같은 고객의 공통 자료만/);
    const otherResearch = await research(a, a.projectB);
    await expectDbError(asA((tx) => link(tx, c, "research", otherResearch)), /이 프로젝트의 외부 출처만/);
    // 남의 업무실 자료는 같은 문구
    const bAsset = await asset(b, b.projectA, "https://example.com/b");
    await expectDbError(asA((tx) => link(tx, c, "asset", bAsset)), /이 프로젝트의 자료나 같은 고객의 공통 자료만/);
    await expectDbError(asA((tx) => link(tx, c, "url", bAsset)), /알 수 없는 근거 종류/);

    const id = await asA((tx) => link(tx, c, "profile", a.profileA1, "products"));
    await expectDbError(asA((tx) => link(tx, c, "profile", a.profileA1, "products")), /이미 연결한 근거/);
    // 같은 프로필이라도 다른 항목은 따로 연결할 수 있다
    await asA((tx) => link(tx, c, "profile", a.profileA1, "audience"));
    await asA((tx) => tx.query("select unlink_claim_source($1)", [id]));
    await expectDbError(asA((tx) => tx.query("select unlink_claim_source($1)", [id])), /이미 해제한 근거/);
    // 관리자도 해제 행·대상 열은 못 바꾼다, 삭제도 못 한다
    await expectDbError(db.query("update content_claim_sources set unlinked_at = null where id = $1", [id]), /해제한 근거 연결은 바꿀 수 없습니다/);
    const live = (await one<{ id: string }>(db, "select id from content_claim_sources where claim_id = $1 and unlinked_at is null", [c])).id;
    await expectDbError(db.query("update content_claim_sources set note = 'x' where id = $1", [live]), /FROZEN_COLUMN/);
    await expectDbError(db.query("delete from content_claim_sources where id = $1", [live]), /IMMUTABLE_ROW/);
  });

  it("한도: 주장 30개, 근거 10개(해제한 것은 세지 않음)", async () => {
    const s = await setup();
    const br = await asA((tx) => createBrief(tx, s.itemId));
    const claims = await asA(async (tx) => {
      const out: string[] = [];
      for (let i = 0; i < 30; i++) out.push(await addClaim(tx, br.brief_id, `주장 ${i}`));
      return out;
    });
    await expectDbError(asA((tx) => addClaim(tx, br.brief_id)), /30개까지/);
    await asA((tx) => tx.query("select archive_brief_claim($1, 1)", [claims[0]]));
    await asA((tx) => addClaim(tx, br.brief_id));

    const c = claims[1];
    const assets: string[] = [];
    for (let i = 0; i < 11; i++) assets.push(await asset(a, a.projectA, `https://example.com/lim-${i}-${newKey()}`));
    const ids = await asA(async (tx) => {
      const out: string[] = [];
      for (let i = 0; i < 10; i++) out.push(await link(tx, c, "asset", assets[i]));
      return out;
    });
    await expectDbError(asA((tx) => link(tx, c, "asset", assets[10])), /10개까지/);
    await asA((tx) => tx.query("select unlink_claim_source($1)", [ids[0]]));
    await asA((tx) => link(tx, c, "asset", assets[10]));
  }, 60_000);
});

describe("DEC-09 B: 같은 고객 공통 자료(20261119001000_dec09_client_assets)", () => {
  /** 프로젝트 없이 고객에게 올린 자료 */
  const clientAsset = (f: Fixture, clientId: string, url: string) =>
    asUser(db, f.userId, async (tx) =>
      (await one<{ id: string }>(tx, "insert into source_assets (workspace_id, client_id, kind, url) values ($1, $2, 'url', $3) returning id", [f.workspaceId, clientId, url])).id,
    );
  const scopeOf = async (sourceId: string) =>
    (await one<{ scope: string | null }>(db, "select details ->> 'scope' as scope from audit_events where entity_type = 'content_brief' and action = 'source_link' and details ->> 'source_id' = $1", [sourceId])).scope;

  it("같은 고객 공통 자료는 허용(감사 scope=client), 이 프로젝트 자료는 그대로(scope=project)", async () => {
    const s = await setup();
    const br = await asA((tx) => createBrief(tx, s.itemId));
    const c = await asA((tx) => addClaim(tx, br.brief_id));
    const common = await clientAsset(a, a.clientA, "https://example.com/common-a");
    const own = await asset(a, a.projectA, "https://example.com/own-a");
    // 고객과 이 프로젝트를 둘 다 지정한 자료도 프로젝트 자료다
    const both = await asUser(db, a.userId, async (tx) =>
      (await one<{ id: string }>(tx, "insert into source_assets (workspace_id, client_id, project_id, kind, url) values ($1, $2, $3, 'url', 'https://example.com/both') returning id", [a.workspaceId, a.clientA, a.projectA])).id,
    );
    const s1 = await asA((tx) => link(tx, c, "asset", common));
    const s2 = await asA((tx) => link(tx, c, "asset", own));
    const s3 = await asA((tx) => link(tx, c, "asset", both));
    expect([await scopeOf(s1), await scopeOf(s2), await scopeOf(s3)]).toEqual(["client", "project", "project"]);
    // 같은 공통 자료 중복은 그대로 거절, 해제 뒤 다시 연결 가능
    await expectDbError(asA((tx) => link(tx, c, "asset", common)), /이미 연결한 근거/);
    await asA((tx) => tx.query("select unlink_claim_source($1)", [s1]));
    await asA((tx) => link(tx, c, "asset", common));
    // 프로필·외부 출처 연결의 감사 기록에는 scope 가 없다
    const sp = await asA((tx) => link(tx, c, "profile", a.profileA1, "products"));
    expect(await scopeOf(sp)).toBeNull();
  });

  it("다른 고객 공통 자료·같은 고객의 다른 프로젝트 자료·남의 업무실 공통 자료는 같은 문구로 거절", async () => {
    const s = await setup();
    const br = await asA((tx) => createBrief(tx, s.itemId));
    const c = await asA((tx) => addClaim(tx, br.brief_id));
    const otherClient = await clientAsset(a, a.clientB, "https://example.com/common-b");
    await expectDbError(asA((tx) => link(tx, c, "asset", otherClient)), /이 프로젝트의 자료나 같은 고객의 공통 자료만/);
    // 같은 고객(A)의 다른 프로젝트 자료: C안이 아님을 확인
    const projectA2 = await asUser(db, a.userId, async (tx) =>
      (await one<{ id: string }>(tx, "insert into projects (workspace_id, client_id, kind, title) values ($1, $2, 'client', 'A 두 번째') returning id", [a.workspaceId, a.clientA])).id,
    );
    const siblingAsset = await asset(a, projectA2, "https://example.com/a2");
    await expectDbError(asA((tx) => link(tx, c, "asset", siblingAsset)), /이 프로젝트의 자료나 같은 고객의 공통 자료만/);
    // 남의 업무실 공통 자료(그 업무실의 고객 A)
    const foreign = await clientAsset(b, b.clientA, "https://example.com/foreign");
    await expectDbError(asA((tx) => link(tx, c, "asset", foreign)), /이 프로젝트의 자료나 같은 고객의 공통 자료만/);
    // 프로필 항목을 붙인 asset 은 여전히 거절
    const common = await clientAsset(a, a.clientA, "https://example.com/common-a2");
    await expectDbError(asA((tx) => link(tx, c, "asset", common, "products")), /SOURCE_MISMATCH/);
    expect(await count("select 1 from content_claim_sources where claim_id = $1", [c])).toBe(0);
  });

  it("함수 정의: 정의자·search_path 고정·실행 권한(authenticated 만)은 그대로", async () => {
    const f = await one<{ secdef: boolean; cfg: string[]; anon: boolean; auth: boolean; pub: boolean }>(
      db,
      `select p.prosecdef as secdef, p.proconfig as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE') as pub
         from pg_proc p where p.oid = 'public.link_claim_source(uuid, text, uuid, text, text)'::regprocedure`,
    );
    expect(f).toEqual({ secdef: true, cfg: ['search_path=""'], anon: false, auth: true, pub: false });
  });
});

describe("전략 기준·정책", () => {
  it("전략 v2 승인 뒤 참조 유지(자동 없음), 다시 맞추기, 프로필 근거가 다르면 거절", async () => {
    const s = await setup();
    const br = await asA((tx) => createBrief(tx, s.itemId));
    const c = await asA((tx) => addClaim(tx, br.brief_id));
    await asA((tx) => link(tx, c, "profile", a.profileA1, "products"));
    await expectDbError(asA((tx) => tx.query("select rebase_content_brief($1, 1)", [br.brief_id])), /이미 지금 승인된/);

    // 같은 프로필 기준의 v2 승인
    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [s.artifactId])).revision;
    const edited = { ...s.content, facts: s.content.facts.map((x) => ({ ...x, text: `${x.text} v2` })) };
    const v2 = await asA(async (tx) => {
      const v = await one<{ version_id: string }>(tx, "select * from save_strategy_manual_version($1, $2, $3)", [s.artifactId, rev, JSON.stringify(edited)]);
      await tx.query("select decide_version($1, $2, 'approved', null)", [s.artifactId, v.version_id]);
      return v.version_id;
    });
    expect((await one<{ v: string }>(db, "select strategy_version_id as v from content_briefs where id = $1", [br.brief_id])).v).toBe(s.versionId);
    await expectDbError(asA((tx) => tx.query("select rebase_content_brief($1, 9)", [br.brief_id])), /CONFLICT/);
    expect(await asA((tx) => one<{ r: number }>(tx, "select rebase_content_brief($1, 1) as r", [br.brief_id]))).toEqual({ r: 2 });
    expect((await one<{ v: string }>(db, "select strategy_version_id as v from content_briefs where id = $1", [br.brief_id])).v).toBe(v2);

    // 다른 프로필을 쓰는 v3 를 관리자 권한으로 흉내(프로필 버전 2는 같은 고객) → 프로필 근거 때문에 거절
    const pv2 = (await one<{ id: string }>(db, "insert into company_profile_versions (workspace_id, client_id, version, products) values ($1, $2, 3, '합성') returning id", [a.workspaceId, a.clientA])).id;
    const v3 = (await one<{ id: string }>(db, "insert into artifact_versions (workspace_id, artifact_id, version, content, generator) values ($1, $2, 99, $3, 'manual') returning id", [
      a.workspaceId, s.artifactId, JSON.stringify({ ...edited, profileRef: { id: pv2, version: 3 } }),
    ])).id;
    await db.exec("set session_replication_role = replica");
    await db.query("update artifacts set approved_version_id = $1 where id = $2", [v3, s.artifactId]);
    await db.exec("set session_replication_role = origin");
    await expectDbError(asA((tx) => tx.query("select rebase_content_brief($1, 2)", [br.brief_id])), /이전 프로필 근거를 먼저 해제/);
  });

  it("N2: 기준 프로필을 철회해도 프로필 근거 연결은 막지 않는다", async () => {
    const c0 = await seedOwner(db, "brief-owner-c@example.test");
    await asUser(db, c0.userId, (tx) => approveProfile(tx, c0.profileA1));
    const s = await setup(c0);
    await asUser(db, c0.userId, (tx) => approveProfile(tx, c0.profileA1, "revoked"));
    const br = await asUser(db, c0.userId, (tx) => createBrief(tx, s.itemId));
    const c = await asUser(db, c0.userId, (tx) => addClaim(tx, br.brief_id));
    await asUser(db, c0.userId, (tx) => link(tx, c, "profile", c0.profileA1, "products"));
  });

  it("보관한 카드·보관한 브리프·보관한 프로젝트·취소된 작업은 고칠 수 없다", async () => {
    const d = await seedOwner(db, "brief-owner-d@example.test");
    await asUser(db, d.userId, (tx) => approveProfile(tx, d.profileA1));
    const s = await setup(d);
    const asD = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, d.userId, fn);
    const br = await asD((tx) => createBrief(tx, s.itemId));
    const c = await asD((tx) => addClaim(tx, br.brief_id));

    await db.query("update projects set status = 'archived' where id = $1", [d.projectA]);
    await expectDbError(asD((tx) => addClaim(tx, br.brief_id)), /보관한 프로젝트/);
    await expectDbError(asD((tx) => createBrief(tx, s.itemId, "linkedin")), /보관한 프로젝트/);
    await db.query("update projects set status = 'active' where id = $1", [d.projectA]);

    // 카드 보관 → 브리프 읽기 전용, 새 채널 생성도 거절
    await asD((tx) => tx.query("select archive_funnel_item($1, 1)", [s.itemId]));
    await expectDbError(asD((tx) => updateBrief(tx, br.brief_id, 1)), /보관한 퍼널 카드의 브리프/);
    await expectDbError(asD((tx) => link(tx, c, "profile", d.profileA1, "products")), /보관한 퍼널 카드의 브리프/);
    await expectDbError(asD((tx) => createBrief(tx, s.itemId, "newsletter")), /보관한 퍼널 카드에는/);
    // 이미 있는 것은 reused 로 돌려준다
    expect((await asD((tx) => createBrief(tx, s.itemId))).reused).toBe(true);

    // 브리프 보관(새 카드)
    const s2 = await setup(d);
    const br2 = await asD((tx) => createBrief(tx, s2.itemId));
    await asD((tx) => tx.query("select archive_content_brief($1, 1)", [br2.brief_id]));
    await expectDbError(asD((tx) => addClaim(tx, br2.brief_id)), /보관한 브리프/);
    await expectDbError(asD((tx) => tx.query("select archive_content_brief($1, 2)", [br2.brief_id])), /이미 보관한 브리프/);

    // 작업 취소
    await db.exec("set session_replication_role = replica");
    await db.query("update tasks set status = 'cancelled' where id = $1", [s2.taskId]);
    await db.exec("set session_replication_role = origin");
    const s2item2 = (await one<{ id: string }>(db, "select id from funnel_items where funnel_id = $1", [s2.funnelId])).id;
    await expectDbError(asD((tx) => createBrief(tx, s2item2, "linkedin")), /취소된 작업/);
  });
});

describe("업무실 경계 (P0)", () => {
  it("남의 카드·브리프·주장·근거는 NOT_FOUND, 직접 쓰기·TRUNCATE 거절, 조회 0행, anon 거절", async () => {
    const s = await setup();
    const br = await asA((tx) => createBrief(tx, s.itemId));
    const c = await asA((tx) => addClaim(tx, br.brief_id));
    const src = await asA((tx) => link(tx, c, "profile", a.profileA1, "products"));
    await expectDbError(asB((tx) => createBrief(tx, s.itemId, "linkedin")), /NOT_FOUND/);
    await expectDbError(asB((tx) => updateBrief(tx, br.brief_id, 1)), /NOT_FOUND/);
    await expectDbError(asB((tx) => tx.query("select rebase_content_brief($1, 1)", [br.brief_id])), /NOT_FOUND/);
    await expectDbError(asB((tx) => tx.query("select archive_content_brief($1, 1)", [br.brief_id])), /NOT_FOUND/);
    await expectDbError(asB((tx) => addClaim(tx, br.brief_id)), /NOT_FOUND/);
    await expectDbError(asB((tx) => tx.query("select update_brief_claim($1, 1, 'x', 'other')", [c])), /NOT_FOUND/);
    await expectDbError(asB((tx) => tx.query("select archive_brief_claim($1, 1)", [c])), /NOT_FOUND/);
    await expectDbError(asB((tx) => link(tx, c, "profile", b.profileA1, "products")), /NOT_FOUND/);
    await expectDbError(asB((tx) => tx.query("select unlink_claim_source($1)", [src])), /NOT_FOUND/);

    await expectDbError(asA((tx) => tx.query("update content_briefs set title = 'x' where id = $1", [br.brief_id])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("insert into content_brief_claims (workspace_id, brief_id, text, position, created_by) values ($1, $2, 'x', 9, $3)", [a.workspaceId, br.brief_id, a.userId])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("update content_claim_sources set unlinked_at = now() where id = $1", [src])), /permission denied/);
    for (const t of ["content_briefs", "content_brief_claims", "content_claim_sources"]) {
      await expectDbError(asA((tx) => tx.query(`truncate ${t}`)), /permission denied/);
      await expectDbError(asA((tx) => tx.query(`delete from ${t}`)), /permission denied/);
      expect(await asB((tx) => tx.query(`select 1 from ${t}`).then((r) => r.rows.length))).toBe(0);
      await expectDbError(asAnon((tx) => tx.query(`select * from ${t}`)), /permission denied/);
    }
    expect(await asA((tx) => tx.query("select 1 from content_briefs where id = $1", [br.brief_id]).then((r) => r.rows.length))).toBe(1);
    await expectDbError(asAnon((tx) => createBrief(tx, s.itemId)), /permission denied/);
    await expectDbError(asA((tx) => tx.query("select app.assert_brief_open($1)", [br.brief_id])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("select app.brief_audit($1, $2, 'x', null, '{}')", [a.workspaceId, br.brief_id])), /permission denied/);
  });

  it("정의자 함수 9개: search_path 고정, 소유 조건 WHERE 안 잠금, public·anon 실행 불가", async () => {
    const names = ["create_content_brief", "update_content_brief", "rebase_content_brief", "archive_content_brief", "add_brief_claim",
      "update_brief_claim", "archive_brief_claim", "link_claim_source", "unlink_claim_source"];
    const rows = (await db.query<{ proname: string; prosecdef: boolean; cfg: string; anon: boolean; pub: boolean; auth: boolean; src: string }>(
      `select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as cfg, p.prosrc as src,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e where e.grantee = 0 and e.privilege_type = 'EXECUTE') as pub,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [names],
    )).rows;
    expect(rows).toHaveLength(9);
    for (const r of rows) {
      expect({ ...r, src: undefined }, r.proname).toMatchObject({ prosecdef: true, cfg: 'search_path=""', anon: false, pub: false, auth: true });
      expect(r.src, r.proname).toMatch(/and exists \(select 1 from public\.workspaces w where w\.id = x\.workspace_id and w\.owner_user_id = uid\)\s+for update of x/);
    }
  });
});

describe("값 규칙", () => {
  let briefId: string;
  let itemId: string;
  beforeAll(async () => {
    const s = await setup();
    itemId = s.itemId;
    briefId = (await asA((tx) => createBrief(tx, s.itemId))).brief_id;
  }, 60_000);

  it("채널별 spec: 그 채널 키만, 길이·개수·형식", async () => {
    const bad = async (channel: string, spec: unknown) =>
      expectDbError(asA((tx) => createBrief(tx, itemId, channel, spec)), /채널별 항목 형식/);
    await bad("linkedin", { format: "reel" }); // 다른 채널 키
    await bad("linkedin", { score: 1 }); // 모르는 키
    await bad("newsletter", { subjectLines: Array(6).fill("제목") });
    await bad("newsletter", { outline: [" "] });
    await bad("newsletter", ["x"]);
    await expectDbError(asA((tx) => updateBrief(tx, briefId, 1, { spec: { titleIdeas: ["가".repeat(201)] } })), /채널별 항목 형식/);
    await expectDbError(asA((tx) => updateBrief(tx, briefId, 1, { spec: { format: "feed" } })), /채널별 항목 형식/); // blog 브리프에 인스타 키
    expect(await asA((tx) => updateBrief(tx, briefId, 1, { spec: { titleIdeas: ["제목 1"], outline: ["1장"], keywords: ["키워드"] } }))).toBe(2);
    await expectDbError(asA((tx) => createBrief(tx, itemId, "tiktok")), /알 수 없는 채널/);
    // 표 CHECK 도 같은 규칙(관리자 직접 쓰기)
    await expectDbError(db.query("update content_briefs set channel_spec = '{\"format\":\"feed\"}' where id = $1", [briefId]), /check constraint/);
  });

  it("공통 필드: 제목 필수, 길이, 공백만이면 null, copy_origin ai 거절, 상태", async () => {
    await expectDbError(asA((tx) => createBrief(tx, itemId, "linkedin", {}, "\u00a0 \n")), /제목은 1~200자/);
    const rev = (await one<{ revision: number }>(db, "select revision from content_briefs where id = $1", [briefId])).revision;
    await expectDbError(asA((tx) => updateBrief(tx, briefId, rev, { origin: "ai" })), /알 수 없는 카피 작성 방식/);
    await expectDbError(asA((tx) => updateBrief(tx, briefId, rev, { status: "published" })), /알 수 없는 진행 상태/);
    await expectDbError(asA((tx) => updateBrief(tx, briefId, rev, { hook: "가".repeat(301) })), /훅 문장은\(는\) 300자 이하/);
    await expectDbError(asA((tx) => updateBrief(tx, briefId, rev, { copy: "가".repeat(5001) })), /카피 초안은\(는\) 5000자 이하/);
    await asA((tx) => updateBrief(tx, briefId, rev, { hook: " \t\n", copy: "\ufeff" }));
    expect(await one(db, "select hook, copy_draft from content_briefs where id = $1", [briefId])).toEqual({ hook: null, copy_draft: null });
    await expectDbError(asA((tx) => addClaim(tx, briefId, "   ")), /주장 문장은 1~500자/);
    await expectDbError(asA((tx) => addClaim(tx, briefId, "x", "rumor")), /알 수 없는 주장 종류/);
    // 표 CHECK: 정리되지 않은 값·ai 는 관리자도 넣지 못한다
    await expectDbError(db.query("update content_briefs set copy_origin = 'ai' where id = $1", [briefId]), /check constraint/);
    await expectDbError(db.query("update content_briefs set hook = '  훅' where id = $1", [briefId]), /check constraint/);
    // 고정 열
    await expectDbError(db.query("update content_briefs set channel = 'linkedin' where id = $1", [briefId]), /FROZEN_COLUMN/);
  });
});
