/**
 * P3E-BACKEND-IMPL-01: PPT 구성안 DB(20261121010000_p3e_ppt_decks) 시험. 설계: Plan/Claude-Backend-20261120/P3E-BACKEND-01-DESIGN.md.
 * 기준: Tester QA-PLAN-P3CDE-01 4절 E1~E3·ES1·ES4·ES5·ES8, 공통 X1~X11. 준비 도우미는 P3-d 시험과 같다. 모든 값은 합성이다.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { designConfirmMessage, designReserveMessage } from "@/domain/design-assets";
import { buildStrategyDraft } from "@/domain/strategy";
import { asUser, createDb, expectDbError, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;
let secret: string;

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "ppt-owner-a@example.test");
  b = await seedOwner(db, "ppt-owner-b@example.test");
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
  secret = (await one<{ value: string }>(db, "select value from app.server_secrets where name = 'design_asset_signing'")).value;
  for (const f of [a, b])
    await asUser(db, f.userId, (tx) =>
      tx.query(
        "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
        [f.profileA1],
      ),
    );
}, 60_000);


const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const asAnon = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn);
const count = async (sql: string, p: unknown[] = []) => (await one<{ n: number }>(db, `select count(*)::int as n from (${sql}) x`, p)).n;
const sign = (purpose: string, message: string, at = Date.now(), key = secret) => ({
  at,
  sig: createHmac("sha256", key).update(`${purpose}|${message}|${at}`, "utf8").digest("hex"),
});

async function strategy(f: Fixture, projectId = f.projectA) {
  return asUser(db, f.userId, async (tx) => {
    const taskId = (
      await one<{ id: string }>(tx, "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id", [
        f.workspaceId, projectId, strategyTpl, newKey(),
      ])
    ).id;
    const profile = projectId === f.projectA ? { id: f.profileA1, clientId: f.clientA } : { id: f.profileB1, clientId: f.clientB };
    if (projectId !== f.projectA)
      await tx.query(
        "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
        [profile.id],
      ).catch(() => undefined);
    const input = {
      templateVersion: STRATEGY_TEMPLATE_VERSION,
      projectId,
      profile: { id: profile.id, version: 1, projectId, clientId: profile.clientId, projectKind: "client" },
      sections: { goals: { facts: [{ text: "합성 목표", sources: [{ kind: "profile", profileId: profile.id, version: 1 }] }], inferences: [] }, offers: { facts: [], inferences: [{ text: "합성 제안" }] } },
      unknowns: [],
    };
    const d = buildStrategyDraft(input);
    if (!d.ok) throw new Error(`계약 실패: ${JSON.stringify(d.issues)}`);
    const g = await one<{ artifact_id: string; version_id: string }>(tx, "select * from generate_strategy($1, $2, $3, $4, $5)", [taskId, newKey(), profile.id, JSON.stringify(input), JSON.stringify(d.result)]);
    await tx.query("select decide_version($1, $2, 'approved', null)", [g.artifact_id, g.version_id]);
    return { artifactId: g.artifact_id };
  });
}

type Brief = { id: string; revision: number };
async function brief(f: Fixture, o: { kinds?: string[]; ready?: boolean; projectId?: string } = {}): Promise<Brief> {
  const projectId = o.projectId ?? f.projectA;
  // 프로젝트당 브리프 10개 한도: 앞 시험의 오래된 브리프를 보관해 자리를 만든다
  const act = await db.query<{ id: string; revision: number }>("select id, revision from production_briefs where project_id = $1 and archived_at is null order by created_at", [projectId]);
  for (const r of act.rows.slice(0, Math.max(0, act.rows.length - 5)))
    await asUser(db, f.userId, (tx) => tx.query("select archive_production_brief($1, $2)", [r.id, r.revision]));
  const s = await strategy(f, projectId);
  const kinds = o.kinds ?? ["ppt_deck", "design_assets"];
  return asUser(db, f.userId, async (tx) => {
    const id = (await one<{ id: string }>(tx, "select create_production_brief($1, $2, 'PPT 브리프', '대상', '메시지', $3::text[], '범위') as id", [projectId, s.artifactId, kinds])).id;
    if (o.ready === false) return { id, revision: 1 };
    await tx.query("select update_production_brief($1, 1, 'PPT 브리프', '대상', '메시지', $2::text[], '범위', null, null, 'ready')", [id, kinds]);
    return { id, revision: 2 };
  });
}

/** 디자인 자산 하나(P3-c 경로 그대로: 예약 → 저장소 → 만들기) */
async function designAsset(f: Fixture, briefId: string, title = "로고") {
  return asUser(db, f.userId, async (tx) => {
    const r = { productionBriefId: briefId, assetId: null, kind: "logo", fileName: "logo.svg", size: 100, mime: "image/svg+xml" };
    const g = sign("design_reserve", designReserveMessage(r as never));
    const u = await one<{ upload_id: string; storage_key: string }>(tx, "select * from reserve_design_asset_upload($1, null, 'logo', 'logo.svg', 100, 'image/svg+xml', $2, $3)", [briefId, g.at, g.sig]);
    await tx.query("insert into storage.objects (bucket_id, name, owner, metadata) values ('design-assets', $1, $2, $3::jsonb)", [u.storage_key, f.userId, JSON.stringify({ size: 100, mimetype: "image/svg+xml" })]);
    const sha = "a".repeat(64);
    const c = sign("design_confirm", designConfirmMessage(u.upload_id, sha));
    return (await one<{ id: string }>(tx, "select create_design_asset($1, $2, null, 'external_upload', $3, $4, $5) as id", [u.upload_id, title, sha, c.at, c.sig])).id;
  });
}
/** 디자인 자산 새 판(파일 교체) */
async function designReplace(f: Fixture, assetId: string) {
  return asUser(db, f.userId, async (tx) => {
    const x = await one<{ production_brief_id: string; revision: number }>(tx, "select production_brief_id, revision from design_assets where id = $1", [assetId]);
    const r = { productionBriefId: x.production_brief_id, assetId, kind: "logo", fileName: "logo2.svg", size: 120, mime: "image/svg+xml" };
    const g = sign("design_reserve", designReserveMessage(r as never));
    const u = await one<{ upload_id: string; storage_key: string }>(tx, "select * from reserve_design_asset_upload($1, $2, 'logo', 'logo2.svg', 120, 'image/svg+xml', $3, $4)", [x.production_brief_id, assetId, g.at, g.sig]);
    await tx.query("insert into storage.objects (bucket_id, name, owner, metadata) values ('design-assets', $1, $2, $3::jsonb)", [u.storage_key, f.userId, JSON.stringify({ size: 120, mimetype: "image/svg+xml" })]);
    const sha = "b".repeat(64);
    const c = sign("design_confirm", designConfirmMessage(u.upload_id, sha));
    await tx.query("select replace_design_asset_file($1, $2, $3, null, $4, $5, $6)", [assetId, x.revision, u.upload_id, sha, c.at, c.sig]);
  });
}

