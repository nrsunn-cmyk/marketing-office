/**
 * ADMIN-P4-01: 관리자 P4 실행 현황 RPC(20261121009000_admin_p4_execution) 시험.
 * 관리자만, 개수·상태·시각만(초안 사본·게시 주소·성과 출처·업무실 이름·이메일 0바이트), 열람 기록 1행. 모든 값은 합성이다.
 * 실행 건·성과 행은 관리자 권한(슈퍼유저)으로 직접 넣는다 — 상태·원인·시도 횟수 조합을 RPC 경로 없이 정확히 만들기 위해서(실행 RPC 규칙은 p4a-execution.test.ts 가 맡는다).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, expectDbError, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let admin: Fixture;
let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  db = await createDb();
  admin = await seedOwner(db, "p4admin-admin@example.test");
  a = await seedOwner(db, "p4admin-owner-a@example.test");
  b = await seedOwner(db, "p4admin-owner-b@example.test");
  await db.query("insert into app.admins (user_id, note) values ($1, '합성 관리자')", [admin.userId]);
}, 60_000);

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, admin.userId, fn);
type Row = Record<string, unknown>;
const p4 = (tx: Tx, limit = 200) => tx.query<Row>("select * from admin_p4_execution($1)", [limit]).then((r) => r.rows);

const SECRET = "비밀본문-XYZ";
const SECRET_URL = "https://secret-zz.tistory.com/77";

/** 실행 건 하나(직접 삽입). 외래 키(원본 초안·게시 기록)는 이 시험의 대상이 아니라 잠시 끈다 */
async function job(f: Fixture, o: { status: string; block?: string; attempts?: number; published?: boolean; projectId?: string; updatedAt?: string }) {
  const id = randomUUID();
  await db.exec("set session_replication_role = replica");
  try {
    await db.query(
      `insert into execution_jobs (id, workspace_id, project_id, source_kind, source_id, source_revision, source_hash, payload, channel, idempotency_key,
                                   status, held_from, block_reason, attempt_count, executed_at, publication_id, external_url, created_by, updated_at)
       values ($1, $2, $3, 'channel_draft', $4, 1, $5, $6::jsonb, 'tistory_manual', $7, $8, $9, $10, $11, $12, $13, $14, $15, coalesce($16::timestamptz, now()))`,
      [
        id, f.workspaceId, o.projectId ?? f.projectA, randomUUID(), "a".repeat(64), JSON.stringify({ title: SECRET, body: SECRET }), `exec-${id}`,
        o.status, o.status === "held" ? "queued" : null, o.status === "blocked_mismatch" ? (o.block ?? "content_changed") : null, o.attempts ?? 0,
        o.status === "succeeded" ? new Date().toISOString() : null, o.published ? randomUUID() : null, o.published ? SECRET_URL : null, f.userId, o.updatedAt ?? null,
      ],
    );
  } finally {
    await db.exec("set session_replication_role = origin");
  }
  return id;
}
async function result(f: Fixture, o: { voided?: boolean; projectId?: string } = {}) {
  await db.query(
    `insert into execution_results (workspace_id, project_id, metric_name, value, unit, source_note, period_start, period_end, collection_mode, status, void_reason, voided_at, created_by)
     values ($1, $2, '비밀지표', 12, 'count', $3, date '2026-11-01', date '2026-11-07', 'manual_entry', $4, $5, $6, $7)`,
    [f.workspaceId, o.projectId ?? f.projectA, `출처 ${SECRET}`, o.voided ? "voided" : "active", o.voided ? `취소 ${SECRET}` : null, o.voided ? new Date().toISOString() : null, f.userId],
  );
}

const COLS = [
  "workspace_id", "project_id",
  "jobs_pending_approval", "jobs_blocked_mismatch", "jobs_queued", "jobs_running", "jobs_succeeded", "jobs_failed", "jobs_held",
  "blocked_content_changed", "blocked_source_archived", "blocked_not_reviewed",
  "retry_exhausted", "tistory_published", "results_active", "last_activity_at",
];

