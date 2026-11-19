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

/** 출처를 인용한 브리프 한 줄(주장 1개 = 1줄. 한 브리프에 같은 출처를 인용한 주장이 여럿이면 여러 줄) */
export interface ResearchSourceCitation {
  briefId: string;
  briefTitle: string;
  channel: string;
  /** 화면 링크용: /tasks/{taskId}?brief={briefId}#brief */
  taskId: string;
  claimText: string;
}

/** in(...) 목록이 길어 주소가 너무 길어지지 않게 나눈다 */
const CHUNK = 100;
const chunks = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

/**
 * SOURCES-SERVER-01(Front SOURCES-UI-01 요청): 프로젝트 출처별로 그 출처를 근거로 연결한 브리프 목록.
 * 경로: 이 프로젝트 출처 → 해제 안 된 research 근거 연결 → 보관 안 된 주장 → 같은 프로젝트 브리프 → 전략 결과물의 task_id.
 * 모든 조회에 본인 업무실 조건을 걸고 RLS(본인 업무실 select)도 함께 적용된다. 인용이 없는 출처는 키가 없다.
 */
export async function listResearchSourceCitations(projectId: string): Promise<Record<string, ResearchSourceCitation[]>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const fail = (what: string, e: { message: string }) => new Error(`인용한 브리프를 불러오지 못했습니다(${what}): ${e.message}`);

  const src = await sb.from("research_sources").select("id").eq("workspace_id", workspace.id).eq("project_id", projectId);
  if (src.error) throw fail("출처", src.error);
  const sourceIds = src.data.map((r) => r.id);
  if (!sourceIds.length) return {};

  const links: { claim_id: string; research_source_id: string | null }[] = [];
  for (const ids of chunks(sourceIds)) {
    const r = await sb
      .from("content_claim_sources")
      .select("claim_id, research_source_id")
      .eq("workspace_id", workspace.id)
      .eq("kind", "research")
      .is("unlinked_at", null)
      .in("research_source_id", ids);
    if (r.error) throw fail("근거 연결", r.error);
    links.push(...r.data);
  }
  if (!links.length) return {};

  const claims = new Map<string, { text: string; brief_id: string }>();
  for (const ids of chunks([...new Set(links.map((l) => l.claim_id))])) {
    const r = await sb.from("content_brief_claims").select("id, text, brief_id").eq("workspace_id", workspace.id).is("archived_at", null).in("id", ids);
    if (r.error) throw fail("주장", r.error);
    for (const c of r.data) claims.set(c.id, { text: c.text, brief_id: c.brief_id });
  }

  const briefs = new Map<string, { title: string; channel: string; strategy_artifact_id: string }>();
  for (const ids of chunks([...new Set([...claims.values()].map((c) => c.brief_id))])) {
    const r = await sb
      .from("content_briefs")
      .select("id, title, channel, strategy_artifact_id")
      .eq("workspace_id", workspace.id)
      .eq("project_id", projectId)
      .in("id", ids);
    if (r.error) throw fail("브리프", r.error);
    for (const b of r.data) briefs.set(b.id, { title: b.title, channel: b.channel, strategy_artifact_id: b.strategy_artifact_id });
  }

  const taskOf = new Map<string, string>();
  for (const ids of chunks([...new Set([...briefs.values()].map((b) => b.strategy_artifact_id))])) {
    const r = await sb.from("artifacts").select("id, task_id").eq("workspace_id", workspace.id).in("id", ids);
    if (r.error) throw fail("결과물", r.error);
    for (const a of r.data) taskOf.set(a.id, a.task_id);
  }

  const out: Record<string, ResearchSourceCitation[]> = {};
  for (const l of links) {
    const c = claims.get(l.claim_id);
    const b = c && briefs.get(c.brief_id);
    const taskId = b && taskOf.get(b.strategy_artifact_id);
    if (!l.research_source_id || !c || !b || !taskId) continue;
    (out[l.research_source_id] ??= []).push({ briefId: c.brief_id, briefTitle: b.title, channel: b.channel, taskId, claimText: c.text });
  }
  for (const rows of Object.values(out)) rows.sort((x, y) => x.briefTitle.localeCompare(y.briefTitle, "ko") || x.briefId.localeCompare(y.briefId));
  return out;
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
