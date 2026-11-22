/**
 * P2G-BACKEND-01: 채널 초안 DB(20261120001000_p2g_channel_drafts) 시험. 설계: Plan/Claude-Backend-20261118/P2G-BACKEND-01-DESIGN.md 7절.
 * Tester QA-PLAN-P2G-01 R1-2(주소 표 세 곳 대조)·R1-3(추가 전용)·R1-4(A1·A2·A13·L6) 반영. 모든 값은 합성이다.
 * 전략은 실제 경로(generate_strategy → decide_version)로 만들고 승인한다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft } from "@/domain/strategy";
import { PUBLICATION_URL_CASES } from "../fixtures/publication-url-cases";
import { asUser, createDb, expectDbError, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "draft-owner-a@example.test");
  b = await seedOwner(db, "draft-owner-b@example.test");
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
  await asUser(db, a.userId, (tx) => approveProfile(tx, a.profileA1));
  await asUser(db, b.userId, (tx) => approveProfile(tx, b.profileA1));
}, 60_000);

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const asAnon = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn);
const count = async (sql: string, p: unknown[] = []) => (await one<{ n: number }>(db, `select count(*)::int as n from (${sql}) x`, p)).n;
const audits = (draftId: string) => count("select 1 from audit_events where entity_type = 'channel_draft' and entity_id = $1", [draftId]);
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

type Funnel = Awaited<ReturnType<typeof strategy>> & { funnelId: string; stages: string[] };
async function funnel(f: Fixture): Promise<Funnel> {
  const s = await strategy(f);
  const fn = await asUser(db, f.userId, (tx) => one<{ funnel_id: string }>(tx, "select * from create_funnel($1)", [s.artifactId]));
  const st = (await db.query<{ id: string }>("select id from funnel_stages where funnel_id = $1 order by position", [fn.funnel_id])).rows.map((r) => r.id);
  return { ...s, funnelId: fn.funnel_id, stages: st };
}

const SPEC = { titleIdeas: ["후보 제목"], outline: ["왜 지금인가", "  세 가지 방법 "], keywords: ["SEO", "seo", "마케팅", "가".repeat(40), "  브랜딩 "] };
type BriefOpts = { channel?: string; status?: "ready" | "drafting"; spec?: unknown; hook?: string | null; title?: string };
/** 카드 하나 + 브리프 하나(기본: blog·ready). 브리프 id 와 revision */
async function brief(f: Fixture, fu: Funnel, o: BriefOpts = {}) {
  return asUser(db, f.userId, async (tx) => {
    const item = (await one<{ id: string }>(tx, "select add_funnel_item($1, 'content', '합성 카드', null, null, 'planned', null, null) as id", [fu.stages[1]])).id;
    const br = await one<{ brief_id: string }>(tx, "select * from create_content_brief($1, $2, $3, $4, $5, $6, $7)", [
      item, o.channel ?? "blog", o.title ?? "합성 블로그 브리프", "합성 타깃", "핵심 요지 ".repeat(30), "무료 진단 신청", JSON.stringify(o.channel && o.channel !== "blog" ? {} : (o.spec ?? SPEC)),
    ]);
    await tx.query("select add_brief_claim($1, '주장 하나', 'capability')", [br.brief_id]);
    const rev = (await one<{ r: number }>(tx, "select update_content_brief($1, 1, $2, '타깃', $3, '핵심 요지', 'CTA 문장', $4, null, 'manual', null, $5) as r", [
      br.brief_id, o.title ?? "합성 블로그 브리프", o.hook === undefined ? "훅 문장" : o.hook, JSON.stringify(o.channel && o.channel !== "blog" ? {} : (o.spec ?? SPEC)), o.status ?? "ready",
    ])).r;
    return { itemId: item, briefId: br.brief_id, revision: rev };
  });
}

