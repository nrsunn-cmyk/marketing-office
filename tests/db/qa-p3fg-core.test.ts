/**
 * QA-BUNDLE-L-01(Tester, Master 지시 '핵심 공격 3'): P3-f 검수·P3-g 납품(migration 20261121011000).
 * ① 승인 게이트 우회(필수 미통과·stale·보관) ② 승인 안 된 판·남의 판을 납품 묶음에 넣기 ③ 묶음 항목·전달 기록 수정·삭제(추가 전용).
 * 대상은 PPT 구성안(P3-e RPC 로 만들고 검토 완료로 저장). qa_reviews 가 없으면 건너뛴다. 모든 값은 합성.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
import { slides, sql } from "./qa-p3e-names";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 });
const MIG = join(import.meta.dirname, "..", "..", "supabase", "migrations");
const present = readdirSync(MIG).some(
  (f) =>
    f.endsWith(".sql") &&
    readFileSync(join(MIG, f), "utf8").includes(
      "create table public.qa_reviews",
    ),
);
let db: Db;
let a: Fixture;
let b: Fixture;
let tpl: string;

const asU = <R>(f: Fixture | null, fn: (tx: Tx) => Promise<R>) =>
  asUser(db, f ? f.userId : null, fn);
const q1 = <T>(f: Fixture | null, text: string, params: unknown[] = []) =>
  asU(f, (tx) => one<T>(tx, text, params));
const rev = async (table: string, id: string) =>
  (
    await one<{ revision: number }>(
      db,
      `select revision from public.${table} where id = $1`,
      [id],
    )
  ).revision;
const KINDS = ["ppt_deck", "design_assets"];

async function project(f: Fixture) {
  return asU(f, async (tx) => {
    const projectId = (
      await one<{ id: string }>(
        tx,
        "insert into projects (workspace_id, client_id, kind, title) values ($1, $2, 'client', '합성 L') returning id",
        [f.workspaceId, f.clientA],
      )
    ).id;
    const taskId = (
      await one<{ id: string }>(
        tx,
        "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id",
        [f.workspaceId, projectId, tpl, newKey()],
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
        [projectId, g.artifact_id, KINDS],
      )
    ).id;
    await tx.query(
      "select update_production_brief($1, 1, '합성 브리프', '대상', '메시지', $2::text[], '범위', null, null, 'ready')",
      [briefId, KINDS],
    );
    return { projectId, briefId };
  });
}
/** PPT 구성안을 만들고 '검토 완료'로 저장(검수 대상이 되게) */
async function reviewedDeck(
  f: Fixture,
  briefId: string,
  title = "합성 구성안",
) {
  const id = (
    await q1<{ r: string }>(
      f,
      sql.create(briefId, title, "royal_grid", slides(2)).text,
      sql.create(briefId, title, "royal_grid", slides(2)).params,
    )
  ).r;
  await saveDeck(f, id, `${title} 검토`);
  return id;
}
async function saveDeck(
  f: Fixture,
  id: string,
  title: string,
  status = "reviewed",
) {
  const cur = await one<{
    slides: Array<{
      id: string;
      title: string;
      bullets: string | null;
      notes: string | null;
    }>;
  }>(
    db,
    "select v.slides from ppt_deck_versions v join ppt_decks d on d.id = v.deck_id and v.version_no = d.current_version_no where d.id = $1",
    [id],
  );
  const input = cur.slides.map((s) => ({
    id: s.id,
    title: s.title,
    bullets: s.bullets,
    notes: s.notes,
    asset_ids: [],
  }));
  const q = sql.save(
    id,
    await rev("ppt_decks", id),
    title,
    "royal_grid",
    status,
    input,
  );
  await q1(f, q.text, q.params);
}
const openReview = async (f: Fixture, deckId: string) =>
  (
    await q1<{ id: string }>(f, "select open_qa_review('ppt_deck', $1) as id", [
      deckId,
    ])
  ).id;
const items = (reviewId: string) =>
  db
    .query<{ id: string; is_required: boolean; verdict: string }>(
      "select id, is_required, verdict from qa_check_items where review_id = $1 order by sort_order",
      [reviewId],
    )
    .then((r) => r.rows);
const setItem = async (
  f: Fixture,
  reviewId: string,
  itemId: string,
  verdict: string,
  memo: string | null = null,
) =>
  q1(f, "select set_qa_item($1, $2, $3, $4, $5)", [
    reviewId,
    await rev("qa_reviews", reviewId),
    itemId,
    verdict,
    memo,
  ]);
const passAll = async (f: Fixture, reviewId: string) => {
  for (const it of await items(reviewId))
    if (it.verdict !== "passed") await setItem(f, reviewId, it.id, "passed");
};
const approve = async (f: Fixture, reviewId: string) =>
  q1(f, "select approve_qa_review($1, $2)", [
    reviewId,
    await rev("qa_reviews", reviewId),
  ]);
