/**
 * SEC-FIX-01 회귀 시험: 정의자 권한으로 바꾼 decide_version·record_delivery 와 권한·트리거 변경이
 * 정상 경로를 깨지 않고, 경계(다른 업무실·비로그인·로그인 정보 없는 역할)를 지키는지 확인한다.
 * 정상 흐름은 앱과 같은 RPC(record_generation → decide_version → record_delivery)로 만든다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, createTask, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "fix-owner-a@example.test");
  b = await seedOwner(db, "fix-owner-b@example.test");
});

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
/** 로그인 역할(authenticated)이지만 로그인 정보(sub)가 없는 상태 */
const asAuthNoUid = <T>(fn: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
/** 서버 관리 작업 역할(service_role, bypassrls). 로그인 정보 없음 */
const asService = <T>(fn: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return fn(tx);
  });

async function codeOf(p: Promise<unknown>): Promise<{ code: string | null; message: string }> {
  try {
    await p;
    return { code: null, message: "" };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? "?", message: err.message ?? "" };
  }
}

/** 본인이 앱과 같은 RPC로 작업·생성(초안 1개)을 만든다. 작업은 review 로 간다. */
async function generated(): Promise<{ taskId: string; artifactId: string; versionId: string }> {
  return asA(async (tx) => {
    const taskId = await createTask(tx, a, a.projectA);
    const r = await one<{ artifact_id: string; version_id: string }>(
      tx,
      "select * from record_generation($1, $2, 'hash-1', '{}', '{}', '[]', '{\"brief\":\"b\"}', 'template')",
      [taskId, newKey()],
    );
    return { taskId, artifactId: r.artifact_id, versionId: r.version_id };
  });
}

const status = async (taskId: string) => (await one<{ status: string }>(db, "select status from tasks where id = $1", [taskId])).status;
const count = async (sql: string, p: unknown[]) => (await one<{ n: number }>(db, `select count(*)::int as n from (${sql}) x`, p)).n;

describe("decide_version 정상 경로·상태·감사 일관성", () => {
  it("현재 초안 승인 → 승인본 지정, 작업 completed, 승인·감사 기록의 행위자 = 본인", async () => {
    const g = await generated();
    expect(await status(g.taskId)).toBe("review");
    await asA((tx) => tx.query("select decide_version($1, $2, 'approved', '좋아요')", [g.artifactId, g.versionId]));
    const art = await one<{ approved_version_id: string }>(db, "select approved_version_id from artifacts where id = $1", [g.artifactId]);
    expect(art.approved_version_id).toBe(g.versionId);
    expect(await status(g.taskId)).toBe("completed");
    const ap = await one<{ actor_id: string; decision: string }>(db, "select actor_id, decision from approvals where artifact_id = $1", [g.artifactId]);
    expect(ap).toEqual({ actor_id: a.userId, decision: "approved" });
    const au = await one<{ actor_id: string }>(db, "select actor_id from audit_events where entity_id = $1 and action = 'approved'", [g.artifactId]);
    expect(au.actor_id).toBe(a.userId);
  });

  it("수정 요청 → 승인본 없음, 작업 changes_requested → 다시 생성하면 review → 승인", async () => {
    const g = await generated();
    await asA((tx) => tx.query("select decide_version($1, $2, 'changes_requested', '색 변경')", [g.artifactId, g.versionId]));
    expect(await status(g.taskId)).toBe("changes_requested");
    expect((await one<{ v: string | null }>(db, "select approved_version_id as v from artifacts where id = $1", [g.artifactId])).v).toBeNull();
    const v2 = await asA(async (tx) =>
      (await one<{ version_id: string }>(tx, "select * from record_generation($1, $2, 'hash-2', '{}', '{}', '[]', '{\"brief\":\"b2\"}', 'template')", [g.taskId, newKey()])).version_id,
    );
    expect(await status(g.taskId)).toBe("review");
    await asA((tx) => tx.query("select decide_version($1, $2, 'approved')", [g.artifactId, v2]));
    expect(await status(g.taskId)).toBe("completed");
  });

  it("재시도: 같은 버전을 두 번 승인해도 오류 없이 승인본은 그대로, 기록은 결정마다 남는다", async () => {
    const g = await generated();
    await asA((tx) => tx.query("select decide_version($1, $2, 'approved')", [g.artifactId, g.versionId]));
    await asA((tx) => tx.query("select decide_version($1, $2, 'approved')", [g.artifactId, g.versionId]));
    expect(await count("select 1 from approvals where artifact_id = $1", [g.artifactId])).toBe(2);
    expect(await count("select 1 from audit_events where entity_id = $1 and action = 'approved'", [g.artifactId])).toBe(2);
    expect((await one<{ v: string }>(db, "select approved_version_id as v from artifacts where id = $1", [g.artifactId])).v).toBe(g.versionId);
    expect(await status(g.taskId)).toBe("completed");
  });

  it("현재 초안이 아닌 버전은 여전히 CONFLICT(P0001)", async () => {
    const g = await generated();
    const v2 = await asA(async (tx) =>
      (await one<{ version_id: string }>(tx, "select * from record_generation($1, $2, 'hash-3', '{}', '{}', '[]', '{\"brief\":\"x\"}', 'template')", [g.taskId, newKey()])).version_id,
    );
    expect(v2).not.toBe(g.versionId);
    const r = await codeOf(asA((tx) => tx.query("select decide_version($1, $2, 'approved')", [g.artifactId, g.versionId])));
    expect(r.code).toBe("P0001");
    expect(r.message).toMatch(/CONFLICT/);
  });
});

