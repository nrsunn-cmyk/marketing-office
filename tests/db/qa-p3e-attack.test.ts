/**
 * QA-P3E-PREP-01(Tester): P3-e PPT 구성안 DB 공격 시험(PGlite). 근거: P3E-BACKEND-01-DESIGN.md, 이름·인자는 ./qa-p3e-names.ts 한곳.
 * migration 에 ppt_decks 가 없으면 전체를 건너뛴다. 디자인 자산은 P3-c 정식 흐름(서명 예약 → 저장소 흉내 행 → 확정)으로 만든다. 모든 값은 합성.
 */
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
  P3E,
  p3eMigrationPresent,
  slide,
  slides,
  sql,
  type SlideIn,
} from "./qa-p3e-names";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 });
const present = p3eMigrationPresent();
const L = P3E.limits;
const T = P3E.tables;
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
const deck = (id: string) =>
  one<{
    revision: number;
    current_version_no: number;
    archived_at: string | null;
    source_brief_revision: number;
  }>(db, `select * from public.${T.decks} where id = $1`, [id]);
type Stored = {
  id: string;
  title: string;
  bullets: string | null;
  notes: string | null;
  assets: Array<{ asset_id: string; version_no: number }>;
};
const cur = (id: string) =>
  one<{ slides: Stored[]; kind: string; title: string; version_no: number }>(
    db,
    `select v.* from public.${T.versions} v join public.${T.decks} d on d.id = v.deck_id and v.version_no = d.current_version_no where d.id = $1`,
    [id],
  );
const act = async (
  f: Fixture | null,
  id: string,
  mk: (rev: number) => { text: string; params: unknown[] },
) => run(f, mk((await deck(id)).revision));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sign = async (purpose: string, msg: string, at = Date.now()) =>
  (
    await one<{ h: string }>(
      db,
      "select app.hmac_sha256(convert_to($1, 'UTF8'), convert_to($2, 'UTF8')) as h",
      [secret, `${purpose}|${msg}|${at}`],
    )
  ).h;

