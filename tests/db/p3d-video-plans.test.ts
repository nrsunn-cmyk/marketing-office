/**
 * P3D-BACKEND-IMPL-01: 영상 구성·파일 관리 DB(20261121008000_p3d_video_plans) 시험. 설계: Plan/Claude-Backend-20261120/P3D-BACKEND-01-DESIGN.md.
 * 저장소는 shim 의 storage.objects(RLS 켜짐, metadata 칸)로 흉내 낸다. 모든 값은 합성이다.
 * 기준: Tester QA-PLAN-P3CDE-01 3절 D1~D6·DS1~DS8, 공통 X1~X11, Master 8절 결정(서명 키 공유 + 용도 바꿔치기 시험).
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { designConfirmMessage, designReserveMessage } from "@/domain/design-assets";
import { buildStrategyDraft } from "@/domain/strategy";
import { VIDEO_PLAN_LIMITS, videoCloseMessage, videoReserveMessage } from "@/domain/video-plans";
import { asUser, createDb, expectDbError, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;
let secret: string;

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "video-owner-a@example.test");
  b = await seedOwner(db, "video-owner-b@example.test");
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

// 앞 시험이 남긴 진행 중 예약이 업무실 한도(5)에 걸리지 않게, 시험마다 만료시킨다
beforeEach(async () => {
  if (db) await db.query("update video_file_uploads set expires_at = now() - interval '1 minute' where status = 'pending'");
});

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
  const kinds = o.kinds ?? ["video_plan", "design_assets"];
  return asUser(db, f.userId, async (tx) => {
    const id = (await one<{ id: string }>(tx, "select create_production_brief($1, $2, '영상 브리프', '대상', '메시지', $3::text[], '범위') as id", [projectId, s.artifactId, kinds])).id;
    if (o.ready === false) return { id, revision: 1 };
    await tx.query("select update_production_brief($1, 1, '영상 브리프', '대상', '메시지', $2::text[], '범위', null, null, 'ready')", [id, kinds]);
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

type SceneIn = { id?: string | null; title?: string; duration_sec?: unknown; narration?: unknown; subtitle?: unknown; asset_ids?: unknown };
const scene = (o: SceneIn = {}) => ({
  id: o.id ?? null,
  title: o.title ?? "첫 장면",
  duration_sec: "duration_sec" in o ? o.duration_sec : 10,
  narration: "narration" in o ? o.narration : "안녕하세요",
  subtitle: "subtitle" in o ? o.subtitle : null,
  asset_ids: o.asset_ids ?? [],
});
const createPlan = (tx: Tx, briefId: string, scenes: unknown = [scene()], title = "봄 소개 영상", aspect = "16:9") =>
  one<{ id: string }>(tx, "select create_video_plan($1, $2, $3, $4::jsonb) as id", [briefId, title, aspect, JSON.stringify(scenes)]).then((r) => r.id);
const save = (tx: Tx, id: string, rev: number, scenes: unknown, o: { title?: string; aspect?: string; status?: string } = {}) =>
  one<{ r: number }>(tx, "select save_video_plan($1, $2, $3, $4, $5, $6::jsonb) as r", [id, rev, o.title ?? "봄 소개 영상", o.aspect ?? "16:9", o.status ?? "drafting", JSON.stringify(scenes)]).then((r) => r.r);
const plan = (id: string) =>
  one<{ revision: number; current_version_no: number; current_file_version_no: number | null; archived_at: string | null; status: string; title: string; source_brief_revision: number }>(
    db, "select * from video_plans where id = $1", [id]);
const ver = (id: string, n?: number) =>
  one<{ kind: string; scenes: Array<{ id: string; title: string; duration_sec: number; narration: string | null; assets: Array<{ asset_id: string; version_no: number }> }>; total_duration_sec: number; restored_from_version_no: number | null; source_brief_revision: number; status: string }>(
    db, "select v.* from video_plan_versions v join video_plans p on p.id = v.plan_id where v.plan_id = $1 and v.version_no = coalesce($2, p.current_version_no)", [id, n ?? null]);
/** 지금 판 장면을 입력 모양으로(자산은 id 만) */
const asInput = (scenes: Array<{ id: string; title: string; duration_sec: number; narration: string | null; assets: Array<{ asset_id: string }> }>) =>
  scenes.map((s) => ({ id: s.id, title: s.title, duration_sec: s.duration_sec, narration: s.narration, subtitle: null, asset_ids: s.assets.map((x) => x.asset_id) }));

