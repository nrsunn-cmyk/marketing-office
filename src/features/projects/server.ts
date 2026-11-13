import "server-only";
import type { ProjectInput } from "@/contracts";
import { canTransition, isState, type ProjectStatus } from "@/domain/state";
import { requireWorkspace } from "@/server/auth/session";
import { CONFLICT_MESSAGE, fail, fromDbError, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

export interface ProjectSummary {
  id: string;
  title: string;
  kind: string;
  status: string;
  due_at: string | null;
  client_id: string | null;
  client_name: string | null;
}

export interface ProjectDetail extends ProjectSummary {
  budget_won: number | null;
  revision: number;
  profile_version: number | null;
}

const SUMMARY = "id, title, kind, status, due_at, client_id, clients(name)";

type Row = {
  id: string;
  title: string;
  kind: string;
  status: string;
  due_at: string | null;
  client_id: string | null;
  clients: { name: string } | null;
};

const toSummary = (r: Row): ProjectSummary => ({
  id: r.id,
  title: r.title,
  kind: r.kind,
  status: r.status,
  due_at: r.due_at,
  client_id: r.client_id,
  client_name: r.clients?.name ?? null,
});

export async function listProjects(opts: { clientId?: string } = {}): Promise<ProjectSummary[]> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  let query = sb.from("projects").select(SUMMARY).eq("workspace_id", workspace.id).order("created_at", { ascending: false });
  if (opts.clientId) query = query.eq("client_id", opts.clientId);
  const { data, error } = await query;
  if (error) throw new Error(`프로젝트 목록을 불러오지 못했습니다: ${error.message}`);
  return (data as Row[]).map(toSummary);
}

export async function getProject(id: string): Promise<ProjectDetail | null> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("projects")
    .select(`${SUMMARY}, budget_won, revision`)
    .eq("workspace_id", workspace.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`프로젝트를 불러오지 못했습니다: ${error.message}`);
  if (!data) return null;
  const row = data as Row & { budget_won: number | null; revision: number };
  const { data: profile } = await sb
    .from("project_profiles")
    .select("company_profile_versions(version)")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pv = (profile as { company_profile_versions: { version: number } | null } | null)?.company_profile_versions;
  return { ...toSummary(row), budget_won: row.budget_won, revision: row.revision, profile_version: pv?.version ?? null };
}

/**
 * 프로젝트 생성. 고객 프로젝트는 그 시점의 최신 회사 프로필 버전을 연결해 둔다
 * (나중에 프로필을 고쳐도 이 프로젝트가 쓰던 버전을 알 수 있다, R06).
 */
export async function createProjectRecord(input: ProjectInput): Promise<Result<{ id: string }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("projects")
    .insert({
      workspace_id: workspace.id,
      client_id: input.clientId,
      kind: input.kind,
      title: input.title,
      budget_won: input.budgetWon,
      due_at: input.dueAt,
    })
    .select("id")
    .single();
  if (error) return fromDbError("createProject", error);

  if (input.kind === "client" && input.clientId) {
    const { data: latest } = await sb
      .from("company_profile_versions")
      .select("id")
      .eq("client_id", input.clientId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      const { error: linkError } = await sb.from("project_profiles").insert({
        workspace_id: workspace.id,
        project_id: data.id,
        client_id: input.clientId,
        company_profile_version_id: latest.id,
      });
      if (linkError) console.error("[createProject] 프로필 연결 실패:", linkError.code, linkError.message);
    }
  }
  return ok(data);
}

export async function changeProjectStatus(id: string, expectedRevision: number, to: string): Promise<Result<null>> {
  const project = await getProject(id);
  if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  if (!isState("project", to) || !canTransition("project", project.status as ProjectStatus, to)) {
    return fail("INVALID_TRANSITION", "지금 상태에서는 그 상태로 바꿀 수 없습니다.");
  }
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("projects")
    .update({ status: to })
    .eq("workspace_id", workspace.id)
    .eq("id", id)
    .eq("revision", expectedRevision)
    .select("id");
  if (error) return fromDbError("changeProjectStatus", error);
  return data.length === 1 ? ok(null) : fail("CONFLICT", CONFLICT_MESSAGE);
}
