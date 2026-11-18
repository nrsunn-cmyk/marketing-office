/**
 * SEC-AUDIT-01 회귀 시험(20261117003000_sec_audit_insert_lock):
 * 감사 기록을 쓰던 invoker RPC 4개를 정의자 권한으로 바꾸고 audit_events 직접 INSERT 를 막았다.
 *  - 정상 경로: 4개 RPC 가 예전처럼 동작하고 감사 기록의 행위자 = 본인
 *  - 경계: 다른 업무실 → NOT_FOUND(P0002, 아무것도 안 생김), 로그인 정보 없음 → 42501
 *  - 정의자 전환으로 생길 수 있는 우회: 전략 유형을 P1 RPC 로 저장 → DIRECT_WRITE_FORBIDDEN
 *  - 감사 기록 직접 추가: 본인 이름이어도 거절, service_role 은 허용(관리 작업 유지)
 * 모든 값은 합성이다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { asUser, createDb, createTask, createUser, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "audit-owner-a@example.test");
  b = await seedOwner(db, "audit-owner-b@example.test");
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
}, 60_000); // 병렬 부하에서 PGlite 준비가 10초를 넘을 수 있다(QA-SEC-RELEASE-04 T1)

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const asAuthNoUid = <T>(fn: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
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

const count = async (sql: string, p: unknown[]) => (await one<{ n: number }>(db, `select count(*)::int as n from (${sql}) x`, p)).n;
const status = async (taskId: string) => (await one<{ status: string }>(db, "select status from tasks where id = $1", [taskId])).status;
const gen = (taskId: string, hash = "h-1") =>
  `select * from record_generation('${taskId}', '${newKey()}', '${hash}', '{}', '{}', '[]', '{"brief":"b"}', 'template')`;

async function generated(): Promise<{ taskId: string; artifactId: string; versionId: string }> {
  return asA(async (tx) => {
    const taskId = await createTask(tx, a, a.projectA);
    const r = await one<{ artifact_id: string; version_id: string }>(tx, gen(taskId));
    return { taskId, artifactId: r.artifact_id, versionId: r.version_id };
  });
}

async function strategyTask(f: Fixture): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id",
      [f.workspaceId, f.projectA, strategyTpl, newKey()],
    )
  ).id;
}

describe("정상 경로: 4개 RPC 동작과 감사 기록 행위자", () => {
  it("setup_workspace: 새 업무실·공급자 1번·감사 기록(행위자 = 본인), 다시 부르면 같은 id", async () => {
    const uid = await createUser(db, "audit-new@example.test");
    const ws = await asUser(db, uid, async (tx) => (await one<{ ws: string }>(tx, "select setup_workspace('새 업무실', '합성상호') as ws")).ws);
    const again = await asUser(db, uid, async (tx) => (await one<{ ws: string }>(tx, "select setup_workspace('다른 이름', '다른상호') as ws")).ws);
    expect(again).toBe(ws);
    expect(await count("select 1 from workspaces where owner_user_id = $1", [uid])).toBe(1);
    expect(await count("select 1 from supplier_profiles where workspace_id = $1", [ws])).toBe(1);
    const au = await one<{ actor_id: string }>(db, "select actor_id from audit_events where workspace_id = $1 and action = 'setup'", [ws]);
    expect(au.actor_id).toBe(uid);
  });

  it("setup_workspace: 이미 업무실이 있는 다른 사용자의 id 를 돌려주지 않는다", async () => {
    const ws = await asA(async (tx) => (await one<{ ws: string }>(tx, "select setup_workspace('x', 'y') as ws")).ws);
    expect(ws).toBe(a.workspaceId);
    const wsB = await asB(async (tx) => (await one<{ ws: string }>(tx, "select setup_workspace('x', 'y') as ws")).ws);
    expect(wsB).toBe(b.workspaceId);
  });

  it("record_generation: 버전·작업 review·감사(generate, 행위자·created_by = 본인), 같은 키 재요청은 재사용", async () => {
    const taskId = await asA((tx) => createTask(tx, a, a.projectA));
    const key = newKey();
    const sql = `select * from record_generation($1, $2, 'h', '{}', '{}', '[]', '{"brief":"b"}', 'template')`;
    const r1 = await asA((tx) => one<{ version_id: string; reused: boolean; artifact_id: string }>(tx, sql, [taskId, key]));
    const r2 = await asA((tx) => one<{ version_id: string; reused: boolean }>(tx, sql, [taskId, key]));
    expect(r1.reused).toBe(false);
    expect(r2).toMatchObject({ version_id: r1.version_id, reused: true });
    expect(await status(taskId)).toBe("review");
    const v = await one<{ created_by: string }>(db, "select created_by from artifact_versions where id = $1", [r1.version_id]);
    expect(v.created_by).toBe(a.userId);
    expect(await count("select 1 from audit_events where entity_id = $1 and action = 'generate' and actor_id = $2", [r1.artifact_id, a.userId])).toBe(1);
  });

  it("save_manual_version: 새 버전·감사(edit, 행위자 = 본인), 오래된 revision 은 CONFLICT", async () => {
    const g = await generated();
    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [g.artifactId])).revision;
    const r = await asA((tx) => one<{ version: number }>(tx, "select * from save_manual_version($1, $2, '{\"brief\":\"고침\"}')", [g.artifactId, rev]));
    expect(r.version).toBe(2);
    expect(await count("select 1 from audit_events where entity_id = $1 and action = 'edit' and actor_id = $2", [g.artifactId, a.userId])).toBe(1);
    const c = await codeOf(asA((tx) => tx.query("select * from save_manual_version($1, $2, '{}')", [g.artifactId, rev])));
    expect(c.code).toBe("P0001");
    expect(c.message).toMatch(/CONFLICT/);
  });

  it("save_draft_version: 견적 초안 저장·감사(save_draft, 행위자 = 본인), revision 규칙 유지", async () => {
    const taskId = await asA((tx) => createTask(tx, a, a.projectB, "quote"));
    const r = await asA((tx) =>
      one<{ artifact_id: string; version: number }>(tx, "select * from save_draft_version($1, null, 'h', '{}', '{\"items\":[]}')", [taskId]),
    );
    expect(r.version).toBe(1);
    expect(await status(taskId)).toBe("review");
    expect(await count("select 1 from audit_events where entity_id = $1 and action = 'save_draft' and actor_id = $2", [r.artifact_id, a.userId])).toBe(1);
    // 이미 결과물이 있는데 revision 없이 → CONFLICT
    const c = await codeOf(asA((tx) => tx.query("select * from save_draft_version($1, null, 'h', '{}', '{}')", [taskId])));
    expect(c.code).toBe("P0001");
  });
});

describe("경계: 다른 업무실·로그인 정보 없음", () => {
  it("B 가 A 의 작업·결과물로 부르면 NOT_FOUND(P0002), 아무 행도 생기지 않는다", async () => {
    const g = await generated();
    const quoteTask = await asA((tx) => createTask(tx, a, a.projectB, "quote"));
    const before = await count("select 1 from audit_events where workspace_id = $1", [a.workspaceId]);
    const versionsBefore = await count("select 1 from artifact_versions where workspace_id = $1", [a.workspaceId]);

    for (const sql of [
      gen(g.taskId),
      `select * from save_manual_version('${g.artifactId}', 1, '{}')`,
      `select * from save_draft_version('${quoteTask}', null, 'h', '{}', '{}')`,
    ]) {
      const c = await codeOf(asB((tx) => tx.query(sql)));
      expect(c.code, sql).toBe("P0002");
    }
    expect(await count("select 1 from audit_events where workspace_id = $1", [a.workspaceId])).toBe(before);
    expect(await count("select 1 from artifact_versions where workspace_id = $1", [a.workspaceId])).toBe(versionsBefore);
  });

  it("로그인 역할이지만 로그인 정보(sub)가 없으면 4개 모두 42501", async () => {
    const g = await generated();
    for (const sql of [
      "select setup_workspace('x', 'y')",
      gen(g.taskId),
      `select * from save_manual_version('${g.artifactId}', 1, '{}')`,
      `select * from save_draft_version('${g.taskId}', null, 'h', '{}', '{}')`,
    ]) {
      const c = await codeOf(asAuthNoUid((tx) => tx.query(sql)));
      expect(c.code, sql).toBe("42501");
    }
  });

  it("비로그인(anon)은 4개 모두 실행 권한이 없다", async () => {
    const rows = (
      await db.query<{ name: string; anon: boolean; authed: boolean }>(
        `select p.proname as name,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('setup_workspace','record_generation','save_manual_version','save_draft_version')
          order by 1`,
      )
    ).rows;
    expect(rows).toEqual([
      { name: "record_generation", anon: false, authed: true },
      { name: "save_draft_version", anon: false, authed: true },
      { name: "save_manual_version", anon: false, authed: true },
      { name: "setup_workspace", anon: false, authed: true },
    ]);
  });

  it("4개 함수 모두 search_path 가 빈 값으로 고정되어 있다", async () => {
    const rows = (
      await db.query<{ name: string; cfg: string[] | null }>(
        "select proname as name, proconfig as cfg from pg_proc where pronamespace = 'public'::regnamespace and proname in ('setup_workspace','record_generation','save_manual_version','save_draft_version')",
      )
    ).rows;
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.cfg, r.name).toEqual(['search_path=""']);
  });
});

describe("정의자 전환 뒤에도 전략 유형 우회 저장은 막힌다", () => {
  it("record_generation·save_draft_version 으로 전략 작업 저장 → DIRECT_WRITE_FORBIDDEN, 행 없음", async () => {
    const taskId = await strategyTask(a);
    for (const sql of [gen(taskId), `select * from save_draft_version('${taskId}', null, 'h', '{}', '{}')`]) {
      const c = await codeOf(asA((tx) => tx.query(sql)));
      expect(c.code, sql).toBe("42501");
      expect(c.message).toMatch(/DIRECT_WRITE_FORBIDDEN/);
    }
    expect(await count("select 1 from artifacts where task_id = $1", [taskId])).toBe(0);
    expect(await count("select 1 from task_input_snapshots where task_id = $1", [taskId])).toBe(0);
  });
});

describe("감사 기록 직접 추가 차단", () => {
  it("본인 이름이어도 직접 INSERT 는 42501", async () => {
    const c = await codeOf(
      asA((tx) =>
        tx.query("insert into audit_events (workspace_id, entity_type, entity_id, actor_id, action) values ($1, 'artifact', $1, $2, 'approved')", [
          a.workspaceId,
          a.userId,
        ]),
      ),
    );
    expect(c.code).toBe("42501");
  });

  it("authenticated 의 audit_events 권한은 SELECT 뿐(INSERT 없음), SELECT 정책은 유지", async () => {
    const privs = (
      await db.query<{ p: string }>(
        "select privilege_type as p from information_schema.role_table_grants where table_schema = 'public' and table_name = 'audit_events' and grantee = 'authenticated' and privilege_type in ('SELECT','INSERT') order by 1",
      )
    ).rows.map((r) => r.p);
    expect(privs).toEqual(["SELECT"]);
    expect(await count("select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_events' and cmd = 'SELECT'", [])).toBe(1);
    // 본인 업무실 기록은 계속 읽힌다
    const seen = await asA(async (tx) => (await one<{ n: number }>(tx, "select count(*)::int as n from audit_events")).n);
    expect(seen).toBeGreaterThan(0);
  });

  it("service_role(관리 역할)은 감사 기록을 직접 넣을 수 있다(관리 작업 유지)", async () => {
    await asService((tx) =>
      tx.query("insert into audit_events (workspace_id, entity_type, entity_id, actor_id, action) values ($1, 'workspace', $1, null, 'admin_note')", [
        a.workspaceId,
      ]),
    );
    expect(await count("select 1 from audit_events where workspace_id = $1 and action = 'admin_note'", [a.workspaceId])).toBe(1);
  });
});

describe("SEC-AUDIT-FIX-02 S1: 소유 확인 전에 남의 행을 잠그지 않는다", () => {
  // PGlite 는 연결이 하나라 두 세션 경합은 재현할 수 없다. 함수 본문으로 잠금 방식을 확인하고,
  // 실제 두 세션 시험(B 가 A 의 커밋을 기다리지 않고 바로 P0002)은 Docker 전용 스택에서 한다.
  const src = async (sig: string) =>
    (await one<{ s: string }>(db, "select prosrc as s from pg_proc where oid = $1::regprocedure", [sig])).s.replace(/\s+/g, " ");

  it.each([
    ["public.record_generation(uuid,text,text,jsonb,jsonb,jsonb,jsonb,text)", "public.tasks x where x.id = p_task_id"],
    ["public.save_draft_version(uuid,integer,text,jsonb,jsonb)", "public.tasks x where x.id = p_task_id"],
    ["public.save_manual_version(uuid,integer,jsonb)", "public.artifacts x where x.id = p_artifact_id"],
  ])("%s: 소유 조건이 잠그는 조회의 WHERE 안에 있고 그 표의 행만 잠근다", async (sig, from) => {
    const s = await src(sig);
    expect(s).toContain(`from ${from} and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid) for update of x;`);
    // 예전 방식(id 로만 잠근 뒤 소유 확인)이 남아 있지 않다
    expect(s).not.toMatch(/where id = p_(task|artifact)_id for update;/);
  });

  it("남의 행·없는 행은 같은 P0002 이고, 주인의 정상 경로는 그대로다", async () => {
    const g = await generated();
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const id of [g.artifactId, missing]) {
      const c = await codeOf(asB((tx) => tx.query(`select * from save_manual_version('${id}', 1, '{}')`)));
      expect(c.code).toBe("P0002");
      expect(c.message).toMatch(/^NOT_FOUND/);
    }
    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [g.artifactId])).revision;
    const r = await asA((tx) => one<{ version: number }>(tx, "select * from save_manual_version($1, $2, '{}')", [g.artifactId, rev]));
    expect(r.version).toBe(2);
  });
});

describe("SEC-AUDIT-FIX-02 R-A: 감사 기록 최소 권한, 로그인 역할 TRUNCATE 없음", () => {
  it("authenticated 의 audit_events 권한은 SELECT 뿐(UPDATE·DELETE·TRUNCATE·INSERT 없음)", async () => {
    const r = await one<Record<string, boolean>>(
      db,
      `select has_table_privilege('authenticated', 'public.audit_events', 'SELECT') as sel,
              has_table_privilege('authenticated', 'public.audit_events', 'INSERT') as ins,
              has_table_privilege('authenticated', 'public.audit_events', 'UPDATE') as upd,
              has_table_privilege('authenticated', 'public.audit_events', 'DELETE') as del,
              has_table_privilege('authenticated', 'public.audit_events', 'TRUNCATE') as trn`,
    );
    expect(r).toEqual({ sel: true, ins: false, upd: false, del: false, trn: false });
  });

  it("public 의 어떤 표도 authenticated·anon 이 TRUNCATE 할 수 없다", async () => {
    const rows = (
      await db.query<{ t: string }>(
        `select c.relname as t from pg_class c
          where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
            and (has_table_privilege('authenticated', c.oid, 'TRUNCATE') or has_table_privilege('anon', c.oid, 'TRUNCATE'))`,
      )
    ).rows;
    expect(rows).toEqual([]);
  });

  it("공격: 본인이 감사 기록 TRUNCATE·UPDATE·DELETE → 42501, 행은 그대로", async () => {
    const before = await count("select 1 from audit_events", []);
    expect(before).toBeGreaterThan(0);
    for (const sql of ["truncate audit_events", "update audit_events set action = 'x'", "delete from audit_events"]) {
      const c = await codeOf(asA((tx) => tx.query(sql)));
      expect(c.code, sql).toBe("42501");
    }
    expect(await count("select 1 from audit_events", [])).toBe(before);
  });

  it("다른 추가 전용 표(결과 버전)도 TRUNCATE 는 42501", async () => {
    const c = await codeOf(asA((tx) => tx.query("truncate artifact_versions cascade")));
    expect(c.code).toBe("42501");
  });
});

describe("SEC-AUDIT-FIX-02 R-B: 결과물 유형 = 작업 유형", () => {
  it("공격: 전략 작업에 logo_brief 결과물 직접 INSERT → 23514 TYPE_MISMATCH, 행 없음, 작업 상태 그대로", async () => {
    const taskId = await strategyTask(a);
    const c = await codeOf(
      asA((tx) =>
        tx.query("insert into artifacts (workspace_id, project_id, task_id, type) values ($1, $2, $3, 'logo_brief')", [a.workspaceId, a.projectA, taskId]),
      ),
    );
    expect(c.code).toBe("23514");
    expect(c.message).toMatch(/TYPE_MISMATCH/);
    expect(await count("select 1 from artifacts where task_id = $1", [taskId])).toBe(0);
    expect(await status(taskId)).toBe("draft");
  });

  it("로고 작업에 quote 결과물 직접 INSERT 도 23514", async () => {
    const taskId = await asA((tx) => createTask(tx, a, a.projectA));
    const c = await codeOf(
      asA((tx) => tx.query("insert into artifacts (workspace_id, project_id, task_id, type) values ($1, $2, $3, 'quote')", [a.workspaceId, a.projectA, taskId])),
    );
    expect(c.code).toBe("23514");
  });

  it("유형이 같으면 지금처럼 직접 INSERT 된다(P1 흐름 유지)", async () => {
    const taskId = await asA((tx) => createTask(tx, a, a.projectA));
    await asA((tx) => tx.query("insert into artifacts (workspace_id, project_id, task_id, type) values ($1, $2, $3, 'logo_brief')", [a.workspaceId, a.projectA, taskId]));
    expect(await count("select 1 from artifacts where task_id = $1", [taskId])).toBe(1);
  });

  it("남의 작업을 가리키면 유형을 알려 주지 않고 기존처럼 권한 오류(42501)로 거절", async () => {
    const taskB = await asB((tx) => createTask(tx, b, b.projectA));
    for (const type of ["logo_brief", "quote"]) {
      const c = await codeOf(
        asA((tx) => tx.query("insert into artifacts (workspace_id, project_id, task_id, type) values ($1, $2, $3, $4)", [a.workspaceId, a.projectA, taskB, type])),
      );
      expect(c.message, type).not.toMatch(/TYPE_MISMATCH/);
      expect(c.code).not.toBeNull();
    }
  });

  it("트리거 함수는 로그인 역할이 직접 부를 수 없다", async () => {
    const r = await one<{ authed: boolean; anon: boolean }>(
      db,
      "select has_function_privilege('authenticated', 'app.enforce_artifact_task_type()', 'EXECUTE') as authed, has_function_privilege('anon', 'app.enforce_artifact_task_type()', 'EXECUTE') as anon",
    );
    expect(r).toEqual({ authed: false, anon: false });
  });
});