// ── 파일 ──
type FileIn = { name?: string; size?: number; mime?: string };
const reserveFile = (tx: Tx, planId: string, o: FileIn = {}, s?: { at: number; sig: string }) => {
  const i = { planId, fileName: o.name ?? "final.mp4", size: o.size ?? 5000, mime: (o.mime ?? "video/mp4") as never };
  const g = s ?? sign("video_file_reserve", videoReserveMessage(i));
  return one<{ upload_id: string; storage_key: string }>(tx, "select * from reserve_video_file_upload($1, $2, $3, $4, $5, $6)", [planId, i.fileName, i.size, i.mime, g.at, g.sig]);
};
const putVideo = (tx: Tx, key: string, size: number, mime: string, uid: string) =>
  tx.query("insert into storage.objects (bucket_id, name, owner, metadata) values ('video-files', $1, $2, $3::jsonb)", [key, uid, JSON.stringify({ size, mimetype: mime })]);
const confirmFile = (tx: Tx, uploadId: string, rev: number, note: string | null = null, s?: { at: number; sig: string }) => {
  const g = s ?? sign("video_file_confirm", uploadId);
  return one<{ r: number }>(tx, "select confirm_video_file_upload($1, $2, $3, $4, $5) as r", [uploadId, rev, note, g.at, g.sig]).then((r) => r.r);
};
async function attach(f: Fixture, planId: string, o: FileIn = {}) {
  return asUser(db, f.userId, async (tx) => {
    const u = await reserveFile(tx, planId, o);
    await putVideo(tx, u.storage_key, o.size ?? 5000, o.mime ?? "video/mp4", f.userId);
    const p = await one<{ revision: number }>(tx, "select revision from video_plans where id = $1", [planId]);
    return confirmFile(tx, u.upload_id, p.revision, "첫 편집본");
  });
}

describe("만들기·바탕 조건(X1·D1)", () => {
  it("작성 중·포함 산출물에 영상 없음·보관 브리프는 INVALID_TRANSITION, 확정 브리프는 v1(장면 id 서버가 매김)", async () => {
    const draft = await brief(a, { ready: false });
    await expectDbError(asA((tx) => createPlan(tx, draft.id)), /INVALID_TRANSITION: 확정한 제작 브리프로만/);
    const noVideo = await brief(a, { kinds: ["web_copy"] });
    await expectDbError(asA((tx) => createPlan(tx, noVideo.id)), /INVALID_TRANSITION: .*영상 구성이 없습니다/);
    const br = await brief(a);
    const id = await asA((tx) => createPlan(tx, br.id, [scene(), scene({ title: "둘째", duration_sec: 28 })]));
    expect(await plan(id)).toMatchObject({ revision: 1, current_version_no: 1, current_file_version_no: null, status: "drafting", source_brief_revision: br.revision });
    const v = await ver(id);
    expect(v.kind).toBe("create");
    expect(v.total_duration_sec).toBe(38);
    expect(v.scenes.map((s) => s.title)).toEqual(["첫 장면", "둘째"]);
    expect(new Set(v.scenes.map((s) => s.id)).size).toBe(2);
    // 만들 때 장면 id 를 지정할 수 없다(DS1)
    await expectDbError(asA((tx) => createPlan(tx, br.id, [scene({ id: v.scenes[0].id })])), /VALIDATION: 이 구성안에 없는 장면/);
    await asA((tx) => tx.query("select archive_production_brief($1, $2)", [br.id, br.revision]));
    await expectDbError(asA((tx) => createPlan(tx, br.id)), /INVALID_TRANSITION: 보관한 제작 브리프/);
  });

  it("브리프당 작업 중 5개·보관 포함 10개(LIMIT_REACHED)", async () => {
    const br = await brief(a);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await asA((tx) => createPlan(tx, br.id)));
    await expectDbError(asA((tx) => createPlan(tx, br.id)), /LIMIT_REACHED: 작업 중인 영상 구성안은 5개/);
    for (const id of ids) await asA((tx) => tx.query("select archive_video_plan($1, 1)", [id]));
    for (let i = 0; i < 5; i++) await asA((tx) => createPlan(tx, br.id));
    await expectDbError(asA((tx) => createPlan(tx, br.id)), /LIMIT_REACHED: .*10개/);
  });
});

