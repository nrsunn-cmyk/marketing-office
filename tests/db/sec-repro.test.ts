/**
 * SEC-REPRO-01 → SEC-FIX-01: 직접 쓰기 무결성 우회의 재현과 차단 확인.
 *
 * 수정 전(커밋 83e4d60, 마이그레이션 20261116001000 이전)에는 아래 [수정 후 거절] 7가지가 모두 **허용**됐다.
 * 그 재현 근거는 83e4d60 의 이 파일과 Plan/Claude-Plan-Audit-20261116/SEC-REPRO-01.md 에 남아 있다.
 * SEC-FIX-01 이후 같은 시도가 실제로 거절되는지(SQLSTATE·메시지) 확인한다.
 * - [대조] 이름의 시험은 다른 업무실·비로그인·RPC 경로가 거절되는지 확인한다.
 * 공격 동작은 모두 asUser(실제 authenticated/anon 역할, auth.uid() 설정)로만 실행한다.
 * 준비 데이터만 관리자(superuser) 트랜잭션 또는 기존 seedOwner(본인 권한)로 만든다.
 * [잔여위험] 시험은 고치지 않은 남은 위험을 관찰한다(통과 = 아직 허용됨, 보안 통과 아님).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createArtifactWithVersion,
  addVersion,
  createDb,
  createTask,
  one,
  seedOwner,
  type Db,
  type Fixture,
} from "./harness";

type Outcome = { allowed: boolean; code: string | null; message: string | null; rowCount: number | null };

/** 한 번의 시도를 실행해 허용/거절·SQLSTATE를 돌려준다. 오류가 나면 그 트랜잭션은 되돌려진다. */
async function attempt(db: Db, userId: string | null, sql: string, params: unknown[] = []): Promise<Outcome> {
  try {
    const r = await asUser(db, userId, (tx) => tx.query(sql, params));
    return { allowed: true, code: null, message: null, rowCount: r.affectedRows ?? r.rows.length };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { allowed: false, code: err.code ?? null, message: err.message ?? null, rowCount: null };
  }
}

const log: Array<{ case: string } & Outcome> = [];
const record = (name: string, o: Outcome) => {
  log.push({ case: name, ...o });
  return o;
};

let db: Db;
let a: Fixture; // 공격자 = 업무실 A의 주인(본인)
let b: Fixture; // 다른 업무실 B의 주인(대조군)
let artifactId: string;
let v1: string; // 현재 초안이 아닌 옛 버전
let v2: string; // 현재 초안(미승인)
let artifactB: string; // 프로젝트 B(고객 B)의 결과물
let vB1: string;

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "owner-a@example.test");
  b = await seedOwner(db, "owner-b@example.test");
  // 준비: 관리자 트랜잭션으로 작업·결과물·버전 2개(현재 초안 = v2, 승인 없음)
  await db.transaction(async (tx) => {
    const task = await createTask(tx, a, a.projectA);
    const r = await createArtifactWithVersion(tx, a, a.projectA, task);
    artifactId = r.artifactId;
    v1 = r.versionId;
    v2 = await addVersion(tx, a, artifactId, 2);
    await tx.query("update artifacts set current_draft_version_id = $1 where id = $2", [v2, artifactId]);
    const taskB = await createTask(tx, a, a.projectB);
    const rb = await createArtifactWithVersion(tx, a, a.projectB, taskB);
    artifactB = rb.artifactId;
    vB1 = rb.versionId;
  });
}, 60_000); // 병렬 부하에서 PGlite 준비가 10초를 넘을 수 있다(QA-SEC-RELEASE-04 T1)

afterAll(() => {
  // 보고서용 요약(SEC-REPRO-01.md에 옮김)
  console.table(log.map((l) => ({ case: l.case, allowed: l.allowed, code: l.code, rows: l.rowCount, message: l.message?.slice(0, 70) })));
});

const taskStatus = async () =>
  (await one<{ status: string }>(db, "select t.status from tasks t join artifacts x on x.task_id = t.id where x.id = $1", [artifactId])).status;