describe("admin_p4_execution", () => {
  it("관리자 아니면 FORBIDDEN, 익명은 권한 없음, 개수 범위 밖은 VALIDATION, P4 를 시작하지 않은 업무실은 나오지 않음", async () => {
    await expectDbError(asA((tx) => p4(tx)), /FORBIDDEN: 관리자만/);
    await expectDbError(asUser(db, null, (tx) => p4(tx)), /permission denied/);
    await expectDbError(asAdmin((tx) => p4(tx, 0)), /VALIDATION/);
    await expectDbError(asAdmin((tx) => p4(tx, 501)), /VALIDATION/);
    expect(await asAdmin((tx) => p4(tx))).toEqual([]);
  });

  it("상태 7종·막힘 원인 3종·재시도 소진·티스토리 게시·성과 입력 개수, 본문·주소·출처·이름·이메일 0바이트, 열람 기록 1행", async () => {
    for (const s of ["pending_approval", "queued", "running", "held"]) await job(a, { status: s });
    await job(a, { status: "blocked_mismatch", block: "content_changed" });
    await job(a, { status: "blocked_mismatch", block: "content_changed" });
    await job(a, { status: "blocked_mismatch", block: "source_archived" });
    await job(a, { status: "blocked_mismatch", block: "not_reviewed", attempts: 1 });
    await job(a, { status: "succeeded", published: true });
    await job(a, { status: "succeeded", published: true, attempts: 2 });
    await job(a, { status: "succeeded" }); // 게시 기록 없이 끝난 건(예: 나중 채널) — 게시 수에 들지 않는다
    await job(a, { status: "failed", attempts: 3 });
    await job(a, { status: "failed", attempts: 1 });
    await result(a);
    await result(a);
    await result(a, { voided: true }); // 취소된 성과는 세지 않는다

    const log0 = (await one<{ n: number }>(db, "select count(*)::int as n from admin_access_log where rpc = 'admin_p4_execution'")).n;
    const rows = await asAdmin((tx) => p4(tx));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspace_id: a.workspaceId, project_id: a.projectA,
      jobs_pending_approval: 1, jobs_blocked_mismatch: 4, jobs_queued: 1, jobs_running: 1, jobs_succeeded: 3, jobs_failed: 2, jobs_held: 1,
      blocked_content_changed: 2, blocked_source_archived: 1, blocked_not_reviewed: 1,
      retry_exhausted: 1, tistory_published: 2, results_active: 2,
    });
    expect(rows[0].last_activity_at).not.toBeNull();
    // 돌려주는 칸은 정해진 것뿐: 업무실 이름·주인 이메일·프로젝트 이름 칸이 없다
    expect(Object.keys(rows[0]).sort()).toEqual([...COLS].sort());
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/비밀|secret-zz|tistory\.com|example\.test|합성|@/);
    expect((await one<{ n: number }>(db, "select count(*)::int as n from admin_access_log where rpc = 'admin_p4_execution'")).n).toBe(log0 + 1);
    // 열람 기록에도 본문·주소가 없다(조건은 개수 한도뿐)
    const log = await one<{ params: unknown; row_count: number }>(db, "select params, row_count from admin_access_log where rpc = 'admin_p4_execution' order by seq desc limit 1");
    expect(log).toEqual({ params: { limit: 200 }, row_count: 1 });
  });

  it("성과만 있는 프로젝트도 나온다, 최근 활동 순서, 개수 한도", async () => {
    await result(b, { projectId: b.projectB });
    await job(b, { status: "queued", updatedAt: "2020-01-01T00:00:00Z" });
    const rows = await asAdmin((tx) => p4(tx));
    const bRows = rows.filter((r) => r.workspace_id === b.workspaceId);
    expect(bRows.map((r) => [r.project_id, r.jobs_queued, r.results_active])).toEqual([
      [b.projectB, 0, 1], // 성과 입력(지금) 이 최근이라 먼저
      [b.projectA, 1, 0],
    ]);
    // 전체 순서 = 최근 활동 내림차순
    const times = rows.map((r) => new Date(String(r.last_activity_at)).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    expect(await asAdmin((tx) => p4(tx, 1))).toHaveLength(1);
  });

  it("정의자 설정: search_path 고정, public·anon 실행 불가, 로그인만", async () => {
    const r = await one<{ prosecdef: boolean; cfg: string; anon: boolean; auth: boolean }>(
      db,
      "select p.prosecdef, array_to_string(p.proconfig, ',') as cfg, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth from pg_proc p where p.proname = 'admin_p4_execution'",
    );
    expect(r).toEqual({ prosecdef: true, cfg: 'search_path=""', anon: false, auth: true });
  });
});
