/**
 * ADMIN-IMPL-01: 관리자 읽기 전용(20261119003000_admin_readonly) 시험. 모든 값은 합성이다.
 * 설계: Plan/Claude-Backend-20261118/ADMIN-DESIGN-01.md 6절.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, createUser, expectDbError, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture; // 관리자
let b: Fixture; // 일반 사용자
let loner: string; // 업무실 없는 가입자

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "admin-a@example.test");
  b = await seedOwner(db, "user-b@example.test");
  loner = await createUser(db, "loner@example.test");
  await db.query("update auth.users set email_confirmed_at = now(), last_sign_in_at = now() - interval '1 hour' where id = $1", [a.userId]);
  await db.query("update auth.users set created_at = now() - interval '2 days' where id = $1", [a.userId]);
  await db.query("update auth.users set created_at = now() - interval '1 days' where id = $1", [b.userId]);
  await db.query("insert into app.admins (user_id, note) values ($1, '합성 관리자')", [a.userId]);
}, 60_000);

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const asAnon = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn);
const logCount = async () => (await one<{ n: number }>(db, "select count(*)::int as n from admin_access_log")).n;
const lastLog = () => one<{ admin_id: string; rpc: string; params: Record<string, unknown>; row_count: number }>(db, "select admin_id, rpc, params, row_count from admin_access_log order by seq desc limit 1");
const KST_TODAY = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());

describe("관리자 판별·거절", () => {
  it("whoami: 관리자 true, 일반 사용자 false(기록 없음), 익명은 실행 권한 없음", async () => {
    const before = await logCount();
    expect((await asA((tx) => one<{ r: boolean }>(tx, "select admin_whoami() as r"))).r).toBe(true);
    expect((await asB((tx) => one<{ r: boolean }>(tx, "select admin_whoami() as r"))).r).toBe(false);
    await expectDbError(asAnon((tx) => tx.query("select admin_whoami()")), /permission denied/);
    expect(await logCount()).toBe(before);
  });

  it("일반 사용자: 관리자 RPC 4개 모두 FORBIDDEN(42501), 열람 기록 0, 명단·기록 직접 접근 불가", async () => {
    const before = await logCount();
    const today = KST_TODAY();
    for (const sql of [
      "select * from admin_list_accounts()",
      "select * from admin_list_pending_allowlist()",
      `select * from admin_usage_summary('${today}', '${today}')`,
      "select * from admin_list_audit()",
    ]) await expectDbError(asB((tx) => tx.query(sql)), /FORBIDDEN: 관리자만 볼 수 있습니다/);
    expect(await logCount()).toBe(before);
    await expectDbError(asB((tx) => tx.query("select * from app.admins")), /permission denied/);
    await expectDbError(asA((tx) => tx.query("select * from app.admins")), /permission denied/);
    await expectDbError(asB((tx) => tx.query("select app.is_admin()")), /permission denied/);
    await expectDbError(asB((tx) => tx.query("select app.admin_log($1, 'x', '{}', 0)", [b.userId])), /permission denied/);
    await expectDbError(asAnon((tx) => tx.query("select * from admin_list_accounts()")), /permission denied/);
  });

  it("관리자도 기존 표는 RLS 그대로: 남의 업무실 고객·프로젝트를 직접 읽으면 0행", async () => {
    expect(await asA((tx) => tx.query("select 1 from clients where workspace_id = $1", [b.workspaceId]).then((r) => r.rows.length))).toBe(0);
    expect(await asA((tx) => tx.query("select 1 from projects where workspace_id = $1", [b.workspaceId]).then((r) => r.rows.length))).toBe(0);
    expect(await asA((tx) => tx.query("select 1 from audit_events where workspace_id = $1", [b.workspaceId]).then((r) => r.rows.length))).toBe(0);
  });
});

describe("가입자·업무실 목록", () => {
  it("최신 가입 순, 업무실·개수·확인 여부·허용 목록, 업무실 없는 가입자도 표시, 열람 기록 1행", async () => {
    const rows = (await asA((tx) => tx.query<Record<string, unknown>>("select * from admin_list_accounts(10)"))).rows;
    const ours = rows.filter((r) => [a.userId, b.userId, loner].includes(r.user_id as string));
    expect(ours.map((r) => r.user_id)).toEqual([loner, b.userId, a.userId]);
    const ra = ours.find((r) => r.user_id === a.userId)!;
    expect(ra).toMatchObject({ email: "admin-a@example.test", email_confirmed: true, workspace_id: a.workspaceId, workspace_name: "내 업무실", clients: 2, projects: 2, tasks: 0, allowlisted: true });
    expect(ra.last_sign_in_at).not.toBeNull();
    expect(ours.find((r) => r.user_id === loner)).toMatchObject({ workspace_id: null, clients: 0, email_confirmed: false });
    expect(Object.keys(ra).sort()).toEqual(["allowlisted", "clients", "email", "email_confirmed", "last_sign_in_at", "projects", "signed_up_at", "tasks", "user_id", "workspace_created_at", "workspace_id", "workspace_name"]);
    expect(await lastLog()).toEqual({ admin_id: a.userId, rpc: "admin_list_accounts", params: { limit: 10, before_id: null, before_created: null }, row_count: rows.length });
  });

  it("커서로 다음 쪽, limit 은 1~200 으로 자른다", async () => {
    const first = (await asA((tx) => tx.query<{ user_id: string; signed_up_at: string }>("select user_id, signed_up_at from admin_list_accounts(1)"))).rows;
    expect(first).toHaveLength(1);
    const next = (await asA((tx) => tx.query<{ user_id: string }>("select user_id from admin_list_accounts(1, $1, $2)", [first[0].signed_up_at, first[0].user_id]))).rows;
    expect(next).toHaveLength(1);
    expect(next[0].user_id).not.toBe(first[0].user_id);
    await asA((tx) => tx.query("select * from admin_list_accounts(100000)"));
    expect((await lastLog()).params.limit).toBe(200);
    await asA((tx) => tx.query("select * from admin_list_accounts(-5)"));
    expect((await lastLog()).params.limit).toBe(1);
  });

  it("허용 목록에만 있고 아직 가입하지 않은 이메일", async () => {
    await db.query("insert into signup_allowlist (email, note) values ('pending@example.test', '합성 초대') on conflict do nothing");
    const rows = (await asA((tx) => tx.query<{ email: string; note: string | null }>("select * from admin_list_pending_allowlist()"))).rows;
    expect(rows.map((r) => r.email)).toContain("pending@example.test");
    expect(rows.map((r) => r.email)).not.toContain("admin-a@example.test");
    expect(rows.find((r) => r.email === "pending@example.test")!.note).toBe("합성 초대");
    expect(await lastLog()).toMatchObject({ rpc: "admin_list_pending_allowlist", row_count: rows.length });
  });
});

describe("이용 현황", () => {
  it("업무실별 개수·용량(한국 날짜 기간), 기간 검사, 업무 내용 열 없음", async () => {
    await asUser(db, b.userId, (tx) =>
      tx.query("insert into source_assets (workspace_id, project_id, kind, url, bytes) values ($1, $2, 'url', 'https://example.com/u', 1234)", [b.workspaceId, b.projectA]),
    );
    const today = KST_TODAY();
    const rows = (await asA((tx) => tx.query<Record<string, unknown>>("select * from admin_usage_summary($1, $1)", [today]))).rows;
    const rb = rows.find((r) => r.workspace_id === b.workspaceId)!;
    expect(rb).toMatchObject({ workspace_name: "내 업무실", owner_email: "user-b@example.test", assets_added: 1, ai_runs: 0, briefs_created: 0 });
    expect(Number(rb.asset_bytes)).toBe(1234);
    expect(Number(rb.ai_cost_usd_micro)).toBe(0);
    expect(Object.keys(rb).sort()).toEqual(["ai_cost_usd_micro", "ai_runs", "artifact_versions_created", "asset_bytes", "assets_added", "briefs_created", "last_activity_at", "owner_email", "tasks_created", "workspace_id", "workspace_name"]);
    // 어제 하루만이면 오늘 올린 자료는 세지 않는다
    const y = new Date(Date.now() - 864e5);
    const yesterday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(y);
    const ry = (await asA((tx) => tx.query<Record<string, unknown>>("select * from admin_usage_summary($1, $1)", [yesterday]))).rows.find((r) => r.workspace_id === b.workspaceId)!;
    expect(ry.assets_added).toBe(0);
    expect(await lastLog()).toMatchObject({ rpc: "admin_usage_summary", params: { from: yesterday, to: yesterday } });
    await expectDbError(asA((tx) => tx.query("select * from admin_usage_summary('2026-11-19', '2026-11-18')")), /기간은 시작일/);
    await expectDbError(asA((tx) => tx.query("select * from admin_usage_summary('2025-01-01', '2026-11-19')")), /최대 366일/);
  });
});

describe("감사 기록 조회", () => {
  it("조건·커서·limit, details 안 문자열 200자에서 자름(구조 유지)", async () => {
    const long = "가".repeat(250);
    for (const [ws, action] of [[a.workspaceId, "x_test_a"], [b.workspaceId, "x_test_b"], [b.workspaceId, "x_test_b"]] as const)
      await db.query(
        "insert into audit_events (workspace_id, entity_type, entity_id, actor_id, action, details) values ($1, 'synthetic', gen_random_uuid(), null, $2, $3)",
        [ws, action, JSON.stringify({ text: long, n: 3, nested: { arr: [long, "짧음"] }, ok: true })],
      );
    const rows = (await asA((tx) => tx.query<{ seq: string; action: string; workspace_id: string; details: Record<string, unknown> }>("select * from admin_list_audit($1, 'x_test_b')", [b.workspaceId]))).rows;
    expect(rows.map((r) => r.action)).toEqual(["x_test_b", "x_test_b"]);
    expect(Number(rows[0].seq)).toBeGreaterThan(Number(rows[1].seq));
    const d = rows[0].details as { text: string; n: number; nested: { arr: string[] }; ok: boolean };
    expect(d.text).toBe("가".repeat(200) + "…");
    expect(d.nested.arr).toEqual(["가".repeat(200) + "…", "짧음"]);
    expect(d.n).toBe(3);
    expect(d.ok).toBe(true);
    const page2 = (await asA((tx) => tx.query<{ seq: string }>("select seq from admin_list_audit($1, 'x_test_b', null, null, 1, $2)", [b.workspaceId, rows[0].seq]))).rows;
    expect(page2.map((r) => r.seq)).toEqual([rows[1].seq]);
    expect(await lastLog()).toMatchObject({ rpc: "admin_list_audit", row_count: 1, params: { workspace_id: b.workspaceId, action: "x_test_b", limit: 1 } });
    // 원본 감사 행은 그대로(자른 것은 결과뿐)
    expect((await one<{ len: number }>(db, "select length(details ->> 'text')::int as len from audit_events where action = 'x_test_a'")).len).toBe(250);
  });
});

describe("열람 기록 보호·회수", () => {
  it("추가만: 관리자도 수정·삭제 권한 없음, 소유자도 트리거로 거절. 본인 기록만 조회", async () => {
    await expectDbError(asA((tx) => tx.query("update admin_access_log set row_count = 0")), /permission denied/);
    await expectDbError(asA((tx) => tx.query("delete from admin_access_log")), /permission denied/);
    await expectDbError(asA((tx) => tx.query("insert into admin_access_log (admin_id, rpc, row_count) values ($1, 'x', 0)", [a.userId])), /permission denied/);
    await expectDbError(db.query("update admin_access_log set row_count = 0"), /IMMUTABLE_ROW/);
    await expectDbError(db.query("delete from admin_access_log"), /IMMUTABLE_ROW/);
    await expectDbError(db.query("truncate admin_access_log"), /IMMUTABLE_ROW/);
    expect(await asA((tx) => tx.query("select 1 from admin_access_log").then((r) => r.rows.length))).toBe(await logCount());
    expect(await asB((tx) => tx.query("select 1 from admin_access_log").then((r) => r.rows.length))).toBe(0);
  });

  it("명단에서 빼면 다음 호출부터 바로 FORBIDDEN, 다시 넣으면 다시 허용", async () => {
    await db.query("delete from app.admins where user_id = $1", [a.userId]);
    await expectDbError(asA((tx) => tx.query("select * from admin_list_audit()")), /FORBIDDEN/);
    expect((await asA((tx) => one<{ r: boolean }>(tx, "select admin_whoami() as r"))).r).toBe(false);
    await db.query("insert into app.admins (user_id) values ($1)", [a.userId]);
    await asA((tx) => tx.query("select * from admin_list_audit(null, null, null, null, 1)"));
  });

  it("정의자 함수 5개: search_path 고정, authenticated 만 실행", async () => {
    const fns = (await db.query<{ name: string; secdef: boolean; cfg: string[]; anon: boolean; auth: boolean }>(
      `select p.proname as name, p.prosecdef as secdef, p.proconfig as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\\_%' order by 1`,
    )).rows;
    // admin_p4_execution 은 ADMIN-P4-01(migration 20261121009000)에서 더했다(묶음에서 admin_p3_progress 와 합쳐지면 둘 다 들어간다)
    expect(fns.map((f) => f.name)).toEqual(["admin_list_accounts", "admin_list_audit", "admin_list_pending_allowlist", "admin_p4_execution", "admin_usage_summary", "admin_whoami"]);
    for (const f of fns) expect(f).toEqual({ name: f.name, secdef: true, cfg: ['search_path=""'], anon: false, auth: true });
    // app 보조 함수 5개(트리거 함수 포함)는 로그인·익명·public 모두 실행 불가
    const helpers = (await db.query<{ name: string; anon: boolean; auth: boolean }>(
      `select p.proname as name, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('is_admin', 'assert_admin', 'admin_log', 'admin_log_immutable', 'jsonb_truncate_strings') order by 1`,
    )).rows;
    expect(helpers).toHaveLength(5);
    for (const h of helpers) expect(h).toEqual({ name: h.name, anon: false, auth: false });
  });
});
