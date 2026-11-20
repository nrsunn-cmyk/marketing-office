/**
 * P4A-BACKEND-IMPL-01: 실행 승인 대기열·티스토리 수동 게시 실행 기록·성과 수동 입력(20261121012000_p4a_execution, 처음 이름 007000) 시험.
 * 설계: Plan/Claude-Backend-20261120/P4A-BACKEND-01-DESIGN.md. 원본은 P2-g 채널 초안(실제 경로: 전략 → 퍼널 → 브리프 → 초안). 모든 값은 합성이다.
 * 공격 위주 시험은 Tester tests/db/qa-p4a-attack.test.ts(claude/qa-p4a-prep)가 맡는다. 여기서는 정상 흐름·막힘 저장·맞추기·권한을 본다.
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
  a = await seedOwner(db, "p4a-owner-a@example.test");
  b = await seedOwner(db, "p4a-owner-b@example.test");
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
  for (const f of [a, b])
    await asUser(db, f.userId, (tx) =>
      tx.query("select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))", [f.profileA1]),
    );
}, 60_000);

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const count = async (sql: string, p: unknown[] = []) => (await one<{ n: number }>(db, `select count(*)::int as n from (${sql}) x`, p)).n;

/** 검토 완료 채널 초안 하나(전략 승인 → 퍼널 → 카드 → 브리프 ready → 초안 reviewed) */
async function reviewedDraft(f: Fixture): Promise<{ draftId: string; projectId: string }> {
  return asUser(db, f.userId, async (tx) => {
    const taskId = (await one<{ id: string }>(tx, "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id", [f.workspaceId, f.projectA, strategyTpl, newKey()])).id;
    const input = {
      templateVersion: STRATEGY_TEMPLATE_VERSION,
      projectId: f.projectA,
      profile: { id: f.profileA1, version: 1, projectId: f.projectA, clientId: f.clientA, projectKind: "client" },
      sections: { goals: { facts: [{ text: "합성 목표", sources: [{ kind: "profile", profileId: f.profileA1, version: 1 }] }], inferences: [] }, offers: { facts: [], inferences: [{ text: "합성 제안" }] } },
      unknowns: [],
    };
    const d = buildStrategyDraft(input);
    if (!d.ok) throw new Error(JSON.stringify(d.issues));
    const g = await one<{ artifact_id: string; version_id: string }>(tx, "select * from generate_strategy($1, $2, $3, $4, $5)", [taskId, newKey(), f.profileA1, JSON.stringify(input), JSON.stringify(d.result)]);
    await tx.query("select decide_version($1, $2, 'approved', null)", [g.artifact_id, g.version_id]);
    const fn = await one<{ funnel_id: string }>(tx, "select * from create_funnel($1)", [g.artifact_id]);
    const stage = (await one<{ id: string }>(tx, "select id from funnel_stages where funnel_id = $1 order by position offset 1 limit 1", [fn.funnel_id])).id;
    const item = (await one<{ id: string }>(tx, "select add_funnel_item($1, 'content', '합성 카드', null, null, 'planned', null, null) as id", [stage])).id;
    const spec = JSON.stringify({ titleIdeas: ["후보 제목"], outline: ["왜 지금인가"], keywords: ["마케팅"] });
    const br = await one<{ brief_id: string }>(tx, "select * from create_content_brief($1, $2, $3, $4, $5, $6, $7)", [item, "blog", "합성 블로그 브리프", "합성 타깃", "핵심 요지 ".repeat(30), "무료 진단 신청", spec]);
    await tx.query("select add_brief_claim($1, '주장 하나', 'capability')", [br.brief_id]);
    await tx.query("select update_content_brief($1, 1, '합성 블로그 브리프', '타깃', '훅 문장', '핵심 요지', 'CTA 문장', $2, null, 'manual', null, 'ready')", [br.brief_id, spec]);
    const draftId = (await one<{ id: string }>(tx, "select create_channel_draft($1) as id", [br.brief_id])).id;
    await tx.query("select update_channel_draft($1, 1, '비밀 제목 표식', '본문 표식', '[\"마케팅\"]', null, null, 'reviewed')", [draftId]);
    return { draftId, projectId: f.projectA };
  });
}
const draftRev = async (id: string) => (await one<{ revision: number }>(db, "select revision from channel_drafts where id = $1", [id])).revision;
const editDraft = async (id: string, title: string, status = "reviewed") => {
  const rev = await draftRev(id);
  await asA((tx) => tx.query("select update_channel_draft($1, $2, $3, '본문 표식', '[\"마케팅\"]', null, null, $4)", [id, rev, title, status]));
};
const job = (id: string) => one<{ status: string; block_reason: string | null; revision: number; attempt_count: number; publication_id: string | null; source_hash: string; idempotency_key: string; external_url: string | null }>(db, "select * from execution_jobs where id = $1", [id]);
const enqueue = (draftId: string, projectId = a.projectA) =>
  asA((tx) => one<{ id: string }>(tx, "select enqueue_execution($1, 'channel_draft', $2, 'tistory_manual') as id", [projectId, draftId])).then((r) => r.id);
