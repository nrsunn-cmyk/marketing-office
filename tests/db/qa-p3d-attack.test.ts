/**
 * QA-P3D-PREP-01(Tester): P3-d 영상 구성·파일 공격 시험(PGlite). 근거: P3D-BACKEND-01-DESIGN.md + Master 8절, 이름·인자는 ./qa-p3d-names.ts 한곳.
 * migration 에 video_plans 가 없으면 전체를 건너뛴다. 저장소는 storage.objects 흉내 행(metadata.size·mimetype)으로 대신한다. 모든 값은 합성.
 */
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft } from "@/domain/strategy";
import {
  asUser,
  createDb,
  expectDbError,
  newKey,
  one,
  seedOwner,
  type Db,
  type Fixture,
  type Tx,
} from "./harness";
import {
  closeMessage,
  confirmMessage,
  P3D,
  p3dMigrationPresent,
  reserveMessage,
  scene,
  scenes,
  sql,
  type SceneIn,
} from "./qa-p3d-names";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 });
const present = p3dMigrationPresent();
const L = P3D.limits;
const T = P3D.tables;
let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;
let secret = "";

const asU = <R>(f: Fixture | null, fn: (tx: Tx) => Promise<R>) =>
  asUser(db, f ? f.userId : null, fn);
const run = (f: Fixture | null, q: { text: string; params: unknown[] }) =>
  asU(f, (tx) => one<{ r: unknown }>(tx, q.text, q.params)).then((x) => x.r);
const count = async (q: string, p: unknown[] = []) =>
  (await one<{ n: number }>(db, `select count(*)::int as n from (${q}) x`, p))
    .n;
const plan = (id: string) =>
  one<{
    revision: number;
    current_version_no: number;
    current_file_version_no: number | null;
    archived_at: string | null;
  }>(db, `select * from public.${T.plans} where id = $1`, [id]);
const cur = (id: string) =>
  one<{
    scenes: Array<
      {
        id: string;
        title: string;
        duration_sec: number;
        assets: Array<{ asset_id: string; version_no: number }>;
      } & Record<string, unknown>
    >;
    kind: string;
  }>(
    db,
    `select v.* from public.${T.versions} v join public.${T.plans} p on p.id = v.plan_id and v.version_no = p.current_version_no where p.id = $1`,
    [id],
  );
const act = async (
  f: Fixture | null,
  id: string,
  mk: (rev: number) => { text: string; params: unknown[] },
) => run(f, mk((await plan(id)).revision));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sign = async (
  purpose: string,
  msg: string,
  at = Date.now(),
  key = secret,
) =>
  (
    await one<{ h: string }>(
      db,
      "select app.hmac_sha256(convert_to($1, 'UTF8'), convert_to($2, 'UTF8')) as h",
      [key, `${purpose}|${msg}|${at}`],
    )
  ).h;
const approveProfile = (tx: Tx, id: string) =>
  tx.query(
    "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
    [id],
  );