describe("장면 검사(D2·DS2·DS3·X9)", () => {
  it("장면 0·31개, 길이 글자·소수·0·601·음수·2^31, 글 길이 경계(코드 포인트), 모르는 키는 VALIDATION", async () => {
    const br = await brief(a);
    const bad: Array<[unknown, RegExp]> = [
      [[], /1개 이상/],
      [Array.from({ length: 31 }, () => scene()), /30개까지/],
      [[scene({ duration_sec: "10" })], /정수/],
      [[scene({ duration_sec: 1.5 })], /정수/],
      [[scene({ duration_sec: 0 })], /정수/],
      [[scene({ duration_sec: 601 })], /정수/],
      [[scene({ duration_sec: -5 })], /정수/],
      [[scene({ duration_sec: 2 ** 31 })], /정수/],
      [[scene({ duration_sec: null })], /정수/],
      [[scene({ title: "" })], /장면 이름/],
      [[scene({ title: " 공백 " })], /장면 이름/],
      [[scene({ title: "가".repeat(81) })], /장면 이름/],
      [[scene({ narration: "😀".repeat(1001) })], /1,000자/],
      [[scene({ subtitle: "가".repeat(301) })], /300자/],
      [[scene({ narration: 3 })], /1,000자/],
      [[{ ...scene(), excluded: true }], /장면 형식/],
      [[{ ...scene(), sort_order: 1 }], /장면 형식/],
      [["문자열"], /장면 형식/],
      [{ not: "array" }, /1개 이상/],
    ];
    for (const [sc, re] of bad) await expectDbError(asA((tx) => createPlan(tx, br.id, sc)), re);
    // 경계 안쪽(이모지는 한 글자)
    const id = await asA((tx) => createPlan(tx, br.id, [scene({ title: "가".repeat(80), duration_sec: 600, narration: "😀".repeat(1000), subtitle: "나".repeat(300) })]));
    expect((await ver(id)).total_duration_sec).toBe(600);
    const max = await asA((tx) => createPlan(tx, br.id, Array.from({ length: 30 }, () => scene({ duration_sec: 600 }))));
    expect((await ver(max)).total_duration_sec).toBe(18000);
    expect(await count("select 1 from video_plans where production_brief_id = $1", [br.id])).toBe(2);
  });
});

describe("저장 = 새 판, 빼기·되돌리기(Q8·Q15·D3·DS1·X10)", () => {
  it("저장·CONFLICT·바뀐 것 없음·빼기·마지막 1개·옛 판 되돌리기로 장면 id 그대로 복구", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createPlan(tx, br.id, [scene({ title: "하나" }), scene({ title: "둘" }), scene({ title: "셋" })]));
    const v1 = await ver(id);
    const auditBefore = await count("select 1 from audit_events where entity_id = $1", [id]);
    // 바뀐 것 없음 → VALIDATION, 감사 0
    await expectDbError(asA((tx) => save(tx, id, 1, asInput(v1.scenes))), /VALIDATION: 바뀐 내용이 없습니다/);
    expect(await count("select 1 from audit_events where entity_id = $1", [id])).toBe(auditBefore);
    // 순서 바꾸기 + 둘째 빼기 + 새 장면
    const r2 = await asA((tx) => save(tx, id, 1, [asInput(v1.scenes)[2], asInput(v1.scenes)[0], scene({ title: "넷" })]));
    const v2 = await ver(id);
    expect(v2.kind).toBe("save");
    expect(v2.scenes.map((s) => s.title)).toEqual(["셋", "하나", "넷"]);
    expect(v2.scenes[0].id).toBe(v1.scenes[2].id);
    await expectDbError(asA((tx) => save(tx, id, 1, asInput(v2.scenes), { title: "다른 제목" })), /CONFLICT/);
    // 뺀 장면 id 를 다시 넣으면 거절(되살리기는 되돌리기로만, DS1)
    await expectDbError(asA((tx) => save(tx, id, r2, [...asInput(v2.scenes), { ...asInput(v1.scenes)[1] }])), /이 구성안에 없는 장면/);
    // 지어낸 id·같은 장면 두 번
    await expectDbError(asA((tx) => save(tx, id, r2, [{ ...asInput(v2.scenes)[0], id: "00000000-0000-4000-8000-000000000999" }])), /이 구성안에 없는 장면/);
    await expectDbError(asA((tx) => save(tx, id, r2, [asInput(v2.scenes)[0], asInput(v2.scenes)[0]])), /두 번/);
    // 마지막 1개는 못 뺀다(0개 거절)
    await expectDbError(asA((tx) => save(tx, id, r2, [])), /1개 이상/);
    // 되돌리기: v1 → 새 판(restore), 둘째 장면이 같은 id 로 돌아온다
    const r3 = await asA((tx) => one<{ r: number }>(tx, "select restore_video_plan_version($1, $2, 1) as r", [id, r2])).then((x) => x.r);
    const v3 = await ver(id);
    expect(v3).toMatchObject({ kind: "restore", restored_from_version_no: 1 });
    expect(v3.scenes).toEqual(v1.scenes);
    await expectDbError(asA((tx) => tx.query("select restore_video_plan_version($1, $2, 3)", [id, r3])), /지금 구성안과 같은 판/);
    await expectDbError(asA((tx) => tx.query("select restore_video_plan_version($1, $2, 99)", [id, r3])), /NOT_FOUND/);
    // 상태는 판에 남고 머리 행도 바뀐다
    await asA((tx) => save(tx, id, r3, asInput(v3.scenes), { status: "reviewed" }));
    expect((await plan(id)).status).toBe("reviewed");
    await expectDbError(asA((tx) => save(tx, id, r3 + 1, asInput(v3.scenes), { status: "approved" })), /알 수 없는 진행 상태/);
    await expectDbError(asA((tx) => save(tx, id, r3 + 1, asInput(v3.scenes), { aspect: "4:3" })), /화면 비율/);
  });

  it("판 100 한도(LIMIT_REACHED)", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createPlan(tx, br.id));
    let rev = 1;
    for (let i = 2; i <= 100; i++) rev = await asA((tx) => save(tx, id, rev, [scene({ duration_sec: i })]));
    expect((await plan(id)).current_version_no).toBe(100);
    await expectDbError(asA((tx) => save(tx, id, rev, [scene({ duration_sec: 3 })])), /LIMIT_REACHED: .*100개/);
  }, 60_000);
});