const bundle = async (f: Fixture, projectId: string) =>
  (
    await q1<{ id: string }>(f, "select create_delivery_bundle($1) as id", [
      projectId,
    ])
  ).id;
const bundleItems = (bundleId: string) =>
  db
    .query<{
      kind: string;
      ppt_deck_id: string | null;
      ppt_deck_version_id: string | null;
      version_no: number;
      qa_review_id: string | null;
      content_sha256: string;
    }>(
      "select kind, ppt_deck_id, ppt_deck_version_id, version_no, qa_review_id, content_sha256 from delivery_bundle_items where bundle_id = $1 order by sort_order",
      [bundleId],
    )
    .then((r) => r.rows);

describe.skipIf(!present)("P3-f·g 핵심 공격(묶음 L)", () => {
  beforeAll(async () => {
    db = await createDb();
    a = await seedOwner(db, "p3fg-owner-a@example.test");
    b = await seedOwner(db, "p3fg-owner-b@example.test");
    tpl = (
      await one<{ id: string }>(db, "select id from templates where key = $1", [
        STRATEGY_TEMPLATE_VERSION,
      ])
    ).id;
    for (const f of [a, b])
      await asU(f, (tx) =>
        tx.query(
          "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
          [f.profileA1],
        ),
      );
  });

  it("① 승인 게이트: 필수 pending·needs_fix·stale·산출물 보관·직접 수정·남의 것은 승인 불가, 필수 아닌 needs_fix 는 승인 가능", async () => {
    const p = await project(a);
    const deck = await reviewedDeck(a, p.briefId);
    // 작성 중 산출물은 회차를 못 연다
    const drafting = (
      await q1<{ r: string }>(
        a,
        sql.create(p.briefId, "작성 중", "royal_grid", slides(1)).text,
        sql.create(p.briefId, "작성 중", "royal_grid", slides(1)).params,
      )
    ).r;
    await expectDbError(openReview(a, drafting), /INVALID_TRANSITION/);
    const r = await openReview(a, deck);
    await expectDbError(openReview(a, deck), /VALIDATION/); // 열린 회차 두 개 불가
    const its = await items(r);
    expect(its.filter((x) => x.is_required)).toHaveLength(4);
    await expectDbError(approve(a, r), /VALIDATION/); // 필수 모두 pending
    for (const it of its.slice(0, 3)) await setItem(a, r, it.id, "passed");
    await expectDbError(approve(a, r), /VALIDATION/); // 필수 하나 pending
    await expectDbError(
      setItem(a, r, its[3].id, "needs_fix", null),
      /VALIDATION/,
    ); // 메모 없는 needs_fix
    await setItem(a, r, its[3].id, "needs_fix", "합성 보완 메모");
    await expectDbError(approve(a, r), /VALIDATION/); // 필수 needs_fix
    // 직접 바꾸기: 로그인 사용자 update 권한 없음, 슈퍼유저도 approved_at 없이 reviewed 불가(CHECK)
    await expectDbError(
      asU(a, (tx) =>
        tx.query("update qa_reviews set status = 'reviewed' where id = $1", [
          r,
        ]),
      ),
      /permission denied/,
    );
    await expectDbError(
      asU(a, (tx) =>
        tx.query(
          "update qa_check_items set verdict = 'passed' where review_id = $1",
          [r],
        ),
      ),
      /permission denied/,
    );
    await expectDbError(
      db.query("update qa_reviews set status = 'reviewed' where id = $1", [r]),
      /check|violates/,
    );
    await expectDbError(approve(b, r), /NOT_FOUND/);
    await setItem(a, r, its[3].id, "passed");
    // 필수 아닌 항목이 needs_fix 여도 승인 가능(설계 ⑦)
    await q1(a, "select add_qa_item($1, $2, '선택 항목', false)", [
      r,
      await rev("qa_reviews", r),
    ]);
    const opt = (await items(r)).find((x) => !x.is_required)!;
    await setItem(a, r, opt.id, "needs_fix", "선택 메모");
    // stale: 산출물이 새 판이 되면 승인 거절
    await saveDeck(a, deck, "새 판");
    await expectDbError(approve(a, r), /INVALID_TRANSITION/);
    // 재검수(새 회차) → 통과 → 승인, 승인 뒤 판정 수정·다시 승인·직접 되돌리기 거절
    const r2 = (
      await q1<{ id: string }>(a, "select rebase_qa_review($1, $2) as id", [
        r,
        await rev("qa_reviews", r),
      ])
    ).id;
    await passAll(a, r2);
    await approve(a, r2);
    await expectDbError(
      setItem(a, r2, (await items(r2))[0].id, "pending"),
      /INVALID_TRANSITION/,
    );
    await expectDbError(approve(a, r2), /INVALID_TRANSITION/);
    await expectDbError(
      db.query(
        "update qa_reviews set status = 'drafting', approved_at = null, approved_by = null where id = $1",
        [r2],
      ),
      /FROZEN/,
    );
    await expectDbError(
      db.query("update qa_check_items set memo = 'x' where review_id = $1", [
        r2,
      ]),
      /FROZEN/,
    );
    // 산출물 보관 뒤 승인 거절
    const deck2 = await reviewedDeck(a, p.briefId, "보관할 구성안");
    const r3 = await openReview(a, deck2);
    await passAll(a, r3);
    await q1(
      a,
      sql.archive(deck2, await rev("ppt_decks", deck2)).text,
      sql.archive(deck2, await rev("ppt_decks", deck2)).params,
    );
    await expectDbError(approve(a, r3), /INVALID_TRANSITION/);
  });

  it("② 납품: 승인된 판만(승인 뒤 새 판·진행 중·보완 요청·승인 회차 보관·남의 것 제외), content_sha256 = 판 지문, 남의 프로젝트·남의 묶음 NOT_FOUND, 직접 넣기 거절", async () => {
    const p = await project(a);
    const approved = await reviewedDeck(a, p.briefId, "승인");
    const ra = await openReview(a, approved);
    await passAll(a, ra);
    await approve(a, ra);
    const approvedVer = await one<{ v: string; n: number }>(
      db,
      "select ppt_deck_version_id as v, target_version_no as n from qa_reviews where id = $1",
      [ra],
    );
    await saveDeck(a, approved, "승인 뒤 새 판"); // 새 판은 미승인
    const open = await reviewedDeck(a, p.briefId, "진행 중");
    await openReview(a, open);
    const fix = await reviewedDeck(a, p.briefId, "보완 요청");
    const rf = await openReview(a, fix);
    await setItem(a, rf, (await items(rf))[0].id, "needs_fix", "보완");
    await q1(a, "select request_qa_fix($1, $2)", [
      rf,
      await rev("qa_reviews", rf),
    ]);
    const revoked = await reviewedDeck(a, p.briefId, "승인 뒤 회차 보관");
    const rr = await openReview(a, revoked);
    await passAll(a, rr);
    await approve(a, rr);
    await q1(a, "select archive_qa_review($1, $2)", [
      rr,
      await rev("qa_reviews", rr),
    ]);
    // 남의 업무실 승인본은 내 묶음에 들어갈 길이 없다
    const pb = await project(b);
    const bd = await reviewedDeck(b, pb.briefId, "남의 것");
    const rb = await openReview(b, bd);
    await passAll(b, rb);
    await approve(b, rb);

    const bid = await bundle(a, p.projectId);
    const its = await bundleItems(bid);
    const decks = its.filter((x) => x.kind === "ppt_deck");
    expect(decks.map((x) => x.ppt_deck_id)).toEqual([approved]);
    expect(decks[0].ppt_deck_version_id).toBe(approvedVer.v);
    expect(decks[0].version_no).toBe(approvedVer.n);
    expect(decks[0].qa_review_id).toBe(ra);
    expect(its.filter((x) => x.kind === "production_brief")).toHaveLength(1);
    const fp = await one<{ h: string }>(
      db,
      "select app.qa_version_sha('ppt_deck', $1) as h",
      [approvedVer.v],
    );
    expect(decks[0].content_sha256).toBe(fp.h);
    await expectDbError(bundle(b, p.projectId), /NOT_FOUND/);
    await expectDbError(
      q1(b, "select restore_delivery_bundle($1) as id", [bid]),
      /NOT_FOUND/,
    );
    // 승인본이 없는 프로젝트는 묶음 불가
    const empty = await project(a);
    await expectDbError(bundle(a, empty.projectId), /VALIDATION/);
    // 복구: 그사이 승인 회차를 보관하면 빠진다
    await q1(a, "select archive_qa_review($1, $2)", [
      ra,
      await rev("qa_reviews", ra),
    ]);
    await expectDbError(
      q1(a, "select restore_delivery_bundle($1) as id", [bid]),
      /VALIDATION/,
    );
    // 직접 넣기: 로그인 사용자 권한 없음 / 슈퍼유저도 종류·칸 짝이 안 맞거나 남의 프로젝트 회차면 거절
    await expectDbError(
      asU(a, (tx) =>
        tx.query(
          "insert into delivery_bundle_items (workspace_id, project_id, bundle_id, sort_order, kind, ppt_deck_id, ppt_deck_version_id, version_no, qa_review_id, content_sha256) values ($1, $2, $3, 99, 'ppt_deck', $4, $5, 9, $6, repeat('a', 64))",
          [a.workspaceId, p.projectId, bid, open, approvedVer.v, ra],
        ),
      ),
      /permission denied/,
    );
    await expectDbError(
      db.query(
        "insert into delivery_bundle_items (workspace_id, project_id, bundle_id, sort_order, kind, video_plan_id, ppt_deck_id, ppt_deck_version_id, version_no, qa_review_id, content_sha256) values ($1, $2, $3, 98, 'web_copy', null, $4, $5, 1, $6, repeat('a', 64))",
        [a.workspaceId, p.projectId, bid, approved, approvedVer.v, ra],
      ),
      /check|violates/,
    );
    await expectDbError(
      db.query(
        "insert into delivery_bundle_items (workspace_id, project_id, bundle_id, sort_order, kind, ppt_deck_id, ppt_deck_version_id, version_no, qa_review_id, content_sha256) values ($1, $2, $3, 97, 'ppt_deck', $4, $5, 1, $6, repeat('a', 64))",
        [a.workspaceId, p.projectId, bid, approved, approvedVer.v, rb],
      ),
      /foreign key|violates/,
    );
    // 다른 구성안의 판을 끼워 넣기(부모·판 짝 FK)
    const otherVer = (
      await one<{ id: string }>(
        db,
        "select id from ppt_deck_versions where deck_id = $1 limit 1",
        [open],
      )
    ).id;
    await expectDbError(
      db.query(
        "insert into delivery_bundle_items (workspace_id, project_id, bundle_id, sort_order, kind, ppt_deck_id, ppt_deck_version_id, version_no, qa_review_id, content_sha256) values ($1, $2, $3, 96, 'ppt_deck', $4, $5, 1, $6, repeat('a', 64))",
        [a.workspaceId, p.projectId, bid, approved, otherVer, ra],
      ),
      /foreign key|violates/,
    );
  });

  it("③ 추가 전용: 묶음 항목·전달 기록 수정·삭제 거절(슈퍼유저 포함), 묶음 머리 고정 칸 거절, 보관 뒤 전달 기록·수정 거절", async () => {
    const p = await project(a);
    const d = await reviewedDeck(a, p.briefId);
    const r = await openReview(a, d);
    await passAll(a, r);
    await approve(a, r);
    const bid = await bundle(a, p.projectId);
    await q1(
      a,
      "select add_delivery_log($1, $2, 'email', now(), '합성 전달')",
      [bid, await rev("delivery_bundles", bid)],
    );
    for (const [t, set] of [
      ["delivery_bundle_items", "content_sha256 = repeat('b', 64)"],
      ["delivery_logs", "note = '바꿈'"],
    ] as const) {
      const where = t === "delivery_bundle_items" ? "bundle_id" : "bundle_id";
      await expectDbError(
        asU(a, (tx) =>
          tx.query(`update ${t} set ${set} where ${where} = $1`, [bid]),
        ),
        /permission denied/,
      );
      await expectDbError(
        asU(a, (tx) => tx.query(`delete from ${t} where ${where} = $1`, [bid])),
        /permission denied/,
      );
      await expectDbError(
        db.query(`update ${t} set ${set} where ${where} = $1`, [bid]),
        /.+/,
      );
      await expectDbError(
        db.query(`delete from ${t} where ${where} = $1`, [bid]),
        /.+/,
      );
    }
    await expectDbError(
      db.query("update delivery_bundles set item_count = 99 where id = $1", [
        bid,
      ]),
      /.+/,
    );
    await expectDbError(
      db.query("update delivery_bundles set bundle_no = 50 where id = $1", [
        bid,
      ]),
      /.+/,
    );
    await expectDbError(
      asU(a, (tx) =>
        tx.query(
          "update delivery_bundles set status = 'reviewed' where id = $1",
          [bid],
        ),
      ),
      /permission denied/,
    );
    // 보관 뒤
    await q1(a, "select archive_delivery_bundle($1, $2)", [
      bid,
      await rev("delivery_bundles", bid),
    ]);
    await expectDbError(
      q1(a, "select add_delivery_log($1, $2, 'email', now(), null)", [
        bid,
        await rev("delivery_bundles", bid),
      ]),
      /INVALID_TRANSITION/,
    );
    await expectDbError(
      q1(a, "select update_delivery_bundle($1, $2, 'reviewed')", [
        bid,
        await rev("delivery_bundles", bid),
      ]),
      /INVALID_TRANSITION|FROZEN/,
    );
    await expectDbError(
      db.query("update delivery_bundles set archived_at = null where id = $1", [
        bid,
      ]),
      /FROZEN/,
    );
    expect(await bundle(a, p.projectId)).toMatch(/^[0-9a-f-]{36}$/); // 보관 뒤 새 묶음은 가능
    expect(
      (
        await db.query(
          "select 1 from delivery_bundle_items where bundle_id = $1",
          [bid],
        )
      ).rows.length,
    ).toBeGreaterThan(0);
  });
});
