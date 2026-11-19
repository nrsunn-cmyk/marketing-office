/**
 * DEC08-AI-COPY-01: 브리프 AI 문구 생성 기록·한도·채택(20261119002000_dec08_ai_copy) 시험. 모든 값은 합성이다.
 * 외부 호출은 없다(DB 는 예약·마감·채택·한도만 맡는다).
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
  a = await seedOwner(db, "ai-owner-a@example.test");
  b = await seedOwner(db, "ai-owner-b@example.test");
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
  for (const f of [a, b])
    await asUser(db, f.userId, (tx) =>
      tx.query("select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))", [f.profileA1]),
    );
}, 60_000);

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const asAnon = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn);
const hash = (n: number) => n.toString(16).padStart(64, "0");

/** 승인 전략 → 퍼널 → 카드 → 브리프 → 주장 2개(첫 주장에 프로필 근거) */
async function setup(f: Fixture = a) {
  return asUser(db, f.userId, async (tx) => {
    const taskId = (await one<{ id: string }>(tx, "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id", [f.workspaceId, f.projectA, strategyTpl, newKey()])).id;
    const input = {
      templateVersion: STRATEGY_TEMPLATE_VERSION,
      projectId: f.projectA,
      profile: { id: f.profileA1, version: 1, projectId: f.projectA, clientId: f.clientA, projectKind: "client" },
      sections: { goals: { facts: [{ text: "합성 목표", sources: [{ kind: "profile", profileId: f.profileA1, version: 1 }] }], inferences: [] } },
      unknowns: [],
    };
    const d = buildStrategyDraft(input);
    if (!d.ok) throw new Error(JSON.stringify(d.issues));
    const g = await one<{ artifact_id: string; version_id: string }>(tx, "select * from generate_strategy($1, $2, $3, $4, $5)", [taskId, newKey(), f.profileA1, JSON.stringify(input), JSON.stringify(d.result)]);
    await tx.query("select decide_version($1, $2, 'approved', null)", [g.artifact_id, g.version_id]);
    const fn = await one<{ funnel_id: string }>(tx, "select * from create_funnel($1)", [g.artifact_id]);
    const stage = await one<{ id: string }>(tx, "select id from funnel_stages where funnel_id = $1 and stage_key = 'awareness'", [fn.funnel_id]);
    const item = await one<{ id: string }>(tx, "select add_funnel_item($1, 'content', '합성 카드', null, null, 'planned', null, null) as id", [stage.id]);
    const br = await one<{ brief_id: string }>(tx, "select * from create_content_brief($1, 'blog', '합성 브리프', null, null, null, '{}')", [item.id]);
    const c1 = (await one<{ id: string }>(tx, "select add_brief_claim($1, '합성 주장 1', 'capability') as id", [br.brief_id])).id;
    const c2 = (await one<{ id: string }>(tx, "select add_brief_claim($1, '합성 주장 2', 'capability') as id", [br.brief_id])).id;
    await tx.query("select link_claim_source($1, 'profile', $2, 'products', null)", [c1, f.profileA1]);
    return { briefId: br.brief_id, c1, c2 };
  });
}
/** 트랜잭션 안에서는 같은 tx 로 읽는다(관리자 연결을 쓰면 PGlite 단일 연결이 서로 기다린다) */
const revIn = async (tx: Tx, briefId: string) => (await one<{ revision: number }>(tx, "select revision from content_briefs where id = $1", [briefId])).revision;
const rev = async (briefId: string) => (await one<{ revision: number }>(db, "select revision from content_briefs where id = $1", [briefId])).revision;
const reserve = (tx: Tx, briefId: string, revision: number, h: string, claims: string[]) =>
  one<{ run_id: string; reused: boolean }>(tx, "select * from reserve_brief_copy_run($1, $2, $3, 'claude-sonnet-5-5', $4::uuid[])", [briefId, revision, h, claims]);
