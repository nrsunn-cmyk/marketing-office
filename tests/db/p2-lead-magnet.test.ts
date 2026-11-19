/**
 * P2E-BACKEND-01: 리드마그넷 기획 DB(20261119004000_p2e_lead_magnets) 시험.
 * 설계: Plan/Claude-Backend-20261118/P2E-BACKEND-01-DESIGN.md 10절. 모든 값은 합성이다.
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
  a = await seedOwner(db, "lead-owner-a@example.test");
  b = await seedOwner(db, "lead-owner-b@example.test");
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
  await asUser(db, a.userId, (tx) => approveProfile(tx, a.profileA1));
  await asUser(db, b.userId, (tx) => approveProfile(tx, b.profileA1));
}, 60_000);

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const asAnon = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn);
const count = async (sql: string, p: unknown[] = []) => (await one<{ n: number }>(db, `select count(*)::int as n from (${sql}) x`, p)).n;

const approveProfile = (tx: Tx, id: string) =>
  tx.query(
    "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
    [id],
  );

async function strategy(f: Fixture) {
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
    await tx.query("select decide_version($1, $2, 'approved', null)", [g.artifact_id, g.version_id]);
    return { taskId, artifactId: g.artifact_id, versionId: g.version_id, content: d.result };
  });
}

/** 승인 전략 → 퍼널. 단계 id 를 순서대로 돌려준다 */
async function funnel(f: Fixture) {
  const s = await strategy(f);
  const fn = await asUser(db, f.userId, (tx) => one<{ funnel_id: string }>(tx, "select * from create_funnel($1)", [s.artifactId]));
  const st = (await db.query<{ id: string }>("select id from funnel_stages where funnel_id = $1 order by position", [fn.funnel_id])).rows.map((r) => r.id);
  return { ...s, funnelId: fn.funnel_id, stages: st };
}

type LmOpts = { title?: string; format?: string; audience?: string | null; promise?: string | null; delivery?: string | null; leadFields?: unknown; outline?: unknown; status?: string };
const createLm = (tx: Tx, stageId: string, o: LmOpts = {}) =>
  one<{ id: string }>(tx, "select create_lead_magnet($1, $2, $3, $4, $5, $6, $7, $8, $9) as id", [
    stageId, o.title ?? "합성 체크리스트", o.format ?? "checklist",
    o.audience === undefined ? "합성 대상" : o.audience, o.promise === undefined ? "합성 가치" : o.promise,
    o.delivery === undefined ? "download" : o.delivery,
    JSON.stringify(o.leadFields ?? ["회사 이메일"]), JSON.stringify(o.outline ?? ["1장"]), o.status ?? "planned",
  ]).then((r) => r.id);
const updateLm = (tx: Tx, id: string, rev: number, stageId: string, o: LmOpts = {}) =>
  one<{ r: number }>(tx, "select update_lead_magnet($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as r", [
    id, rev, stageId, o.title ?? "고친 리드마그넷", o.format ?? "guide",
    o.audience === undefined ? null : o.audience, o.promise === undefined ? null : o.promise, o.delivery === undefined ? "email" : o.delivery,
    JSON.stringify(o.leadFields ?? []), JSON.stringify(o.outline ?? []), o.status ?? "drafting",
  ]).then((x) => x.r);
const lmRow = (id: string) =>
  one<{ stage_id: string; revision: number; title: string; format: string; audience: string | null; promise: string | null; delivery: string | null; lead_fields: unknown; outline: unknown; status: string; archived_at: string | null; strategy_version_id: string; project_id: string; created_by: string }>(
    db, "select * from lead_magnets where id = $1", [id],
  );
const addItem = (tx: Tx, stageId: string, kind = "cta") =>
  one<{ id: string }>(tx, "select add_funnel_item($1, $2, '합성 카드', null, null, 'planned', null, null) as id", [stageId, kind]).then((r) => r.id);
const itemRev = async (id: string) => (await one<{ revision: number }>(db, "select revision from funnel_items where id = $1", [id])).revision;
const link = (tx: Tx, itemId: string, rev: number, lmId: string | null) =>
  one<{ r: number }>(tx, "select set_funnel_item_lead_magnet($1, $2, $3) as r", [itemId, rev, lmId]).then((x) => x.r);