describe("디자인 자산 연결·이전 기준(Q10·Q11·DS4·X4)", () => {
  it("같은 프로젝트·보관 안 된 자산만, 판 번호는 서버가 찍고 저장해도 유지, 맞추기로만 최신", async () => {
    const br = await brief(a);
    const as1 = await designAsset(a, br.id, "로고");
    const as2 = await designAsset(a, br.id, "배경");
    const otherProject = await brief(a, { projectId: a.projectB });
    const asOther = await designAsset(a, otherProject.id, "다른 프로젝트");
    const brB = await brief(b);
    const asB1 = await designAsset(b, brB.id, "남의 자산");
    // 남의 업무실·다른 프로젝트·지어낸 id·중복·11개 거절
    for (const ids of [[asB1], [asOther], ["00000000-0000-4000-8000-000000000123"]])
      await expectDbError(asA((tx) => createPlan(tx, br.id, [scene({ asset_ids: ids })])), /같은 프로젝트의 보관하지 않은 디자인 자산만/);
    await expectDbError(asA((tx) => createPlan(tx, br.id, [scene({ asset_ids: [as1, as1] })])), /두 번/);
    await expectDbError(asA((tx) => createPlan(tx, br.id, [scene({ asset_ids: Array.from({ length: 11 }, () => as1) })])), /10개까지/);
    await expectDbError(asA((tx) => createPlan(tx, br.id, [scene({ asset_ids: ["문자"] })])), /형식이 올바르지 않습니다/);
    await expectDbError(asA((tx) => createPlan(tx, br.id, [scene({ asset_ids: [{ asset_id: as1, version_no: 1 }] })])), /형식이 올바르지 않습니다/);

    const id = await asA((tx) => createPlan(tx, br.id, [scene({ asset_ids: [as1] })]));
    expect((await ver(id)).scenes[0].assets).toEqual([{ asset_id: as1, version_no: 1 }]);
    // 자산 새 판 → 저장해도 판 번호 1 유지(이전 기준이 몰래 풀리지 않음), 새로 넣은 자산은 지금 판
    await designReplace(a, as1);
    const v = await ver(id);
    const r2 = await asA((tx) => save(tx, id, 1, [{ ...asInput(v.scenes)[0], asset_ids: [as1, as2], narration: "고침" }]));
    expect((await ver(id)).scenes[0].assets).toEqual([{ asset_id: as1, version_no: 1 }, { asset_id: as2, version_no: 1 }]);
    // 맞추기 → as1 판 2, 판 하나 더(kind rebase)
    const r3 = await asA((tx) => one<{ r: number }>(tx, "select rebase_video_plan($1, $2) as r", [id, r2])).then((x) => x.r);
    const v3 = await ver(id);
    expect(v3.kind).toBe("rebase");
    expect(v3.scenes[0].assets).toEqual([{ asset_id: as1, version_no: 2 }, { asset_id: as2, version_no: 1 }]);
    await expectDbError(asA((tx) => tx.query("select rebase_video_plan($1, $2)", [id, r3])), /VALIDATION: 이미 지금/);
    // 연결 뒤 자산을 보관해도 저장 때 그대로 둔다(경고만), 새로 연결은 거절
    const as2rev = await one<{ revision: number }>(db, "select revision from design_assets where id = $1", [as2]);
    await asA((tx) => tx.query("select archive_design_asset($1, $2)", [as2, as2rev.revision]));
    const r4 = await asA((tx) => save(tx, id, r3, [{ ...asInput(v3.scenes)[0], narration: "또 고침" }]));
    expect((await ver(id)).scenes[0].assets.map((x) => x.asset_id)).toEqual([as1, as2]);
    await expectDbError(asA((tx) => save(tx, id, r4, [asInput(v3.scenes)[0], scene({ asset_ids: [as2] })])), /보관하지 않은 디자인 자산만/);
    // 브리프 기준: 브리프가 작성 중이면 맞추기 거절(원인별 문구)
    await asA((tx) => tx.query("select update_production_brief($1, $2, '영상 브리프 2', '대상', '메시지', $3::text[], '범위', null, null, 'drafting')", [br.id, br.revision, ["video_plan", "design_assets"]]));
    await expectDbError(asA((tx) => tx.query("select rebase_video_plan($1, $2)", [id, r4])), /INVALID_TRANSITION: 제작 브리프가 작성 중/);
    await asA((tx) => tx.query("select update_production_brief($1, $2, '영상 브리프 2', '대상', '메시지', $3::text[], '범위', null, null, 'ready')", [br.id, br.revision + 1, ["video_plan", "design_assets"]]));
    await asA((tx) => tx.query("select rebase_video_plan($1, $2)", [id, r4]));
    expect((await ver(id)).source_brief_revision).toBe(br.revision + 2);
  });
});