type Ctx = { projectId: string; taskId: string; briefId: string };
async function ctx(
  f: Fixture,
  types: string[] = ["video_plan", "design_assets"],
  status: "ready" | "drafting" = "ready",
): Promise<Ctx> {
  return asU(f, async (tx) => {
    const projectId = (
      await one<{ id: string }>(
        tx,
        "insert into projects (workspace_id, client_id, kind, title) values ($1, $2, 'client', '합성 P3D') returning id",
        [f.workspaceId, f.clientA],
      )
    ).id;
    const taskId = (
      await one<{ id: string }>(
        tx,
        "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id",
        [f.workspaceId, projectId, strategyTpl, newKey()],
      )
    ).id;
    const input = {
      templateVersion: STRATEGY_TEMPLATE_VERSION,
      projectId,
      profile: {
        id: f.profileA1,
        version: 1,
        projectId,
        clientId: f.clientA,
        projectKind: "client",
      },
      sections: {
        goals: {
          facts: [
            {
              text: "합성 목표",
              sources: [
                { kind: "profile", profileId: f.profileA1, version: 1 },
              ],
            },
          ],
          inferences: [],
        },
        offers: { facts: [], inferences: [{ text: "합성 제안" }] },
      },
      unknowns: [],
    };
    const d = buildStrategyDraft(input);
    if (!d.ok) throw new Error(JSON.stringify(d.issues));
    const g = await one<{ artifact_id: string; version_id: string }>(
      tx,
      "select * from generate_strategy($1, $2, $3, $4, $5)",
      [
        taskId,
        newKey(),
        f.profileA1,
        JSON.stringify(input),
        JSON.stringify(d.result),
      ],
    );
    await tx.query("select decide_version($1, $2, 'approved', null)", [
      g.artifact_id,
      g.version_id,
    ]);
    const briefId = (
      await one<{ id: string }>(
        tx,
        "select create_production_brief($1, $2, '합성 브리프', '대상', '메시지', $3::text[], '범위', null, null) as id",
        [projectId, g.artifact_id, types],
      )
    ).id;
    if (status === "ready")
      await tx.query(
        "select update_production_brief($1, 1, '합성 브리프', '대상', '메시지', $2::text[], '범위', null, null, 'ready')",
        [briefId, types],
      );
    return { projectId, taskId, briefId };
  });
}
const putObject = (
  f: Fixture | null,
  bucket: string,
  key: string,
  size: number,
  mime: string,
) =>
  asU(f, (tx) =>
    tx.query(
      "insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, auth.uid(), $3::jsonb)",
      [bucket, key, JSON.stringify({ size, mimetype: mime })],
    ),
  );

/** P3-c 디자인 자산(서명된 예약 → 객체 → 확정). 교체로 새 판을 만든다 */
async function designAsset(
  f: Fixture,
  c: Ctx,
  assetId: string | null = null,
): Promise<string> {
  const name = `a${Math.random().toString(36).slice(2, 7)}.png`;
  const at = Date.now();
  const rs = await sign(
    P3D.designPurpose.reserve,
    [c.briefId, assetId ?? "", "logo", "1000", "image/png", name].join("|"),
    at,
  );
  const up = await asU(f, (tx) =>
    one<{ upload_id: string; storage_key: string }>(
      tx,
      "select * from reserve_design_asset_upload($1, $2, 'logo', $3, 1000, 'image/png', $4, $5)",
      [c.briefId, assetId, name, at, rs],
    ),
  );
  await putObject(f, "design-assets", up.storage_key, 1000, "image/png");
  const h = sha(up.upload_id);
  const at2 = Date.now();
  const cs = await sign(P3D.designPurpose.confirm, `${up.upload_id}|${h}`, at2);
  if (!assetId)
    return (
      await asU(f, (tx) =>
        one<{ id: string }>(
          tx,
          "select create_design_asset($1, '합성 자산', null, 'external_upload', $2, $3, $4) as id",
          [up.upload_id, h, at2, cs],
        ),
      )
    ).id;
  const rev = (
    await one<{ revision: number }>(
      db,
      "select revision from design_assets where id = $1",
      [assetId],
    )
  ).revision;
  await asU(f, (tx) =>
    tx.query("select replace_design_asset_file($1, $2, $3, null, $4, $5, $6)", [
      assetId,
      rev,
      up.upload_id,
      h,
      at2,
      cs,
    ]),
  );
  return assetId;
}
const createPlan = async (
  f: Fixture,
  c: Ctx,
  sc: unknown = scenes(2),
  title = "합성 구성안",
) => (await run(f, sql.create(c.briefId, title, "16:9", sc))) as string;
const save = (f: Fixture, id: string, sc: unknown, title = "합성 구성안") =>
  act(f, id, (rev) => sql.save(id, rev, title, "16:9", "drafting", sc));
