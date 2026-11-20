/**
 * P3FG-BACKEND-IMPL-01: 검수·납품 DB(20261121011000_p3fg_qa_delivery) 시험. 설계: Plan/Claude-Backend-20261120/P3FG-BACKEND-01-DESIGN.md.
 * 기준: AGY P3F·P3G 인계, Master 8절 결정, 공통 X1~X11. 준비 도우미는 P3-d·e 시험과 같다. 모든 값은 합성이다.
 */
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { designConfirmMessage, designReserveMessage } from "@/domain/design-assets";
import { DEFAULT_QA_ITEMS } from "@/domain/qa-delivery";
import { buildStrategyDraft } from "@/domain/strategy";
import { asUser, createDb, expectDbError, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;
let secret: string;

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "qa-owner-a@example.test");
  b = await seedOwner(db, "qa-owner-b@example.test");
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

// ── 준비: 검토 완료(reviewed) 산출물 만들기 ──
const ALL = ["web_copy", "design_assets", "video_plan", "ppt_deck"];
const slide = (title = "표지") => ({ id: null, title, bullets: "요점", notes: null, asset_ids: [] });
async function pptReviewed(f: Fixture, briefId: string, title = "제안서") {
  return asUser(db, f.userId, async (tx) => {
    const id = (await one<{ id: string }>(tx, "select create_ppt_deck($1, $2, 'royal_grid', $3::jsonb) as id", [briefId, title, JSON.stringify([slide()])])).id;
    await tx.query("select save_ppt_deck($1, 1, $2, 'royal_grid', 'reviewed', $3::jsonb)", [id, title, JSON.stringify((await one<{ s: Array<{ id: string; title: string; bullets: string; notes: null; assets: [] }> }>(tx, "select slides as s from ppt_deck_versions where deck_id = $1", [id])).s.map((s) => ({ id: s.id, title: s.title, bullets: s.bullets, notes: s.notes, asset_ids: [] })))]);
    return id;
  });
}
const pptSaveNew = (f: Fixture, id: string, title: string) =>
  asUser(db, f.userId, async (tx) => {
    const d = await one<{ revision: number }>(tx, "select revision from ppt_decks where id = $1", [id]);
    await tx.query("select save_ppt_deck($1, $2, 'x', 'royal_grid', 'reviewed', $3::jsonb)", [id, d.revision, JSON.stringify([slide(title)])]);
  });
async function webReviewed(f: Fixture, briefId: string) {
  return asUser(db, f.userId, async (tx) => {
    const id = (await one<{ id: string }>(tx, "select create_web_copy_doc($1) as id", [briefId])).id;
    const c = await one<{ pages: unknown }>(tx, "select v.content -> 'pages' as pages from web_copy_versions v join web_copy_docs d on d.id = v.doc_id and v.version_no = d.current_version_no where d.id = $1", [id]);
    await tx.query("select save_web_copy($1, 1, 'reviewed', $2::jsonb)", [id, JSON.stringify(c.pages)]);
    return id;
  });
}
async function assetReviewed(f: Fixture, briefId: string) {
  const id = await designAsset(f, briefId, "로고");
  await asUser(db, f.userId, (tx) => tx.query("select update_design_asset($1, 1, '로고', null, 'reviewed')", [id]));
  return id;
}
async function videoReviewed(f: Fixture, briefId: string) {
  return asUser(db, f.userId, async (tx) => {
    const sc = [{ id: null, title: "첫 장면", duration_sec: 10, narration: null, subtitle: null, asset_ids: [] }];
    const id = (await one<{ id: string }>(tx, "select create_video_plan($1, '영상', '16:9', $2::jsonb) as id", [briefId, JSON.stringify(sc)])).id;
    const v = await one<{ s: Array<{ id: string }> }>(tx, "select scenes as s from video_plan_versions where plan_id = $1", [id]);
    await tx.query("select save_video_plan($1, 1, '영상', '16:9', 'reviewed', $2::jsonb)", [id, JSON.stringify([{ ...sc[0], id: v.s[0].id }])]);
    return id;
  });
}