type Ctx = { projectId: string; briefId: string; briefRev: number };
const KINDS = [P3E.deliverable, "design_assets"];
async function ctx(
  f: Fixture,
  types: string[] = KINDS,
  status: "ready" | "drafting" = "ready",
): Promise<Ctx> {
  return asU(f, async (tx) => {
    const projectId = (
      await one<{ id: string }>(
        tx,
        "insert into projects (workspace_id, client_id, kind, title) values ($1, $2, 'client', '합성 P3E') returning id",
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
    return { projectId, briefId, briefRev: status === "ready" ? 2 : 1 };
  });
}
/** 브리프를 새 판으로(내용을 바꿔야 저장된다) */
async function bumpBrief(
  f: Fixture,
  c: Ctx,
  status: "ready" | "drafting" = "ready",
) {
  await asU(f, (tx) =>
    tx.query(
      "select update_production_brief($1, $2, '합성 브리프', '대상', '메시지', $3::text[], $4, null, null, $5)",
      [c.briefId, c.briefRev, KINDS, `범위 ${c.briefRev}`, status],
    ),
  );
  c.briefRev += 1;
}
const putObject = (f: Fixture, key: string) =>
  asU(f, (tx) =>
    tx.query(
      "insert into storage.objects (bucket_id, name, owner, metadata) values ('design-assets', $1, auth.uid(), $2::jsonb)",
      [key, JSON.stringify({ size: 1000, mimetype: "image/png" })],
    ),
  );

/** P3-c 디자인 자산(서명 예약 → 객체 → 확정). assetId 를 주면 교체로 새 판 */
async function designAsset(
  f: Fixture,
  c: Ctx,
  assetId: string | null = null,
): Promise<string> {
  const name = `a${Math.random().toString(36).slice(2, 7)}.png`;
  const at = Date.now();
  const rs = await sign(
    "design_reserve",
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
  await putObject(f, up.storage_key);
  const h = sha(up.upload_id);
  const at2 = Date.now();
  const cs = await sign("design_confirm", `${up.upload_id}|${h}`, at2);
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
const archiveAsset = async (f: Fixture, id: string) => {
  const rev = (
    await one<{ revision: number }>(
      db,
      "select revision from design_assets where id = $1",
      [id],
    )
  ).revision;
  await asU(f, (tx) =>
    tx.query("select archive_design_asset($1, $2)", [id, rev]),
  );
};
const create = async (
  f: Fixture,
  c: Ctx,
  s: unknown = slides(2),
  title = "합성 구성안",
  tpl = "royal_grid",
) => (await run(f, sql.create(c.briefId, title, tpl, s))) as string;
const save = (
  f: Fixture,
  id: string,
  s: unknown,
  title = "합성 구성안",
  tpl = "royal_grid",
  status = "drafting",
) => act(f, id, (rev) => sql.save(id, rev, title, tpl, status, s));
/** 지금 판 슬라이드를 입력 모양으로 */
const asInput = async (id: string): Promise<SlideIn[]> =>
  (await cur(id)).slides.map((s) => ({
    id: s.id,
    title: s.title,
    bullets: s.bullets,
    notes: s.notes,
    asset_ids: s.assets.map((x) => x.asset_id),
  }));

describe.skipIf(!present)(`P3-e PPT 구성안 공격 시험(${T.decks})`, () => {
  beforeAll(async () => {
    db = await createDb();
    await db.exec(
      "alter table storage.objects add column if not exists metadata jsonb",
    );
    a = await seedOwner(db, "p3e-owner-a@example.test");
    b = await seedOwner(db, "p3e-owner-b@example.test");
    strategyTpl = (
      await one<{ id: string }>(db, "select id from templates where key = $1", [
        STRATEGY_TEMPLATE_VERSION,
      ])
    ).id;
    secret = (
      await one<{ value: string }>(
        db,
        "select value from app.server_secrets where name = 'design_asset_signing'",
      )
    ).value;
    for (const f of [a, b])
      await asU(f, (tx) =>
        tx.query(
          "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
          [f.profileA1],
        ),
      );
  });

  it("바탕: 작성 중 브리프·ppt_deck 없음·보관 브리프는 INVALID_TRANSITION, 남의 브리프는 NOT_FOUND", async () => {
    const drafting = await ctx(a, KINDS, "drafting");
    await expectDbError(create(a, drafting), /INVALID_TRANSITION/);
    const noPpt = await ctx(a, ["design_assets"]);
    await expectDbError(create(a, noPpt), /INVALID_TRANSITION/);
    const arch = await ctx(a);
    await asU(a, (tx) =>
      tx.query("select archive_production_brief($1, $2)", [
        arch.briefId,
        arch.briefRev,
      ]),
    );
    await expectDbError(create(a, arch), /INVALID_TRANSITION/);
    const mine = await ctx(a);
    await expectDbError(create(b, mine), /NOT_FOUND/);
  });

  it("슬라이드 수: 0·41장 거절, 1·40장 통과 / 키 하나 더·빠짐·배열 아님 거절", async () => {
    const c = await ctx(a);
    await expectDbError(create(a, c, []), /VALIDATION/);
    await expectDbError(create(a, c, slides(L.slides + 1)), /VALIDATION/);
    const max = await create(a, c, slides(L.slides));
    expect((await cur(max)).slides).toHaveLength(L.slides);
    await expectDbError(create(a, c, [{ ...slide(), extra: 1 }]), /VALIDATION/);
    const { notes: _n, ...noNotes } = slide();
    void _n;
    await expectDbError(create(a, c, [noNotes]), /VALIDATION/);
    await expectDbError(create(a, c, { title: "x" }), /VALIDATION/);
    await expectDbError(create(a, c, "[]"), /VALIDATION/);
  });

  it("글 길이·앞뒤 공백: 제목 0·101자, 요점·메모 빈 글·1001자, 구성안 제목 121자·앞 공백 거절 / 경계값 통과", async () => {
    const c = await ctx(a);
    const bad: Array<[string, unknown, string?]> = [
      ["슬라이드 제목 빈 글", [slide({ title: "" })]],
      [
        "슬라이드 제목 101자",
        [slide({ title: "가".repeat(L.slideTitle + 1) })],
      ],
      ["슬라이드 제목 앞 공백", [slide({ title: " 앞공백" })]],
      ["요점 빈 글", [slide({ bullets: "" })]],
      ["요점 1001자", [slide({ bullets: "가".repeat(L.bullets + 1) })]],
      ["메모 1001자", [slide({ notes: "나".repeat(L.notes + 1) })]],
      ["구성안 제목 121자", [slide()], "가".repeat(L.deckTitle + 1)],
      ["구성안 제목 빈 글", [slide()], ""],
      ["구성안 제목 뒤 공백", [slide()], "제목 "],
    ];
    const passed: string[] = [];
    for (const [name, s, title] of bad)
      await create(a, c, s, title ?? "합성").then(
        () => passed.push(name),
        () => undefined,
      );
    expect(passed, "거절돼야 할 입력이 통과").toEqual([]);
    // 경계값: 100·1000·1000·120자, 이모지(서로게이트 쌍)도 코드 포인트로 센다
    const ok = await create(
      a,
      c,
      [
        slide({
          title: "😀".repeat(L.slideTitle),
          bullets: "가".repeat(L.bullets),
          notes: "나".repeat(L.notes),
        }),
      ],
      "가".repeat(L.deckTitle),
    );
    expect((await cur(ok)).slides[0].title).toBe("😀".repeat(L.slideTitle));
  });

  it("제어 문자·CR 저장 거절(제목·요점·메모·구성안 제목), 줄바꿈·탭은 허용", async () => {
    const c = await ctx(a);
    const passed: string[] = [];
    for (const ch of P3E.controlChars) {
      const code = `U+${ch.codePointAt(0)!.toString(16).padStart(4, "0")}`;
      for (const [where, s, title] of [
        ["슬라이드 제목", [slide({ title: `앞${ch}뒤` })], "합성"],
        ["요점", [slide({ bullets: `첫${ch}줄` })], "합성"],
        ["메모", [slide({ notes: `메${ch}모` })], "합성"],
        ["구성안 제목", [slide()], `제${ch}목`],
      ] as const)
        await create(a, c, s, title).then(
          () => passed.push(`${where} ${code}`),
          () => undefined,
        );
    }
    expect(passed, "제어 문자가 저장됨").toEqual([]);
    const ok = await create(a, c, [
      slide({ bullets: "첫 줄\n둘째\t줄\n셋째", notes: "메모\n둘째" }),
    ]);
    expect((await cur(ok)).slides[0].bullets).toBe("첫 줄\n둘째\t줄\n셋째");
  });

  it("템플릿·상태 주입: __proto__·constructor·대문자·경로·공백 거절, 3종만 통과", async () => {
    const c = await ctx(a);
    const passed: string[] = [];
    for (const t of [
      "__proto__",
      "constructor",
      "toString",
      "ROYAL_GRID",
      "royal_grid ",
      "../royal_grid",
      "royal_grid/../brand_deck",
      "",
      "null",
    ])
      await create(a, c, slides(1), "합성", t).then(
        () => passed.push(t),
        () => undefined,
      );
    expect(passed).toEqual([]);
    for (const t of P3E.templates)
      await create(a, c, slides(1), `합성 ${t}`, t);
    const id = (
      await one<{ id: string }>(
        db,
        `select id from public.${T.decks} where production_brief_id = $1 and archived_at is null order by created_at limit 1`,
        [c.briefId],
      )
    ).id;
    for (const st of ["archived", "Reviewed", "__proto__"])
      await expectDbError(
        save(a, id, await asInput(id), "합성 royal_grid", "royal_grid", st),
        /VALIDATION/,
      );
  });

  it("슬라이드 id: 지어낸·남의 구성안·뺀 슬라이드·중복·uuid 아님·숫자 거절, 대문자는 같은 id, null 은 새 uuid", async () => {
    const c = await ctx(a);
    const id = await create(a, c, slides(3));
    const other = await create(a, c, slides(1));
    const [s1, s2, s3] = await asInput(id);
    const otherId = (await asInput(other))[0].id!;
    // 하나 빼고 저장(판 2) → 뺀 id 는 이제 '지금 판'에 없다
    await save(a, id, [s1, s3]);
    const bad: Array<[string, unknown]> = [
      [
        "지어낸 id",
        [s1, { ...s3, id: "11111111-2222-4333-8444-555555555555" }],
      ],
      ["남의 구성안 슬라이드 id", [s1, { ...s3, id: otherId }]],
      ["뺀 슬라이드 id(옛 판에만)", [s1, s3, s2]],
      ["중복", [s1, s1]],
      ["uuid 아님", [s1, { ...s3, id: "slide-3" }]],
      ["숫자 id", [s1, { ...s3, id: 3 }]],
    ];
    const passed: string[] = [];
    for (const [name, s] of bad)
      await save(a, id, s).then(
        () => passed.push(name),
        () => undefined,
      );
    expect(passed, "거절돼야 할 id 가 통과").toEqual([]);
    await save(a, id, [
      { ...s1, id: s1.id!.toUpperCase(), title: "대문자 id" },
      s3,
      slide({ title: "새 슬라이드" }),
    ]);
    const now = (await cur(id)).slides;
    expect(now[0].id).toBe(s1.id);
    expect(now[2].id).toMatch(/^[0-9a-f-]{36}$/);
    expect([s1.id, s2.id, s3.id]).not.toContain(now[2].id);
  });

  it("마지막 1장: 빈 목록 저장 거절, 1장까지 빼기 가능 / 판 되돌리기로 뺀 슬라이드가 같은 id 로 돌아옴", async () => {
    const c = await ctx(a);
    const id = await create(a, c, slides(3));
    const v1 = (await cur(id)).slides.map((s) => s.id);
    const [s1] = await asInput(id);
    await expectDbError(save(a, id, []), /VALIDATION/);
    await save(a, id, [s1]);
    expect((await cur(id)).slides).toHaveLength(1);
    await act(a, id, (rev) => sql.restore(id, rev, 1));
    const c3 = await cur(id);
    expect(c3.kind).toBe("restore");
    expect(c3.slides.map((s) => s.id)).toEqual(v1);
    await expectDbError(
      act(a, id, (rev) => sql.restore(id, rev, 1)),
      /VALIDATION/,
    ); // 지금과 같은 판
    await expectDbError(
      act(a, id, (rev) => sql.restore(id, rev, 99)),
      /NOT_FOUND/,
    );
    await expectDbError(save(a, id, await asInput(id)), /VALIDATION/); // 바뀐 내용 없음
  });

  it("판 20: 저장 19번 → v20, 21번째 저장·되돌리기·맞추기 LIMIT_REACHED", async () => {
    const c = await ctx(a);
    const id = await create(a, c, slides(1));
    for (let i = 2; i <= L.versions; i++)
      await save(a, id, await asInput(id), `합성 ${i}`);
    expect((await deck(id)).current_version_no).toBe(L.versions);
    await expectDbError(
      save(a, id, await asInput(id), "21번째"),
      /LIMIT_REACHED/,
    );
    await expectDbError(
      act(a, id, (rev) => sql.restore(id, rev, 1)),
      /LIMIT_REACHED/,
    );
    await bumpBrief(a, c);
    await expectDbError(
      act(a, id, (rev) => sql.rebase(id, rev)),
      /LIMIT_REACHED/,
    );
    expect(
      await count(`select 1 from public.${T.versions} where deck_id = $1`, [
        id,
      ]),
    ).toBe(L.versions);
  });

  it("활성 5·전체 10: 6번째 활성 거절, 보관해 자리를 만들어도 11번째 거절", async () => {
    const c = await ctx(a);
    const ids: string[] = [];
    for (let i = 0; i < L.active; i++)
      ids.push(await create(a, c, slides(1), `활성 ${i}`));
    await expectDbError(create(a, c, slides(1), "6번째"), /LIMIT_REACHED/);
    for (let n = L.active; n < L.total; n++) {
      const old = ids.shift()!;
      await act(a, old, (rev) => sql.archive(old, rev));
      ids.push(await create(a, c, slides(1), `교대 ${n}`));
    }
    expect(
      await count(
        `select 1 from public.${T.decks} where production_brief_id = $1`,
        [c.briefId],
      ),
    ).toBe(L.total);
    const old = ids.shift()!;
    await act(a, old, (rev) => sql.archive(old, rev));
    await expectDbError(create(a, c, slides(1), "11번째"), /LIMIT_REACHED/);
  });

  it("자산 연결: 다른 프로젝트·남의 업무실·보관·중복·11개·uuid 아님 거절, 통과하면 {asset_id, 그 자산 현재 판}", async () => {
    const c = await ctx(a);
    const c2 = await ctx(a);
    const cb = await ctx(b);
    const mine = await designAsset(a, c);
    const otherProject = await designAsset(a, c2);
    const others = await designAsset(b, cb);
    const archived = await designAsset(a, c);
    await archiveAsset(a, archived);
    const many: string[] = [];
    for (let i = 0; i < L.assetsPerSlide + 1; i++)
      many.push(await designAsset(a, c));
    const bad: Array<[string, string[]]> = [
      ["다른 프로젝트", [otherProject]],
      ["남의 업무실", [others]],
      ["보관된 자산", [archived]],
      ["중복", [mine, mine]],
      ["11개", many],
      ["uuid 아님", ["asset-1"]],
    ];
    const passed: string[] = [];
    for (const [name, ids] of bad)
      await create(a, c, [slide({ asset_ids: ids })]).then(
        () => passed.push(name),
        () => undefined,
      );
    expect(passed, "거절돼야 할 자산이 연결됨").toEqual([]);
    const ok = await create(a, c, [
      slide({ asset_ids: many.slice(0, L.assetsPerSlide) }),
    ]);
    expect((await cur(ok)).slides[0].assets).toEqual(
      many
        .slice(0, L.assetsPerSlide)
        .map((x) => ({ asset_id: x, version_no: 1 })),
    );
    // 입력에 판 번호를 직접 넣는 모양(assets)은 거절
    await expectDbError(
      create(a, c, [
        {
          ...slide(),
          asset_ids: undefined,
          assets: [{ asset_id: mine, version_no: 9 }],
        },
      ]),
      /VALIDATION/,
    );
  });

  it("자산 판 번호 유지: 자산이 v2 가 돼도 저장은 v1 그대로(이전 기준 안 풀림), 보관돼도 유지, 맞추기만 v2", async () => {
    const c = await ctx(a);
    const asset = await designAsset(a, c);
    const id = await create(a, c, [
      slide({ title: "표지", asset_ids: [asset] }),
      slide({ title: "본문" }),
    ]);
    await designAsset(a, c, asset); // v2
    const input = await asInput(id);
    await save(a, id, input, "제목만 바꿈");
    expect((await cur(id)).slides[0].assets).toEqual([
      { asset_id: asset, version_no: 1 },
    ]);
    await save(
      a,
      id,
      [{ ...input[0], title: "표지 글 바꿈" }, input[1]],
      "제목만 바꿈",
    );
    expect((await cur(id)).slides[0].assets[0].version_no).toBe(1);
    await act(a, id, (rev) => sql.rebase(id, rev));
    const rb = await cur(id);
    expect(rb.kind).toBe("rebase");
    expect(rb.slides[0].assets[0].version_no).toBe(2);
    // 연결된 자산이 보관돼도 저장하면 연결·판 번호 유지
    await archiveAsset(a, asset);
    await save(a, id, await asInput(id), "보관 뒤 저장");
    expect((await cur(id)).slides[0].assets).toEqual([
      { asset_id: asset, version_no: 2 },
    ]);
  });

  // D1(Tester 판단 요청): 판 번호 유지를 '같은 슬라이드의 직전 판'에서만 찾는다. 이미 연결된 자산을 다른 슬라이드로 옮기면(또는 빼고 새 슬라이드에 넣으면)
  //   맞추기 없이 현재 판으로 바뀌어 이전 기준이 몰래 풀린다. P3-d 장면도 같은 방식. 고쳐지면 it.fails → it 으로 바꾼다.
  it("D1 자산을 다른 슬라이드로 옮겨도 판 번호 유지(이전 기준이 저장으로 풀리면 안 됨)", async () => {
    const c = await ctx(a);
    const asset = await designAsset(a, c);
    const id = await create(a, c, [
      slide({ title: "표지", asset_ids: [asset] }),
      slide({ title: "본문" }),
    ]);
    await designAsset(a, c, asset); // v2
    const [s1, s2] = await asInput(id);
    await save(a, id, [
      { ...s1, asset_ids: [] },
      { ...s2, asset_ids: [asset] },
    ]);
    expect((await cur(id)).slides[1].assets).toEqual([
      { asset_id: asset, version_no: 1 },
    ]);
  });

  it("보관: 저장·되돌리기·맞추기·다시 보관 INVALID_TRANSITION, 판 표 수정·삭제 거절, 보관 구성안은 슈퍼유저도 못 바꿈", async () => {
    const c = await ctx(a);
    const id = await create(a, c, slides(2));
    await save(a, id, (await asInput(id)).slice(0, 1));
    await act(a, id, (rev) => sql.archive(id, rev));
    await expectDbError(
      save(a, id, await asInput(id), "보관 뒤"),
      /INVALID_TRANSITION/,
    );
    await expectDbError(
      act(a, id, (rev) => sql.restore(id, rev, 1)),
      /INVALID_TRANSITION/,
    );
    await bumpBrief(a, c);
    await expectDbError(
      act(a, id, (rev) => sql.rebase(id, rev)),
      /INVALID_TRANSITION/,
    );
    await expectDbError(
      act(a, id, (rev) => sql.archive(id, rev)),
      /INVALID_TRANSITION/,
    );
    await expectDbError(
      db.query(
        `update public.${T.versions} set title = 'x' where deck_id = $1`,
        [id],
      ),
      /.+/,
    );
    await expectDbError(
      db.query(`delete from public.${T.versions} where deck_id = $1`, [id]),
      /.+/,
    );
    await expectDbError(
      db.query(
        `update public.${T.decks} set archived_at = null where id = $1`,
        [id],
      ),
      /FROZEN|보관/,
    );
  });

  it("revision 충돌: 옛 revision 으로 저장·되돌리기·맞추기·보관은 CONFLICT", async () => {
    const c = await ctx(a);
    const id = await create(a, c, slides(2));
    const old = (await deck(id)).revision;
    await save(a, id, (await asInput(id)).slice(0, 1));
    await expectDbError(
      run(
        a,
        sql.save(id, old, "옛", "royal_grid", "drafting", await asInput(id)),
      ),
      /CONFLICT/,
    );
    await expectDbError(run(a, sql.restore(id, old, 1)), /CONFLICT/);
    await expectDbError(run(a, sql.rebase(id, old)), /CONFLICT/);
    await expectDbError(run(a, sql.archive(id, old)), /CONFLICT/);
  });

  it("남의 업무실: 쓰기 RPC 4개 모두 없는 id 와 같은 NOT_FOUND 문구, 표 0행, anon 0행·실행 거절", async () => {
    const c = await ctx(a);
    const id = await create(a, c, slides(2));
    const ghost = "00000000-0000-4000-8000-000000000001";
    const msg = async (
      f: Fixture,
      target: string,
      k: "save" | "restore" | "rebase" | "archive",
    ) => {
      const rev = (await deck(id)).revision;
      const q =
        k === "save"
          ? sql.save(target, rev, "남", "royal_grid", "drafting", slides(1))
          : k === "restore"
            ? sql.restore(target, rev, 1)
            : k === "rebase"
              ? sql.rebase(target, rev)
              : sql.archive(target, rev);
      return run(f, q).then(
        () => "성공",
        (e: Error) => e.message,
      );
    };
    for (const k of ["save", "restore", "rebase", "archive"] as const) {
      const theirs = await msg(b, id, k);
      expect(theirs, k).toMatch(/NOT_FOUND/);
      expect(theirs, `${k} 문구가 없는 id 와 같아야`).toBe(
        await msg(b, ghost, k),
      );
    }
    for (const t of Object.values(T)) {
      expect(
        (await asU(b, (tx) => tx.query(`select 1 from public.${t}`))).rows,
      ).toHaveLength(0);
      // 익명은 거절(트랜잭션째 실패)되거나 0행이어야 한다 — 안쪽에서 오류를 삼키면 커밋이 깨지므로 바깥에서 잡는다
      expect(
        await asU(null, (tx) => tx.query(`select 1 from public.${t}`)).then(
          (r) => r.rows,
          () => [],
        ),
      ).toHaveLength(0);
    }
    await expectDbError(
      run(null, sql.create(c.briefId, "anon", "royal_grid", slides(1))),
      /.+/,
    );
  });

  it("권한: 직접 insert·update·delete 거절, RPC 5개는 정의자·search_path 고정·anon 실행 0", async () => {
    const c = await ctx(a);
    const id = await create(a, c, slides(1));
    await expectDbError(
      asU(a, (tx) =>
        tx.query(`update public.${T.decks} set title = '직접' where id = $1`, [
          id,
        ]),
      ),
      /permission denied|권한/,
    );
    await expectDbError(
      asU(a, (tx) =>
        tx.query(`delete from public.${T.decks} where id = $1`, [id]),
      ),
      /permission denied|권한/,
    );
    await expectDbError(
      asU(a, (tx) =>
        tx.query(
          `insert into public.${T.decks} (workspace_id, project_id, production_brief_id, source_brief_revision, title, template_key, current_version_no, created_by) values ($1, $2, $3, 1, '직접', 'royal_grid', 1, $4)`,
          [a.workspaceId, c.projectId, c.briefId, a.userId],
        ),
      ),
      /permission denied|권한/,
    );
    const fns = await db.query<{
      name: string;
      definer: boolean;
      cfg: string[] | null;
      anon: boolean;
    }>(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as cfg, has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1)`,
      [Object.values(P3E.rpc)],
    );
    expect(fns.rows).toHaveLength(Object.keys(P3E.rpc).length);
    for (const f of fns.rows) {
      expect(f.definer, f.name).toBe(true);
      expect(f.cfg?.join(","), f.name).toMatch(/search_path=("")?$/);
      expect(f.anon, f.name).toBe(false);
    }
  });

  it("감사: 만들기·저장·되돌리기·맞추기·보관이 남고, details 에 제목·요점·메모·자산 이름 글자 0", async () => {
    const c = await ctx(a);
    const MARK = "감사표식ZQ";
    const id = await create(
      a,
      c,
      [
        slide({
          title: `${MARK}제목`,
          bullets: `${MARK}요점`,
          notes: `${MARK}메모`,
        }),
      ],
      `${MARK}구성안`,
      "brand_deck",
    );
    await save(
      a,
      id,
      [{ ...(await asInput(id))[0], bullets: `${MARK}요점2` }],
      `${MARK}구성안2`,
      "minimal_report",
      "reviewed",
    );
    await act(a, id, (rev) => sql.restore(id, rev, 1));
    await bumpBrief(a, c);
    await act(a, id, (rev) => sql.rebase(id, rev));
    await act(a, id, (rev) => sql.archive(id, rev));
    const rows = await db.query<{ action: string; details: unknown }>(
      "select action, details from audit_events where entity_type = $1 and entity_id = $2 order by seq",
      [P3E.auditEntity, id],
    );
    expect(rows.rows.map((r) => r.action)).toEqual([
      "ppt_deck_create",
      "ppt_deck_save",
      "ppt_deck_restore",
      "ppt_deck_rebase",
      "ppt_deck_archive",
    ]);
    expect(JSON.stringify(rows.rows.map((r) => r.details))).not.toContain(MARK);
  });
});