/** 지금 판 장면을 입력 모양(asset_ids)으로 */
const asInput = async (id: string): Promise<SceneIn[]> =>
  (await cur(id)).scenes.map((s) => ({
    id: s.id,
    title: s.title,
    duration_sec: s.duration_sec,
    narration: (s.narration as string) ?? null,
    subtitle: (s.subtitle as string) ?? null,
    asset_ids: s.assets.map((x) => x.asset_id),
  }));

/** 영상 업로드: 예약 → 객체 → 확정 */
async function reserve(
  f: Fixture,
  planId: string,
  o: {
    name?: string;
    size?: number;
    mime?: string;
    sig?: string | null;
    at?: number;
  } = {},
) {
  const name = o.name ?? `v${Math.random().toString(36).slice(2, 7)}.mp4`;
  const size = o.size ?? 5000;
  const mime = o.mime ?? "video/mp4";
  const at = o.at ?? Date.now();
  const sig =
    o.sig === undefined
      ? await sign(
          P3D.purpose.reserve,
          reserveMessage(planId, size, mime, name),
          at,
        )
      : o.sig;
  return asU(f, (tx) =>
    one<{ upload_id: string; storage_key: string }>(
      tx,
      sql.reserve(planId, name, size, mime, at, sig).text,
      sql.reserve(planId, name, size, mime, at, sig).params,
    ),
  );
}
async function confirm(
  f: Fixture,
  planId: string,
  uploadId: string,
  o: { sig?: string | null; note?: string | null } = {},
) {
  const at = Date.now();
  const sig =
    o.sig === undefined
      ? await sign(P3D.purpose.confirm, confirmMessage(uploadId), at)
      : o.sig;
  const rev = (await plan(planId)).revision;
  return run(f, sql.confirm(uploadId, rev, o.note ?? null, at, sig));
}
async function uploadFile(f: Fixture, planId: string) {
  const up = await reserve(f, planId);
  await putObject(f, P3D.bucket, up.storage_key, 5000, "video/mp4");
  await confirm(f, planId, up.upload_id);
}