describe("정상 흐름", () => {
  it("만들기(퍼널 전략 버전 복사·앞뒤 정리) → 수정·단계 이동 → 보관, 감사 기록", async () => {
    const f = await funnel(a);
    const id = await asA((tx) =>
      createLm(tx, f.stages[2], { title: "  진단 체크리스트 ", audience: "\n  초기 창업자 ", promise: "   ", leadFields: [" 회사 이메일 ", "회사명"], outline: ["\t1장 자가진단 "] }),
    );
    expect(await lmRow(id)).toMatchObject({
      stage_id: f.stages[2], revision: 1, title: "진단 체크리스트", format: "checklist", audience: "초기 창업자", promise: null, delivery: "download",
      lead_fields: ["회사 이메일", "회사명"], outline: ["1장 자가진단"], status: "planned", archived_at: null,
      strategy_version_id: f.versionId, project_id: a.projectA, created_by: a.userId,
    });

    expect(await asA((tx) => updateLm(tx, id, 1, f.stages[3], { status: "ready", delivery: null }))).toBe(2);
    expect(await lmRow(id)).toMatchObject({ stage_id: f.stages[3], title: "고친 리드마그넷", format: "guide", audience: null, delivery: null, lead_fields: [], status: "ready" });

    await expectDbError(asA((tx) => updateLm(tx, id, 1, f.stages[3])), /CONFLICT/);
    expect(await asA((tx) => one<{ r: number }>(tx, "select archive_lead_magnet($1, 2) as r", [id]))).toEqual({ r: 3 });
    await expectDbError(asA((tx) => updateLm(tx, id, 3, f.stages[3])), /INVALID_TRANSITION: 보관한 리드마그넷/);
    await expectDbError(asA((tx) => tx.query("select archive_lead_magnet($1, 3)", [id])), /INVALID_TRANSITION: 이미 보관/);

    const acts = (await db.query<{ action: string; actor_id: string; revision: number }>(
      "select action, actor_id, revision from audit_events where entity_type = 'lead_magnet' and entity_id = $1 order by seq", [id],
    )).rows;
    expect(acts.map((x) => [x.action, x.revision])).toEqual([["lead_magnet_create", 1], ["lead_magnet_update", 2], ["lead_magnet_archive", 3]]);
    expect(acts.every((x) => x.actor_id === a.userId)).toBe(true);
  });
});