type SlideIn = { id?: string | null; title?: unknown; bullets?: unknown; notes?: unknown; asset_ids?: unknown };
const slide = (o: SlideIn = {}) => ({
  id: o.id ?? null,
  title: "title" in o ? o.title : "표지",
  bullets: "bullets" in o ? o.bullets : "요점 하나\n요점 둘",
  notes: "notes" in o ? o.notes : null,
  asset_ids: o.asset_ids ?? [],
});
const createDeck = (tx: Tx, briefId: string, slides: unknown = [slide()], title = "봄 제안서", tpl = "royal_grid") =>
  one<{ id: string }>(tx, "select create_ppt_deck($1, $2, $3, $4::jsonb) as id", [briefId, title, tpl, JSON.stringify(slides)]).then((r) => r.id);
const save = (tx: Tx, id: string, rev: number, slides: unknown, o: { title?: string; tpl?: string; status?: string } = {}) =>
  one<{ r: number }>(tx, "select save_ppt_deck($1, $2, $3, $4, $5, $6::jsonb) as r", [id, rev, o.title ?? "봄 제안서", o.tpl ?? "royal_grid", o.status ?? "drafting", JSON.stringify(slides)]).then((r) => r.r);
const deck = (id: string) =>
  one<{ revision: number; current_version_no: number; archived_at: string | null; status: string; template_key: string; source_brief_revision: number }>(db, "select * from ppt_decks where id = $1", [id]);
