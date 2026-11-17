import "server-only";
import { researchSourceErrorFromDb, type ResearchReviewStatus, type ResearchSourceInput } from "@/domain/research-source/input";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** 화면에 보여 줄 출처 한 줄 */
export interface ResearchSourceSummary {
  id: string;
  project_id: string;
  url: string;
  title: string;
  publisher: string | null;
  retrieved_at: string;
  quoted_excerpt: string | null;
  review_status: ResearchReviewStatus;
  revision: number;
  created_at: string;
}

function dbFail<T>(where: string, error: { code?: string; message?: string }): Result<T> {
  console.error(`[${where}]`, error.code, error.message);
  const e = researchSourceErrorFromDb(error);
  return fail(e.code, e.message);
}

/** 프로젝트의 출처 목록(최근 순). 본인 업무실(RLS) 안에서만 읽는다 */
export async function listResearchSources(projectId: string): Promise<ResearchSourceSummary[]> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("research_sources")
    .select("id, project_id, url, title, publisher, retrieved_at, quoted_excerpt, review_status, revision, created_at")
    .eq("workspace_id", workspace.id)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`출처 목록을 불러오지 못했습니다: ${error.message}`);
  return data as ResearchSourceSummary[];
}

/** 출처 추가. 직접 INSERT 는 막혀 있어 RPC(add_research_source, 정의자·본인 프로젝트 확인)로만 넣는다 */
export async function addResearchSource(projectId: string, input: ResearchSourceInput): Promise<Result<{ id: string }>> {
  await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("add_research_source", {
    p_project_id: projectId,
    p_url: input.url,
    p_title: input.title,
    p_retrieved_at: input.retrievedAt,
    ...(input.publisher ? { p_publisher: input.publisher } : {}),
    ...(input.quotedExcerpt ? { p_quoted_excerpt: input.quotedExcerpt } : {}),
  });
  if (error) return dbFail("addResearchSource", error);
  return ok({ id: data });
}

/** 검토 상태 변경. 화면이 본 revision 과 다르면 CONFLICT */
export async function setResearchSourceReview(
  sourceId: string,
  status: ResearchReviewStatus,
  expectedRevision: number,
): Promise<Result<{ revision: number }>> {
  await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("set_research_source_review", {
    p_source_id: sourceId,
    p_status: status,
    p_expected_revision: expectedRevision,
  });
  if (error) return dbFail("setResearchSourceReview", error);
  return ok({ revision: data });
}