const create = (tx: Tx, briefId: string) => one<{ id: string }>(tx, "select create_channel_draft($1) as id", [briefId]).then((r) => r.id);
type DraftVals = { title?: string; body?: string; tags?: unknown; imageNote?: string | null; meta?: string | null; status?: string };
const update = (tx: Tx, id: string, rev: number, v: DraftVals = {}) =>
  one<{ r: number }>(tx, "select update_channel_draft($1, $2, $3, $4, $5, $6, $7, $8) as r", [
    id, rev, v.title ?? "고친 초안", v.body ?? "## 소제목\n본문", JSON.stringify(v.tags ?? ["마케팅"]),
    v.imageNote === undefined ? null : v.imageNote, v.meta === undefined ? null : v.meta, v.status ?? "drafting",
  ]).then((x) => x.r);
const record = (tx: Tx, id: string, url = "https://a.tistory.com/1", at: string | null = new Date().toISOString(), note: string | null = null) =>
  one<{ id: string }>(tx, "select record_channel_publication($1, $2, $3, $4) as id", [id, url, at, note]).then((r) => r.id);
const voidPub = (tx: Tx, pubId: string, reason: string | null = "잘못 적음") =>
  one<{ id: string }>(tx, "select void_channel_publication($1, $2) as id", [pubId, reason]).then((r) => r.id);
const draftRow = (id: string) =>
  one<{
    title: string; body: string; tags: string[]; image_note: string | null; meta_description: string | null; status: string; revision: number;
    archived_at: string | null; strategy_version_id: string; source_brief_revision: number; source_snapshot: Record<string, unknown>; created_by: string; channel: string; language: string;
  }>(db, "select * from channel_drafts where id = $1", [id]);

