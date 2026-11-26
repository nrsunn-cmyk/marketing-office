import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft } from "@/domain/strategy";
import { asUser, createDb, expectDbError, newKey, one, seedOwner, type Db, type Fixture } from "./harness";

/**
 * P4-SCHEDULE-RUNNER-01 예약 실행기(20261124008000_p4_schedule_runner).
 * 예약 시각이 지나면 예약 행만 'due'(실행할 차례)·'paused_version_changed'(자동 보류)·'executed'·'cancelled' 로 바꾼다.
 * 실행 건·외부 호출은 건드리지 않는다.
 */
let db: Db;
let strategyTpl: string;

beforeAll(async () => {
  db = await createDb();
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
}, 60_000);

// p4b-external-channels.test.ts 와 같은 준비(검토 완료 티스토리 초안 하나)
async function setupReviewedDraft(email: string): Promise<{ owner: Fixture; projectId: string; draftId: string }> {
  const owner = await seedOwner(db, email);
  await asUser(db, owner.userId, (tx) =>
    tx.query(
      "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
      [owner.profileA1],
    ),
  );
  const draftId = await asUser(db, owner.userId, async (tx) => {
    const taskId = (
      await one<{ id: string }>(
        tx,
        "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id",
        [owner.workspaceId, owner.projectA, strategyTpl, newKey()],
      )
    ).id;
    const input = {
      templateVersion: STRATEGY_TEMPLATE_VERSION,
      projectId: owner.projectA,
      profile: { id: owner.profileA1, version: 1, projectId: owner.projectA, clientId: owner.clientA, projectKind: "client" as const },
      sections: {
        goals: { facts: [{ text: "합성 목표", sources: [{ kind: "profile" as const, profileId: owner.profileA1, version: 1 }] }], inferences: [] },
        offers: { facts: [], inferences: [{ text: "합성 제안" }] },
      },
      unknowns: [],
    };
    const d = buildStrategyDraft(input);
    if (!d.ok) throw new Error(JSON.stringify(d.issues));
    const g = await one<{ artifact_id: string; version_id: string }>(
      tx,
      "select * from generate_strategy($1, $2, $3, $4, $5)",
      [taskId, newKey(), owner.profileA1, JSON.stringify(input), JSON.stringify(d.result)],
    );
    await tx.query("select decide_version($1, $2, 'approved', null)", [g.artifact_id, g.version_id]);
    const fn = await one<{ funnel_id: string }>(tx, "select * from create_funnel($1)", [g.artifact_id]);
    const stage = (
      await one<{ id: string }>(tx, "select id from funnel_stages where funnel_id = $1 order by position offset 1 limit 1", [
        fn.funnel_id,
      ])
    ).id;
    const item = (await one<{ id: string }>(tx, "select add_funnel_item($1, 'content', '합성 카드', null, null, 'planned', null, null) as id", [stage])).id;
    const spec = JSON.stringify({ titleIdeas: ["후보 제목"], outline: ["왜 지금인가"], keywords: ["마케팅"] });
    const br = await one<{ brief_id: string }>(
      tx,
      "select * from create_content_brief($1, $2, $3, $4, $5, $6, $7)",
      [item, "blog", "합성 블로그 브리프", "합성 타깃", "핵심 요지 ".repeat(30), "무료 진단 신청", spec],
    );
    await tx.query("select add_brief_claim($1, '주장 하나', 'capability')", [br.brief_id]);
    await tx.query(
      "select update_content_brief($1, 1, '합성 블로그 브리프', '타깃', '훅 문장', '핵심 요지', 'CTA 문장', $2, null, 'manual', null, 'ready')",
      [br.brief_id, spec],
    );
    const id = (await one<{ id: string }>(tx, "select create_channel_draft($1) as id", [br.brief_id])).id;
    await tx.query("select update_channel_draft($1, 1, '외부 연동 제목', '외부 연동 본문', '[\"마케팅\"]', null, null, 'reviewed')", [id]);
    return id;
  });
  return { owner, projectId: owner.projectA, draftId };
}

type Sched = { status: string; due_at: string | null; job_source_hash: string | null };
const sched = (id: string) => one<Sched>(db, "select status, due_at::text, job_source_hash from public.execution_schedules where id = $1", [id]);
const jobRow = (id: string) =>
  one<{ status: string; revision: number; updated_at: string; source_hash: string }>(
    db,
    "select status, revision, updated_at::text, source_hash from public.execution_jobs where id = $1",
    [id],
  );