describe("decide_version 경계", () => {
  it("다른 업무실 주인 B → NOT_FOUND(P0002), 기록·포인터 변화 없음", async () => {
    const g = await generated();
    const r = await codeOf(asUser(db, b.userId, (tx) => tx.query("select decide_version($1, $2, 'approved')", [g.artifactId, g.versionId])));
    expect(r.code).toBe("P0002");
    expect(await count("select 1 from approvals where artifact_id = $1", [g.artifactId])).toBe(0);
    expect((await one<{ v: string | null }>(db, "select approved_version_id as v from artifacts where id = $1", [g.artifactId])).v).toBeNull();
    expect(await status(g.taskId)).toBe("review");
  });

  it("비로그인(anon) → 실행 권한 없음(42501)", async () => {
    const g = await generated();
    const r = await codeOf(asUser(db, null, (tx) => tx.query("select decide_version($1, $2, 'approved')", [g.artifactId, g.versionId])));
    expect(r.code).toBe("42501");
    expect(r.message).toMatch(/permission denied for function decide_version/);
  });

  it("로그인 역할이지만 uid 없음 → NOT_AUTHENTICATED(42501)", async () => {
    const g = await generated();
    const r = await codeOf(asAuthNoUid((tx) => tx.query("select decide_version($1, $2, 'approved')", [g.artifactId, g.versionId])));
    expect(r.code).toBe("42501");
    expect(r.message).toMatch(/NOT_AUTHENTICATED/);
  });
});

describe("record_delivery 정상 경로·경계", () => {
  async function approved() {
    const g = await generated();
    await asA((tx) => tx.query("select decide_version($1, $2, 'approved')", [g.artifactId, g.versionId]));
    return g;
  }

  it("승인본이 있으면 같은 프로젝트·승인본으로 기록되고 감사 행위자 = 본인", async () => {
    const g = await approved();
    const id = await asA(async (tx) => (await one<{ id: string }>(tx, "select record_delivery($1, 'email_manual', now(), '메일 보냄') as id", [g.artifactId])).id);
    const d = await one<{ project_id: string; artifact_version_id: string; method: string }>(
      db,
      "select project_id, artifact_version_id, method from delivery_records where id = $1",
      [id],
    );
    expect(d).toEqual({ project_id: a.projectA, artifact_version_id: g.versionId, method: "email_manual" });
    const au = await one<{ actor_id: string }>(db, "select actor_id from audit_events where entity_id = $1 and action = 'delivered_manual'", [g.artifactId]);
    expect(au.actor_id).toBe(a.userId);
  });

  it("승인본 없음 → VALIDATION(22023), 미래 시각 → 22023", async () => {
    const g = await generated();
    expect((await codeOf(asA((tx) => tx.query("select record_delivery($1, 'other', now())", [g.artifactId])))).code).toBe("22023");
    const g2 = await approved();
    expect((await codeOf(asA((tx) => tx.query("select record_delivery($1, 'other', now() + interval '1 day')", [g2.artifactId])))).code).toBe("22023");
  });

  it("다른 업무실 B → P0002, 비로그인 → 42501, uid 없음 → 42501", async () => {
    const g = await approved();
    const sql = "select record_delivery($1, 'other', now())";
    expect((await codeOf(asUser(db, b.userId, (tx) => tx.query(sql, [g.artifactId])))).code).toBe("P0002");
    const anon = await codeOf(asUser(db, null, (tx) => tx.query(sql, [g.artifactId])));
    expect(anon.code).toBe("42501");
    expect(anon.message).toMatch(/permission denied for function record_delivery/);
    const noUid = await codeOf(asAuthNoUid((tx) => tx.query(sql, [g.artifactId])));
    expect(noUid.code).toBe("42501");
    expect(noUid.message).toMatch(/NOT_AUTHENTICATED/);
    expect(await count("select 1 from delivery_records where artifact_version_id = $1", [g.versionId])).toBe(0);
  });
});

