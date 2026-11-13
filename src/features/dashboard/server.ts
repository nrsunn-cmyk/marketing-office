import "server-only";
import { requireWorkspace } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * 전체 현황 (S02·T17). 실제 DB 값만 보여 준다(참고 이미지의 예시 숫자 없음).
 * - 데이터가 하나도 없으면 0이 아니라 '아직 데이터 없음'
 * - 불러오기에 실패하면 0이 아니라 '불러오지 못함'
 */

const OPEN_PROJECT = ["received", "waiting_material", "active", "review"];
const ACTION_TASK = ["draft", "ready", "review", "changes_requested", "failed"];

export interface DashboardData {
  asOf: string;
  hasAnyProject: boolean;
  counts: {
    openProjects: number;
    waitingMaterial: number;
    tasksInReview: number;
    dueSoon: number;
  };
  todo: Array<{ taskId: string; type: string; status: string; projectId: string; projectTitle: string }>;
  dueSoon: Array<{ id: string; title: string; due_at: string; status: string }>;
  recent: Array<{ taskId: string; type: string; version: number; generator: string; created_at: string; projectTitle: string }>;
}

export type DashboardResult = { ok: true; data: DashboardData } | { ok: false; message: string };

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getDashboard(today: string): Promise<DashboardResult> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const ws = workspace.id;
  const in7 = addDays(today, 7);

  const [anyProject, open, waiting, review, due, todo, recent] = await Promise.all([
    sb.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    sb.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", ws).in("status", OPEN_PROJECT),
    sb.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "waiting_material"),
    sb.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "review"),
    sb
      .from("projects")
      .select("id, title, due_at, status")
      .eq("workspace_id", ws)
      .in("status", OPEN_PROJECT)
      .not("due_at", "is", null)
      .lte("due_at", in7)
      .order("due_at"),
    sb
      .from("tasks")
      .select("id, type, status, project_id, projects(title)")
      .eq("workspace_id", ws)
      .in("status", ACTION_TASK)
      .order("updated_at", { ascending: false })
      .limit(10),
    sb
      .from("artifact_versions")
      // artifacts ↔ artifact_versions 는 외래키가 여러 개라 어느 연결로 이을지 이름으로 정한다
      .select("version, generator, created_at, artifacts!artifact_versions_workspace_id_artifact_id_fkey(task_id, type, projects(title))")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const failed = [anyProject, open, waiting, review, due, todo, recent].find((r) => r.error);
  if (failed?.error) {
    console.error("[dashboard]", failed.error.code, failed.error.message);
    return { ok: false, message: "현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  type TodoRow = { id: string; type: string; status: string; project_id: string; projects: { title: string } | null };
  type RecentRow = {
    version: number;
    generator: string;
    created_at: string;
    artifacts: { task_id: string; type: string; projects: { title: string } | null } | null;
  };

  return {
    ok: true,
    data: {
      asOf: new Date().toISOString(),
      hasAnyProject: (anyProject.count ?? 0) > 0,
      counts: {
        openProjects: open.count ?? 0,
        waitingMaterial: waiting.count ?? 0,
        tasksInReview: review.count ?? 0,
        dueSoon: due.data?.length ?? 0,
      },
      todo: ((todo.data ?? []) as unknown as TodoRow[]).map((t) => ({
        taskId: t.id,
        type: t.type,
        status: t.status,
        projectId: t.project_id,
        projectTitle: t.projects?.title ?? "",
      })),
      dueSoon: (due.data ?? []) as DashboardData["dueSoon"],
      recent: ((recent.data ?? []) as unknown as RecentRow[]).map((r) => ({
        taskId: r.artifacts?.task_id ?? "",
        type: r.artifacts?.type ?? "",
        version: r.version,
        generator: r.generator,
        created_at: r.created_at,
        projectTitle: r.artifacts?.projects?.title ?? "",
      })),
    },
  };
}
