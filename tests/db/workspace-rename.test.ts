import { describe, expect, it } from "vitest";
import { asUser, createDb, expectDbError, one, seedOwner } from "./harness";

/**
 * 업무실 이름 바꾸기(AUDIT-05 C3, WORKSPACE-RENAME-BACKEND-01, 20261124009000).
 * - 로그인 역할은 표를 직접 못 바꾼다(PERM-CLEANUP 유지). 정의자 RPC 로 본인 업무실 이름만 바꾼다
 * - revision 이 다르면 CONFLICT, 이름은 앞뒤 공백 제거 후 1~200자
 */
const rev = async (db: Awaited<ReturnType<typeof createDb>>, ws: string) =>
  one<{ name: string; revision: number }>(db, "select name, revision from workspaces where id = $1", [ws]);

describe("rename_workspace", () => {
  it("본인 업무실 이름만 바꾸고 revision 을 올린다. 다른 업무실은 그대로", async () => {
    const db = await createDb();
    const a = await seedOwner(db, "wsr-a@example.test");
    const b = await seedOwner(db, "wsr-b@example.test");
    const before = await rev(db, a.workspaceId);
    const bBefore = await rev(db, b.workspaceId);

    const r = await asUser(db, a.userId, (tx) =>
      one<{ r: number }>(tx, "select public.rename_workspace($1, $2) as r", ["  새 이름  ", before.revision]),
    );
    expect(r.r).toBe(before.revision + 1);
    expect(await rev(db, a.workspaceId)).toEqual({ name: "새 이름", revision: before.revision + 1 });
    expect(await rev(db, b.workspaceId)).toEqual(bBefore);

    // 같은 이름이면 바꾸지 않고 지금 revision
    const same = await asUser(db, a.userId, (tx) => one<{ r: number }>(tx, "select public.rename_workspace('새 이름', $1) as r", [before.revision + 1]));
    expect(same.r).toBe(before.revision + 1);
  }, 120_000);

  it("revision 이 다르면 CONFLICT, 이름 길이가 틀리면 VALIDATION", async () => {
    const db = await createDb();
    const a = await seedOwner(db, "wsr-c@example.test");
    const cur = await rev(db, a.workspaceId);
    await expectDbError(asUser(db, a.userId, (tx) => tx.query("select public.rename_workspace('x', $1)", [cur.revision + 5])), /CONFLICT/);
    await expectDbError(asUser(db, a.userId, (tx) => tx.query("select public.rename_workspace(null, $1)", [cur.revision])), /VALIDATION/);
    for (const bad of ["", "   ", "가".repeat(201)]) {
      await expectDbError(asUser(db, a.userId, (tx) => tx.query("select public.rename_workspace($1, $2)", [bad, cur.revision])), /VALIDATION/);
    }
    await asUser(db, a.userId, (tx) => tx.query("select public.rename_workspace($1, $2)", ["가".repeat(200), cur.revision]));
    expect((await rev(db, a.workspaceId)).name).toHaveLength(200);
  }, 120_000);

  it("권한: anon 실행 불가, 비로그인 거절, 표 직접 수정은 여전히 막힘, 정의자·경로 고정", async () => {
    const db = await createDb();
    const a = await seedOwner(db, "wsr-d@example.test");
    const g = await one<Record<string, unknown>>(
      db,
      `select has_function_privilege('anon', 'public.rename_workspace(text, integer)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.rename_workspace(text, integer)', 'execute') as auth,
              (select prosecdef from pg_proc where proname = 'rename_workspace') as definer,
              (select proconfig::text from pg_proc where proname = 'rename_workspace') as cfg,
              has_table_privilege('authenticated', 'public.workspaces', 'update') as tbl_update`,
    );
    expect(g).toEqual({ anon: false, auth: true, definer: true, cfg: '{"search_path=\\"\\""}', tbl_update: false });
    await expectDbError(asUser(db, null, (tx) => tx.query("select public.rename_workspace('x', 1)")), /NOT_AUTHENTICATED|permission denied/);
    await expectDbError(asUser(db, a.userId, (tx) => tx.query("update workspaces set name = '직접' where id = $1", [a.workspaceId])), /permission denied/);
  }, 120_000);
});
