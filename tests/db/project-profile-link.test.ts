import { describe, expect, it } from "vitest";
import { asUser, createDb, expectDbError, one, seedOwner } from "./harness";

/**
 * AUDIT-05 C1-2(PROJECT-PROFILE-LINK-BACKEND-01) 서버 함수가 쓰는 DB 경로를 실제 권한으로 확인한다.
 * - 로그인 역할은 본인 업무실 프로젝트에 project_profiles 를 넣을 수 있다(PERM-CLEANUP 뒤에도 insert 는 남아 있음)
 * - 다른 고객의 프로필 판·다른 업무실 프로젝트는 넣을 수 없다. 넣은 연결은 고치거나 지울 수 없다(이력 유지, R06)
 */
describe("project_profiles 연결 경로", () => {
  it("본인 프로젝트에 같은 고객의 판만 연결되고, 연결은 고치거나 지울 수 없다", async () => {
    const db = await createDb();
    const a = await seedOwner(db, "ppl-a@example.test");
    const b = await seedOwner(db, "ppl-b@example.test");

    // 프로필 없이 만든 고객 프로젝트(A 고객)
    const p = await asUser(db, a.userId, (tx) =>
      one<{ id: string }>(tx, "insert into projects (workspace_id, client_id, kind, title) values ($1, $2, 'client', '프로필 없이 만든 프로젝트') returning id", [a.workspaceId, a.clientA]),
    );
    const ins = (pv: string, ws = a.workspaceId, client = a.clientA, project = p.id) =>
      "insert into project_profiles (workspace_id, project_id, client_id, company_profile_version_id) values ('" + ws + "', '" + project + "', '" + client + "', '" + pv + "')";

    await asUser(db, a.userId, (tx) => tx.query(ins(a.profileA1)));
    expect((await one<{ n: number }>(db, "select count(*)::int as n from project_profiles where project_id = $1", [p.id])).n).toBe(1);

    // 다른 고객(B)의 판은 외래 키로 막힌다
    await expectDbError(asUser(db, a.userId, (tx) => tx.query(ins(a.profileB1))), /foreign key|violates/);
    // 다른 업무실 프로젝트에는 못 넣는다(RLS 또는 외래 키)
    await expectDbError(asUser(db, b.userId, (tx) => tx.query(ins(b.profileA1, b.workspaceId, b.clientA, p.id))), /row-level security|foreign key|violates/);
    // 이력은 고치거나 지울 수 없다
    await expectDbError(asUser(db, a.userId, (tx) => tx.query("update project_profiles set company_profile_version_id = $1 where project_id = $2", [a.profileA1, p.id])), /permission denied/);
    await expectDbError(asUser(db, a.userId, (tx) => tx.query("delete from project_profiles where project_id = $1", [p.id])), /permission denied/);
  }, 120_000);
});