describe("값 규칙", () => {
  it("형식·전달 방식·상태·길이·배열·빈 제목은 VALIDATION", async () => {
    const f = await funnel(a);
    const s = f.stages[2];
    await expectDbError(asA((tx) => createLm(tx, s, { title: "  ﻿ " })), /VALIDATION: 제목/);
    await expectDbError(asA((tx) => createLm(tx, s, { title: "가".repeat(201) })), /VALIDATION: 제목/);
    await expectDbError(asA((tx) => createLm(tx, s, { format: "ebook" })), /VALIDATION: 알 수 없는 리드마그넷 형식/);
    await expectDbError(asA((tx) => createLm(tx, s, { delivery: "fax" })), /VALIDATION: 알 수 없는 전달 방식/);
    await expectDbError(asA((tx) => createLm(tx, s, { status: "published" })), /VALIDATION: 알 수 없는 진행 상태/);
    await expectDbError(asA((tx) => createLm(tx, s, { audience: "가".repeat(501) })), /VALIDATION: 대상/);
    await expectDbError(asA((tx) => createLm(tx, s, { promise: "가".repeat(501) })), /VALIDATION: 약속하는 가치/);
    await expectDbError(asA((tx) => createLm(tx, s, { leadFields: Array.from({ length: 11 }, (_, i) => `항목${i}`) })), /VALIDATION: 수집할 정보/);
    await expectDbError(asA((tx) => createLm(tx, s, { leadFields: ["  "] })), /VALIDATION: 수집할 정보/);
    await expectDbError(asA((tx) => createLm(tx, s, { leadFields: [1] })), /VALIDATION: 수집할 정보/);
    await expectDbError(asA((tx) => createLm(tx, s, { leadFields: { a: 1 } })), /VALIDATION: 수집할 정보/);
    await expectDbError(asA((tx) => createLm(tx, s, { outline: ["가".repeat(301)] })), /VALIDATION: 구성/);
    await expectDbError(asA((tx) => createLm(tx, s, { outline: Array.from({ length: 21 }, () => "줄") })), /VALIDATION: 구성/);
    // 경계값은 통과
    await asA((tx) => createLm(tx, s, { title: "가".repeat(200), audience: "가".repeat(500), leadFields: Array.from({ length: 10 }, () => "가".repeat(50)), outline: Array.from({ length: 20 }, () => "가".repeat(300)) }));
  });

  it("퍼널마다 활성 20개까지, 보관한 것은 세지 않는다", async () => {
    const f = await funnel(a);
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await asA((tx) => createLm(tx, f.stages[i % 5], { title: `리드 ${i}` })));
    await expectDbError(asA((tx) => createLm(tx, f.stages[0])), /VALIDATION: 한 퍼널에는 리드마그넷을 20개까지/);
    await asA((tx) => tx.query("select archive_lead_magnet($1, 1)", [ids[0]]));
    await asA((tx) => createLm(tx, f.stages[0], { title: "보관 뒤 새것" }));
    expect(await count("select 1 from lead_magnets where funnel_id = $1", [f.funnelId])).toBe(21);
    // 다른 퍼널은 따로 센다
    const g = await funnel(a);
    await asA((tx) => createLm(tx, g.stages[0]));
  });

  it("단계는 같은 퍼널 안에서만, 표 수준에서도 FK 가 막는다", async () => {
    const f1 = await funnel(a);
    const f2 = await funnel(a);
    const id = await asA((tx) => createLm(tx, f1.stages[0]));
    await expectDbError(asA((tx) => updateLm(tx, id, 1, f2.stages[1])), /VALIDATION: 같은 퍼널의 단계만/);
    await expectDbError(db.query("update lead_magnets set stage_id = $1 where id = $2", [f2.stages[1], id]), /foreign key|violates/);
    await expectDbError(db.query("update lead_magnets set funnel_id = $1 where id = $2", [f2.funnelId, id]), /FROZEN_COLUMN/);
  });
});

describe("읽기 전용(퍼널·브리프와 같은 규칙)", () => {
  it("보관한 프로젝트·취소된 전략 작업에서는 만들기·수정·연결 거절, 다시 열면 된다", async () => {
    const c = await seedOwner(db, "lead-owner-c@example.test");
    await asUser(db, c.userId, (tx) => approveProfile(tx, c.profileA1));
    const f = await funnel(c);
    const asC = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, c.userId, fn);
    const id = await asC((tx) => createLm(tx, f.stages[2]));
    const item = await asC((tx) => addItem(tx, f.stages[3]));

    await db.exec("set session_replication_role = replica");
    await db.query("update projects set status = 'archived' where id = $1", [c.projectA]);
    await db.exec("set session_replication_role = origin");
    await expectDbError(asC((tx) => createLm(tx, f.stages[2])), /INVALID_TRANSITION: 보관한 프로젝트/);
    await expectDbError(asC((tx) => updateLm(tx, id, 1, f.stages[2])), /INVALID_TRANSITION: 보관한 프로젝트/);
    await expectDbError(asC((tx) => tx.query("select archive_lead_magnet($1, 1)", [id])), /INVALID_TRANSITION/);
    await expectDbError(asC((tx) => link(tx, item, 1, id)), /INVALID_TRANSITION/);

    await db.exec("set session_replication_role = replica");
    await db.query("update projects set status = 'active' where id = $1", [c.projectA]);
    await db.query("update tasks set status = 'cancelled' where id = $1", [f.taskId]);
    await db.exec("set session_replication_role = origin");
    await expectDbError(asC((tx) => updateLm(tx, id, 1, f.stages[2])), /INVALID_TRANSITION: 취소된 작업/);

    await db.exec("set session_replication_role = replica");
    await db.query("update tasks set status = 'completed' where id = $1", [f.taskId]);
    await db.exec("set session_replication_role = origin");
    expect(await asC((tx) => updateLm(tx, id, 1, f.stages[2]))).toBe(2);
  });
});