describe("1) 현재 초안이 아닌 버전 직접 승인 + 승인본 포인터 변경", () => {
  it("[대조] RPC decide_version 은 현재 초안이 아닌 v1 승인을 거절한다", async () => {
    const o = record("1-대조 RPC decide_version(v1)", await attempt(db, a.userId, "select public.decide_version($1, $2, 'approved')", [artifactId, v1]));
    expect(o.allowed).toBe(false);
    expect(o.message).toMatch(/CONFLICT/);
  });

  it("[대조] 다른 업무실 주인 B는 A 결과물에 승인 기록을 넣지 못한다(RLS)", async () => {
    const o = record(
      "1-대조 B → A approvals insert",
      await attempt(db, b.userId, "insert into approvals (workspace_id, artifact_id, artifact_version_id, actor_id, decision) values ($1, $2, $3, $4, 'approved')", [a.workspaceId, artifactId, v1, b.userId]),
    );
    expect(o.allowed).toBe(false);
    expect(o.code).toBe("42501");
  });

  it("[대조] 다른 업무실 주인 B의 A 결과물 포인터 변경은 거절된다(수정 전: 0행, 수정 후: 열 권한 없음)", async () => {
    const o = record("1-대조 B → A artifacts update", await attempt(db, b.userId, "update artifacts set approved_version_id = $1 where id = $2", [v1, artifactId]));
    expect(o.allowed).toBe(false);
    expect(o.code).toBe("42501");
    expect(o.message).toMatch(/permission denied for table artifacts/);
  });

  it("[대조] 비로그인(anon)은 승인 기록을 넣지 못한다", async () => {
    const o = record(
      "1-대조 anon approvals insert",
      await attempt(db, null, "insert into approvals (workspace_id, artifact_id, artifact_version_id, actor_id, decision) values ($1, $2, $3, $4, 'approved')", [a.workspaceId, artifactId, v1, a.userId]),
    );
    expect(o.allowed).toBe(false);
    expect(o.code).toBe("42501");
  });

  it("[수정 후 거절] 본인도 RPC 없이 v1 승인 기록 insert 와 approved_version_id 직접 변경을 할 수 없다", async () => {
    const before = await taskStatus();
    const ins = record(
      "1-관찰 A approvals insert(v1, 비현재)",
      await attempt(db, a.userId, "insert into approvals (workspace_id, artifact_id, artifact_version_id, actor_id, decision) values ($1, $2, $3, $4, 'approved')", [a.workspaceId, artifactId, v1, a.userId]),
    );
    const upd = record("1-관찰 A artifacts.approved_version_id = v1", await attempt(db, a.userId, "update artifacts set approved_version_id = $1 where id = $2", [v1, artifactId]));
    expect(ins.allowed).toBe(false);
    expect(ins.code).toBe("42501");
    expect(ins.message).toMatch(/permission denied for table approvals|row-level security policy for table "approvals"/);
    expect(upd.allowed).toBe(false);
    expect(upd.code).toBe("42501");
    expect(upd.message).toMatch(/permission denied for table artifacts/);
    const art = await one<{ approved_version_id: string | null; current_draft_version_id: string }>(
      db,
      "select approved_version_id, current_draft_version_id from artifacts where id = $1",
      [artifactId],
    );
    expect(art.approved_version_id).toBeNull(); // 옛 버전이 승인본이 되지 않음
    expect(art.current_draft_version_id).toBe(v2);
    expect(await taskStatus()).toBe(before);
    const n = await one<{ n: number }>(db, "select count(*)::int as n from approvals where artifact_version_id = $1", [v1]);
    expect(n.n).toBe(0);
  });
});

describe("2) 미승인·다른 프로젝트 버전으로 전달 기록", () => {
  it("[대조] RPC record_delivery 는 승인본이 없는 결과물을 거절한다", async () => {
    const o = record("2-대조 RPC record_delivery(B 결과물, 미승인)", await attempt(db, a.userId, "select public.record_delivery($1, 'other', now())", [artifactB]));
    expect(o.allowed).toBe(false);
    expect(o.code).toBe("22023");
  });

  it("[대조] 다른 업무실 주인 B는 A 업무실에 전달 기록을 넣지 못한다(RLS)", async () => {
    const o = record(
      "2-대조 B → A delivery insert",
      await attempt(db, b.userId, "insert into delivery_records (workspace_id, project_id, artifact_version_id, delivered_at, method) values ($1, $2, $3, now(), 'other')", [a.workspaceId, a.projectA, v2]),
    );
    expect(o.allowed).toBe(false);
    expect(o.code).toBe("42501");
  });

  it("[대조] 비로그인(anon)은 전달 기록을 넣지 못한다", async () => {
    const o = record(
      "2-대조 anon delivery insert",
      await attempt(db, null, "insert into delivery_records (workspace_id, project_id, artifact_version_id, delivered_at, method) values ($1, $2, $3, now(), 'other')", [a.workspaceId, a.projectA, v2]),
    );
    expect(o.allowed).toBe(false);
    expect(o.code).toBe("42501");
  });

  it("[수정 후 거절] 본인도 승인되지 않은 버전(v2)을 전달 기록으로 직접 넣을 수 없다", async () => {
    const o = record(
      "2-관찰 A delivery insert(미승인 v2)",
      await attempt(db, a.userId, "insert into delivery_records (workspace_id, project_id, artifact_version_id, delivered_at, method) values ($1, $2, $3, now(), 'other')", [a.workspaceId, a.projectA, v2]),
    );
    expect(o.allowed).toBe(false);
    expect(o.code).toBe("42501");
    expect(o.message).toMatch(/permission denied for table delivery_records|row-level security policy for table "delivery_records"/);
  });

  it("[수정 후 거절] 본인도 프로젝트 B(고객 B)의 버전을 프로젝트 A(고객 A) 전달 기록으로 넣을 수 없다", async () => {
    const o = record(
      "2-관찰 A delivery insert(프로젝트A ← B 버전)",
      await attempt(db, a.userId, "insert into delivery_records (workspace_id, project_id, artifact_version_id, delivered_at, method) values ($1, $2, $3, now(), 'other')", [a.workspaceId, a.projectA, vB1]),
    );
    expect(o.allowed).toBe(false);
    expect(o.code).toBe("42501");
    expect(o.message).toMatch(/permission denied for table delivery_records|row-level security policy for table "delivery_records"/);
  });
});