describe("만들기(Q1 승인본)·입력 사본(A2)·초기값", () => {
  it("ready·blog 브리프로 만든다: 사본 고정, 템플릿 초기값, 감사 1행", async () => {
    const fu = await funnel(a);
    const br = await brief(a, fu);
    const id = await asA((tx) => create(tx, br.briefId));
    const d = await draftRow(id);
    expect(d).toMatchObject({
      channel: "tistory", language: "ko", status: "drafting", revision: 1, archived_at: null, title: "합성 블로그 브리프",
      strategy_version_id: fu.versionId, source_brief_revision: br.revision, created_by: a.userId, image_note: null,
    });
    // 태그: 키워드 앞에서부터 30자로 자르고 정리, 대소문자 무시 중복 제거
    expect(d.tags).toEqual(["SEO", "마케팅", "가".repeat(30), "브랜딩"]);
    expect(d.meta_description).toBe("핵심 요지");
    expect(d.body).toBe("훅 문장\n\n핵심 요지\n\n## 왜 지금인가\n\n(내용을 써 주세요)\n\n## 세 가지 방법\n\n(내용을 써 주세요)\n\nCTA 문장");
    expect(d.source_snapshot).toEqual({
      title: "합성 블로그 브리프", audience: "타깃", hook: "훅 문장", coreMessage: "핵심 요지", cta: "CTA 문장",
      titleIdeas: SPEC.titleIdeas, outline: SPEC.outline, keywords: SPEC.keywords, claims: [{ text: "주장 하나", kind: "capability" }],
    });
    expect(await audits(id)).toBe(1);

    // 브리프를 고쳐도 사본·본문은 그대로
    await asA((tx) => tx.query("select update_content_brief($1, $2, '바뀐 제목', null, null, null, null, '{}', null, 'manual', null, 'ready')", [br.briefId, br.revision]));
    const after = await draftRow(id);
    expect(after.source_snapshot).toEqual(d.source_snapshot);
    expect(after.body).toBe(d.body);
    expect(after.source_brief_revision).toBe(br.revision);
  });

  it("빈 훅·CTA·목차는 건너뛴다, 공격 문자열은 글자로 그대로(HTML 은 내보낼 때 만든다)", async () => {
    const fu = await funnel(a);
    const br = await brief(a, fu, { hook: null, spec: { outline: ["<script>alert(1)</script>"] } });
    const id = await asA((tx) => create(tx, br.briefId));
    expect((await draftRow(id)).body).toBe("핵심 요지\n\n## <script>alert(1)</script>\n\n(내용을 써 주세요)\n\nCTA 문장");
  });

  it("A1 거절 표: drafting·다른 채널·보관 브리프·보관 카드·남의 것·없는 id — 감사 0행", async () => {
    const fu = await funnel(a);
    const before = await count("select 1 from audit_events where entity_type = 'channel_draft'");
    const drafting = await brief(a, fu, { status: "drafting" });
    await expectDbError(asA((tx) => create(tx, drafting.briefId)), /INVALID_TRANSITION: 준비 완료 브리프로만/);
    const insta = await brief(a, fu, { channel: "instagram" });
    await expectDbError(asA((tx) => create(tx, insta.briefId)), /VALIDATION: 티스토리 초안은 블로그 브리프로만/);
    const arch = await brief(a, fu);
    await asA((tx) => tx.query("select archive_content_brief($1, $2)", [arch.briefId, arch.revision]));
    await expectDbError(asA((tx) => create(tx, arch.briefId)), /INVALID_TRANSITION: 보관한 브리프로는/);
    const itemArch = await brief(a, fu);
    await asA((tx) => tx.query("select archive_funnel_item($1, (select revision from funnel_items where id = $1))", [itemArch.itemId]));
    await expectDbError(asA((tx) => create(tx, itemArch.briefId)), /INVALID_TRANSITION: 보관한 퍼널 카드/);
    const mine = await brief(a, fu);
    await expectDbError(asB((tx) => create(tx, mine.briefId)), /NOT_FOUND: 브리프를 찾을 수 없습니다/);
    await expectDbError(asA((tx) => create(tx, "00000000-0000-0000-0000-000000000000")), /NOT_FOUND: 브리프를 찾을 수 없습니다/);
    expect(await count("select 1 from audit_events where entity_type = 'channel_draft'")).toBe(before);
  });

  it("Q7 한도: 보관하지 않은 초안 5개, 보관한 것은 세지 않는다", async () => {
    const fu = await funnel(a);
    const br = await brief(a, fu);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await asA((tx) => create(tx, br.briefId)));
    await expectDbError(asA((tx) => create(tx, br.briefId)), /VALIDATION: 한 브리프에는 초안을 5개까지/);
    await asA((tx) => tx.query("select archive_channel_draft($1, 1)", [ids[0]]));
    expect(await asA((tx) => create(tx, br.briefId))).toBeTruthy();
  });
});

