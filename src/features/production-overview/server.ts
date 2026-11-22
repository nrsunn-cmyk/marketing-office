import "server-only";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * UX-SCENARIO-AUDIT-01 F4·F5(AGY DESIGN-UX-F245-01 2·3절) 화면용 건수 읽기. 분수·% 없이 개수만 돌려준다.
 * - 모두 사용자 토큰 + 기존 select 정책(본인 업무실)으로 읽는다. 새 DB 함수·migration 없음.
 * - 보관(archived_at)된 것은 세지 않는다. 사용자 글(제목 등)은 돌려주지 않는다.
 * - 읽기에 실패하면 0 이 아니라 오류(화면은 '불러오지 못함').
 */

/** F4 현황(업무실 전체) */
export interface PendingCounts {
  /** P3 검수 대기: 열린 검수 회차(작성 중·보완 요청) 수 */
  qaPending: number;
  /** P4 실행 승인 대기: 승인 대기 실행 건 수 */
  executionPendingApproval: number;
}

/** F5 프로젝트 상세 'P3 제작·납품' 카드 */
export interface ProjectProductionCounts {
  /** 확정된 제작 브리프 수 */
  briefsReady: number;
  /** 산출물(홈페이지 문서·디자인 자산·영상 구성안·PPT 구성안) 상태별 수 — 작성 중·검토 완료 */
  outputs: { drafting: number; reviewed: number };
  /** 산출물 종류별(같은 두 상태) — 화면이 종류를 나눠 보여 줄 때 */
  byKind: Record<OutputKind, { drafting: number; reviewed: number }>;
  /** 검수 승인된 회차 수 */
  qaApproved: number;
  /** 납품 묶음 수 */
  deliveryBundles: number;
  /** 링크용 전략 작업 id(가장 최근 것, 없으면 null) — /tasks/[id]#production-brief */
  strategyTaskId: string | null;
}

export type OutputKind = "web_copy" | "design_asset" | "video_plan" | "ppt_deck";
const OUTPUT_TABLE: Record<OutputKind, string> = {
  web_copy: "web_copy_docs",
  design_asset: "design_assets",
  video_plan: "video_plans",
  ppt_deck: "ppt_decks",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  console.error(`[${where}]`, error.code, error.message);
  return fail("ERROR", "건수를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

/** F4: 업무실 전체 P3 검수 대기·P4 실행 승인 대기 건수 */
export async function getPendingCounts(): Promise<Result<PendingCounts>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const ws = workspace.id;
  const [qa, exec] = await Promise.all([
    sb.from("qa_reviews").select("id", { count: "exact", head: true }).eq("workspace_id", ws).in("status", ["drafting", "fix_requested"]).is("archived_at", null),
    sb.from("execution_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "pending_approval").is("archived_at", null),
  ]);
  const bad = [qa, exec].find((r) => r.error);
  if (bad?.error) return readFail("getPendingCounts", bad.error);
  return ok({ qaPending: qa.count ?? 0, executionPendingApproval: exec.count ?? 0 });
}

/** F5: 프로젝트 하나의 제작·납품 건수. 남의 프로젝트·없는 id 는 정책 때문에 모두 0(읽기 0행)이고 strategyTaskId 는 null */
export async function getProjectProductionCounts(projectId: string): Promise<Result<ProjectProductionCounts>> {
  if (!UUID.test(projectId)) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const ws = workspace.id;
  const kinds = Object.keys(OUTPUT_TABLE) as OutputKind[];
  // 산출물은 프로젝트당 수가 작아(브리프 10 × 종류별 상한) 상태만 읽어 센다 — 표마다 질의 1번(순서 = OUTPUT_TABLE 키 순서)
  const [briefs, approved, bundles, strategy, ...outs] = await Promise.all([
    sb.from("production_briefs").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("project_id", projectId).eq("status", "ready").is("archived_at", null),
    sb.from("qa_reviews").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("project_id", projectId).eq("status", "reviewed").is("archived_at", null),
    sb.from("delivery_bundles").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("project_id", projectId).is("archived_at", null),
    sb.from("tasks").select("id").eq("workspace_id", ws).eq("project_id", projectId).eq("type", "strategy").order("updated_at", { ascending: false }).limit(1),
    sb.from("web_copy_docs").select("status").eq("workspace_id", ws).eq("project_id", projectId).is("archived_at", null),
    sb.from("design_assets").select("status").eq("workspace_id", ws).eq("project_id", projectId).is("archived_at", null),
    sb.from("video_plans").select("status").eq("workspace_id", ws).eq("project_id", projectId).is("archived_at", null),
    sb.from("ppt_decks").select("status").eq("workspace_id", ws).eq("project_id", projectId).is("archived_at", null),
  ]);
  const bad = [briefs, approved, bundles, strategy, ...outs].find((r) => r.error);
  if (bad?.error) return readFail("getProjectProductionCounts", bad.error);

  const byKind = {} as ProjectProductionCounts["byKind"];
  const outputs = { drafting: 0, reviewed: 0 };
  kinds.forEach((k, i) => {
    const rows: Array<{ status: string }> = outs[i].data ?? [];
    const c = { drafting: rows.filter((r) => r.status === "drafting").length, reviewed: rows.filter((r) => r.status === "reviewed").length };
    byKind[k] = c;
    outputs.drafting += c.drafting;
    outputs.reviewed += c.reviewed;
  });
  const st = (strategy.data ?? []) as Array<{ id: string }>;
  return ok({
    briefsReady: briefs.count ?? 0,
    outputs,
    byKind,
    qaApproved: approved.count ?? 0,
    deliveryBundles: bundles.count ?? 0,
    strategyTaskId: st[0]?.id ?? null,
  });
}
