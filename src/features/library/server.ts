import "server-only";
import { encodeCursor, PAGE_SIZE, type Cursor } from "@/domain/paging";
import { requireWorkspace } from "@/server/auth/session";
import { escapeLike } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * 자료실·결과물 모아 보기 (AGY 04 §2.1 탭 5개 중 자료실·결과물).
 * 여러 고객·프로젝트의 자료와 결과물을 한곳에서 본다. 모두 로그인·업무실 확인 뒤 RLS 아래에서 읽는다.
 * 같은 테이블로 가는 외래키가 여러 개라 연결 이름을 정확히 적는다.
 *
 * 페이지 나누기(CR07): 50개씩, (시각, 고유번호) 순서로 '어디까지 봤는지'를 기억해 다음 쪽을 읽는다.
 * 같은 시각인 행도 빠지거나 겹치지 않는다. 전체 개수도 함께 돌려준다.
 */

export const ASSET_KINDS = ["file", "url", "text"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface Page<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
}

/** 검사를 마친 기준값만 받는다(decodeCursor). 시각 순서가 같으면 고유번호로 이어 본다. */
function afterCursor(column: string, c: Cursor): string {
  return `${column}.lt."${c.at}",and(${column}.eq."${c.at}",id.lt."${c.id}")`;
}

export interface LibraryItem {
  id: string;
  kind: AssetKind;
  /** 화면 표시·검색용 이름(제목 → 링크 주소 → 메모 앞부분, DB 자동 계산) */
  display_name: string | null;
  url: string | null;
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

export async function listLibrary(
  opts: { kind?: AssetKind | null; q?: string | null; cursor?: Cursor | null } = {},
): Promise<Page<LibraryItem>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const q = opts.q?.trim();

  const filter = <T extends { eq: (c: string, v: string) => T; ilike: (c: string, v: string) => T }>(query: T) => {
    let out = query.eq("workspace_id", workspace.id);
    if (opts.kind) out = out.eq("kind", opts.kind);
    // CR08: 화면에 보이는 이름(display_name)으로 찾는다. LIKE 특수문자(%, _, \)는 글자 그대로.
    if (q) out = out.ilike("display_name", `%${escapeLike(q)}%`);
    return out;
  };

  let query = filter(
    sb
      .from("source_assets")
      .select(
        "id, kind, display_name, url, mime, bytes, upload_status, extraction_status, created_at, client_id, project_id, clients!source_assets_workspace_id_client_id_fkey(name), projects!source_assets_workspace_id_project_id_fkey(title)",
      ),
  );
  if (opts.cursor) query = query.or(afterCursor("created_at", opts.cursor));
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE + 1),
    filter(sb.from("source_assets").select("id", { count: "exact", head: true })),
  ]);
  if (error || countError) throw new Error(`자료실을 불러오지 못했습니다: ${(error ?? countError)!.message}`);

  type Row = Omit<LibraryItem, "client_name" | "project_title"> & {
    clients: { name: string } | null;
    projects: { title: string } | null;
  };
  const rows = data as unknown as Row[];
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(({ clients, projects, ...r }) => ({
      ...r,
      client_name: clients?.name ?? null,
      project_title: projects?.title ?? null,
    })),
    total: count ?? 0,
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor({ at: last.created_at, id: last.id }) : null,
  };
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

export async function listResults(
  opts: { type?: "logo_brief" | "quote" | null; approvedOnly?: boolean; cursor?: Cursor | null } = {},
): Promise<Page<ResultItem>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();

  const filter = <T extends { eq: (c: string, v: string) => T; not: (c: string, op: string, v: null) => T }>(query: T) => {
    let out = query.eq("workspace_id", workspace.id);
    if (opts.type) out = out.eq("type", opts.type);
    if (opts.approvedOnly) out = out.not("approved_version_id", "is", null);
    return out;
  };

  let query = filter(
    sb
      .from("artifacts")
      .select(
        "id, type, task_id, project_id, updated_at, approved_version_id, tasks!artifacts_project_id_task_id_fkey(status), projects!artifacts_workspace_id_project_id_fkey(title, clients(name)), current:artifact_versions!artifacts_id_current_draft_version_id_fkey(version), approved:artifact_versions!artifacts_id_approved_version_id_fkey(version)",
      ),
  );
  if (opts.cursor) query = query.or(afterCursor("updated_at", opts.cursor));
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    query.order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE + 1),
    filter(sb.from("artifacts").select("id", { count: "exact", head: true })),
  ]);
  if (error || countError) throw new Error(`결과물을 불러오지 못했습니다: ${(error ?? countError)!.message}`);

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
  const rows = data as unknown as Row[];
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
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
    })),
    total: count ?? 0,
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor({ at: last.updated_at, id: last.id }) : null,
  };
}