describe("고치기·stale·보관(A13)", () => {
  it("값 전체 교체·정리, CONFLICT, 경계(L6), 감사", async () => {
    const fu = await funnel(a);
    const br = await brief(a, fu);
    const id = await asA((tx) => create(tx, br.briefId));
    expect(await asA((tx) => update(tx, id, 1, { title: "  새 제목 ", body: "  첫 줄\r\n둘째\r셋째  ", tags: [" SEO ", "브랜딩"], imageNote: "  1200×630 ", meta: "  ", status: "reviewed" }))).toBe(2);
    expect(await draftRow(id)).toMatchObject({ title: "새 제목", body: "첫 줄\n둘째\n셋째", tags: ["SEO", "브랜딩"], image_note: "1200×630", meta_description: null, status: "reviewed", revision: 2 });
    await expectDbError(asA((tx) => update(tx, id, 1)), /CONFLICT/);

    let r = 2;
    expect(await asA((tx) => update(tx, id, r, { body: "😀".repeat(20000), title: "가".repeat(200), meta: "가".repeat(300), imageNote: "가".repeat(500), tags: Array.from({ length: 10 }, (_, i) => "가".repeat(29) + i) }))).toBe(++r);
    for (const [v, re] of [
      [{ body: "가".repeat(20001) }, /본문은 20000자/],
      [{ title: "가".repeat(201) }, /제목은 1~200자/],
      [{ title: "  ﻿ " }, /제목은 1~200자/],
      [{ meta: "가".repeat(301) }, /메타 설명은 300자/],
      [{ imageNote: "가".repeat(501) }, /대표 이미지 안내는 500자/],
      [{ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, /태그는 10개까지/],
      [{ tags: ["가".repeat(31)] }, /태그는 10개까지, 각 1~30자/],
      [{ tags: [" "] }, /태그는 10개까지, 각 1~30자/],
      [{ tags: ["SEO", "seo"] }, /같은 태그가 두 번/],
      [{ tags: [1] }, /태그는 10개까지/],
      [{ tags: {} }, /태그는 10개까지/],
      [{ status: "published" }, /알 수 없는 진행 상태/],
    ] as [DraftVals, RegExp][]) await expectDbError(asA((tx) => update(tx, id, r, v)), re);
    expect(await audits(id)).toBe(3);
  });

  it("stale: 전략 v2 승인 뒤에도 편집·게시 기록은 되고, 다시 맞추기로만 v2", async () => {
    const fu = await funnel(a);
    const br = await brief(a, fu);
    const id = await asA((tx) => create(tx, br.briefId));
    await expectDbError(asA((tx) => tx.query("select rebase_channel_draft($1, 1)", [id])), /VALIDATION: 이미/);
    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [fu.artifactId])).revision;
    const edited = { ...fu.content, facts: fu.content.facts.map((x) => ({ ...x, text: `${x.text} v2` })) };
    const v2 = await asA(async (tx) => {
      const v = await one<{ version_id: string }>(tx, "select * from save_strategy_manual_version($1, $2, $3)", [fu.artifactId, rev, JSON.stringify(edited)]);
      await tx.query("select decide_version($1, $2, 'approved', null)", [fu.artifactId, v.version_id]);
      return v.version_id;
    });
    expect(await asA((tx) => update(tx, id, 1))).toBe(2);
    await asA((tx) => record(tx, id));
    await expectDbError(asA((tx) => tx.query("select rebase_channel_draft($1, 1)", [id])), /CONFLICT/);
    expect(await asA((tx) => one<{ r: number }>(tx, "select rebase_channel_draft($1, 2) as r", [id]))).toEqual({ r: 3 });
    expect((await draftRow(id)).strategy_version_id).toBe(v2);
    const d = await one<{ details: unknown }>(db, "select details from audit_events where entity_type = 'channel_draft' and entity_id = $1 and action = 'draft_rebase'", [id]);
    expect(d.details).toEqual({ from_version_id: fu.versionId, to_version_id: v2 });
  });

  it("A13: 초안 보관·프로젝트 보관·작업 취소는 6개 RPC 모두 거절(감사 0행), 브리프 보관·drafting 복귀는 막지 않음", async () => {
    const c = await seedOwner(db, "draft-owner-c@example.test");
    await asUser(db, c.userId, (tx) => approveProfile(tx, c.profileA1));
    const asC = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, c.userId, fn);
    const fu = await funnel(c);
    const br = await brief(c, fu);
    const id = await asC((tx) => create(tx, br.briefId));
    const pub = await asC((tx) => record(tx, id));

    // 브리프를 drafting 으로 돌리고 보관해도 기존 초안은 고치고 기록할 수 있다(새로 만들기만 막는다)
    await asC((tx) => tx.query("select update_content_brief($1, $2, '제목', null, null, null, null, '{}', null, 'manual', null, 'drafting')", [br.briefId, br.revision]));
    await asC((tx) => tx.query("select archive_content_brief($1, $2)", [br.briefId, br.revision + 1]));
    expect(await asC((tx) => update(tx, id, 1))).toBe(2);
    await asC((tx) => record(tx, id));
    await expectDbError(asC((tx) => create(tx, br.briefId)), /INVALID_TRANSITION/);

    const n0 = await audits(id);
    const all = async (re: RegExp, rev = 2) => {
      await expectDbError(asC((tx) => update(tx, id, rev)), re);
      await expectDbError(asC((tx) => tx.query("select rebase_channel_draft($1, $2)", [id, rev])), re);
      await expectDbError(asC((tx) => record(tx, id)), re);
      await expectDbError(asC((tx) => voidPub(tx, pub)), re);
    };
    await replica(() => db.query("update projects set status = 'archived' where id = $1", [c.projectA]));
    await all(/INVALID_TRANSITION: 보관한 프로젝트/);
    await expectDbError(asC((tx) => tx.query("select archive_channel_draft($1, 2)", [id])), /INVALID_TRANSITION: 보관한 프로젝트/);
    await replica(async () => {
      await db.query("update projects set status = 'active' where id = $1", [c.projectA]);
      await db.query("update tasks set status = 'cancelled' where id = $1", [fu.taskId]);
    });
    await all(/INVALID_TRANSITION: 취소된 작업/);
    await replica(() => db.query("update tasks set status = 'completed' where id = $1", [fu.taskId]));
    expect(await asC((tx) => one<{ r: number }>(tx, "select archive_channel_draft($1, 2) as r", [id]))).toEqual({ r: 3 });
    await all(/INVALID_TRANSITION: 보관한 초안/, 3);
    await expectDbError(asC((tx) => tx.query("select archive_channel_draft($1, 3)", [id])), /INVALID_TRANSITION: 이미 보관/);
    expect(await audits(id)).toBe(n0 + 1);
    // 읽기는 된다
    expect(await asC((tx) => tx.query("select 1 from channel_drafts where id = $1", [id]).then((x) => x.rows.length))).toBe(1);
  });
});