type V = { kind: string; slides: Array<{ id: string; title: string; bullets: string | null; notes: string | null; assets: Array<{ asset_id: string; version_no: number }> }>; slide_count: number; restored_from_version_no: number | null; source_brief_revision: number };
const ver = (id: string, n?: number) =>
  one<V>(db, "select v.* from ppt_deck_versions v join ppt_decks d on d.id = v.deck_id where v.deck_id = $1 and v.version_no = coalesce($2, d.current_version_no)", [id, n ?? null]);
const asInput = (slides: V["slides"]) => slides.map((s) => ({ id: s.id, title: s.title, bullets: s.bullets, notes: s.notes, asset_ids: s.assets.map((x) => x.asset_id) }));

describe("만들기·바탕 조건(X1·E1)", () => {
  it("작성 중·PPT 없음 브리프 거절, 확정 브리프는 v1, 작업 중 5·전체 10", async () => {
    const draft = await brief(a, { ready: false });
    await expectDbError(asA((tx) => createDeck(tx, draft.id)), /INVALID_TRANSITION: 확정한 제작 브리프로만/);
    const noPpt = await brief(a, { kinds: ["web_copy"] });
    await expectDbError(asA((tx) => createDeck(tx, noPpt.id)), /INVALID_TRANSITION: .*PPT 구성이 없습니다/);
    const br = await brief(a);
    const id = await asA((tx) => createDeck(tx, br.id, [slide(), slide({ title: "목차" }), slide({ title: "본문" })]));
    expect(await deck(id)).toMatchObject({ revision: 1, current_version_no: 1, status: "drafting", template_key: "royal_grid", source_brief_revision: br.revision });
    expect((await ver(id)).slide_count).toBe(3);
    const ids = [id];
    for (let i = 0; i < 4; i++) ids.push(await asA((tx) => createDeck(tx, br.id)));
    await expectDbError(asA((tx) => createDeck(tx, br.id)), /LIMIT_REACHED: PPT 구성안은 브리프당 활성 5개\(전체 10개\)/);
    for (const x of ids) await asA((tx) => tx.query("select archive_ppt_deck($1, 1)", [x]));
    for (let i = 0; i < 5; i++) await asA((tx) => createDeck(tx, br.id));
    await expectDbError(asA((tx) => createDeck(tx, br.id)), /LIMIT_REACHED/);
  });
});

describe("슬라이드 검사(E2·ES1·ES5·X9)", () => {
  it("0·41장, 제목 0·101자, 요점·메모 1001자(이모지), 제어 문자, 모르는 키는 VALIDATION, 경계 안쪽은 저장", async () => {
    const br = await brief(a);
    const bad: Array<[unknown, RegExp]> = [
      [[], /1장 이상/],
      [Array.from({ length: 41 }, () => slide()), /40장까지/],
      [[slide({ title: "" })], /슬라이드 제목/],
      [[slide({ title: "가".repeat(101) })], /슬라이드 제목/],
      [[slide({ title: " 공백 " })], /슬라이드 제목/],
      [[slide({ title: "제어\u0001문자" })], /제어 문자/],
      [[slide({ bullets: "😀".repeat(1001) })], /1,000자/],
      [[slide({ bullets: "줄\u000B바꿈" })], /제어 문자/],
      [[slide({ notes: "가".repeat(1001) })], /1,000자/],
      [[slide({ notes: "\u007F" })], /제어 문자/],
      [[slide({ title: 3 })], /슬라이드 제목/],
      [[{ ...slide(), excluded: true }], /슬라이드 형식/],
      [[{ ...slide(), sort_order: 1 }], /슬라이드 형식/],
    ];
    for (const [s, re] of bad) await expectDbError(asA((tx) => createDeck(tx, br.id, s)), re);
    for (const tpl of ["ROYAL_GRID", "../../x", "", "royal_grid ", "__proto__"]) await expectDbError(asA((tx) => createDeck(tx, br.id, [slide()], "제목", tpl)), /알 수 없는 템플릿/);
    await expectDbError(asA((tx) => createDeck(tx, br.id, [slide()], "제목\u0001")), /발표 자료 제목/);
    const big = Array.from({ length: 40 }, (_, i) => slide({ title: `${i}`.padEnd(100, "가"), bullets: "😀".repeat(1000), notes: "<a:t>]]>&\t\n둘째 줄" }));
    const id = await asA((tx) => createDeck(tx, br.id, big, "가".repeat(120), "brand_deck"));
    const v = await ver(id);
    expect(v.slide_count).toBe(40);
    expect(v.slides[0].notes).toBe("<a:t>]]>&\t\n둘째 줄");
  });
});