type Review = { id: string; revision: number; status: string; round_no: number; target_version_no: number; archived_at: string | null; approved_at: string | null };
const review = (id: string) => one<Review>(db, "select * from qa_reviews where id = $1", [id]);
type Item = { id: string; sort_order: number; item_title: string; is_required: boolean; is_default: boolean; verdict: string; memo: string | null; checked_by: string | null };
const items = (id: string) => db.query<Item>("select * from qa_check_items where review_id = $1 order by sort_order", [id]).then((r) => r.rows);
const open = (f: Fixture, kind: string, target: string) => asUser(db, f.userId, (tx) => one<{ id: string }>(tx, "select open_qa_review($1, $2) as id", [kind, target]).then((r) => r.id));
const setItem = (f: Fixture, rid: string, rev: number, item: string, verdict: string, memo: string | null = null) =>
  asUser(db, f.userId, (tx) => one<{ r: number }>(tx, "select set_qa_item($1, $2, $3, $4, $5) as r", [rid, rev, item, verdict, memo]).then((x) => x.r));
/** 필수 항목을 모두 통과로 → 승인 */
async function passAll(f: Fixture, rid: string) {
  let rev = (await review(rid)).revision;
  for (const it of await items(rid)) if (it.is_required && it.verdict !== "passed") rev = await setItem(f, rid, rev, it.id, "passed");
  return rev;
}
const approve = (f: Fixture, rid: string, rev: number) => asUser(db, f.userId, (tx) => one<{ r: number }>(tx, "select approve_qa_review($1, $2) as r", [rid, rev]).then((x) => x.r));

describe("검수 회차 열기(인계 F 1·3-3, X1·X7)", () => {
  it("검토 완료 전·보관·남의 것·모르는 종류는 거절, 열면 기본 필수 4항목(AGY 상수와 같은 글), 열린 회차는 하나", async () => {
    const br = await brief(a, { kinds: ALL });
    const draft = await asA((tx) => one<{ id: string }>(tx, "select create_ppt_deck($1, '초안', 'royal_grid', $2::jsonb) as id", [br.id, JSON.stringify([slide()])]).then((r) => r.id));
    await expectDbError(open(a, "ppt_deck", draft), /INVALID_TRANSITION: 결과물이 검토 완료 상태여야/);
    const id = await pptReviewed(a, br.id);
    await expectDbError(open(b, "ppt_deck", id), /NOT_FOUND: 검수할 결과물을 찾을 수 없습니다/);
    await expectDbError(open(a, "ppt_deck", "00000000-0000-4000-8000-0000000000aa"), /NOT_FOUND: 검수할 결과물을 찾을 수 없습니다/);
    await expectDbError(open(a, "pptx", id), /알 수 없는 검수 대상 종류/);
    await expectDbError(open(a, "web_copy", id), /NOT_FOUND/); // 종류와 안 맞는 id
    const rid = await open(a, "ppt_deck", id);
    expect(await review(rid)).toMatchObject({ status: "drafting", round_no: 1, target_version_no: 2 });
    const its = await items(rid);
    expect(its.map((x) => x.item_title)).toEqual([...DEFAULT_QA_ITEMS.ppt_deck]);
    expect(its.every((x) => x.is_required && x.is_default && x.verdict === "pending")).toBe(true);
    await expectDbError(open(a, "ppt_deck", id), /진행 중인 검수 회차가 있습니다/);
    // 네 종류 모두 열린다(디자인 자산은 자산 하나 = 대상 하나)
    for (const [kind, mk] of [["web_copy", webReviewed], ["design_assets", assetReviewed], ["video_plan", videoReviewed]] as const) {
      const t = await mk(a, br.id);
      const r = await open(a, kind, t);
      expect((await items(r)).map((x) => x.item_title), kind).toEqual([...DEFAULT_QA_ITEMS[kind]]);
    }
    // DB 기본 항목 = 앱 상수
    for (const k of ALL) expect((await one<{ t: string[] }>(db, "select app.qa_default_items($1) as t", [k])).t, k).toEqual([...DEFAULT_QA_ITEMS[k as keyof typeof DEFAULT_QA_ITEMS]]);
  });
});