const finish = (tx: Tx, runId: string, status: string, variants: unknown, o: { problems?: unknown; err?: string | null; inT?: number; outT?: number; cost?: number } = {}) =>
  tx.query("select finish_brief_copy_run($1, $2, $3, $4, $5, $6, $7, $8)", [
    runId, status, variants === null ? null : JSON.stringify(variants), o.problems === undefined ? null : JSON.stringify(o.problems), o.err ?? null, o.inT ?? 3000, o.outT ?? 5000, o.cost ?? 56000,
  ]);
const accept = (tx: Tx, runId: string, variant: number, revision: number) => one<{ r: number }>(tx, "select accept_brief_copy($1, $2, $3) as r", [runId, variant, revision]).then((x) => x.r);
const updateBrief = (tx: Tx, id: string, r: number, copy: string | null, origin: string) =>
  one<{ r: number }>(tx, "select update_content_brief($1, $2, '합성 브리프', null, null, null, null, '{}', $3, $4, null, 'drafting') as r", [id, r, copy, origin]).then((x) => x.r);
/** 1분 간격 규칙을 피하려고 이 브리프의 생성 기록 시각을 2분 앞으로 민다(관리자 연결) */
const age = (briefId: string) => db.query("update brief_copy_runs set created_at = created_at - interval '2 minutes' where brief_id = $1", [briefId]);

describe("정상 흐름", () => {
  it("예약 → 성공 마감(감사) → 같은 입력은 재사용 → 채택(ai, revision+1) → 수정 시 ai 유지·변경 규칙", async () => {
    const s = await setup();
    const r0 = await rev(s.briefId);
    const res = await asA((tx) => reserve(tx, s.briefId, r0, hash(1), [s.c1]));
    expect(res.reused).toBe(false);
    const row = await one(db, "select status, brief_revision, model, claim_ids, created_by from brief_copy_runs where id = $1", [res.run_id]);
    expect(row).toEqual({ status: "reserved", brief_revision: r0, model: "claude-sonnet-5-5", claim_ids: [s.c1], created_by: a.userId });

    const variants = [{ text: "첫 변형 문구", usedClaimIds: [s.c1] }, { text: "둘째 변형 문구", usedClaimIds: [] }];
    await asA((tx) => finish(tx, res.run_id, "succeeded", variants));
    expect(await one(db, "select status, variants, cost_usd_micro::int as cost, finished_at is not null as fin from brief_copy_runs where id = $1", [res.run_id]))
      .toEqual({ status: "succeeded", variants, cost: 56000, fin: true });
    // 같은 입력은 10분 안에 다시 부르지 않는다(1분 규칙보다 먼저)
    expect(await asA((tx) => reserve(tx, s.briefId, r0, hash(1), [s.c1]))).toEqual({ run_id: res.run_id, reused: true });

    const r1 = await asA((tx) => accept(tx, res.run_id, 2, r0));
    expect(r1).toBe(r0 + 1);
    expect(await one(db, "select copy_draft, copy_origin from content_briefs where id = $1", [s.briefId])).toEqual({ copy_draft: "둘째 변형 문구", copy_origin: "ai" });
    expect(await one(db, "select accepted_variant, accepted_at is not null as at from brief_copy_runs where id = $1", [res.run_id])).toEqual({ accepted_variant: 2, at: true });
    await expectDbError(asA((tx) => accept(tx, res.run_id, 1, r1)), /이미 채택한 생성/);

    // 다른 칸만 고치면 ai 유지(화면은 manual 을 보내도 됨), 카피 글을 바꾸면 보낸 값
    const r2 = await asA((tx) => updateBrief(tx, s.briefId, r1, "둘째 변형 문구", "manual"));
    expect((await one<{ copy_origin: string }>(db, "select copy_origin from content_briefs where id = $1", [s.briefId])).copy_origin).toBe("ai");
    await expectDbError(asA((tx) => updateBrief(tx, s.briefId, r2, "다른 글", "ai")), /알 수 없는 카피 작성 방식/);
    await asA((tx) => updateBrief(tx, s.briefId, r2, "사람이 고친 글", "manual"));
    expect((await one<{ copy_origin: string }>(db, "select copy_origin from content_briefs where id = $1", [s.briefId])).copy_origin).toBe("manual");

    const acts = (await db.query<{ action: string; details: Record<string, unknown> }>(
      "select action, details from audit_events where entity_type = 'content_brief' and entity_id = $1 and action like 'copy_%' order by seq", [s.briefId],
    )).rows;
    expect(acts.map((x) => x.action)).toEqual(["copy_generate", "copy_accept"]);
    expect(acts[0].details).toMatchObject({ run_id: res.run_id, status: "succeeded", model: "claude-sonnet-5-5", cost_usd_micro: 56000 });
    expect(acts[1].details).toEqual({ run_id: res.run_id, variant: 2, used_claim_ids: [] });
  });

  it("검사 탈락·거절·실패 마감은 변형 없이 기록, 채택 불가", async () => {
    const s = await setup();
    for (const [i, st] of (["rejected", "refused", "failed"] as const).entries()) {
      await age(s.briefId);
      const r = await rev(s.briefId);
      const res = await asA((tx) => reserve(tx, s.briefId, r, hash(100 + i), [s.c1, s.c2]));
      await asA((tx) => finish(tx, res.run_id, st, null, { problems: st === "rejected" ? ["1번 변형에 근거 없는 수치가 있습니다: 30%"] : undefined, err: st === "failed" ? "TIMEOUT" : null }));
      await expectDbError(asA(async (tx) => accept(tx, res.run_id, 1, await revIn(tx, s.briefId))), /성공한 생성만 채택/);
    }
    expect((await one<{ n: number }>(db, "select count(*)::int as n from brief_copy_runs where brief_id = $1 and variants is null and finished_at is not null", [s.briefId])).n).toBe(3);
  });
});