describe.skipIf(!present)(`P3-d 영상 구성·파일 공격 시험(${T.plans})`, () => {
  beforeAll(async () => {
    db = await createDb();
    await db.exec(
      "alter table storage.objects add column if not exists metadata jsonb",
    );
    a = await seedOwner(db, "p3d-owner-a@example.test");
    b = await seedOwner(db, "p3d-owner-b@example.test");
    strategyTpl = (
      await one<{ id: string }>(db, "select id from templates where key = $1", [
        STRATEGY_TEMPLATE_VERSION,
      ])
    ).id;
    await asU(a, (tx) => approveProfile(tx, a.profileA1));
    await asU(b, (tx) => approveProfile(tx, b.profileA1));
    secret = (
      await one<{ value: string }>(
        db,
        "select value from app.server_secrets where name = $1",
        [P3D.secretName],
      )
    ).value;
  });
  beforeEach(async () => {
    await db.query(
      `update public.${T.uploads} set expires_at = now() - interval '1 second' where status = 'pending'`,
    );
  });

  describe("만들기·바탕", () => {
    it("바탕 브리프: 작성 중·video_plan 없음·보관 → INVALID_TRANSITION, 남의 브리프 → NOT_FOUND", async () => {
      const drafting = await ctx(a, ["video_plan"], "drafting");
      const noKind = await ctx(a, ["web_copy"]);
      const arch = await ctx(a);
      await asU(a, (tx) =>
        tx.query("select archive_production_brief($1, 2)", [arch.briefId]),
      );
      for (const x of [drafting, noKind, arch])
        await expectDbError(createPlan(a, x), P3D.err.invalid);
      const c = await ctx(a);
      await expectDbError(createPlan(b, c), P3D.err.notFound);
    });
    it("활성 5·전체 10(보관 포함): 6번째 활성·11번째 전체 → LIMIT_REACHED", async () => {
      const c = await ctx(b);
      const ids: string[] = [];
      for (let i = 0; i < L.activePlans; i++)
        ids.push(await createPlan(b, c, scenes(1), `활성 ${i}`));
      await expectDbError(createPlan(b, c, scenes(1)), P3D.err.limit);
      for (let i = 0; i < L.totalPlans - L.activePlans; i++) {
        await act(b, ids[i]!, (rev) => sql.archive(ids[i]!, rev));
        ids.push(await createPlan(b, c, scenes(1), `더 ${i}`));
      }
      await act(b, ids.at(-1)!, (rev) => sql.archive(ids.at(-1)!, rev));
      await expectDbError(createPlan(b, c, scenes(1)), P3D.err.limit);
    });
  });

  describe("장면 검사", () => {
    let c: Ctx;
    beforeAll(async () => {
      c = await ctx(a);
    });
    it("장면 1~30: 0개·31개 거절, 30개 통과", async () => {
      await expectDbError(createPlan(a, c, []), P3D.err.validation);
      await expectDbError(
        createPlan(a, c, scenes(L.scenes + 1)),
        P3D.err.validation,
      );
      const id = await createPlan(a, c, scenes(L.scenes));
      expect((await cur(id)).scenes.length).toBe(L.scenes);
      await act(a, id, (rev) => sql.archive(id, rev));
    });
    it("길이 정수 1~600: 글자 '10'·1.5·0·-1·601·2^31·null 거절, 1·600 통과", async () => {
      const passed: string[] = [];
      for (const d of ["10", 1.5, 0, -1, L.durationMax + 1, 2 ** 31, null]) {
        await createPlan(a, c, [scene(1, { duration_sec: d })]).then(
          async (id) => {
            passed.push(JSON.stringify(d));
            await act(a, id, (rev) => sql.archive(id, rev));
          },
          (e: Error) => expect(e.message).toMatch(P3D.err.validation),
        );
      }
      expect(passed, "받아들여진 길이").toEqual([]);
      const id = await createPlan(a, c, [
        scene(1, { duration_sec: 1 }),
        scene(2, { duration_sec: L.durationMax }),
      ]);
      await act(a, id, (rev) => sql.archive(id, rev));
    });
    it("키 집합: 모르는 키·빠진 키 거절, 저장 판에는 sort_order 가 없고 배열 순서 = 정렬(빈틈 불가)", async () => {
      await expectDbError(
        createPlan(a, c, [{ ...scene(1), extra: 1 }]),
        P3D.err.validation,
      );
      const { subtitle: _s, ...noSub } = scene(1);
      void _s;
      await expectDbError(createPlan(a, c, [noSub]), P3D.err.validation);
      const id = await createPlan(a, c, [
        scene(1, { title: "첫째" }),
        scene(2, { title: "둘째" }),
        scene(3, { title: "셋째" }),
      ]);
      const v = await cur(id);
      expect(v.scenes.map((s) => s.title)).toEqual(["첫째", "둘째", "셋째"]);
      expect(
        v.scenes.every((s) => !("sort_order" in s) && !("sortOrder" in s)),
      ).toBe(true);
      await act(a, id, (rev) => sql.archive(id, rev));
    });
    it("장면 id: 중복·지어낸 id·남의 판 id 거절, null 은 서버가 채운다", async () => {
      const id = await createPlan(a, c, scenes(2));
      const ins = await asInput(id);
      expect(ins.every((s) => /^[0-9a-f-]{36}$/.test(s.id!))).toBe(true);
      await expectDbError(
        save(a, id, [ins[0]!, { ...ins[1]!, id: ins[0]!.id }]),
        P3D.err.validation,
      );
      await expectDbError(
        save(a, id, [ins[0]!, { ...ins[1]!, id: crypto.randomUUID() }]),
        P3D.err.validation,
      );
      const other = await createPlan(a, c, scenes(1));
      const foreign = (await asInput(other))[0]!.id;
      await expectDbError(
        save(a, id, [ins[0]!, { ...ins[1]!, id: foreign }]),
        P3D.err.validation,
      );
      await act(a, id, (rev) => sql.archive(id, rev));
      await act(a, other, (rev) => sql.archive(other, rev));
    });
    it("마지막 장면 빼기 거절, 하나 빼기는 새 판, 되돌리면 같은 id 로 돌아온다", async () => {
      const id = await createPlan(a, c, scenes(2));
      const ins = await asInput(id);
      await expectDbError(save(a, id, []), P3D.err.validation);
      await save(a, id, [ins[0]!]);
      expect((await cur(id)).scenes.map((s) => s.id)).toEqual([ins[0]!.id]);
      await act(a, id, (rev) => sql.restore(id, rev, 1));
      const back = await cur(id);
      expect([back.kind, back.scenes.map((s) => s.id)]).toEqual([
        "restore",
        [ins[0]!.id, ins[1]!.id],
      ]);
      await act(a, id, (rev) => sql.archive(id, rev));
    });
  });

  describe("자산 연결·이전 기준", () => {
    it("같은 업무실·같은 프로젝트·보관 안 된 자산만, 중복·11개 거절", async () => {
      const c = await ctx(a);
      const id = await createPlan(a, c, scenes(1));
      const ok1 = await designAsset(a, c);
      const otherProject = await ctx(a);
      const otherProjAsset = await designAsset(a, otherProject);
      const other = await ctx(b);
      const otherWsAsset = await designAsset(b, other);
      const archived = await designAsset(a, c);
      const arev = (
        await one<{ revision: number }>(
          db,
          "select revision from design_assets where id = $1",
          [archived],
        )
      ).revision;
      await asU(a, (tx) =>
        tx.query("select archive_design_asset($1, $2)", [archived, arev]),
      );
      const ins = await asInput(id);
      for (const bad of [
        [otherProjAsset],
        [otherWsAsset],
        [archived],
        [ok1, ok1],
        Array.from({ length: L.assetsPerScene + 1 }, () => crypto.randomUUID()),
      ]) {
        await expectDbError(
          save(a, id, [{ ...ins[0]!, asset_ids: bad }]),
          /VALIDATION|NOT_FOUND/,
        );
      }
      await save(a, id, [{ ...ins[0]!, asset_ids: [ok1] }]);
      const v = await cur(id);
      const assetV = (
        await one<{ current_version_no: number }>(
          db,
          "select current_version_no from design_assets where id = $1",
          [ok1],
        )
      ).current_version_no;
      expect(v.scenes[0]!.assets).toEqual([
        { asset_id: ok1, version_no: assetV },
      ]);
    });
    it("자산 새 판 → 저장해도 연결 판 번호 그대로(stale 안 풀림), 맞추기만 최신으로", async () => {
      const c = await ctx(a);
      const asset = await designAsset(a, c);
      const id = await createPlan(a, c, [scene(1, { asset_ids: [asset] })]);
      expect((await cur(id)).scenes[0]!.assets[0]!.version_no).toBe(1);
      await designAsset(a, c, asset); // 교체 → 자산 v2
      const ins = await asInput(id);
      await save(a, id, [{ ...ins[0]!, title: "제목만 바꿈" }]);
      expect((await cur(id)).scenes[0]!.assets[0]!.version_no).toBe(1);
      await act(a, id, (rev) => sql.rebase(id, rev));
      const v = await cur(id);
      expect([v.kind, v.scenes[0]!.assets[0]!.version_no]).toEqual([
        "rebase",
        2,
      ]);
    });
    it("클라이언트가 판 번호를 보내려 해도(assets 키) 거절 — 입력은 asset_ids 만", async () => {
      const c = await ctx(a);
      const asset = await designAsset(a, c);
      const { asset_ids: _x, ...rest } = scene(1);
      void _x;
      await expectDbError(
        createPlan(a, c, [
          { ...rest, assets: [{ asset_id: asset, version_no: 99 }] },
        ]),
        P3D.err.validation,
      );
    });
  });

  describe("판 100", () => {
    it("저장 99번 → 판 100, 101번째 저장·되돌리기 LIMIT_REACHED", async () => {
      const c = await ctx(a);
      const id = await createPlan(a, c, scenes(1));
      for (let i = 2; i <= L.planVersions; i++) {
        const ins = await asInput(id);
        await save(a, id, [{ ...ins[0]!, title: `판 ${i}` }]);
      }
      expect((await plan(id)).current_version_no).toBe(L.planVersions);
      const ins = await asInput(id);
      await expectDbError(
        save(a, id, [{ ...ins[0]!, title: "101" }]),
        P3D.err.limit,
      );
      await expectDbError(
        act(a, id, (rev) => sql.restore(id, rev, 1)),
        P3D.err.limit,
      );
    });
  });

  describe("영상 파일(예약·확정·서명·판 0~20)", () => {
    let c: Ctx;
    let id: string;
    beforeAll(async () => {
      c = await ctx(a);
      id = await createPlan(a, c, scenes(1));
    });
    it("예약 검사: 50MB+1·0·모르는 형식·확장자 불일치 거절, 정확히 50MB 통과, 경로는 서버가 정함", async () => {
      for (const o of [
        { size: L.maxBytes + 1 },
        { size: 0 },
        { mime: "video/avi", name: "a.avi" },
        { name: "a.webm" },
        { mime: "text/html", name: "a.html" },
      ]) {
        await expectDbError(reserve(a, id, o), P3D.err.reserve);
      }
      const up = await reserve(a, id, { size: L.maxBytes });
      expect(up.storage_key).toMatch(new RegExp(`^${a.workspaceId}/`));
    });
    it("서명: 없음·틀림·추측 키 → BAD_SIGNATURE, 용도 바꿔치기(design_* 로 서명한 메시지) 거절", async () => {
      const name = "s.mp4";
      const at = Date.now();
      const msg = reserveMessage(id, 5000, "video/mp4", name);
      for (const sig of [
        null,
        await sign(P3D.purpose.reserve, "다른 값", at),
        await sign(P3D.purpose.reserve, msg, at, "추측".repeat(10)),
        await sign(P3D.designPurpose.reserve, msg, at),
      ]) {
        await expectDbError(reserve(a, id, { name, sig, at }), P3D.err.badSig);
      }
      const up = await reserve(a, id);
      await putObject(a, P3D.bucket, up.storage_key, 5000, "video/mp4");
      await expectDbError(
        confirm(a, id, up.upload_id, {
          sig: await sign(
            P3D.designPurpose.confirm,
            `${up.upload_id}|${sha(up.upload_id)}`,
          ),
        }),
        P3D.err.badSig,
      );
      await expectDbError(
        confirm(a, id, up.upload_id, {
          sig: await sign(
            P3D.purpose.close,
            closeMessage(up.upload_id, "CANCELLED"),
          ),
        }),
        P3D.err.badSig,
      );
      await confirm(a, id, up.upload_id);
      expect((await plan(id)).current_file_version_no).toBe(1);
    });
    it("확정 대조: 객체 없음 UPLOAD_MISSING, 크기·형식 다름·metadata 없음 TYPE_MISMATCH", async () => {
      const u1 = await reserve(a, id);
      await expectDbError(confirm(a, id, u1.upload_id), P3D.err.missing);
      for (const [size, mime] of [
        [4999, "video/mp4"],
        [5000, "video/webm"],
      ] as const) {
        const u = await reserve(a, id);
        await putObject(a, P3D.bucket, u.storage_key, size, mime);
        await expectDbError(confirm(a, id, u.upload_id), P3D.err.mismatch);
      }
      const u3 = await reserve(a, id);
      await asU(a, (tx) =>
        tx.query(
          "insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())",
          [P3D.bucket, u3.storage_key],
        ),
      );
      await expectDbError(confirm(a, id, u3.upload_id), P3D.err.mismatch);
    });
    it("저장소 정책: 예약 경로만 insert, 남·anon·예약 밖 경로 거절, 덮어쓰기 거절", async () => {
      const u = await reserve(a, id);
      await expectDbError(
        putObject(b, P3D.bucket, u.storage_key, 5000, "video/mp4"),
        P3D.err.denied,
      );
      await expectDbError(
        putObject(null, P3D.bucket, u.storage_key, 5000, "video/mp4"),
        P3D.err.denied,
      );
      await expectDbError(
        putObject(
          a,
          P3D.bucket,
          `${a.workspaceId}/video-files/${crypto.randomUUID()}.mp4`,
          5000,
          "video/mp4",
        ),
        P3D.err.denied,
      );
      await putObject(a, P3D.bucket, u.storage_key, 5000, "video/mp4");
      await expectDbError(
        putObject(a, P3D.bucket, u.storage_key, 5000, "video/mp4"),
        /duplicate|unique|row-level/i,
      );
    });
    it("진행 중 예약 5 → 6번째 LIMIT_REACHED, 닫기는 서명 필요", async () => {
      const ups: Array<{ upload_id: string; storage_key: string }> = [];
      for (let i = 0; i < L.pendingUploads; i++) ups.push(await reserve(a, id));
      await expectDbError(reserve(a, id), P3D.err.limit);
      await expectDbError(
        asU(a, (tx) =>
          tx.query(
            sql.close(ups[0]!.upload_id, "CANCELLED", Date.now(), null).text,
            sql.close(ups[0]!.upload_id, "CANCELLED", Date.now(), null).params,
          ),
        ),
        P3D.err.badSig,
      );
      const at = Date.now();
      const cs = await sign(
        P3D.purpose.close,
        closeMessage(ups[0]!.upload_id, "CANCELLED"),
        at,
      );
      await asU(a, (tx) =>
        tx.query(
          sql.close(ups[0]!.upload_id, "CANCELLED", at, cs).text,
          sql.close(ups[0]!.upload_id, "CANCELLED", at, cs).params,
        ),
      );
      await reserve(a, id);
    });
    it("파일 판 20 → 21번째 예약·파일 되돌리기 LIMIT_REACHED, 되돌리기는 같은 storage_key", async () => {
      const c2 = await ctx(b);
      const p = await createPlan(b, c2, scenes(1));
      for (let i = 0; i < L.fileVersions; i++) {
        await db.query(
          `update public.${T.uploads} set expires_at = now() - interval '1 second' where status = 'pending'`,
        );
        await uploadFile(b, p);
      }
      expect((await plan(p)).current_file_version_no).toBe(L.fileVersions);
      await expectDbError(reserve(b, p), P3D.err.limit);
      await expectDbError(
        act(b, p, (rev) => sql.restoreFile(p, rev, 1)),
        P3D.err.limit,
      );
      const c3 = await ctx(b);
      const q = await createPlan(b, c3, scenes(1));
      await uploadFile(b, q);
      await uploadFile(b, q);
      await act(b, q, (rev) => sql.restoreFile(q, rev, 1));
      const keys = (
        await db.query<{
          version_no: number;
          kind: string;
          storage_key: string;
        }>(
          `select version_no, kind, storage_key from public.${T.files} where plan_id = $1 order by version_no`,
          [q],
        )
      ).rows;
      expect(keys.map((k) => k.kind)).toEqual(["upload", "upload", "restore"]);
      expect(keys[2]!.storage_key).toBe(keys[0]!.storage_key);
      await expectDbError(
        db.query(
          `update public.${T.files} set storage_key = 'x' where plan_id = $1`,
          [q],
        ),
        P3D.err.frozen,
      );
    });
  });

  describe("남의 업무실·보관·감사 본문 0", () => {
    it("남: 쓰기 문구가 없는 id 와 같다, 표 4개 0행", async () => {
      const c = await ctx(a);
      const id = await createPlan(a, c, scenes(1));
      const ghost = "00000000-0000-4000-8000-0000000000d3";
      const msg = (q: { text: string; params: unknown[] }) =>
        run(b, q).then(
          () => "성공함",
          (e: Error) => e.message,
        );
      for (const mk of [
        (x: string) => sql.save(x, 1, "남", "16:9", "drafting", scenes(1)),
        (x: string) => sql.restore(x, 1, 1),
        (x: string) => sql.rebase(x, 1),
        (x: string) => sql.archive(x, 1),
        (x: string) => sql.restoreFile(x, 1, 1),
      ]) {
        const mine = await msg(mk(id));
        expect(mine).toMatch(P3D.err.notFound);
        expect(mine).toBe(await msg(mk(ghost)));
      }
      for (const t of Object.values(T)) {
        expect(
          await asU(b, (tx) =>
            tx.query(`select 1 from public.${t} where workspace_id = $1`, [
              a.workspaceId,
            ]),
          ).then(
            (r) => r.rows.length,
            () => 0,
          ),
          t,
        ).toBe(0);
      }
    });
    it("보관하면 모든 쓰기 INVALID_TRANSITION, 판 표 수정·삭제 거절", async () => {
      const c = await ctx(a);
      const id = await createPlan(a, c, scenes(1));
      await act(a, id, (rev) => sql.archive(id, rev));
      for (const mk of [
        (rev: number) => sql.save(id, rev, "또", "16:9", "drafting", scenes(1)),
        (rev: number) => sql.restore(id, rev, 1),
        (rev: number) => sql.archive(id, rev),
      ]) {
        await expectDbError(act(a, id, mk), P3D.err.invalid);
      }
      await expectDbError(reserve(a, id), P3D.err.invalid);
      await expectDbError(
        db.query(
          `update public.${T.versions} set title = 'x' where plan_id = $1`,
          [id],
        ),
        P3D.err.frozen,
      );
      await expectDbError(
        db.query(`delete from public.${T.versions} where plan_id = $1`, [id]),
        P3D.err.frozen,
      );
    });
    it("감사 details 에 제목·대사·자막·파일 이름·메모 글자 0(표식)", async () => {
      const M = "ZZP3DAUDIT";
      const c = await ctx(a);
      const id = await createPlan(
        a,
        c,
        [
          scene(1, {
            title: `${M} 장면`,
            narration: `${M} 대사`,
            subtitle: `${M} 자막`,
          }),
        ],
        `${M} 구성안`,
      );
      const up = await reserve(a, id, { name: `${M}.mp4` });
      await putObject(a, P3D.bucket, up.storage_key, 5000, "video/mp4");
      await confirm(a, id, up.upload_id, { note: `${M} 메모` });
      const leaked = await count(
        "select 1 from audit_events where entity_type = $1 and details::text like $2",
        [P3D.auditEntity, `%${M}%`],
      );
      expect(leaked).toBe(0);
      expect(
        await count(
          "select 1 from audit_events where entity_type = $1 and entity_id = $2",
          [P3D.auditEntity, id],
        ),
      ).toBeGreaterThanOrEqual(2);
    });
    it("직접 쓰기·anon 거절, RPC 9개 정의자·anon 실행 0", async () => {
      for (const t of Object.values(T)) {
        await expectDbError(
          asU(a, (tx) => tx.query(`delete from public.${t}`)),
          P3D.err.denied,
        );
        await expectDbError(
          asU(null, (tx) => tx.query(`select * from public.${t}`)),
          P3D.err.denied,
        );
      }
      for (const name of Object.values(P3D.rpc)) {
        const r = await one<{ sig: string; d: boolean }>(
          db,
          "select p.oid::regprocedure::text as sig, p.prosecdef as d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
          [name],
        );
        expect(r.d, name).toBe(true);
        expect(
          (
            await one<{ ok: boolean }>(
              db,
              "select has_function_privilege('anon', $1::regprocedure, 'execute') as ok",
              [r.sig],
            )
          ).ok,
          name,
        ).toBe(false);
      }
    });
  });
});
