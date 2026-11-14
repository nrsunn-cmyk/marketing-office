import "server-only";
import { requireWorkspace } from "@/server/auth/session";
import { escapeLike } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * 자료실·결과물 모아 보기 (AGY 04 §2.1 탭 5개 중 자료실·결과물).
 * 여러 고객·프로젝트의 자료와 결과물을 한곳에서 본다. 모두 로그인·업무실 확인 뒤 RLS 아래에서 읽는다.
 * 같은 테이블로 가는 외래키가 여러 개라 연결 이름을 정확히 적는다.
 */

export const ASSET_KINDS = ["file", "url", "text"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface LibraryItem {
  id: string;
  kind: AssetKind;
  file_name: string | null;
  url: string | null;
  text_content: string | null;
  mime: string | null;
  bytes: number | null;
  upload_status: string;
  extraction_status: string;
  created_at: string;
  client_id: string | null;
  client_name: string | null;
  project_id: string | null;
  project_title: string | null;
}

export async function listLibrary(opts: { kind?: AssetKind | null; q?: string | null } = {}): Promise<LibraryItem[]> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  let query = sb
    .from("source_assets")
    .select(
      "id, kind, file_name, url, text_content, mime, bytes, upload_status, extraction_status, created_at, client_id, project_id, clients!source_assets_workspace_id_client_id_fkey(name), projects!source_assets_workspace_id_project_id_fkey(title)",
    )
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (opts.kind) query = query.eq("kind", opts.kind);
  const q = opts.q?.trim();
  if (q) query = query.ilike("file_name", `%${escapeLike(q)}%`);
  const { data, error } = await query;
  if (error) throw new Error(`자료실을 불러오지 못했습니다: ${error.message}`);
  type Row = Omit<LibraryItem, "client_name" | "project_title"> & {
    clients: { name: string } | null;
    projects: { title: string } | null;
  };
  return (data as unknown as Row[]).map(({ clients, projects, ...r }) => ({
    ...r,
    client_name: clients?.name ?? null,
    project_title: projects?.title ?? null,
  }));
}

export interface ResultItem {
  id: string;
  type: string;
  task_id: string;
  task_status: string;
  project_id: string;
  project_title: string;
  client_name: string | null;
  current_version: number | null;
  approved_version: number | null;
  updated_at: string;
}

export async function listResults(opts: { type?: "logo_brief" | "quote" | null; approvedOnly?: boolean } = {}): Promise<ResultItem[]> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  let query = sb
    .from("artifacts")
    .select(
      "id, type, task_id, project_id, updated_at, approved_version_id, tasks!artifacts_project_id_task_id_fkey(status), projects!artifacts_workspace_id_project_id_fkey(title, clients(name)), current:artifact_versions!artifacts_id_current_draft_version_id_fkey(version), approved:artifact_versions!artifacts_id_approved_version_id_fkey(version)",
    )
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (opts.type) query = query.eq("type", opts.type);
  if (opts.approvedOnly) query = query.not("approved_version_id", "is", null);
  const { data, error } = await query;
  if (error) throw new Error(`결과물을 불러오지 못했습니다: ${error.message}`);
  type Row = {
    id: string;
    type: string;
    task_id: string;
    project_id: string;
    updated_at: string;
    tasks: { status: string } | null;
    projects: { title: string; clients: { name: string } | null } | null;
    current: { version: number } | null;
    approved: { version: number } | null;
  };
  return (data as unknown as Row[]).map((r) => ({
    id: r.id,
    type: r.type,
    task_id: r.task_id,
    task_status: r.tasks?.status ?? "",
    project_id: r.project_id,
    project_title: r.projects?.title ?? "",
    client_name: r.projects?.clients?.name ?? null,
    current_version: r.current?.version ?? null,
    approved_version: r.approved?.version ?? null,
    updated_at: r.updated_at,
  }));
}
