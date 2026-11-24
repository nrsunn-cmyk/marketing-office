// UX-G1-G4-BACKEND-01: 현황 G1·G4 로더가 고르는 칸을 로그인 사용자가 실제 DB 권한으로 읽을 수 있는지, 남의 업무실은 안 보이는지.
// 로더(src/features/production-overview/server.ts)와 같은 표·칸·거르기를 SQL 로 그대로 쓴다. migration 없음.
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, one, seedOwner, type Db, type Fixture } from "./harness";

let db: Db;
let me: Fixture;
let other: Fixture;
beforeAll(async () => {
  db = await createDb();
  me = await seedOwner(db, "g1g4-me@example.test");
  other = await seedOwner(db, "g1g4-other@example.test");
}, 60_000);

/** 후속 1건(문의 외래 키 검사만 잠시 끄고 넣는다 — 이 시험은 읽기 권한만 본다) */
async function followup(f: Fixture, projectId: string, due: string, status = "todo", archived = false) {
  await db.exec("set session_replication_role = replica");
  try {
    await db.query(
      `insert into public.crm_followups (workspace_id, project_id, inquiry_id, assignee_name, due_date, status, archived_at, created_by)
       values ($1, $2, gen_random_uuid(), '합성 담당', $3, $4, $5, $6)`,
      [f.workspaceId, projectId, due, status, archived ? new Date().toISOString() : null, f.userId],
    );
  } finally {
    await db.exec("set session_replication_role = origin");
  }
}

describe("현황 G1·G4 읽기 권한", () => {
  it("로더가 고르는 칸은 로그인 사용자가 권한 오류 없이 읽는다(5개 표)", async () => {
    await asUser(db, me.userId, async (tx) => {
      const ws = me.workspaceId;
      await tx.query("select project_id from public.qa_reviews where workspace_id = $1 and status in ('drafting', 'fix_requested') and archived_at is null", [ws]);
      await tx.query("select project_id from public.execution_jobs where workspace_id = $1 and status = 'pending_approval' and archived_at is null", [ws]);
      await tx.query("select id, title, status from public.projects where workspace_id = $1 and id = any($2::uuid[])", [ws, [me.projectA]]);
      await tx.query("select id, project_id from public.tasks where workspace_id = $1 and type = 'strategy' and project_id = any($2::uuid[]) order by updated_at desc", [ws, [me.projectA]]);
      await tx.query("select project_id, due_date from public.crm_followups where workspace_id = $1 and status in ('todo', 'in_progress') and archived_at is null and due_date <= '2026-12-01'", [ws]);
    });
  });

  it("후속·프로젝트는 본인 업무실만 보인다(남의 업무실 id 로 물어도 0행), 보관 프로젝트 상태는 그대로 읽힌다", async () => {
    await followup(me, me.projectA, "2026-11-20");
    await followup(me, me.projectB, "2026-11-28", "in_progress");
    await followup(me, me.projectB, "2026-11-25", "done");
    await followup(me, me.projectA, "2026-11-25", "todo", true);
    await followup(other, other.projectA, "2026-11-21");
    await db.query("update public.projects set status = 'archived' where id = $1", [me.projectB]);

    const rows = await asUser(db, me.userId, (tx) =>
      tx.query<{ project_id: string; due_date: string }>(
        "select project_id, due_date::text from public.crm_followups where workspace_id = $1 and status in ('todo', 'in_progress') and archived_at is null and due_date <= '2026-12-01' order by due_date",
        [me.workspaceId],
      ),
    );
    expect(rows.rows).toEqual([
      { project_id: me.projectA, due_date: "2026-11-20" },
      { project_id: me.projectB, due_date: "2026-11-28" },
    ]);
    // 남의 업무실 id 를 넣어도 정책 때문에 0행
    const leak = await asUser(db, me.userId, (tx) =>
      one<{ n: number }>(tx, "select count(*)::int as n from public.crm_followups where workspace_id = $1", [other.workspaceId]),
    );
    expect(leak.n).toBe(0);
    const projs = await asUser(db, me.userId, (tx) =>
      tx.query<{ id: string; status: string }>("select id, status from public.projects where id = any($1::uuid[]) order by title", [[me.projectA, me.projectB, other.projectA]]),
    );
    // 로더는 status = 'archived' 인 B 를 빼고, 남의 A 는 아예 보이지 않는다
    expect(projs.rows).toEqual([
      { id: me.projectA, status: "received" },
      { id: me.projectB, status: "archived" },
    ]);
  });
});