const call = (fn: string, id: string, rev: number, extra = "") => asA((tx) => one<{ r: Record<string, unknown> }>(tx, `select ${fn}($1, $2${extra}) as r`, [id, rev]).then((x) => x.r));
const URL1 = "https://nadaum.tistory.com/42";

describe("실행 대기열 정상 흐름", () => {
  it("올리기 → 승인 → 티스토리 기록 → 끝남, 멱등 키는 exec-+id 전체, 다시 기록하면 already_done(기록 1개)", async () => {
    const { draftId } = await reviewedDraft(a);
    const id = await enqueue(draftId);
    const j0 = await job(id);
    expect(j0).toMatchObject({ status: "pending_approval", attempt_count: 0, publication_id: null });
    expect(j0.idempotency_key).toBe(`exec-${id}`);
    expect(j0.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await call("approve_execution", id, 1)).toMatchObject({ status: "queued", block_reason: null });
    const r = await asA((tx) => one<{ r: Record<string, unknown> }>(tx, "select record_tistory_execution($1, $2, $3, now() - interval '1 minute', null) as r", [id, 2, URL1]).then((x) => x.r));
    expect(r).toMatchObject({ status: "succeeded", already_done: false });
    expect(await job(id)).toMatchObject({ status: "succeeded", external_url: URL1 });
    expect(await count("select 1 from channel_publications where draft_id = $1 and kind = 'record'", [draftId])).toBe(1);
    // 다시 기록(같은 키) → 실행 없이 기존 결과
    const again = await asA((tx) => one<{ r: Record<string, unknown> }>(tx, "select record_tistory_execution($1, 1, $2, now(), null) as r", [id, "https://nadaum.tistory.com/99"]).then((x) => x.r));
    expect(again).toMatchObject({ status: "succeeded", already_done: true, publication_id: r.publication_id });
    expect(await count("select 1 from channel_publications where draft_id = $1 and kind = 'record'", [draftId])).toBe(1);
    // 게시 기록을 취소해도 실행 건은 succeeded 그대로(추가 전용끼리 서로 고치지 않음)
    await asA((tx) => tx.query("select void_channel_publication($1, '잘못 적음')", [r.publication_id]));
    expect((await job(id)).status).toBe("succeeded");
    // 끝난 건은 보관만, 다시 하기는 잘못된 전이
    await expectDbError(call("retry_execution", id, (await job(id)).revision), /INVALID_TRANSITION: 이미 끝난/);
  });
});