describe("영상 파일(D4·DS5·DS6·DS8·Master 결정 ④)", () => {
  it("서명 용도 바꿔치기·틀린 서명·5분 지난 서명은 BAD_SIGNATURE", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createPlan(tx, br.id));
    const i = { planId: id, fileName: "final.mp4", size: 5000, mime: "video/mp4" as const };
    // 같은 키·같은 메시지라도 디자인 자산 용도 서명은 영상 예약에 못 쓴다
    await expectDbError(asA((tx) => reserveFile(tx, id, {}, sign("design_reserve", videoReserveMessage(i)))), /BAD_SIGNATURE/);
    await expectDbError(asA((tx) => reserveFile(tx, id, {}, sign("video_file_confirm", videoReserveMessage(i)))), /BAD_SIGNATURE/);
    await expectDbError(asA((tx) => reserveFile(tx, id, {}, sign("video_file_reserve", videoReserveMessage(i), Date.now(), "x".repeat(64)))), /BAD_SIGNATURE/);
    await expectDbError(asA((tx) => reserveFile(tx, id, {}, sign("video_file_reserve", videoReserveMessage(i), Date.now() - 6 * 60_000))), /BAD_SIGNATURE/);
    // 메시지 한 칸만 달라도(크기) 거절
    await expectDbError(asA((tx) => reserveFile(tx, id, { size: 9999 }, sign("video_file_reserve", videoReserveMessage(i)))), /BAD_SIGNATURE/);
    const u = await asA((tx) => reserveFile(tx, id));
    await asA((tx) => putVideo(tx, u.storage_key, 5000, "video/mp4", a.userId));
    // 확정에 디자인 확정 용도 서명(메시지 예약id|…) → 거절
    await expectDbError(asA((tx) => confirmFile(tx, u.upload_id, 1, null, sign("design_confirm", u.upload_id))), /BAD_SIGNATURE/);
    await expectDbError(asA((tx) => confirmFile(tx, u.upload_id, 1, null, sign("video_file_reserve", u.upload_id))), /BAD_SIGNATURE/);
    // 반대로 영상 용도 서명은 디자인 자산 확정에 못 쓴다
    const sha = "a".repeat(64);
    await expectDbError(
      asA((tx) => {
        const g = sign("video_file_confirm", designConfirmMessage(u.upload_id, sha));
        return tx.query("select create_design_asset($1, '이름', null, 'external_upload', $2, $3, $4)", [u.upload_id, sha, g.at, g.sig]);
      }),
      /BAD_SIGNATURE/,
    );
    expect(await asA((tx) => confirmFile(tx, u.upload_id, 1))).toBe(2);
    await expectDbError(asAnon((tx) => tx.query("select * from reserve_video_file_upload($1, 'a.mp4', 1, 'video/mp4', 1, 'x')", [id])), /permission denied/);
  });

  it("형식·이름·크기 검사, 저장소 기록 위조(text/html·크기 다름·없음)는 확정 거절", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createPlan(tx, br.id));
    await expectDbError(asA((tx) => reserveFile(tx, id, { mime: "text/html", name: "a.html" })), /UNSUPPORTED_TYPE/);
    await expectDbError(asA((tx) => reserveFile(tx, id, { mime: "video/x-msvideo", name: "a.avi" })), /UNSUPPORTED_TYPE/);
    await expectDbError(asA((tx) => reserveFile(tx, id, { size: VIDEO_PLAN_LIMITS.maxFileBytes + 1 })), /TOO_LARGE/);
    await expectDbError(asA((tx) => reserveFile(tx, id, { size: 0 })), /TOO_LARGE/);
    for (const name of ["a.mov", "a.mp4.html", "../a.mp4", ".mp4", "a‮mp4.mp4", " a.mp4"])
      await expectDbError(asA((tx) => reserveFile(tx, id, { name })), /TYPE_MISMATCH/);
    const ok1 = await asA((tx) => reserveFile(tx, id, { name: "옛 편집.MOV", mime: "video/quicktime" }));
    expect(ok1.storage_key).toMatch(new RegExp(`^${a.workspaceId}/video-files/[0-9a-f-]{36}\\.mov$`));
    // 위조: 저장소 기록이 text/html(DS5)
    const u = await asA((tx) => reserveFile(tx, id));
    await expectDbError(asA((tx) => confirmFile(tx, u.upload_id, 1)), /UPLOAD_MISSING/);
    await asA((tx) => putVideo(tx, u.storage_key, 5000, "text/html", a.userId));
    await expectDbError(asA((tx) => confirmFile(tx, u.upload_id, 1)), /TYPE_MISMATCH/);
    const u2 = await asA((tx) => reserveFile(tx, id));
    await asA((tx) => putVideo(tx, u2.storage_key, 4999, "video/mp4", a.userId));
    await expectDbError(asA((tx) => confirmFile(tx, u2.upload_id, 1)), /TYPE_MISMATCH/);
    // 닫기(서버 서명) 뒤에는 확정 불가, 이유 목록 밖 거절
    const c = sign("video_file_close", videoCloseMessage(u2.upload_id, "TYPE_MISMATCH"));
    await asA((tx) => tx.query("select close_video_file_upload($1, 'TYPE_MISMATCH', $2, $3)", [u2.upload_id, c.at, c.sig]));
    await expectDbError(asA((tx) => confirmFile(tx, u2.upload_id, 1)), /INVALID_TRANSITION: 이미 끝난/);
    const c2 = sign("video_file_close", `${u.upload_id}|WHATEVER`);
    await expectDbError(asA((tx) => tx.query("select close_video_file_upload($1, 'WHATEVER', $2, $3)", [u.upload_id, c2.at, c2.sig])), /알 수 없는 닫기 이유/);
    // 만료
    await db.query("update video_file_uploads set expires_at = now() - interval '1 minute' where id = $1", [u.upload_id]);
    await expectDbError(asA((tx) => confirmFile(tx, u.upload_id, 1)), /UPLOAD_EXPIRED/);
    // 확정 메모 301자
    const u3 = await asA((tx) => reserveFile(tx, id));
    await asA((tx) => putVideo(tx, u3.storage_key, 5000, "video/mp4", a.userId));
    await expectDbError(asA((tx) => confirmFile(tx, u3.upload_id, 1, "가".repeat(301))), /300자/);
  });

  it("파일 판 20(DS6)·비파괴 되돌리기(같은 객체로 새 판)·진행 중 예약 5·업무실 총량", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createPlan(tx, br.id));
    for (let i = 0; i < 3; i++) await attach(a, id, { size: 1000 + i });
    const v1 = await one<{ storage_key: string }>(db, "select storage_key from video_file_versions where plan_id = $1 and version_no = 1", [id]);
    let p = await plan(id);
    expect(p.current_file_version_no).toBe(3);
    await asA((tx) => tx.query("select restore_video_file_version($1, $2, 1)", [id, p.revision]));
    const v4 = await one<{ kind: string; storage_key: string; restored_from_version_no: number }>(db, "select * from video_file_versions where plan_id = $1 and version_no = 4", [id]);
    expect(v4).toMatchObject({ kind: "restore", storage_key: v1.storage_key, restored_from_version_no: 1 });
    p = await plan(id);
    await expectDbError(asA((tx) => tx.query("select restore_video_file_version($1, $2, 1)", [id, p.revision])), /지금 파일과 같은 버전/);
    expect(await count("select 1 from video_file_versions where plan_id = $1", [id])).toBe(4);
    for (let i = 5; i <= 20; i++) await attach(a, id, { size: 2000 + i });
    await expectDbError(asA((tx) => reserveFile(tx, id)), /LIMIT_REACHED: 첨부 파일 버전은 20개/);
    p = await plan(id);
    await expectDbError(asA((tx) => tx.query("select restore_video_file_version($1, $2, 2)", [id, p.revision])), /LIMIT_REACHED/);

    // 진행 중 예약은 업무실당 5
    const id2 = await asA((tx) => createPlan(tx, br.id));
    for (let i = 0; i < 5; i++) await asA((tx) => reserveFile(tx, id2));
    await expectDbError(asA((tx) => reserveFile(tx, id2)), /LIMIT_REACHED: 진행 중인 영상 업로드/);
    await db.query("update video_file_uploads set expires_at = now() - interval '1 minute' where plan_id = $1 and status = 'pending'", [id2]);
    // 업무실 총량 1GB: 다른 구성안에 50MB 판 20개를 넣어 두면(1000MB) 50MB 하나 더는 넘는다
    const id3 = await asA((tx) => createPlan(tx, br.id));
    await db.query(
      `insert into video_file_versions (workspace_id, plan_id, version_no, kind, storage_key, file_name, file_size_bytes, mime_type, created_by)
       select $1::uuid, $2::uuid, n, 'upload', $1::text || '/video-files/big-' || n || '.mp4', 'big.mp4', 52428800, 'video/mp4', $3::uuid from generate_series(1, 20) n`,
      [a.workspaceId, id3, a.userId],
    );
    await expectDbError(asA((tx) => reserveFile(tx, id2, { size: VIDEO_PLAN_LIMITS.maxFileBytes })), /QUOTA_EXCEEDED/);
    await asA((tx) => reserveFile(tx, id2, { size: 1000 })); // 작은 파일은 아직 들어간다
  }, 60_000);
});