describe("저장 = 새 판, 빼기·되돌리기(E3·Q15)", () => {
  it("저장·CONFLICT·바뀐 것 없음·빼기·마지막 1장·옛 판 되돌리기로 id 그대로, 판 20 한도", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createDeck(tx, br.id, [slide({ title: "하나" }), slide({ title: "둘" }), slide({ title: "셋" })]));
    const v1 = await ver(id);
    const audit0 = await count("select 1 from audit_events where entity_id = $1", [id]);
    await expectDbError(asA((tx) => save(tx, id, 1, asInput(v1.slides))), /바뀐 내용이 없습니다/);
    expect(await count("select 1 from audit_events where entity_id = $1", [id])).toBe(audit0);
    let rev = await asA((tx) => save(tx, id, 1, [asInput(v1.slides)[2], asInput(v1.slides)[0]], { tpl: "minimal_report" }));
    expect((await ver(id)).slides.map((s) => s.title)).toEqual(["셋", "하나"]);
    expect((await deck(id)).template_key).toBe("minimal_report");
    await expectDbError(asA((tx) => save(tx, id, 1, asInput(v1.slides), { title: "x" })), /CONFLICT/);
    const v2 = await ver(id);
    await expectDbError(asA((tx) => save(tx, id, rev, [...asInput(v2.slides), asInput(v1.slides)[1]])), /이 구성안에 없는 슬라이드/);
    await expectDbError(asA((tx) => save(tx, id, rev, [])), /1장 이상/);
    rev = await asA((tx) => one<{ r: number }>(tx, "select restore_ppt_deck_version($1, $2, 1) as r", [id, rev])).then((x) => x.r);
    const v3 = await ver(id);
    expect(v3).toMatchObject({ kind: "restore", restored_from_version_no: 1 });
    expect(v3.slides).toEqual(v1.slides);
    expect((await deck(id)).template_key).toBe("royal_grid");
    for (let i = 4; i <= 20; i++) rev = await asA((tx) => save(tx, id, rev, [slide({ title: `판 ${i}` })]));
    expect((await deck(id)).current_version_no).toBe(20);
    await expectDbError(asA((tx) => save(tx, id, rev, [slide({ title: "판 21" })])), /LIMIT_REACHED: PPT 구성안 판 이력이 20개/);
    await expectDbError(asA((tx) => tx.query("select restore_ppt_deck_version($1, $2, 1)", [id, rev])), /LIMIT_REACHED/);
  });
});

describe("디자인 자산 연결·이전 기준(ES5·Q10·Q11)", () => {
  it("같은 프로젝트·보관 안 된 자산만, 판 번호 서버가 찍고 저장해도 유지, 맞추기로 최신, 브리프 작성 중이면 맞추기 거절", async () => {
    const br = await brief(a);
    const as1 = await designAsset(a, br.id, "로고");
    const brB = await brief(b);
    const asB1 = await designAsset(b, brB.id, "남의 자산");
    await expectDbError(asA((tx) => createDeck(tx, br.id, [slide({ asset_ids: [asB1] })])), /같은 프로젝트의 보관하지 않은 디자인 자산만/);
    await expectDbError(asA((tx) => createDeck(tx, br.id, [slide({ asset_ids: Array.from({ length: 11 }, () => as1) })])), /10개까지/);
    await expectDbError(asA((tx) => createDeck(tx, br.id, [slide({ asset_ids: [as1, as1] })])), /두 번/);
    const id = await asA((tx) => createDeck(tx, br.id, [slide({ asset_ids: [as1] })]));
    await designReplace(a, as1);
    const cur = await ver(id);
    const r2 = await asA((tx) => save(tx, id, 1, [{ ...asInput(cur.slides)[0], bullets: "고침" }]));
    expect((await ver(id)).slides[0].assets).toEqual([{ asset_id: as1, version_no: 1 }]);
    const r3 = await asA((tx) => one<{ r: number }>(tx, "select rebase_ppt_deck($1, $2) as r", [id, r2])).then((x) => x.r);
    expect((await ver(id)).slides[0].assets).toEqual([{ asset_id: as1, version_no: 2 }]);
    await expectDbError(asA((tx) => tx.query("select rebase_ppt_deck($1, $2)", [id, r3])), /이미 지금/);
    await asA((tx) => tx.query("select update_production_brief($1, $2, 'PPT 브리프 2', '대상', '메시지', $3::text[], '범위', null, null, 'drafting')", [br.id, br.revision, ["ppt_deck", "design_assets"]]));
    await expectDbError(asA((tx) => tx.query("select rebase_ppt_deck($1, $2)", [id, r3])), /아직 확정 전이라/);
  });
});

