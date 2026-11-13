import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, createTask, createUser, type Db, expectDbError, type Fixture, newKey, one, seedOwner } from "./harness";

let db: Db;
let f: Fixture;

beforeAll(async () => {
  db = await createDb();
  f = await seedOwner(db);
}, 60_000);

const asOwner = <T>(fn: Parameters<typeof asUser<T>>[2]) => asUser(db, f.userId, fn);

interface GenResult {
  artifact_id: string;
  version_id: string;
  version: number;
  reused: boolean;
}

function generate(taskId: string, key: string, hash = "h1", content: object = { brief: "b" }, uid = f.userId) {
  return asUser(db, uid, async (tx) =>
    one<GenResult>(
      tx,
      `select * from record_generation($1, $2, $3, $4, '{}'::jsonb, '[]'::jsonb, $5, 'template')`,
      [taskId, key, hash, JSON.stringify({ client: "A" }), JSON.stringify(content)],
    ),
  );
}

async function newTask() {
  return asOwner((tx) => createTask(tx, f, f.projectA));
}

const taskStatus = async (id: string) => (await one<{ status: string }>(db, "select status from tasks where id = $1", [id])).status;
const artifact = (id: string) =>
  one<{ revision: number; current_draft_version_id: string; approved_version_id: string | null }>(
    db,
    "select revision, current_draft_version_id, approved_version_id from artifacts where id = $1",
    [id],
  );

describe("record_generation (F03)", () => {
  it("처음 생성: 스냅샷·실행 기록·결과 1번 버전, 작업은 '검토 중'", async () => {
    const task = await newTask();
    const r = await generate(task, newKey());
    expect(r.version).toBe(1);
    expect(r.reused).toBe(false);
    expect(await taskStatus(task)).toBe("review");
    const run = await one<{ status: string; artifact_version_id: string; mode: string }>(
      db,
      "select status, artifact_version_id, mode from generation_runs where task_id = $1",
      [task],
    );
    expect(run).toEqual({ status: "succeeded", artifact_version_id: r.version_id, mode: "template" });
    const v = await one<{ input_snapshot_id: string; generator: string }>(
      db,
      "select input_snapshot_id, generator from artifact_versions where id = $1",
      [r.version_id],
    );
    expect(v.generator).toBe("template");
    const snap = await one<{ profile_snapshot: { client: string } }>(db, "select profile_snapshot from task_input_snapshots where id = $1", [
      v.input_snapshot_id,
    ]);
    expect(snap.profile_snapshot).toEqual({ client: "A" });
  });

  it("T15 같은 키·같은 내용으로 다시 요청하면 새로 만들지 않고 같은 결과", async () => {
    const task = await newTask();
    const key = newKey();
    const a = await generate(task, key);
    const b = await generate(task, key);
    expect(b).toEqual({ ...a, reused: true });
    const count = await one<{ n: number }>(db, "select count(*)::int as n from artifact_versions where artifact_id = $1", [a.artifact_id]);
    expect(count.n).toBe(1);
  });

  it("T15 같은 키에 다른 내용이면 충돌", async () => {
    const task = await newTask();
    const key = newKey();
    await generate(task, key, "h1");
    await expectDbError(generate(task, key, "h2"), /IDEMPOTENCY_MISMATCH/);
  });

  it("다시 만들기는 같은 결과물의 새 버전", async () => {
    const task = await newTask();
    const a = await generate(task, newKey());
    const b = await generate(task, newKey(), "h2");
    expect(b.artifact_id).toBe(a.artifact_id);
    expect(b.version).toBe(2);
    expect((await artifact(a.artifact_id)).current_draft_version_id).toBe(b.version_id);
  });

  it("다른 계정은 남의 작업으로 생성할 수 없다", async () => {
    const task = await newTask();
    const stranger = await createUser(db, "gen-stranger@example.test");
    await expectDbError(generate(task, newKey(), "h1", {}, stranger), /NOT_FOUND/);
  });

  it("AI 방식은 아직 받지 않는다 (T07: 연결 안 된 기능을 실행하지 않음)", async () => {
    const task = await newTask();
    await expectDbError(
      asOwner((tx) =>
        tx.query(`select * from record_generation($1, $2, 'h', '{}', '{}', '[]', '{}', 'ai')`, [task, newKey()]),
      ),
      /VALIDATION/,
    );
  });
});

describe("save_manual_version (T13)", () => {
  it("직접 수정은 새 버전, 입력 스냅샷은 이어받는다", async () => {
    const task = await newTask();
    const g = await generate(task, newKey());
    const rev = (await artifact(g.artifact_id)).revision;
    const r = await asOwner((tx) =>
      one<{ version: number; version_id: string }>(tx, "select * from save_manual_version($1, $2, $3)", [
        g.artifact_id,
        rev,
        JSON.stringify({ brief: "고친 브리프" }),
      ]),
    );
    expect(r.version).toBe(2);
    const v = await one<{ generator: string; same: boolean }>(
      db,
      `select v2.generator, v2.input_snapshot_id = v1.input_snapshot_id as same
         from artifact_versions v1, artifact_versions v2 where v1.id = $1 and v2.id = $2`,
      [g.version_id, r.version_id],
    );
    expect(v).toEqual({ generator: "manual", same: true });
  });

  it("오래된 revision으로 저장하면 충돌, 버전이 늘지 않는다", async () => {
    const task = await newTask();
    const g = await generate(task, newKey());
    const rev = (await artifact(g.artifact_id)).revision;
    const save = (r: number) =>
      asOwner((tx) => tx.query("select * from save_manual_version($1, $2, '{}')", [g.artifact_id, r]));
    await save(rev);
    await expectDbError(save(rev), /CONFLICT/);
    const n = await one<{ n: number }>(db, "select count(*)::int as n from artifact_versions where artifact_id = $1", [g.artifact_id]);
    expect(n.n).toBe(2);
  });
});