describe("3) 승인·감사 기록의 행위자(actor_id) 위조", () => {
  it("[대조] RPC decide_version 은 행위자를 호출자(auth.uid())로 기록한다", async () => {
    // 현재 초안 v2 승인(정상 경로). 위 1)의 우회와 별개로 기록만 확인한다.
    const o = record("3-대조 RPC decide_version(v2)", await attempt(db, a.userId, "select public.decide_version($1, $2, 'approved')", [artifactId, v2]));
    expect(o.allowed).toBe(true);
    const row = await one<{ actor_id: string }>(db, "select actor_id from approvals where artifact_version_id = $1 order by seq desc limit 1", [v2]);
    expect(row.actor_id).toBe(a.userId);
  });

  it("[대조] 다른 업무실 주인 B는 A 업무실 감사 기록을 넣지 못한다(RLS)", async () => {
    const o = record(
      "3-대조 B → A audit insert",
      await attempt(db, b.userId, "insert into audit_events (workspace_id, entity_type, entity_id, actor_id, action) values ($1, 'artifact', $2, $3, 'approve')", [a.workspaceId, artifactId, b.userId]),
    );
    expect(o.allowed).toBe(false);
    expect(o.code).toBe("42501");
  });

  it("[수정 후 거절] 본인도 승인 기록의 actor_id 를 다른 사용자(B)로 넣을 수 없다", async () => {
    const o = record(
      "3-관찰 A approvals insert(actor = B)",
      await attempt(db, a.userId, "insert into approvals (workspace_id, artifact_id, artifact_version_id, actor_id, decision) values ($1, $2, $3, $4, 'changes_requested')", [a.workspaceId, artifactId, v2, b.userId]),
    );
    expect(o.allowed).toBe(false);
    expect(o.code).toBe("42501");
    expect(o.message).toMatch(/permission denied for table approvals|ACTOR_MISMATCH/);
  });

  it("[수정 후 거절] 본인도 감사 기록의 actor_id 를 다른 사용자(B)로 넣을 수 없다", async () => {
    const o = record(
      "3-관찰 A audit insert(actor = B)",
      await attempt(db, a.userId, "insert into audit_events (workspace_id, entity_type, entity_id, actor_id, action) values ($1, 'artifact', $2, $3, 'approve')", [a.workspaceId, artifactId, b.userId]),
    );
    expect(o.allowed).toBe(false);
    expect(o.code).toBe("42501");
    // SEC-AUDIT-01 뒤로는 INSERT 권한 자체가 없어 행위자 검사(ACTOR_MISMATCH)보다 먼저 거절된다
    expect(o.message).toMatch(/ACTOR_MISMATCH|permission denied for table audit_events/);
  });

  it("[수정 후 거절, SEC-AUDIT-01] 본인도 자기 이름(actor = 본인)으로 감사 기록을 직접 추가할 수 없다", async () => {
    const o = record(
      "3-잔여 A audit insert(actor = A)",
      await attempt(db, a.userId, "insert into audit_events (workspace_id, entity_type, entity_id, actor_id, action) values ($1, 'artifact', $2, $3, 'approve')", [a.workspaceId, artifactId, a.userId]),
    );
    expect(o.allowed).toBe(false);
    expect(o.code).toBe("42501");
  });
});