describe("입력 검사", () => {
  it("예약: revision 충돌·확인값 형식·다른 브리프 주장·보관 주장 거절", async () => {
    const s = await setup();
    const other = await setup();
    const r0 = await rev(s.briefId);
    await expectDbError(asA((tx) => reserve(tx, s.briefId, r0 + 5, hash(2), [])), /CONFLICT/);
    await expectDbError(asA((tx) => reserve(tx, s.briefId, r0, "XYZ", [])), /입력 확인값 형식/);
    await expectDbError(asA((tx) => reserve(tx, s.briefId, r0, hash(2), [other.c1])), /이 브리프의 주장만/);
    await asA((tx) => tx.query("select archive_brief_claim($1, 1)", [s.c2]));
    await expectDbError(asA(async (tx) => reserve(tx, s.briefId, await revIn(tx, s.briefId), hash(2), [s.c2])), /이 브리프의 주장만/);
  });

  it("마감: 두 번 마감·성공인데 변형 없음·실패인데 변형·보내지 않은 주장·형식·사용량 범위 거절", async () => {
    const s = await setup();
    const res = await asA(async (tx) => reserve(tx, s.briefId, await revIn(tx, s.briefId), hash(3), [s.c1]));
    await expectDbError(asA((tx) => finish(tx, res.run_id, "succeeded", null)), /성공일 때만 변형/);
    await expectDbError(asA((tx) => finish(tx, res.run_id, "failed", [{ text: "x", usedClaimIds: [] }])), /성공일 때만 변형/);
    await expectDbError(asA((tx) => finish(tx, res.run_id, "succeeded", [{ text: "x", usedClaimIds: [s.c2] }])), /보내지 않은 주장/);
    await expectDbError(asA((tx) => finish(tx, res.run_id, "succeeded", [{ text: "", usedClaimIds: [] }])), /변형 형식/);
    await expectDbError(asA((tx) => finish(tx, res.run_id, "succeeded", [{ text: "x", usedClaimIds: [], extra: 1 }])), /변형 형식/);
    await expectDbError(asA((tx) => finish(tx, res.run_id, "succeeded", [{ text: "x", usedClaimIds: ["not-uuid"] }])), /변형 형식/);
    await expectDbError(asA((tx) => finish(tx, res.run_id, "succeeded", [1, 2, 3, 4].map(() => ({ text: "x", usedClaimIds: [] })))), /1~3개/);
    await expectDbError(asA((tx) => finish(tx, res.run_id, "done", null)), /알 수 없는 생성 결과/);
    await expectDbError(asA((tx) => finish(tx, res.run_id, "failed", null, { cost: 9_000_000 })), /사용량 값/);
    await asA((tx) => finish(tx, res.run_id, "succeeded", [{ text: "좋은 문구", usedClaimIds: [s.c1] }]));
    await expectDbError(asA((tx) => finish(tx, res.run_id, "failed", null)), /이미 마감한/);
    await expectDbError(asA(async (tx) => accept(tx, res.run_id, 2, await revIn(tx, s.briefId))), /없는 변형 번호/);
    await expectDbError(asA(async (tx) => accept(tx, res.run_id, 1, (await revIn(tx, s.briefId)) + 1)), /CONFLICT/);
  });
});