describe("항목·게이트·보완 요청(인계 F 2·3-1·3-2, Master ⑦)", () => {
  it("판정·메모 규칙, 항목 더하기·빼기, 필수 미확인·보완 필요면 승인 거절, 선택 항목 보완 필요여도 승인, 승인 뒤 동결", async () => {
    const br = await brief(a, { kinds: ALL });
    const id = await pptReviewed(a, br.id);
    const rid = await open(a, "ppt_deck", id);
    let its = await items(rid);
    let rev = (await review(rid)).revision;
    await expectDbError(setItem(a, rid, rev, its[0].id, "needs_fix"), /검수 메모를 적어 주세요/);
    await expectDbError(setItem(a, rid, rev, its[0].id, "approved"), /알 수 없는 판정/);
    await expectDbError(setItem(a, rid, rev, its[0].id, "passed", "제어\u0001"), /제어 문자/);
    await expectDbError(setItem(a, rid, rev, its[0].id, "passed", "가".repeat(501)), /500자/);
    rev = await setItem(a, rid, rev, its[0].id, "needs_fix", "비밀메모 보완");
    expect((await items(rid))[0]).toMatchObject({ verdict: "needs_fix", memo: "비밀메모 보완", checked_by: a.userId });
    await expectDbError(setItem(a, rid, rev - 1, its[1].id, "passed"), /CONFLICT/);
    await expectDbError(approve(a, rid, rev), /보완 필요 또는 미확인 필수 항목이 남아 있어 승인할 수 없습니다/);
    // 보완 요청(산출물 표는 그대로 — Master ②)
    const before = await one<{ status: string; revision: number }>(db, "select status, revision from ppt_decks where id = $1", [id]);
    rev = await asA((tx) => one<{ r: number }>(tx, "select request_qa_fix($1, $2) as r", [rid, rev]).then((x) => x.r));
    expect((await review(rid)).status).toBe("fix_requested");
    expect(await one(db, "select status, revision from ppt_decks where id = $1", [id])).toEqual(before);
    await expectDbError(asA((tx) => tx.query("select request_qa_fix($1, $2)", [rid, rev])), /이미 보완 요청/);
    // 선택 항목 더하기 → 그 항목이 보완 필요여도 필수가 모두 통과면 승인
    rev = await asA((tx) => one<{ r: number }>(tx, "select add_qa_item($1, $2, '선택 확인', false) as r", [rid, rev]).then((x) => x.r));
    its = await items(rid);
    expect(its).toHaveLength(5);
    await expectDbError(asA((tx) => tx.query("select remove_qa_item($1, $2, $3)", [rid, rev, its[0].id])), /기본 필수 항목은 뺄 수 없습니다/);
    rev = await setItem(a, rid, rev, its[4].id, "needs_fix", "선택 보완");
    rev = await passAll(a, rid);
    await expectDbError(approve(a, rid, rev - 1), /CONFLICT/);
    rev = await approve(a, rid, rev);
    expect(await review(rid)).toMatchObject({ status: "reviewed" });
    expect((await review(rid)).approved_at).not.toBeNull();
    // 승인 뒤: 판정·항목·보완 요청·재승인 모두 거절, 슈퍼유저도 승인 되돌리기·항목 수정 불가
    await expectDbError(setItem(a, rid, rev, its[0].id, "pending"), /승인한 검수 회차는 고칠 수 없습니다/);
    await expectDbError(asA((tx) => tx.query("select add_qa_item($1, $2, 'x', true)", [rid, rev])), /승인한 검수 회차/);
    await expectDbError(db.query("update qa_reviews set status = 'drafting', approved_at = null, approved_by = null where id = $1", [rid]), /승인한 검수 회차는 되돌릴 수 없습니다/);
    await expectDbError(db.query("update qa_check_items set verdict = 'pending', checked_by = null, checked_at = null where review_id = $1", [rid]), /닫히거나 보관한 검수 회차/);
    await expectDbError(db.query("delete from qa_check_items where review_id = $1", [rid]), /닫히거나 보관한 검수 회차/);
    // 승인 뒤 새 회차는 열 수 있다(다음 판 검수)
    await pptSaveNew(a, id, "새 판");
    expect((await review(await open(a, "ppt_deck", id))).round_no).toBe(2);
  });

  it("항목 30 한도, 더한 항목 빼면 순서 다시 매김", async () => {
    const br = await brief(a, { kinds: ALL });
    const rid = await open(a, "ppt_deck", await pptReviewed(a, br.id));
    let rev = (await review(rid)).revision;
    for (let i = 5; i <= 30; i++) rev = await asA((tx) => one<{ r: number }>(tx, "select add_qa_item($1, $2, $3, false) as r", [rid, rev, `추가 ${i}`]).then((x) => x.r));
    await expectDbError(asA((tx) => tx.query("select add_qa_item($1, $2, 'x', false)", [rid, rev])), /30개까지/);
    const its = await items(rid);
    rev = await asA((tx) => one<{ r: number }>(tx, "select remove_qa_item($1, $2, $3) as r", [rid, rev, its[5].id]).then((x) => x.r));
    expect((await items(rid)).map((x) => x.sort_order)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });
});

describe("이전 기준·재검수·보관(인계 F 3-3, X2)", () => {
  it("검수 중 산출물이 새 판이면 승인 거절 → 재검수는 앞 회차 보관 + 새 회차(항목 제목 옮김, 판정 pending), 산출물 보관이면 승인·열기 거절", async () => {
    const br = await brief(a, { kinds: ALL });
    const id = await pptReviewed(a, br.id);
    const r1 = await open(a, "ppt_deck", id);
    let rev = (await review(r1)).revision;
    rev = await asA((tx) => one<{ r: number }>(tx, "select add_qa_item($1, $2, '추가 확인', true) as r", [r1, rev]).then((x) => x.r));
    rev = await passAll(a, r1);
    await expectDbError(asA((tx) => tx.query("select rebase_qa_review($1, $2)", [r1, rev])), /이미 지금 버전 기준/);
    await pptSaveNew(a, id, "고친 판");
    await expectDbError(approve(a, r1, rev), /새 버전으로 수정되었습니다/);
    const r2 = await asA((tx) => one<{ id: string }>(tx, "select rebase_qa_review($1, $2) as id", [r1, rev]).then((x) => x.id));
    expect((await review(r1)).archived_at).not.toBeNull();
    expect(await review(r2)).toMatchObject({ round_no: 2, status: "drafting", target_version_no: 3 });
    expect((await items(r2)).map((x) => [x.item_title, x.verdict])).toEqual([...DEFAULT_QA_ITEMS.ppt_deck.map((t) => [t, "pending"]), ["추가 확인", "pending"]]);
    await expectDbError(setItem(a, r1, rev + 1, (await items(r1))[0].id, "pending"), /보관한 검수 회차|CONFLICT/);
    // 산출물 보관 → 승인 거절, 새로 열기 거절
    const rv2 = await passAll(a, r2);
    const d = await one<{ revision: number }>(db, "select revision from ppt_decks where id = $1", [id]);
    await asA((tx) => tx.query("select archive_ppt_deck($1, $2)", [id, d.revision]));
    await expectDbError(approve(a, r2, rv2), /바탕 결과물이 보관되어 승인할 수 없습니다/);
    await asA((tx) => tx.query("select archive_qa_review($1, $2)", [r2, rv2]));
    await expectDbError(open(a, "ppt_deck", id), /바탕 결과물이 보관되어 검수할 수 없습니다/);
  });

  it("대상 FK: 종류와 안 맞는 쌍·남의 산출물 판·다른 산출물 판은 DB 가 거절, 회차 31 은 CHECK", async () => {
    const br = await brief(a, { kinds: ALL });
    const p1 = await pptReviewed(a, br.id, "하나");
    const p2 = await pptReviewed(a, br.id, "둘");
    const v2 = (await one<{ id: string }>(db, "select id from ppt_deck_versions where deck_id = $1 limit 1", [p2])).id;
    const base = [a.workspaceId, a.projectA, a.userId];
    await expectDbError(db.query("insert into qa_reviews (workspace_id, project_id, created_by, target_kind, ppt_deck_id, ppt_deck_version_id, target_version_no, round_no) values ($1, $2, $3, 'ppt_deck', $4, $5, 1, 1)", [...base, p1, v2]), /foreign key/);
    await expectDbError(db.query("insert into qa_reviews (workspace_id, project_id, created_by, target_kind, ppt_deck_id, ppt_deck_version_id, target_version_no, round_no) values ($1, $2, $3, 'web_copy', $4, $5, 1, 1)", [...base, p2, v2]), /check/);
    await expectDbError(db.query("insert into qa_reviews (workspace_id, project_id, created_by, target_kind, ppt_deck_id, ppt_deck_version_id, target_version_no, round_no) values ($1, $2, $3, 'ppt_deck', $4, $5, 1, 31)", [...base, p2, v2]), /check/);
    await expectDbError(db.query("insert into qa_reviews (workspace_id, project_id, created_by, target_kind, ppt_deck_id, ppt_deck_version_id, target_version_no, round_no) values ($1, $2, $3, 'ppt_deck', $4, $5, 1, 1)", [b.workspaceId, b.projectA, b.userId, p2, v2]), /foreign key/);
  });
});

describe("납품 묶음(인계 G 1·3)", () => {
  it("승인본만·브리프 포함·보관 산출물 제외·승인 뒤 새 판이면 승인 판, 지문 = 판 내용, 항목·기록 추가 전용", async () => {
    const c = await seedOwner(db, "qa-deliv-c@example.test");
    await asUser(db, c.userId, (tx) => tx.query("select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))", [c.profileA1]));
    const br = await brief(c, { kinds: ALL });
    await expectDbError(asUser(db, c.userId, (tx) => tx.query("select create_delivery_bundle($1)", [c.projectA])), /승인본이 1건 이상/);
    const deck = await pptReviewed(c, br.id);
    const r1 = await open(c, "ppt_deck", deck);
    await approve(c, r1, await passAll(c, r1));
    const asset = await assetReviewed(c, br.id);
    const r2 = await open(c, "design_assets", asset);
    await approve(c, r2, await passAll(c, r2));
    const plan = await videoReviewed(c, br.id);
    await open(c, "video_plan", plan); // 검수 진행 중 → 제외
    await pptSaveNew(c, deck, "승인 뒤 새 판"); // 승인된 판(v2)이 들어가야 한다
    const bid = await asUser(db, c.userId, (tx) => one<{ id: string }>(tx, "select create_delivery_bundle($1) as id", [c.projectA]).then((x) => x.id));
    const bi = (await db.query<{ kind: string; version_no: number; qa_review_id: string | null; content_sha256: string; ppt_deck_version_id: string | null; design_asset_version_id: string | null }>(
      "select * from delivery_bundle_items where bundle_id = $1 order by sort_order", [bid])).rows;
    expect(bi.map((x) => [x.kind, x.version_no, x.qa_review_id])).toEqual([["production_brief", br.revision, null], ["design_assets", 1, r2], ["ppt_deck", 2, r1]]);
    expect(await one(db, "select bundle_no, item_count, status from delivery_bundles where id = $1", [bid])).toEqual({ bundle_no: 1, item_count: 3, status: "drafting" });
    const want = await one<{ s: string }>(db, "select app.qa_version_sha('ppt_deck', $1) as s", [bi[2].ppt_deck_version_id]);
    expect(bi[2].content_sha256).toBe(want.s);
    expect(bi[1].content_sha256).toBe("a".repeat(64)); // 자산 판의 파일 sha256
    await expectDbError(db.query("update delivery_bundle_items set version_no = 9 where bundle_id = $1", [bid]), /IMMUTABLE_ROW/);
    await expectDbError(db.query("delete from delivery_bundle_items where bundle_id = $1", [bid]), /IMMUTABLE_ROW/);
    // 디자인 자산 보관 → 다음 묶음에서 빠짐
    const ar = await one<{ revision: number }>(db, "select revision from design_assets where id = $1", [asset]);
    await asUser(db, c.userId, (tx) => tx.query("select archive_design_asset($1, $2)", [asset, ar.revision]));
    const b2 = await asUser(db, c.userId, (tx) => one<{ id: string }>(tx, "select create_delivery_bundle($1) as id", [c.projectA]).then((x) => x.id));
    expect((await db.query<{ kind: string }>("select kind from delivery_bundle_items where bundle_id = $1 order by sort_order", [b2])).rows.map((x) => x.kind)).toEqual(["production_brief", "ppt_deck"]);
    // 복구: 옛 묶음(1) 구성 중 지금도 승인 상태만 — 보관된 자산은 빠진다
    const b3 = await asUser(db, c.userId, (tx) => one<{ id: string }>(tx, "select restore_delivery_bundle($1) as id", [bid]).then((x) => x.id));
    expect(await one(db, "select bundle_no, restored_from_id, item_count from delivery_bundles where id = $1", [b3])).toEqual({ bundle_no: 3, restored_from_id: bid, item_count: 2 });
    // 전달 기록: 미래 불가, 방법 4종, 메모 제어 문자 불가, 추가 전용, 보관 뒤 불가·새 묶음은 가능
    const log = (rev: number, m: string, at: string, note: string | null = null) =>
      asUser(db, c.userId, (tx) => one<{ r: number }>(tx, "select add_delivery_log($1, $2, $3, $4::timestamptz, $5) as r", [b3, rev, m, at, note]).then((x) => x.r));
    let rev = 1;
    await expectDbError(log(rev, "fax", new Date().toISOString()), /알 수 없는 전달 방식/);
    await expectDbError(log(rev, "email", new Date(Date.now() + 3600_000).toISOString()), /미래 시각 불가/);
    await expectDbError(log(rev, "email", new Date().toISOString(), "비밀\u0001"), /제어 문자/);
    rev = await log(rev, "email", new Date().toISOString(), "비밀수신확인");
    await expectDbError(db.query("update delivery_logs set note = 'x' where bundle_id = $1", [b3]), /IMMUTABLE_ROW/);
    rev = await asUser(db, c.userId, (tx) => one<{ r: number }>(tx, "select archive_delivery_bundle($1, $2) as r", [b3, rev]).then((x) => x.r));
    await expectDbError(log(rev, "email", new Date().toISOString()), /보관한 납품 묶음/);
    await expectDbError(db.query("update delivery_bundles set archived_at = null where id = $1", [b3]), /FROZEN_COLUMN/);
    await asUser(db, c.userId, (tx) => tx.query("select create_delivery_bundle($1)", [c.projectA])); // 보관 뒤에도 새 묶음
    // 감사 글자 0
    const audit = (await db.query("select details from audit_events where entity_type in ('qa_review', 'delivery_bundle') and workspace_id = $1", [c.workspaceId])).rows;
    expect(JSON.stringify(audit)).not.toMatch(/비밀|확인/);
  });

  it("묶음 50·기록 50 한도, 프로젝트 보관이면 만들기·기록 거절, 남의 것 NOT_FOUND, 권한", async () => {
    const d = await seedOwner(db, "qa-deliv-d@example.test");
    await asUser(db, d.userId, (tx) => tx.query("select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))", [d.profileA1]));
    const br = await brief(d, { kinds: ALL });
    const deck = await pptReviewed(d, br.id);
    const r1 = await open(d, "ppt_deck", deck);
    await approve(d, r1, await passAll(d, r1));
    let last = "";
    for (let i = 0; i < 50; i++) last = await asUser(db, d.userId, (tx) => one<{ id: string }>(tx, "select create_delivery_bundle($1) as id", [d.projectA]).then((x) => x.id));
    await expectDbError(asUser(db, d.userId, (tx) => tx.query("select create_delivery_bundle($1)", [d.projectA])), /50개까지/);
    let rev = 1;
    for (let i = 0; i < 50; i++) rev = await asUser(db, d.userId, (tx) => one<{ r: number }>(tx, "select add_delivery_log($1, $2, 'in_person', now(), null) as r", [last, rev]).then((x) => x.r));
    await expectDbError(asUser(db, d.userId, (tx) => tx.query("select add_delivery_log($1, $2, 'in_person', now(), null)", [last, rev])), /50건까지/);
    await expectDbError(asB((tx) => tx.query("select add_delivery_log($1, $2, 'email', now(), null)", [last, rev])), /NOT_FOUND: 납품 묶음을 찾을 수 없습니다/);
    await expectDbError(asB((tx) => tx.query("select create_delivery_bundle($1)", [d.projectA])), /NOT_FOUND: 프로젝트를 찾을 수 없습니다/);
    await expectDbError(asB((tx) => tx.query("select approve_qa_review($1, 1)", [r1])), /NOT_FOUND: 검수 회차를 찾을 수 없습니다/);
    for (const t of ["qa_reviews", "qa_check_items", "delivery_bundles", "delivery_bundle_items", "delivery_logs"]) {
      expect(await asB((tx) => tx.query(`select 1 from ${t} where workspace_id = $1`, [d.workspaceId]).then((x) => x.rows.length)), t).toBe(0);
      await expectDbError(asAnon((tx) => tx.query(`select 1 from ${t}`)), /permission denied/);
      await expectDbError(asUser(db, d.userId, (tx) => tx.query(`delete from ${t}`)), /permission denied/);
    }
    for (const fn of ["open_qa_review", "set_qa_item", "add_qa_item", "remove_qa_item", "request_qa_fix", "approve_qa_review", "rebase_qa_review", "archive_qa_review", "create_delivery_bundle", "restore_delivery_bundle", "update_delivery_bundle", "archive_delivery_bundle", "add_delivery_log"])
      expect(await one(db, "select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth, p.prosecdef as secdef from pg_proc p where p.proname = $1", [fn]), fn).toEqual({ anon: false, auth: true, secdef: true });
    await expectDbError(asUser(db, d.userId, (tx) => tx.query("select app.delivery_candidates($1)", [d.projectA])), /permission denied/);
    // 프로젝트 보관 → 만들기·기록 거절(조회는 됨)
    await db.query("update projects set status = 'archived' where id = $1", [d.projectA]);
    await expectDbError(asUser(db, d.userId, (tx) => tx.query("select restore_delivery_bundle($1)", [last])), /바탕 프로젝트가 보관/);
    expect(await asUser(db, d.userId, (tx) => tx.query("select 1 from delivery_bundles where project_id = $1", [d.projectA]).then((x) => x.rows.length))).toBe(50);
  }, 60_000);
});