describe("게시 기록(추가 전용, R1-3)", () => {
  it("기록·취소·상태 계산(P11)·취소 규칙(P8)·revision 그대로", async () => {
    const fu = await funnel(a);
    const br = await brief(a, fu);
    const id = await asA((tx) => create(tx, br.briefId));
    const id2 = await asA((tx) => create(tx, br.briefId));
    const p1 = await asA((tx) => record(tx, id, "  https://a.tistory.com/1 ", new Date().toISOString(), "  첫 게시 "));
    const p2 = await asA((tx) => record(tx, id, "https://blog.example.com/2"));
    const row = await one<{ url: string; note: string; kind: string }>(db, "select url, note, kind from channel_publications where id = $1", [p1]);
    expect(row).toEqual({ url: "https://a.tistory.com/1", note: "첫 게시", kind: "record" });
    expect((await draftRow(id)).revision).toBe(1);

    const active = () => count("select 1 from channel_publications c where c.draft_id = $1 and c.kind = 'record' and not exists (select 1 from channel_publications v where v.voids_id = c.id)", [id]);
    const v1 = await asA((tx) => voidPub(tx, p1, "  주소 오타 "));
    expect(await one(db, "select kind, note, voids_id, url, published_at from channel_publications where id = $1", [v1])).toEqual({ kind: "void", note: "주소 오타", voids_id: p1, url: null, published_at: null });
    expect(await active()).toBe(1);
    await asA((tx) => voidPub(tx, p2));
    expect(await active()).toBe(0);

    const n0 = await audits(id);
    await expectDbError(asA((tx) => voidPub(tx, p1)), /INVALID_TRANSITION: 이미 취소/);
    await expectDbError(asA((tx) => voidPub(tx, v1)), /INVALID_TRANSITION: 취소 표시는 다시 취소할 수 없습니다/);
    const p3 = await asA((tx) => record(tx, id2));
    await expectDbError(asA((tx) => voidPub(tx, p3, null)), /VALIDATION: 취소 이유/);
    await expectDbError(asA((tx) => voidPub(tx, p3, "가".repeat(301))), /VALIDATION: 취소 이유/);
    await expectDbError(asA((tx) => voidPub(tx, p2, "가".repeat(301))), /INVALID_TRANSITION: 이미 취소/);
    await expectDbError(asB((tx) => voidPub(tx, p2)), /NOT_FOUND: 게시 기록을 찾을 수 없습니다/);
    expect(await audits(id)).toBe(n0);
    // 다른 초안의 기록은 FK(draft_id, voids_id)로 가리킬 수 없다(슈퍼유저 직접 써도)
    const other = await asA((tx) => record(tx, id2));
    await expectDbError(
      db.query("insert into channel_publications (workspace_id, draft_id, kind, note, voids_id, created_by) values ($1, $2, 'void', 'x', $3, $4)", [a.workspaceId, id, other, a.userId]),
      /foreign key/,
    );
  });

  it("P1~P3·P10: 슈퍼유저 UPDATE(값 그대로도)·DELETE 거절, CHECK 모양", async () => {
    const fu = await funnel(a);
    const br = await brief(a, fu);
    const id = await asA((tx) => create(tx, br.briefId));
    const p = await asA((tx) => record(tx, id));
    await expectDbError(db.query("update channel_publications set url = 'https://b.com/' where id = $1", [p]), /IMMUTABLE_ROW/);
    await expectDbError(db.query("update channel_publications set note = note where id = $1", [p]), /IMMUTABLE_ROW/);
    await expectDbError(db.query("delete from channel_publications where id = $1", [p]), /IMMUTABLE_ROW/);
    const ins = (kind: string, url: string | null, at: string | null, note: string | null, voids: string | null) =>
      db.query("insert into channel_publications (workspace_id, draft_id, kind, url, published_at, note, voids_id, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)", [
        a.workspaceId, id, kind, url, at, note, voids, a.userId,
      ]);
    await expectDbError(ins("record", "https://a.com/", new Date().toISOString(), null, p), /check constraint/);
    await expectDbError(ins("void", "https://a.com/", null, "x", p), /check constraint/);
    await expectDbError(ins("record", "https://a.com/", null, null, null), /check constraint/);
    await expectDbError(ins("void", null, null, null, p), /check constraint/);
    await expectDbError(ins("record", "javascript:alert(1)", new Date().toISOString(), null, null), /check constraint/);
    await expectDbError(ins("record", "https://a.com/", "1999-12-31T23:59:59+09:00", null, null), /check constraint/);
    // 부모 초안은 지울 수 없다(FK)
    await expectDbError(db.query("delete from channel_drafts where id = $1", [id]), /foreign key/);
  });

  it("시각: 미래 5분 이내 통과·초과 거절, 2000년 이전 거절, 빈 값 거절, 한도 50(취소 안 된 기록만)", async () => {
    const fu = await funnel(a);
    const br = await brief(a, fu);
    const id = await asA((tx) => create(tx, br.briefId));
    await asA((tx) => record(tx, id, "https://a.com/1", new Date(Date.now() + 4 * 60_000).toISOString()));
    await expectDbError(asA((tx) => record(tx, id, "https://a.com/1", new Date(Date.now() + 6 * 60_000).toISOString())), /VALIDATION: 게시 시각이 미래/);
    await expectDbError(asA((tx) => record(tx, id, "https://a.com/1", "1999-12-31T23:59:59+09:00")), /VALIDATION: 게시 시각이 너무 이릅니다/);
    await asA((tx) => record(tx, id, "https://a.com/1", "2000-01-01T00:00:00+09:00"));
    await expectDbError(asA((tx) => record(tx, id, "https://a.com/1", null)), /VALIDATION: 게시 시각을 입력/);
    // QA D3: 기록·취소를 반복해도 막히지 않는다(취소한 기록은 세지 않음)
    for (let i = 0; i < 30; i++) {
      const p = await asA((tx) => record(tx, id));
      await asA((tx) => voidPub(tx, p));
    }
    for (let i = 0; i < 48; i++) await asA((tx) => record(tx, id));
    await expectDbError(asA((tx) => record(tx, id)), /VALIDATION: 한 초안에는 취소하지 않은 게시 기록을 50개까지/);
  });
});