describe("보관·동결·추가 전용(X2·X5)", () => {
  it("보관 뒤 쓰기 RPC 모두 INVALID_TRANSITION, 진행 중 예약 닫힘, 슈퍼유저 직접 수정·판 수정·삭제 거절", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createPlan(tx, br.id));
    await attach(a, id);
    const u = await asA((tx) => reserveFile(tx, id));
    const r = await asA((tx) => one<{ r: number }>(tx, "select archive_video_plan($1, 2) as r", [id])).then((x) => x.r);
    expect(await one<{ status: string; close_reason: string }>(db, "select status, close_reason from video_file_uploads where id = $1", [u.upload_id])).toEqual({ status: "closed", close_reason: "CANCELLED" });
    const v = await ver(id);
    const calls: Array<(tx: Tx) => Promise<unknown>> = [
      (tx: Tx) => save(tx, id, r, asInput(v.scenes), { title: "새 제목" }),
      (tx: Tx) => tx.query("select restore_video_plan_version($1, $2, 1)", [id, r]),
      (tx: Tx) => tx.query("select rebase_video_plan($1, $2)", [id, r]),
      (tx: Tx) => tx.query("select archive_video_plan($1, $2)", [id, r]),
      (tx: Tx) => tx.query("select restore_video_file_version($1, $2, 1)", [id, r]),
      (tx: Tx) => reserveFile(tx, id),
    ];
    for (const call of calls) await expectDbError(asA(call), /INVALID_TRANSITION/);
    // 보관 + 틀린 revision 이어도 남의 것은 NOT_FOUND 가 먼저(X7)
    await expectDbError(asB((tx) => tx.query("select archive_video_plan($1, 999)", [id])), /NOT_FOUND: 영상 구성안을 찾을 수 없습니다/);
    await expectDbError(db.query("update video_plans set archived_at = null where id = $1", [id]), /FROZEN_COLUMN/);
    await expectDbError(db.query("update video_plan_versions set title = 'x' where plan_id = $1", [id]), /IMMUTABLE_ROW/);
    await expectDbError(db.query("delete from video_plan_versions where plan_id = $1", [id]), /IMMUTABLE_ROW/);
    await expectDbError(db.query("update video_file_versions set file_name = 'x.mp4' where plan_id = $1", [id]), /IMMUTABLE_ROW/);
    await expectDbError(db.query("delete from video_file_versions where plan_id = $1", [id]), /IMMUTABLE_ROW/);
    await expectDbError(db.query("update video_plans set project_id = $2 where id = $1", [id, a.projectB]), /FROZEN_COLUMN|violates/);
  });
});