describe("한도", () => {
  /** 이 업무실의 기존 기록을 40일 전으로 밀어 오늘·이번 달 계산에서 뺀다(다른 시험과 섞이지 않게) */
  const clear = () => db.query("update brief_copy_runs set created_at = now() - interval '40 days' where workspace_id = $1", [a.workspaceId]);
  it("같은 브리프 1분 1번, 업무실 하루 30번, 월 비용 상한(예약 중은 25만 마이크로달러로 계산)", async () => {
    await clear();
    const s = await setup();
    const t = await setup();
    const r0 = await rev(s.briefId);
    await asA((tx) => reserve(tx, s.briefId, r0, hash(10), []));
    await expectDbError(asA((tx) => reserve(tx, s.briefId, r0, hash(11), [])), /1분에 한 번/);
    // 다른 브리프는 1분 규칙과 무관
    await asA(async (tx) => reserve(tx, t.briefId, await revIn(tx, t.briefId), hash(12), []));

    // 하루 30번: 오늘 기록 28개를 더해 30개로 만든다(관리자 연결, 2분 전 시각)
    await db.query(
      `insert into brief_copy_runs (workspace_id, brief_id, brief_revision, model, input_hash, status, finished_at, error_code, cost_usd_micro, created_by, created_at)
       select $1, $2, 1, 'claude-sonnet-5-5', lpad(to_hex(g), 64, '0'), 'failed', now(), 'TIMEOUT', 0, $3, now() - interval '2 minutes'
         from generate_series(1000, 1027) g`,
      [a.workspaceId, t.briefId, a.userId],
    );
    await age(s.briefId);
    await expectDbError(asA((tx) => reserve(tx, s.briefId, r0, hash(13), [])), /오늘 AI 문구 생성 횟수\(30번\)/);
    // 하루 기록 28개를 지우면 다시 예약할 수 있는 상태(이 시험이 넣은 것만)
    await db.query("delete from brief_copy_runs where brief_id = $1 and status = 'failed' and error_code = 'TIMEOUT' and cost_usd_micro = 0", [t.briefId]);

    // 월 상한 2천만 마이크로달러: 이번 달 실패 4개(각 4,937,500 = 1,975만)를 더한다
    await db.query(
      `insert into brief_copy_runs (workspace_id, brief_id, brief_revision, model, input_hash, status, finished_at, cost_usd_micro, created_by, created_at)
       select $1, $2, 1, 'claude-sonnet-5-5', lpad(to_hex(g), 64, '0'), 'failed', now(), 4937500, $3, now() - interval '2 minutes' from generate_series(2000, 2003) g`,
      [a.workspaceId, t.briefId, a.userId],
    );
    // 지금 이번 달 기록: 예약 2개(s, t: 각 25만) + 실패 4개(각 4,937,500) = 50만 + 1,975만 = 2,025만 → 예약 불가
    await expectDbError(asA((tx) => reserve(tx, s.briefId, r0, hash(14), [])), /BUDGET_EXCEEDED/);
    // 예약 하나를 0원 실패로 마감하면 1,975만 + 25만 = 2,000만, 새 예약 25만을 더하면 넘침 → 여전히 거절
    const reserved = (await db.query<{ id: string }>("select id from brief_copy_runs where brief_id = any($1::uuid[]) and status = 'reserved' order by created_at limit 1", [[s.briefId, t.briefId]])).rows[0].id;
    await asA((tx) => finish(tx, reserved, "failed", null, { cost: 0 }));
    await expectDbError(asA((tx) => reserve(tx, s.briefId, r0, hash(15), [])), /BUDGET_EXCEEDED/);
    // 하나를 더 0원으로 바꾸면 1,975만 + 0 + 25만(새) = 2,000만 ≤ 상한 → 허용
    const reserved2 = (await db.query<{ id: string }>("select id from brief_copy_runs where brief_id = any($1::uuid[]) and status = 'reserved' limit 1", [[s.briefId, t.briefId]])).rows[0].id;
    await asA((tx) => finish(tx, reserved2, "failed", null, { cost: 0 }));
    expect((await asA((tx) => reserve(tx, s.briefId, r0, hash(16), []))).reused).toBe(false);
    await clear();
  }, 60_000);
});