describe("열 권한·행위자 트리거·서버 작업 역할", () => {
  it("본인은 current_draft_version_id 는 바꿀 수 있고(invoker RPC 경로) approved_version_id 는 직접 바꿀 수 없다", async () => {
    const g = await generated();
    // 같은 값으로 갱신: 열 권한만 확인
    const ok = await codeOf(asA((tx) => tx.query("update artifacts set current_draft_version_id = $1 where id = $2", [g.versionId, g.artifactId])));
    expect(ok.code).toBeNull();
    const ng = await codeOf(asA((tx) => tx.query("update artifacts set approved_version_id = $1 where id = $2", [g.versionId, g.artifactId])));
    expect(ng.code).toBe("42501");
    expect(ng.message).toMatch(/permission denied for table artifacts/);
  });

  it("uid 없는 로그인 역할의 감사 기록 직접 추가는 NOT_AUTHENTICATED 로 거절", async () => {
    const r = await codeOf(
      asAuthNoUid((tx) => tx.query("insert into audit_events (workspace_id, entity_type, entity_id, actor_id, action) values ($1, 'x', $1, null, 'x')", [a.workspaceId])),
    );
    expect(r.code).toBe("42501");
  });

  it("service_role(bypassrls)은 uid 없이도 승인 기록·승인본 지정이 된다(서버 관리 작업 동작 유지)", async () => {
    const g = await generated();
    await asService(async (tx) => {
      await tx.query(
        "insert into approvals (workspace_id, artifact_id, artifact_version_id, actor_id, decision) values ($1, $2, $3, $4, 'approved')",
        [a.workspaceId, g.artifactId, g.versionId, a.userId],
      );
      await tx.query("update artifacts set approved_version_id = $1 where id = $2", [g.versionId, g.artifactId]);
    });
    expect((await one<{ v: string }>(db, "select approved_version_id as v from artifacts where id = $1", [g.artifactId])).v).toBe(g.versionId);
  });

  it("service_role 도 승인 기록 없이 승인본을 지정할 수는 없다(require_approval 유지)", async () => {
    const g = await generated();
    const r = await codeOf(asService((tx) => tx.query("update artifacts set approved_version_id = $1 where id = $2", [g.versionId, g.artifactId])));
    expect(r.message).toMatch(/APPROVAL_REQUIRED/);
  });
});

describe("함수 속성·정책·권한 (수정 후 상태)", () => {
  it("decide_version·record_delivery 는 정의자 권한 + search_path 빈 값, anon·public 실행 불가, authenticated 실행 가능", async () => {
    for (const fn of ["public.decide_version(uuid,uuid,text,text)", "public.record_delivery(uuid,text,timestamptz,text)"]) {
      const row = await one<{ secdef: boolean; config: string[] | null }>(
        db,
        "select prosecdef as secdef, proconfig as config from pg_proc where oid = $1::regprocedure",
        [fn],
      );
      expect(row.secdef).toBe(true);
      expect(row.config).toContain("search_path=\"\"");
      const priv = await one<{ anon: boolean; authed: boolean; pub: boolean }>(
        db,
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as authed,
                exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                         where p.oid = $1::regprocedure and x.grantee = 0 and x.privilege_type = 'EXECUTE') as pub`,
        [fn],
      );
      expect(priv).toEqual({ anon: false, authed: true, pub: false });
    }
  });

  it("다른 invoker RPC 는 그대로 invoker 다(일괄 전환 없음), finalize_quote 는 기존대로 정의자", async () => {
    const rows = (
      await db.query<{ name: string; secdef: boolean }>(
        "select proname as name, prosecdef as secdef from pg_proc where pronamespace = 'public'::regnamespace and proname in ('record_generation','save_draft_version','save_manual_version','setup_workspace','finalize_quote')",
      )
    ).rows;
    const map = Object.fromEntries(rows.map((r) => [r.name, r.secdef]));
    expect(map).toEqual({ record_generation: false, save_draft_version: false, save_manual_version: false, setup_workspace: false, finalize_quote: true });
  });

  it("insert 정책: approvals·delivery_records 없음, audit_events 는 유지(잔여 위험)", async () => {
    const rows = (
      await db.query<{ tablename: string }>("select tablename from pg_policies where schemaname = 'public' and cmd = 'INSERT' and tablename in ('approvals','delivery_records','audit_events')")
    ).rows.map((r) => r.tablename);
    expect(rows).toEqual(["audit_events"]);
  });

  it("artifacts UPDATE 권한: authenticated 는 current_draft_version_id 열만", async () => {
    const cols = (
      await db.query<{ column_name: string }>(
        "select column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'artifacts' and grantee = 'authenticated' and privilege_type = 'UPDATE' order by 1",
      )
    ).rows.map((r) => r.column_name);
    expect(cols).toEqual(["current_draft_version_id"]);
  });
});