describe("남의 업무실·권한·감사(X6·X7·X8·DS7)", () => {
  it("남의 구성안은 없는 id 와 같은 NOT_FOUND 문구, 읽기 0", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createPlan(tx, br.id));
    const v = await ver(id);
    const missing = "00000000-0000-4000-8000-0000000000aa";
    for (const target of [id, missing]) {
      await expectDbError(asB((tx) => save(tx, target, 1, asInput(v.scenes), { title: "남" })), /^NOT_FOUND: 영상 구성안을 찾을 수 없습니다$|NOT_FOUND: 영상 구성안을 찾을 수 없습니다/);
      await expectDbError(asB((tx) => tx.query("select restore_video_file_version($1, 1, 1)", [target])), /NOT_FOUND: 영상 구성안을 찾을 수 없습니다/);
      await expectDbError(asB((tx) => reserveFile(tx, target)), /NOT_FOUND: 영상 구성안을 찾을 수 없습니다/);
    }
    await expectDbError(asB((tx) => createPlan(tx, br.id)), /NOT_FOUND: 제작 브리프를 찾을 수 없습니다/);
    const u = await asA((tx) => reserveFile(tx, id));
    await expectDbError(asB((tx) => confirmFile(tx, u.upload_id, 1)), /NOT_FOUND/);
    for (const t of ["video_plans", "video_plan_versions", "video_file_versions"])
      expect(await asB((tx) => tx.query(`select 1 from ${t} where workspace_id = $1`, [a.workspaceId]).then((r) => r.rows.length))).toBe(0);
  });

  it("직접 쓰기·예약 읽기·anon·app 도우미 실행 거절, 저장소 insert 는 진행 중 예약 경로만", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createPlan(tx, br.id));
    for (const sql of [
      "insert into video_plans (workspace_id, project_id, production_brief_id, source_brief_revision, title, aspect_ratio, current_version_no, created_by) values ($1, $2, $3, 1, 't', '16:9', 1, $4)",
    ])
      await expectDbError(asA((tx) => tx.query(sql, [a.workspaceId, a.projectA, br.id, a.userId])), /permission denied/);
    for (const sql of ["update video_plans set title = 'x'", "delete from video_plans", "update video_plan_versions set title = 'x'", "delete from video_file_versions", "truncate video_plans", "select * from video_file_uploads"])
      await expectDbError(asA((tx) => tx.query(sql)), /permission denied/);
    for (const t of ["video_plans", "video_plan_versions", "video_file_versions", "video_file_uploads"])
      await expectDbError(asAnon((tx) => tx.query(`select 1 from ${t}`)), /permission denied/);
    for (const fn of ["app.video_file_used_bytes($1)", "app.lock_own_video_plan($1)", "app.video_build_scenes($1, $1, null, '[]'::jsonb)"])
      await expectDbError(asA((tx) => tx.query(`select ${fn}`, [a.workspaceId])), /permission denied/);
    for (const fn of ["create_video_plan", "save_video_plan", "archive_video_plan", "confirm_video_file_upload"])
      expect(await one<{ ok: boolean }>(db, `select has_function_privilege('anon', p.oid, 'execute') as ok from pg_proc p where p.proname = $1`, [fn])).toEqual({ ok: false });
    // 저장소: 예약 경로만, 다른 경로·남의 예약 경로·만료 경로 거절
    const u = await asA((tx) => reserveFile(tx, id));
    await expectDbError(asA((tx) => putVideo(tx, `${a.workspaceId}/video-files/지어낸.mp4`, 1, "video/mp4", a.userId)), /row-level security/);
    await expectDbError(asB((tx) => putVideo(tx, u.storage_key, 5000, "video/mp4", b.userId)), /row-level security/);
    await asA((tx) => putVideo(tx, u.storage_key, 5000, "video/mp4", a.userId));
    // 덮어쓰기·삭제 정책 없음
    expect(await asA((tx) => tx.query("update storage.objects set metadata = '{}'::jsonb where name = $1", [u.storage_key]).then((r) => r.affectedRows ?? 0))).toBe(0);
    expect(await asB((tx) => tx.query("select 1 from storage.objects where name = $1", [u.storage_key]).then((r) => r.rows.length))).toBe(0);
  });

  it("감사 1행/쓰기, details 에 제목·대사·자막·파일 이름·메모 글자 0(DS7)", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createPlan(tx, br.id, [scene({ title: "비밀장면", narration: "비밀대사", subtitle: "비밀자막" })], "비밀제목"));
    await asUser(db, a.userId, async (tx) => {
      const u = await reserveFile(tx, id, { name: "비밀파일.mp4" });
      await putVideo(tx, u.storage_key, 5000, "video/mp4", a.userId);
      await confirmFile(tx, u.upload_id, 1, "비밀메모");
    });
    const rows = (await db.query<{ action: string; details: unknown }>("select action, details from audit_events where entity_type = 'video_plan' and entity_id = $1 order by seq", [id])).rows;
    expect(rows.map((r) => r.action)).toEqual(["video_plan_create", "video_file_upload"]);
    expect(JSON.stringify(rows)).not.toMatch(/비밀/);
  });
});

describe("앱 상수 = DB 상수(Master 결정 ①③, 한쪽만 바꾸지 않게)", () => {
  it("파일 상한·업무실 총량·버킷 한도", async () => {
    const r = await one<{ max: string; quota: string; bucket: string; mimes: string[] }>(
      db,
      "select app.video_file_max_bytes()::text as max, app.video_file_quota_bytes()::text as quota, (select file_size_limit::text from storage.buckets where id = 'video-files') as bucket, (select allowed_mime_types from storage.buckets where id = 'video-files') as mimes",
    );
    expect(Number(r.max)).toBe(VIDEO_PLAN_LIMITS.maxFileBytes);
    expect(Number(r.bucket)).toBe(VIDEO_PLAN_LIMITS.maxFileBytes);
    expect(Number(r.quota)).toBe(VIDEO_PLAN_LIMITS.workspaceQuotaBytes);
    expect(r.mimes).toEqual(["video/mp4", "video/quicktime", "video/webm"]);
    expect(readFileSync("supabase/migrations/20261121008000_p3d_video_plans.sql", "utf8")).not.toMatch(/https?:\/\//);
  });
});