async function newJob(email: string) {
  const { owner, projectId, draftId } = await setupReviewedDraft(email);
  const jobId = await asUser(db, owner.userId, async (tx) =>
    (await one<{ id: string }>(tx, "select public.enqueue_execution($1, 'channel_draft', $2, 'tistory_manual') as id", [projectId, draftId])).id,
  );
  return { owner, projectId, draftId, jobId };
}
const schedule = (owner: Fixture, jobId: string, at: string) =>
  asUser(db, owner.userId, async (tx) => (await one<{ id: string }>(tx, "select public.schedule_execution($1, $2::timestamptz) as id", [jobId, at])).id);
const refresh = (owner: Fixture) =>
  asUser(db, owner.userId, async (tx) => (await one<{ n: number }>(tx, "select public.refresh_due_execution_schedules() as n")).n);
const cancel = (owner: Fixture, id: string) => asUser(db, owner.userId, (tx) => tx.query("select public.cancel_execution_schedule($1)", [id]));
const approve = (owner: Fixture, jobId: string) => asUser(db, owner.userId, (tx) => tx.query("select public.approve_execution($1, 1)", [jobId]));
const recordPosted = async (owner: Fixture, jobId: string, url: string) => {
  const rev = (await jobRow(jobId)).revision;
  await asUser(db, owner.userId, (tx) =>
    tx.query("select public.record_tistory_execution($1, $2, $3, now() - interval '1 minute', null)", [jobId, rev, url]),
  );
};
const PAST = "2026-01-01T00:00:00+09:00";
const FUTURE = "2099-01-01T00:00:00+09:00";