describe("게시 주소 표(R1-2): RPC·CHECK 가 앱(JS) 표와 같다", () => {
  it("RPC 통과·거절", async () => {
    const fu = await funnel(a);
    const br = await brief(a, fu);
    const id = await asA((tx) => create(tx, br.briefId));
    const got: { raw: string; rpc: boolean; check: boolean }[] = [];
    for (const c of PUBLICATION_URL_CASES) {
      let rpc: boolean;
      try {
        await asA((tx) => record(tx, id, c.raw));
        rpc = true;
      } catch (e) {
        const m = String((e as Error).message);
        // NUL 은 Postgres 글자에 들어갈 수 없어 드라이버·서버가 먼저 거절한다(거절로 센다)
        expect(m, c.raw).toMatch(/VALIDATION: 게시 주소는|invalid byte sequence|0x00|null character/);
        rpc = false;
      }
      let check: boolean;
      try {
        await db.query("select $1::text as u", [c.raw]);
        check = (await one<{ ok: boolean }>(db, "select coalesce(app.publication_url_ok($1), false) as ok", [c.raw])).ok;
      } catch {
        check = false;
      }
      got.push({ raw: c.raw, rpc, check });
      if (got.length >= 48) break; // 한도 50 아래에서
    }
    expect(got).toEqual(PUBLICATION_URL_CASES.slice(0, got.length).map((c) => ({ raw: c.raw, rpc: c.rpc, check: c.check })));
  });
});