describe("내용 일치 검사(Q1: 막힘은 반환값으로, 저장은 남는다)", () => {
  it("상태만 바뀌면 일치, 제목이 바뀌면 승인 때 blocked_mismatch(content_changed) 가 저장된다 → 맞추기 → 다시 승인", async () => {
    const { draftId } = await reviewedDraft(a);
    const id = await enqueue(draftId);
    await editDraft(draftId, "비밀 제목 표식", "drafting");
    await editDraft(draftId, "비밀 제목 표식", "reviewed");
    expect(await call("approve_execution", id, 1)).toMatchObject({ status: "queued" });
    await editDraft(draftId, "바뀐 제목");
    // 기록 때 다시 대조 → 막힘이 저장되고 게시 기록은 생기지 않는다
    const r = await asA((tx) => one<{ r: Record<string, unknown> }>(tx, "select record_tistory_execution($1, 2, $2, now(), null) as r", [id, URL1]).then((x) => x.r));
    expect(r).toMatchObject({ status: "blocked_mismatch", block_reason: "content_changed", already_done: false });
    expect(await job(id)).toMatchObject({ status: "blocked_mismatch", block_reason: "content_changed" });
    expect(await count("select 1 from channel_publications where draft_id = $1", [draftId])).toBe(0);
    // 맞추기 → 승인 대기(사람이 다시 승인), 지문이 새 내용으로
    const before = (await job(id)).source_hash;
    expect(await call("rebase_execution", id, (await job(id)).revision)).toMatchObject({ status: "pending_approval" });
    expect((await job(id)).source_hash).not.toBe(before);
    expect(await call("approve_execution", id, (await job(id)).revision)).toMatchObject({ status: "queued" });
  });

  it("원인 3종: 초안이 작성 중으로 돌아감(not_reviewed)·보관(source_archived), 작성 중이면 맞추기도 거절", async () => {
    const { draftId } = await reviewedDraft(a);
    const id = await enqueue(draftId);
    await editDraft(draftId, "비밀 제목 표식", "drafting");
    expect(await call("approve_execution", id, 1)).toMatchObject({ status: "blocked_mismatch", block_reason: "not_reviewed" });
    await expectDbError(call("rebase_execution", id, 2), /INVALID_TRANSITION: 원본 초안이 검토 완료가 아니라/);
    const other = await reviewedDraft(a);
    const id2 = await enqueue(other.draftId);
    const rev = await draftRev(other.draftId);
    await asA((tx) => tx.query("select archive_channel_draft($1, $2)", [other.draftId, rev]));
    expect(await call("approve_execution", id2, 1)).toMatchObject({ status: "blocked_mismatch", block_reason: "source_archived" });
  });

  it("보류·재개: 재개 때도 다시 대조, 보류는 승인 대기·실행 대기·실패에서만", async () => {
    const { draftId } = await reviewedDraft(a);
    const id = await enqueue(draftId);
    expect(await call("hold_execution", id, 1)).toMatchObject({ status: "held" });
    await editDraft(draftId, "보류 중 바뀜");
    expect(await call("resume_execution", id, 2)).toMatchObject({ status: "blocked_mismatch", block_reason: "content_changed" });
    await expectDbError(call("hold_execution", id, 3), /INVALID_TRANSITION/);
  });
});

describe("대기열 규칙", () => {
  it("검토 완료만, 외부 채널은 자리만, 끝나지 않은 건 1개, 다른 프로젝트·남의 초안 NOT_FOUND, 보관 뒤 다시 올리기 허용", async () => {
    const { draftId } = await reviewedDraft(a);
    for (const ch of ["crm", "search_ad", "social_api"])
      await expectDbError(asA((tx) => tx.query("select enqueue_execution($1, 'channel_draft', $2, $3)", [a.projectA, draftId, ch])), /아직 연결하지 않은 채널/);
    await expectDbError(asA((tx) => tx.query("select enqueue_execution($1, 'delivery_bundle_item', $2, 'tistory_manual')", [a.projectA, draftId])), /채널 초안만/);
    await expectDbError(asA((tx) => tx.query("select enqueue_execution($1, 'channel_draft', $2, 'tistory_manual')", [a.projectB, draftId])), /NOT_FOUND: 채널 초안/);
    await expectDbError(asB((tx) => tx.query("select enqueue_execution($1, 'channel_draft', $2, 'tistory_manual')", [b.projectA, draftId])), /NOT_FOUND: 채널 초안/);
    const id = await enqueue(draftId);
    await expectDbError(enqueue(draftId), /이미 끝나지 않은 실행 건/);
    await asA((tx) => tx.query("select archive_execution($1, 1)", [id]));
    await enqueue(draftId);
    const drafting = await reviewedDraft(a);
    await editDraft(drafting.draftId, "x", "drafting");
    await expectDbError(enqueue(drafting.draftId), /검토 완료한 초안만/);
  });

  it("재시도 3회(실패 건만, 같은 키), 실패에서 보류 허용", async () => {
    const { draftId } = await reviewedDraft(a);
    const id = await enqueue(draftId);
    await call("approve_execution", id, 1);
    const key = (await job(id)).idempotency_key;
    for (let n = 1; n <= 3; n++) {
      await db.query("update execution_jobs set status = 'failed', last_error_code = 'timeout' where id = $1", [id]);
      expect(await call("retry_execution", id, (await job(id)).revision)).toMatchObject({ status: "queued", attempt_count: n });
    }
    await db.query("update execution_jobs set status = 'failed' where id = $1", [id]);
    await expectDbError(call("retry_execution", id, (await job(id)).revision), /LIMIT_REACHED: 같은 실행 건은 3번까지/);
    expect(await call("hold_execution", id, (await job(id)).revision)).toMatchObject({ status: "held" });
    expect((await job(id)).idempotency_key).toBe(key);
  });
});