describe("decide_version (T14·R08)", () => {
  const decide = (artifactId: string, versionId: string, decision: string) =>
    asOwner((tx) => tx.query("select decide_version($1, $2, $3, '메모')", [artifactId, versionId, decision]));

  it("승인하면 승인본 지정 + 작업 완료", async () => {
    const task = await newTask();
    const g = await generate(task, newKey());
    await decide(g.artifact_id, g.version_id, "approved");
    expect((await artifact(g.artifact_id)).approved_version_id).toBe(g.version_id);
    expect(await taskStatus(task)).toBe("completed");
  });

  it("수정 요청 → 다시 생성 → 검토로 돌아온다", async () => {
    const task = await newTask();
    const g = await generate(task, newKey());
    await decide(g.artifact_id, g.version_id, "changes_requested");
    expect(await taskStatus(task)).toBe("changes_requested");
    expect((await artifact(g.artifact_id)).approved_version_id).toBeNull();
    await generate(task, newKey(), "h2");
    expect(await taskStatus(task)).toBe("review");
  });

  it("승인 후 다시 만들어도 승인본은 그대로, 새 초안만 생긴다", async () => {
    const task = await newTask();
    const g1 = await generate(task, newKey());
    await decide(g1.artifact_id, g1.version_id, "approved");
    const g2 = await generate(task, newKey(), "h2");
    const a = await artifact(g1.artifact_id);
    expect(a.approved_version_id).toBe(g1.version_id);
    expect(a.current_draft_version_id).toBe(g2.version_id);
    expect(await taskStatus(task)).toBe("completed");
  });

  it("최신 초안이 아닌 버전은 승인할 수 없다", async () => {
    const task = await newTask();
    const g1 = await generate(task, newKey());
    await generate(task, newKey(), "h2");
    await expectDbError(decide(g1.artifact_id, g1.version_id, "approved"), /CONFLICT/);
  });

  it("알 수 없는 결정 값 거절", async () => {
    const task = await newTask();
    const g = await generate(task, newKey());
    await expectDbError(decide(g.artifact_id, g.version_id, "rejected-ish"), /VALIDATION/);
  });

  it("다른 계정은 결정할 수 없다", async () => {
    const task = await newTask();
    const g = await generate(task, newKey());
    const stranger = await createUser(db, "decide-stranger@example.test");
    await expectDbError(
      asUser(db, stranger, (tx) => tx.query("select decide_version($1, $2, 'approved')", [g.artifact_id, g.version_id])),
      /NOT_FOUND/,
    );
  });
});

describe("record_delivery (T18)", () => {
  const deliver = (artifactId: string, at = "now()", method = "email_manual") =>
    asOwner((tx) =>
      tx.query(`select record_delivery($1, $2, ${at === "now()" ? "now()" : "$3::timestamptz"}, '직접 메일로 보냄')`, at === "now()" ? [artifactId, method] : [artifactId, method, at]),
    );

  it("승인 전에는 기록할 수 없다", async () => {
    const task = await newTask();
    const g = await generate(task, newKey());
    await expectDbError(deliver(g.artifact_id), /VALIDATION/);
  });

  it("승인본 버전으로 고정되어 기록된다 (이후 새 초안이 생겨도)", async () => {
    const task = await newTask();
    const g1 = await generate(task, newKey());
    await asOwner((tx) => tx.query("select decide_version($1, $2, 'approved')", [g1.artifact_id, g1.version_id]));
    await generate(task, newKey(), "h2");
    await deliver(g1.artifact_id);
    const d = await one<{ artifact_version_id: string; method: string; note: string }>(
      db,
      "select artifact_version_id, method, note from delivery_records dr join artifact_versions av on av.id = dr.artifact_version_id where av.artifact_id = $1",
      [g1.artifact_id],
    );
    expect(d).toEqual({ artifact_version_id: g1.version_id, method: "email_manual", note: "직접 메일로 보냄" });
  });

  it("미래 시각·알 수 없는 방법은 거절", async () => {
    const task = await newTask();
    const g = await generate(task, newKey());
    await asOwner((tx) => tx.query("select decide_version($1, $2, 'approved')", [g.artifact_id, g.version_id]));
    await expectDbError(deliver(g.artifact_id, "2999-01-01T00:00:00Z"), /VALIDATION/);
    await expectDbError(deliver(g.artifact_id, "now()", "auto_send"), /check constraint/);
  });

  it("다른 계정은 기록할 수 없다", async () => {
    const task = await newTask();
    const g = await generate(task, newKey());
    await asOwner((tx) => tx.query("select decide_version($1, $2, 'approved')", [g.artifact_id, g.version_id]));
    const stranger = await createUser(db, "delivery-stranger@example.test");
    await expectDbError(
      asUser(db, stranger, (tx) => tx.query("select record_delivery($1, 'other', now())", [g.artifact_id])),
      /NOT_FOUND/,
    );
  });
});