describe("전략 버전 고정·stale (DEC-P2-01-A)", () => {
  it("전략 v2 승인 뒤: 참조는 v1 그대로(편집은 됨), 다시 맞추기로만 v2", async () => {
    const f = await funnel(a);
    const id = await asA((tx) => createLm(tx, f.stages[2]));
    await expectDbError(asA((tx) => tx.query("select rebase_lead_magnet($1, 1)", [id])), /VALIDATION: 이미/);

    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [f.artifactId])).revision;
    const edited = { ...f.content, facts: f.content.facts.map((x) => ({ ...x, text: `${x.text} v2` })) };
    const v2 = await asA(async (tx) => {
      const v = await one<{ version_id: string }>(tx, "select * from save_strategy_manual_version($1, $2, $3)", [f.artifactId, rev, JSON.stringify(edited)]);
      await tx.query("select decide_version($1, $2, 'approved', null)", [f.artifactId, v.version_id]);
      return v.version_id;
    });
    expect((await lmRow(id)).strategy_version_id).toBe(f.versionId);
    // stale 이어도 편집은 막지 않는다
    expect(await asA((tx) => updateLm(tx, id, 1, f.stages[2]))).toBe(2);
    // 새로 만들면 퍼널의 참조 버전(v1)을 복사한다(퍼널을 다시 맞춘 뒤에야 v2)
    const id2 = await asA((tx) => createLm(tx, f.stages[2]));
    expect((await lmRow(id2)).strategy_version_id).toBe(f.versionId);

    await expectDbError(asA((tx) => tx.query("select rebase_lead_magnet($1, 1)", [id])), /CONFLICT/);
    expect(await asA((tx) => one<{ r: number }>(tx, "select rebase_lead_magnet($1, 2) as r", [id]))).toEqual({ r: 3 });
    expect((await lmRow(id)).strategy_version_id).toBe(v2);
    const d = await one<{ details: { from_version_id: string; to_version_id: string } }>(
      db, "select details from audit_events where entity_type = 'lead_magnet' and entity_id = $1 and action = 'lead_magnet_rebase'", [id],
    );
    expect(d.details).toEqual({ from_version_id: f.versionId, to_version_id: v2 });
  });
});