describe("업무실 경계 (P0)", () => {
  it("남의 브리프·기록은 NOT_FOUND, 조회 0행, 직접 쓰기 거절, anon 거절, 정의자 설정", async () => {
    const s = await setup();
    const res = await asA(async (tx) => reserve(tx, s.briefId, await revIn(tx, s.briefId), hash(20), [s.c1]));
    const rA = await rev(s.briefId);
    await expectDbError(asB((tx) => reserve(tx, s.briefId, rA, hash(21), [])), /NOT_FOUND/);
    await expectDbError(asB((tx) => finish(tx, res.run_id, "failed", null)), /NOT_FOUND/);
    await asA((tx) => finish(tx, res.run_id, "succeeded", [{ text: "문구", usedClaimIds: [] }]));
    await expectDbError(asB((tx) => accept(tx, res.run_id, 1, 1)), /NOT_FOUND/);
    expect(await asB((tx) => tx.query("select 1 from brief_copy_runs").then((r) => r.rows.length))).toBe(0);
    expect(await asA((tx) => tx.query("select 1 from brief_copy_runs where id = $1", [res.run_id]).then((r) => r.rows.length))).toBe(1);
    await expectDbError(asA((tx) => tx.query("update brief_copy_runs set status = 'reserved' where id = $1", [res.run_id])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("insert into brief_copy_runs (workspace_id, brief_id, brief_revision, model, input_hash, created_by) values ($1, $2, 1, 'm', $3, $4)", [a.workspaceId, s.briefId, hash(22), a.userId])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("delete from brief_copy_runs where id = $1", [res.run_id])), /permission denied/);
    await expectDbError(asAnon((tx) => tx.query("select * from reserve_brief_copy_run($1, 1, $2, 'm', '{}')", [s.briefId, hash(23)])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("select * from app.brief_copy_limits()")), /permission denied/);

    const fns = (await db.query<{ name: string; secdef: boolean; cfg: string[]; anon: boolean; auth: boolean }>(
      `select p.proname as name, p.prosecdef as secdef, p.proconfig as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reserve_brief_copy_run', 'finish_brief_copy_run', 'accept_brief_copy', 'update_content_brief')
        order by 1`,
    )).rows;
    expect(fns).toHaveLength(4);
    for (const f of fns) expect(f).toEqual({ name: f.name, secdef: true, cfg: ['search_path=""'], anon: false, auth: true });
  });
});