describe("성과 수동 입력", () => {
  const add = (o: Record<string, unknown> = {}) =>
    asA((tx) =>
      one<{ id: string }>(
        tx,
        "select add_execution_result(p_project_id => $1, p_execution_job_id => $2, p_metric_name => $3, p_value => $4, p_unit => $5, p_numerator => $6, p_denominator => $7, p_source_note => $8, p_period_start => $9, p_period_end => $10) as id",
        [o.project ?? a.projectA, o.job ?? null, o.name ?? "글 조회수", o.value ?? 342, o.unit ?? "count", o.num ?? null, o.den ?? null, o.note ?? "비밀 출처 표식", o.start ?? "2026-11-13", o.end ?? "2026-11-19"],
      ).then((r) => r.id),
    );
  it("정상·취소(사유)·두 번 취소 거절·보관, 직접 쓰기 권한 없음, 감사에 출처·사유 글 0", async () => {
    const id = await add();
    await expectDbError(asA((tx) => tx.query("select void_execution_result($1, ' ')", [id])), /취소 이유/);
    await asA((tx) => tx.query("select void_execution_result($1, '비밀 사유 표식')", [id]));
    await expectDbError(asA((tx) => tx.query("select void_execution_result($1, '다시')", [id])), /이미 취소/);
    await asA((tx) => tx.query("select archive_execution_result($1)", [id]));
    await expectDbError(asA((tx) => tx.query("update execution_results set value = 1 where id = $1", [id])), /permission denied/);
    await expectDbError(db.query("update execution_results set value = 1 where id = $1", [id]), /FROZEN_COLUMN/);
    const au = (await db.query<{ details: unknown }>("select details from audit_events where entity_type in ('execution_result', 'execution_job')")).rows;
    expect(JSON.stringify(au)).not.toMatch(/비밀|표식|tistory\.com/);
  });
  it("기간·단위·비율·모드 검사", async () => {
    await add({ unit: "percent", value: 18.4, num: 23, den: 125 });
    for (const [o, re] of [
      [{ start: "2026-11-19", end: "2026-11-13" }, /시작일이 종료일보다/],
      [{ end: "2999-01-01", start: "2998-12-31" }, /미래/],
      [{ start: "2025-01-01", end: "2026-01-02" }, /366일/],
      [{ unit: "percent", value: 101 }, /수치/],
      [{ value: 1.234 }, /수치/],
      [{ num: 1 }, /분자·분모/],
      [{ note: "" }, /출처/],
      [{ name: "가".repeat(61) }, /지표 이름/],
    ] as const)
      await expectDbError(add(o as Record<string, unknown>), re);
    await expectDbError(
      asA((tx) => tx.query("select add_execution_result(p_project_id => $1, p_execution_job_id => null, p_metric_name => 'x', p_value => 1, p_unit => 'count', p_numerator => null, p_denominator => null, p_source_note => 'x', p_period_start => '2026-11-01', p_period_end => '2026-11-02', p_collection_mode => 'readonly_sync')", [a.projectA])),
      /수동 입력만/,
    );
  });
});

describe("권한", () => {
  it("로그인 역할은 두 표에 select 만(쓰기·REFERENCES·TRIGGER 없음), anon 은 아무것도 없음, 남은 0행", async () => {
    for (const t of ["execution_jobs", "execution_results"]) {
      const g = await one<Record<string, boolean>>(
        db,
        `select has_table_privilege('authenticated', 'public.${t}', 'SELECT') as s, has_table_privilege('authenticated', 'public.${t}', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as w,
                has_table_privilege('anon', 'public.${t}', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as anon`,
      );
      expect(g).toEqual({ s: true, w: false, anon: false });
    }
    expect(await asB((tx) => one<{ n: number }>(tx, "select count(*)::int as n from execution_jobs"))).toEqual({ n: 0 });
  });
});