describe("퍼널 카드 연결", () => {
  it("CTA·리드마그넷 카드 → 같은 퍼널의 리드마그넷 연결·해제, 감사 기록", async () => {
    const f = await funnel(a);
    const lm = await asA((tx) => createLm(tx, f.stages[2]));
    const cta = await asA((tx) => addItem(tx, f.stages[3], "cta"));
    const old = await asA((tx) => addItem(tx, f.stages[2], "lead_magnet"));
    expect(await asA((tx) => link(tx, cta, 1, lm))).toBe(2);
    expect(await asA((tx) => link(tx, old, 1, lm))).toBe(2);
    expect(await count("select 1 from funnel_items where lead_magnet_id = $1", [lm])).toBe(2);
    await expectDbError(asA((tx) => link(tx, cta, 2, lm)), /VALIDATION: 이미 그렇게/);
    await expectDbError(asA((tx) => link(tx, cta, 1, null)), /CONFLICT/);
    expect(await asA((tx) => link(tx, cta, 2, null))).toBe(3);
    expect((await one<{ l: string | null }>(db, "select lead_magnet_id as l from funnel_items where id = $1", [cta])).l).toBeNull();
    const acts = (await db.query<{ details: Record<string, string | null> }>(
      "select details from audit_events where entity_type = 'funnel_item' and entity_id = $1 and action = 'item_link_lead_magnet' order by seq", [cta],
    )).rows.map((x) => [x.details.from_lead_magnet_id, x.details.to_lead_magnet_id]);
    expect(acts).toEqual([[null, lm], [lm, null]]);
  });

  it("콘텐츠 카드·다른 퍼널·보관한 리드마그넷·보관한 카드는 거절", async () => {
    const f = await funnel(a);
    const g = await funnel(a);
    const lm = await asA((tx) => createLm(tx, f.stages[2]));
    const other = await asA((tx) => createLm(tx, g.stages[2]));
    const content = await asA((tx) => addItem(tx, f.stages[1], "content"));
    const cta = await asA((tx) => addItem(tx, f.stages[3], "cta"));
    await expectDbError(asA((tx) => link(tx, content, 1, lm)), /VALIDATION: 전환 오퍼·리드마그넷 카드만/);
    await expectDbError(asA((tx) => link(tx, cta, 1, other)), /VALIDATION: 같은 퍼널의 리드마그넷만/);
    await expectDbError(asA((tx) => link(tx, cta, 1, "00000000-0000-4000-8000-000000000000")), /VALIDATION: 같은 퍼널의 리드마그넷만/);
    // 표 수준에서도: 다른 퍼널(FK)·콘텐츠 카드(CHECK)
    await expectDbError(db.query("update funnel_items set lead_magnet_id = $1 where id = $2", [other, cta]), /foreign key|violates/);
    await expectDbError(db.query("update funnel_items set lead_magnet_id = $1 where id = $2", [lm, content]), /funnel_items_lead_magnet_kind|violates/);

    // 연결된 뒤 리드마그넷을 보관하면 연결은 남고, 새 연결은 거절
    const cta2 = await asA((tx) => addItem(tx, f.stages[3], "cta"));
    await asA((tx) => link(tx, cta, 1, lm));
    await asA((tx) => tx.query("select archive_lead_magnet($1, 1)", [lm]));
    expect((await one<{ l: string }>(db, "select lead_magnet_id as l from funnel_items where id = $1", [cta])).l).toBe(lm);
    await expectDbError(asA((tx) => link(tx, cta2, 1, lm)), /INVALID_TRANSITION: 보관한 리드마그넷에는/);
    // 해제는 된다
    expect(await asA((tx) => link(tx, cta, 2, null))).toBe(3);

    await asA((tx) => tx.query("select archive_funnel_item($1, 1)", [cta2]));
    await expectDbError(asA((tx) => link(tx, cta2, 2, null)), /INVALID_TRANSITION: 보관한 카드/);
  });

  it("연결된 카드를 콘텐츠로 바꾸면 거절, 전환 오퍼↔리드마그넷 카드 사이는 허용(update_funnel_item 인자 그대로)", async () => {
    const f = await funnel(a);
    const lm = await asA((tx) => createLm(tx, f.stages[2]));
    const cta = await asA((tx) => addItem(tx, f.stages[3], "cta"));
    await asA((tx) => link(tx, cta, 1, lm));
    const upd = (tx: Tx, rev: number, kind: string) =>
      one<{ r: number }>(tx, "select update_funnel_item($1, $2, $3, $4, '합성', null, null, 'planned', null, null) as r", [cta, rev, f.stages[3], kind]).then((x) => x.r);
    await expectDbError(asA((tx) => upd(tx, 2, "content")), /VALIDATION: 리드마그넷과 연결된 카드는 콘텐츠 유형으로/);
    expect(await asA((tx) => upd(tx, 2, "lead_magnet"))).toBe(3);
    expect(await itemRev(cta)).toBe(3);
    // 해제한 뒤에는 콘텐츠로 바꿀 수 있다
    await asA((tx) => link(tx, cta, 3, null));
    expect(await asA((tx) => upd(tx, 4, "content"))).toBe(5);
  });
});