describe("P4 예약 실행기 (20261124008000_p4_schedule_runner)", () => {
  it("권한: 실행기 본체는 브라우저 역할이 못 부르고, 본인 업무실 따라잡기만 authenticated 에 열린다", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await one<{ runner: boolean; next: boolean }>(
        db,
        `select has_function_privilege($1, 'app.run_due_execution_schedules(uuid)', 'EXECUTE') as runner,
                has_function_privilege($1, 'app.schedule_next_status(public.execution_schedules, public.execution_jobs, timestamptz)', 'EXECUTE') as next`,
        [role],
      );
      expect(r).toEqual({ runner: false, next: false });
    }
    const pub = await one<{ anon: boolean; auth: boolean }>(
      db,
      `select has_function_privilege('anon', 'public.refresh_due_execution_schedules()', 'EXECUTE') as anon,
              has_function_privilege('authenticated', 'public.refresh_due_execution_schedules()', 'EXECUTE') as auth`,
    );
    expect(pub).toEqual({ anon: false, auth: true });
    const def = await one<{ secdef: boolean; cfg: string[] }>(
      db,
      "select prosecdef as secdef, proconfig as cfg from pg_proc where oid = 'app.run_due_execution_schedules(uuid)'::regprocedure",
    );
    expect(def.secdef).toBe(true);
    expect(def.cfg.join(",")).toMatch(/^search_path=("")?$/);
  });

  it("예약 함수는 007000 의 R3 누적 한도·잠금을 그대로 갖고, 예약 때 지문을 남긴다", async () => {
    const def = (await one<{ d: string }>(db, "select pg_get_functiondef('public.schedule_execution(uuid, timestamptz)'::regprocedure) as d")).d;
    expect(def).toContain("app.p4_r3_limit('schedules_per_job')");
    expect(def).toContain("for update");
    expect(def).toContain("'due'");
    const { owner, jobId } = await newJob("runner-hash@example.test");
    const id = await schedule(owner, jobId, FUTURE);
    expect((await sched(id)).job_source_hash).toBe((await jobRow(jobId)).source_hash);
  });

  it("미래 예약은 그대로, 시각이 지난 예약은 '실행할 차례'(due)가 되고 실행 건은 바꾸지 않는다", async () => {
    const { owner, jobId } = await newJob("runner-due@example.test");
    const future = await schedule(owner, jobId, FUTURE);
    expect(await refresh(owner)).toBe(0);
    expect((await sched(future)).status).toBe("scheduled");
    await cancel(owner, future);

    const before = await jobRow(jobId);
    const past = await schedule(owner, jobId, PAST);
    expect(await refresh(owner)).toBe(1);
    const s = await sched(past);
    expect(s.status).toBe("due");
    expect(s.due_at).not.toBeNull();
    expect(await jobRow(jobId)).toEqual(before); // 실행 건(상태·revision·시각·지문)은 그대로
    expect(await refresh(owner)).toBe(0); // 다시 돌려도 바뀌는 것 없음
  });

  it("예약 뒤 승인(상태만 바뀜)은 보류 사유가 아니다 — 지문 기준", async () => {
    const { owner, jobId } = await newJob("runner-approve@example.test");
    const id = await schedule(owner, jobId, PAST);
    await approve(owner, jobId);
    expect((await jobRow(jobId)).status).toBe("queued");
    await refresh(owner);
    expect((await sched(id)).status).toBe("due");
  });

  it("예약 뒤 원본 초안 내용이 바뀌면 자동 보류되고, 보류는 다음 주기에도 유지된다", async () => {
    const { owner, draftId, jobId } = await newJob("runner-paused@example.test");
    const id = await schedule(owner, jobId, PAST);
    await asUser(db, owner.userId, (tx) =>
      tx.query("select update_channel_draft($1, 2, '바뀐 제목', '바뀐 본문', '[\"마케팅\"]', null, null, 'reviewed')", [draftId]),
    );
    expect(await refresh(owner)).toBe(1);
    expect((await sched(id)).status).toBe("paused_version_changed");
    expect(await refresh(owner)).toBe(0);
    expect((await sched(id)).status).toBe("paused_version_changed");
    // 보류도 열린 예약이라 새 예약은 거절, 취소하면 닫힌다
    await expectDbError(schedule(owner, jobId, FUTURE), /이미 예약이 있습니다/);
    await cancel(owner, id);
    expect((await sched(id)).status).toBe("cancelled");
  });

  it("'실행할 차례'는 열린 예약: 새 예약은 거절, 취소는 된다. 실행 건이 끝나면 '실행 완료'로 닫힌다", async () => {
    const { owner, jobId } = await newJob("runner-exec@example.test");
    const first = await schedule(owner, jobId, PAST);
    await refresh(owner);
    expect((await sched(first)).status).toBe("due");
    await expectDbError(schedule(owner, jobId, FUTURE), /이미 예약이 있습니다/);
    await cancel(owner, first);
    expect((await sched(first)).status).toBe("cancelled");

    const second = await schedule(owner, jobId, PAST);
    await refresh(owner);
    expect((await sched(second)).status).toBe("due");
    await approve(owner, jobId);
    await recordPosted(owner, jobId, "https://runner-exec.tistory.com/1");
    expect((await jobRow(jobId)).status).toBe("succeeded");
    expect(await refresh(owner)).toBe(1);
    expect((await sched(second)).status).toBe("executed");
  });

  it("예약 시각 전에 직접 실행해 끝나면, 시각을 기다리지 않고 '실행 완료'로 닫힌다", async () => {
    const { owner, jobId } = await newJob("runner-early@example.test");
    const id = await schedule(owner, jobId, FUTURE);
    await approve(owner, jobId);
    await recordPosted(owner, jobId, "https://runner-early.tistory.com/1");
    await refresh(owner);
    expect((await sched(id)).status).toBe("executed");
  });

  it("따라잡기는 본인 업무실만, 크론용 전체 실행은 모두 처리한다", async () => {
    const a = await newJob("runner-ws-a@example.test");
    const b = await newJob("runner-ws-b@example.test");
    const sa = await schedule(a.owner, a.jobId, PAST);
    const sb = await schedule(b.owner, b.jobId, PAST);
    await refresh(b.owner);
    expect((await sched(sa)).status).toBe("scheduled");
    expect((await sched(sb)).status).toBe("due");
    await db.query("select app.run_due_execution_schedules()"); // 크론과 같은 소유자 권한 전체 실행
    expect((await sched(sa)).status).toBe("due");
  });

  it("pg_cron 이 없는 DB(PGlite)에서는 아무것도 등록하지 않고 migration 이 끝난다", async () => {
    const ext = await one<{ n: number }>(db, "select count(*)::int as n from pg_extension where extname = 'pg_cron'");
    const ns = await one<{ n: number }>(db, "select count(*)::int as n from pg_namespace where nspname = 'cron'");
    expect({ ext: ext.n, ns: ns.n }).toEqual({ ext: 0, ns: 0 });
  });
});