describe("보안(S1~S5)", () => {
  it("남의 업무실 NOT_FOUND·RLS 0행, 직접 쓰기 거절, anon 거절, 도우미 실행 불가, 복합 FK", async () => {
    const fu = await funnel(a);
    const br = await brief(a, fu);
    const id = await asA((tx) => create(tx, br.briefId));
    const p = await asA((tx) => record(tx, id));
    for (const q of [
      () => asB((tx) => update(tx, id, 1)),
      () => asB((tx) => tx.query("select rebase_channel_draft($1, 1)", [id])),
      () => asB((tx) => tx.query("select archive_channel_draft($1, 1)", [id])),
      () => asB((tx) => record(tx, id)),
    ]) await expectDbError(q(), /NOT_FOUND: 초안을 찾을 수 없습니다/);
    await expectDbError(asB((tx) => update(tx, "00000000-0000-0000-0000-000000000000", 1)), /NOT_FOUND: 초안을 찾을 수 없습니다/);
    expect(await asB((tx) => tx.query("select 1 from channel_drafts where id = $1 union all select 1 from channel_publications where id = $2", [id, p]).then((r) => r.rows.length))).toBe(0);
    expect(await asA((tx) => tx.query("select 1 from channel_drafts where id = $1 union all select 1 from channel_publications where id = $2", [id, p]).then((r) => r.rows.length))).toBe(2);

    await expectDbError(
      asA((tx) => tx.query(
        "insert into channel_drafts (workspace_id, brief_id, strategy_artifact_id, strategy_version_id, source_brief_revision, source_snapshot, title, created_by) values ($1, $2, $3, $4, 1, '{}', 'x', $5)",
        [a.workspaceId, br.briefId, fu.artifactId, fu.versionId, a.userId],
      )),
      /permission denied/,
    );
    await expectDbError(asA((tx) => tx.query("update channel_drafts set title = 'x' where id = $1", [id])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("delete from channel_drafts where id = $1", [id])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("truncate channel_drafts")), /permission denied/);
    await expectDbError(
      asA((tx) => tx.query("insert into channel_publications (workspace_id, draft_id, kind, url, published_at, created_by) values ($1, $2, 'record', 'https://a.com/', now(), $3)", [a.workspaceId, id, a.userId])),
      /permission denied/,
    );
    await expectDbError(asA((tx) => tx.query("truncate channel_publications")), /permission denied/);
    await expectDbError(asAnon((tx) => tx.query("select * from channel_drafts")), /permission denied/);
    await expectDbError(asAnon((tx) => tx.query("select * from channel_publications")), /permission denied/);
    await expectDbError(asAnon((tx) => create(tx, br.briefId)), /permission denied/);
    await expectDbError(asAnon((tx) => record(tx, id)), /permission denied/);
    for (const f of [
      "select app.check_channel_draft('x', '', '[]', null, null, 'drafting')",
      `select app.channel_draft_audit('${a.workspaceId}', '${id}', 'x', 1, '{}')`,
      `select app.assert_channel_draft_open('${id}')`,
      `select app.lock_own_channel_draft('${id}')`,
    ]) await expectDbError(asA((tx) => tx.query(f)), /permission denied/);

    // S2: 다른 프로젝트(B 업무실)의 전략 판·다른 브리프의 전략은 슈퍼유저가 직접 써도 FK 가 막는다
    const fb = await funnel(b);
    const ins = (artifact: string, version: string) =>
      db.query(
        "insert into channel_drafts (workspace_id, brief_id, strategy_artifact_id, strategy_version_id, source_brief_revision, source_snapshot, title, created_by) values ($1, $2, $3, $4, 1, '{}', 'x', $5)",
        [a.workspaceId, br.briefId, artifact, version, a.userId],
      );
    await expectDbError(ins(fb.artifactId, fb.versionId), /foreign key/);
    await expectDbError(ins(fu.artifactId, fb.versionId), /foreign key/);
    // 고정 열은 바꿀 수 없다(슈퍼유저도)
    for (const col of ["brief_id", "workspace_id", "strategy_artifact_id", "channel", "language", "source_brief_revision", "source_snapshot", "created_by", "created_at", "id"]) {
      const v = { brief_id: "gen_random_uuid()", workspace_id: "gen_random_uuid()", strategy_artifact_id: "gen_random_uuid()", channel: "'x'", language: "'x'", source_brief_revision: "99", source_snapshot: "'{\"title\":\"x\"}'", created_by: "gen_random_uuid()", created_at: "now() - interval '1 day'", id: "gen_random_uuid()" }[col];
      await expectDbError(db.query(`update channel_drafts set ${col} = ${v} where id = $1`, [id]), /FROZEN_COLUMN|check constraint|foreign key/);
    }
  });

  it("정의자 함수 설정: search_path 고정, public·anon 실행 불가, 로그인 실행 가능, 소유 조건은 잠그는 조회 안", async () => {
    const names = ["create_channel_draft", "update_channel_draft", "rebase_channel_draft", "archive_channel_draft", "record_channel_publication", "void_channel_publication"];
    const rows = (await db.query<{ proname: string; prosecdef: boolean; cfg: string; anon: boolean; pub: boolean; auth: boolean }>(
      `select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e where e.grantee = 0 and e.privilege_type = 'EXECUTE') as pub,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`,
      [names],
    )).rows;
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r, r.proname).toMatchObject({ prosecdef: true, cfg: "search_path=\"\"", anon: false, pub: false, auth: true });
    const lock = (await one<{ s: string }>(db, "select prosrc as s from pg_proc where proname = 'lock_own_channel_draft'")).s;
    expect(lock).toMatch(/and exists \(select 1 from public\.workspaces w where w\.id = x\.workspace_id and w\.owner_user_id = auth\.uid\(\)\)\s+for update of x/);
    const cr = (await one<{ s: string }>(db, "select prosrc as s from pg_proc where proname = 'create_channel_draft'")).s;
    expect(cr).toMatch(/from public\.content_briefs x\s+where x\.id = p_brief_id\s+and exists \(select 1 from public\.workspaces w where w\.id = x\.workspace_id and w\.owner_user_id = uid\)\s+for update of x/);
    // 잠금은 브리프·초안 하나뿐 — 퍼널·단계·카드는 잠그지 않는다(R1 순서와 반대 방향 없음)
    for (const n of names) {
      const s = (await one<{ s: string }>(db, "select prosrc as s from pg_proc where proname = $1", [n])).s;
      expect(s, n).not.toMatch(/public\.(funnels|funnel_stages|funnel_items)[^;]*for (no key )?(update|share)/);
    }
  });
});