describe("업무실 경계·권한 (P0)", () => {
  it("남의 단계·리드마그넷·카드는 NOT_FOUND, 소유 조건은 조회 WHERE 안", async () => {
    const f = await funnel(a);
    const lm = await asA((tx) => createLm(tx, f.stages[2]));
    const cta = await asA((tx) => addItem(tx, f.stages[3]));
    await expectDbError(asB((tx) => createLm(tx, f.stages[2])), /NOT_FOUND/);
    await expectDbError(asB((tx) => updateLm(tx, lm, 1, f.stages[2])), /NOT_FOUND/);
    await expectDbError(asB((tx) => tx.query("select rebase_lead_magnet($1, 1)", [lm])), /NOT_FOUND/);
    await expectDbError(asB((tx) => tx.query("select archive_lead_magnet($1, 1)", [lm])), /NOT_FOUND/);
    await expectDbError(asB((tx) => link(tx, cta, 1, null)), /NOT_FOUND/);
    // B 의 카드에서 A 의 리드마그넷을 가리킬 수 없다(다른 퍼널과 같은 문구)
    const fb = await funnel(b);
    const ctaB = await asB((tx) => addItem(tx, fb.stages[3]));
    await expectDbError(asB((tx) => link(tx, ctaB, 1, lm)), /VALIDATION: 같은 퍼널의 리드마그넷만/);

    const bodies = (await db.query<{ proname: string; src: string }>(
      `select proname, prosrc as src from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('create_lead_magnet','update_lead_magnet','rebase_lead_magnet','archive_lead_magnet','set_funnel_item_lead_magnet')`,
    )).rows;
    expect(bodies).toHaveLength(5);
    for (const x of bodies) expect(x.src, x.proname).toMatch(/and exists \(select 1 from public\.workspaces w where w\.id = x\.workspace_id and w\.owner_user_id = uid\)/);
    for (const x of bodies.filter((y) => y.proname !== "create_lead_magnet"))
      expect(x.src, x.proname).toMatch(/and exists \(select 1 from public\.workspaces w where w\.id = x\.workspace_id and w\.owner_user_id = uid\)\s+for update of x/);
  });

  it("직접 쓰기 거절, 남의 업무실 조회 0행, anon 거절, 도우미 함수 실행 불가", async () => {
    const f = await funnel(a);
    const lm = await asA((tx) => createLm(tx, f.stages[2]));
    const cta = await asA((tx) => addItem(tx, f.stages[3]));
    await expectDbError(
      asA((tx) => tx.query(
        "insert into lead_magnets (workspace_id, project_id, funnel_id, stage_id, strategy_artifact_id, strategy_version_id, title, format, created_by) values ($1, $2, $3, $4, $5, $6, 'x', 'other', $7)",
        [a.workspaceId, a.projectA, f.funnelId, f.stages[0], f.artifactId, f.versionId, a.userId],
      )),
      /permission denied/,
    );
    await expectDbError(asA((tx) => tx.query("update lead_magnets set title = 'x' where id = $1", [lm])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("update funnel_items set lead_magnet_id = $1 where id = $2", [lm, cta])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("delete from lead_magnets where id = $1", [lm])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("truncate lead_magnets")), /permission denied/);

    expect(await asA((tx) => tx.query("select 1 from lead_magnets where id = $1", [lm]).then((r) => r.rows.length))).toBe(1);
    expect(await asB((tx) => tx.query("select 1 from lead_magnets where id = $1", [lm]).then((r) => r.rows.length))).toBe(0);

    await expectDbError(asAnon((tx) => createLm(tx, f.stages[2])), /permission denied/);
    await expectDbError(asAnon((tx) => tx.query("select * from lead_magnets")), /permission denied/);
    await expectDbError(asAnon((tx) => link(tx, cta, 1, null)), /permission denied/);
    await expectDbError(asA((tx) => tx.query("select app.check_lead_magnet('x', 'other', null, null, null, '[]', '[]', 'planned')")), /permission denied/);
    await expectDbError(asA((tx) => tx.query("select app.lead_magnet_audit($1, $2, 'x', 1, '{}')", [a.workspaceId, lm])), /permission denied/);
  });

  it("정의자 함수 설정: search_path 고정, public·anon 실행 불가, 로그인 실행 가능", async () => {
    const rows = (await db.query<{ proname: string; prosecdef: boolean; cfg: string; anon: boolean; pub: boolean; auth: boolean }>(
      `select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e where e.grantee = 0 and e.privilege_type = 'EXECUTE') as pub,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.pronamespace = 'public'::regnamespace
          and p.proname in ('create_lead_magnet','update_lead_magnet','rebase_lead_magnet','archive_lead_magnet','set_funnel_item_lead_magnet','update_funnel_item')`,
    )).rows;
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r, r.proname).toMatchObject({ prosecdef: true, cfg: "search_path=\"\"", anon: false, pub: false, auth: true });
    // update_funnel_item 은 한 개(인자 그대로 다시 정의)
    expect(await count("select 1 from pg_proc where proname = 'update_funnel_item'")).toBe(1);
  });
});