describe("보관·남의 것·권한·감사(X2·X5·X6·X7·ES4·ES8)", () => {
  it("보관 뒤 쓰기 거절·동결·판 추가 전용, 보관해도 읽기(내보내기)는 됨", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createDeck(tx, br.id));
    const r = await asA((tx) => one<{ r: number }>(tx, "select archive_ppt_deck($1, 1) as r", [id])).then((x) => x.r);
    const v = await ver(id);
    const calls: Array<(tx: Tx) => Promise<unknown>> = [
      (tx) => save(tx, id, r, asInput(v.slides), { title: "새" }),
      (tx) => tx.query("select restore_ppt_deck_version($1, $2, 1)", [id, r]),
      (tx) => tx.query("select rebase_ppt_deck($1, $2)", [id, r]),
      (tx) => tx.query("select archive_ppt_deck($1, $2)", [id, r]),
    ];
    for (const c of calls) await expectDbError(asA(c), /INVALID_TRANSITION/);
    expect(await asA((tx) => tx.query("select v.slides from ppt_deck_versions v where v.deck_id = $1", [id]).then((x) => x.rows.length))).toBe(1);
    await expectDbError(db.query("update ppt_decks set archived_at = null where id = $1", [id]), /FROZEN_COLUMN/);
    await expectDbError(db.query("update ppt_deck_versions set title = 'x' where deck_id = $1", [id]), /IMMUTABLE_ROW/);
    await expectDbError(db.query("delete from ppt_deck_versions where deck_id = $1", [id]), /IMMUTABLE_ROW/);
  });

  it("남의 구성안은 없는 id 와 같은 NOT_FOUND, 읽기 0, 직접 쓰기·익명 거절, 감사 글자 0", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createDeck(tx, br.id, [slide({ title: "비밀제목", bullets: "비밀요점", notes: "비밀메모" })], "비밀발표"));
    for (const target of [id, "00000000-0000-4000-8000-0000000000aa"])
      await expectDbError(asB((tx) => save(tx, target, 1, [slide()])), /NOT_FOUND: PPT 구성안을 찾을 수 없습니다/);
    for (const t of ["ppt_decks", "ppt_deck_versions"]) {
      expect(await asB((tx) => tx.query(`select 1 from ${t} where workspace_id = $1`, [a.workspaceId]).then((x) => x.rows.length))).toBe(0);
      await expectDbError(asAnon((tx) => tx.query(`select 1 from ${t}`)), /permission denied/);
    }
    for (const sql of ["update ppt_decks set title = 'x'", "delete from ppt_decks", "truncate ppt_decks", "update ppt_deck_versions set title = 'x'"])
      await expectDbError(asA((tx) => tx.query(sql)), /permission denied/);
    for (const fn of ["create_ppt_deck", "save_ppt_deck", "restore_ppt_deck_version", "rebase_ppt_deck", "archive_ppt_deck"])
      expect(await one<{ anon: boolean; auth: boolean; secdef: boolean }>(db, "select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth, p.prosecdef as secdef from pg_proc p where p.proname = $1", [fn])).toEqual({ anon: false, auth: true, secdef: true });
    await expectDbError(asA((tx) => tx.query("select app.ppt_build_slides($1, $1, null, '[]'::jsonb)", [a.workspaceId])), /permission denied/);
    const rows = (await db.query<{ details: unknown }>("select details from audit_events where entity_type = 'ppt_deck' and entity_id = $1", [id])).rows;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/비밀/);
    expect(readFileSync("supabase/migrations/20261121010000_p3e_ppt_decks.sql", "utf8")).not.toMatch(/https?:\/\//);
  });
});
