/**
 * TASK-REVIEW-FIX-01 (BUG-CAND-01): 직접 고치기(save_manual_version)로 새 초안을 저장하면
 * 다른 새 버전 경로(record_generation·save_draft_version)와 같이 작업이 '검토 중'으로 돌아오는지,
 * 승인본은 그대로인지, 현황의 '검토 대기' 집계(status = 'review')에 다시 잡히는지 확인한다.
 * 흐름은 앱과 같은 RPC 로 본인 권한(authenticated)에서 만든다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, createTask, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let f: Fixture;
const asOwner = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, f.userId, fn);

beforeAll(async () => {
  db = await createDb();
  f = await seedOwner(db, "review-fix@example.test");
});

async function generated() {
  return asOwner(async (tx) => {
    const taskId = await createTask(tx, f, f.projectA);
    const r = await one<{ artifact_id: string; version_id: string }>(
      tx,
      "select * from record_generation($1, $2, 'h', '{}', '{}', '[]', '{\"brief\":\"b\"}', 'template')",
      [taskId, newKey()],
    );
    return { taskId, artifactId: r.artifact_id, versionId: r.version_id };
  });
}
const decide = (artifactId: string, versionId: string, decision: string) =>
  asOwner((tx) => tx.query("select decide_version($1, $2, $3, '메모')", [artifactId, versionId, decision]));
const revisionOf = async (artifactId: string) => (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [artifactId])).revision;
const manualEdit = (artifactId: string, revision: number) =>
  asOwner(async (tx) =>
    one<{ version_id: string }>(tx, "select * from save_manual_version($1, $2, '{\"brief\":\"직접 고침\"}')", [artifactId, revision]),
  );
const status = async (taskId: string) => (await one<{ status: string }>(db, "select status from tasks where id = $1", [taskId])).status;
/** 현황 화면과 같은 기준(본인 권한, 업무실, status = 'review')으로 센다 */
const reviewCount = () =>
  asOwner(async (tx) => (await one<{ n: number }>(tx, "select count(*)::int as n from tasks where workspace_id = $1 and status = 'review'", [f.workspaceId])).n);

describe("직접 고치기 뒤 작업 상태", () => {
  it("수정 요청 → 직접 고치기 → 검토 중, 현황 '검토 대기'에 다시 잡힌다", async () => {
    const g = await generated();
    expect(await status(g.taskId)).toBe("review");
    await decide(g.artifactId, g.versionId, "changes_requested");
    expect(await status(g.taskId)).toBe("changes_requested");
    const before = await reviewCount();

    const v2 = await manualEdit(g.artifactId, await revisionOf(g.artifactId));
    expect(await status(g.taskId)).toBe("review");
    expect(await reviewCount()).toBe(before + 1);

    const art = await one<{ approved_version_id: string | null; current_draft_version_id: string }>(
      db,
      "select approved_version_id, current_draft_version_id from artifacts where id = $1",
      [g.artifactId],
    );
    expect(art).toEqual({ approved_version_id: null, current_draft_version_id: v2.version_id });
    // 수정 요청 기록은 1번 버전에 그대로 남는다
    const ap = await one<{ n: number }>(db, "select count(*)::int as n from approvals where artifact_version_id = $1 and decision = 'changes_requested'", [g.versionId]);
    expect(ap.n).toBe(1);
  });

  it("승인 완료 뒤 직접 고치기: 새 초안만 생기고 작업은 완료, 승인본은 그대로(불변)", async () => {
    const g = await generated();
    await decide(g.artifactId, g.versionId, "approved");
    expect(await status(g.taskId)).toBe("completed");
    const v2 = await manualEdit(g.artifactId, await revisionOf(g.artifactId));
    expect(await status(g.taskId)).toBe("completed");
    const art = await one<{ approved_version_id: string; current_draft_version_id: string }>(
      db,
      "select approved_version_id, current_draft_version_id from artifacts where id = $1",
      [g.artifactId],
    );
    expect(art).toEqual({ approved_version_id: g.versionId, current_draft_version_id: v2.version_id });
  });

  it("검토 중에서 직접 고치기: 검토 중 그대로", async () => {
    const g = await generated();
    await manualEdit(g.artifactId, await revisionOf(g.artifactId));
    expect(await status(g.taskId)).toBe("review");
  });

  it("다른 새 버전 경로와 같은 규칙: 수정 요청 → 다시 만들기도 검토 중", async () => {
    const g = await generated();
    await decide(g.artifactId, g.versionId, "changes_requested");
    await asOwner((tx) => tx.query("select * from record_generation($1, $2, 'h2', '{}', '{}', '[]', '{\"brief\":\"b2\"}', 'template')", [g.taskId, newKey()]));
    expect(await status(g.taskId)).toBe("review");
  });
});

describe("바뀌지 않아야 하는 것", () => {
  it("오래된 revision 은 여전히 CONFLICT, 상태도 바뀌지 않는다", async () => {
    const g = await generated();
    await decide(g.artifactId, g.versionId, "changes_requested");
    const stale = await revisionOf(g.artifactId);
    await manualEdit(g.artifactId, stale);
    let message = "";
    try {
      await manualEdit(g.artifactId, stale);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/CONFLICT/);
    expect(await status(g.taskId)).toBe("review");
  });

  it("save_manual_version 은 invoker 그대로, anon 실행 불가·authenticated 실행 가능", async () => {
    const row = await one<{ secdef: boolean; anon: boolean; authed: boolean }>(
      db,
      `select prosecdef as secdef,
              has_function_privilege('anon', 'public.save_manual_version(uuid,integer,jsonb)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.save_manual_version(uuid,integer,jsonb)', 'execute') as authed
         from pg_proc where oid = 'public.save_manual_version(uuid,integer,jsonb)'::regprocedure`,
    );
    expect(row).toEqual({ secdef: false, anon: false, authed: true });
  });

  it("다른 업무실 사용자는 남의 결과물을 직접 고칠 수 없다(invoker + RLS 로 NOT_FOUND)", async () => {
    const g = await generated();
    const other = await seedOwner(db, "review-fix-other@example.test");
    let message = "";
    try {
      await asUser(db, other.userId, (tx) => tx.query("select * from save_manual_version($1, $2, '{}')", [g.artifactId, 1]));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/NOT_FOUND/);
    expect(await status(g.taskId)).toBe("review");
  });
});
