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

// ─────────────────────────────────────────────
// UX-G1-G4-BACKEND-01(AGY UX-G1-G4-OVERVIEW-HANDOFF 3절): 현황 G1 대기 프로젝트 바로가기·G4 CRM 후속 기한 읽기.
// - 새 DB 함수·migration 없음. 사용자 토큰 + 기존 select 정책(본인 업무실)으로 읽는다.
// - 프로젝트 보관은 projects.status = 'archived'(projects 에는 archived_at 이 없다). 각 행의 archived_at 도 뺀다.
// - 돌려주는 것은 건수·프로젝트 id/이름·기한 날짜·링크뿐. 문의 고객 원문(이름·전화·이메일)은 읽지도 않는다
//   (crm_followups 에서 project_id·due_date 만 고른다, inquiries 는 부르지 않는다).
// ─────────────────────────────────────────────

export interface OverviewWaitingProject {
  projectId: string;
  projectName: string;
  count: number;
  /** G1-P3: /tasks/{전략 작업 id}#qa-checklist(없으면 /projects/{id}), G1-P4: /projects/{id}/execution#queue */
  targetHref: string;
}
export interface OverviewWaitingList {
  /** 건수 많은 순 최대 3개(같으면 이름 순) */
  projects: OverviewWaitingProject[];
  /** 대기 건이 있는 프로젝트 전체 수(보관 프로젝트 제외) — '외 n개 프로젝트 더 있음' 계산용 */
  totalProjectCount: number;
}
export interface OverviewWaitingProjects {
  qa: OverviewWaitingList;
  execution: OverviewWaitingList;
}

export interface OverviewCrmFollowupSummary {
  /** 기한 지남 + 오늘~7일 안, 열린(todo·in_progress) 후속 건수 */
  totalDueWithin7Days: number;
  /** 오늘(KST)보다 앞선 기한 */
  overdueCount: number;
  /** 가장 빠른 기한 순 최대 3개(같으면 건수 많은 순, 이름 순) */
  projects: Array<{ projectId: string; projectName: string; count: number; earliestDueDate: string; targetHref: string }>;
  totalProjectCount: number;
}

const TOP = 3;
/** 열린 후속 상태. done(완료)·hold(보류)는 세지 않는다 */
const OPEN_FOLLOWUP = ["todo", "in_progress"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Sb = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** 프로젝트 id → 이름(보관 프로젝트와 못 읽는 프로젝트는 빠진다) */
async function liveProjectNames(sb: Sb, ws: string, ids: string[]): Promise<Result<Map<string, string>>> {
  if (ids.length === 0) return ok(new Map());
  const { data, error } = await sb.from("projects").select("id, title, status").eq("workspace_id", ws).in("id", ids);
  if (error) return readFail("liveProjectNames", error);
  const out = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ id: string; title: string; status: string }>) if (r.status !== "archived") out.set(r.id, r.title);
  return ok(out);
}

function countBy(rows: Array<{ project_id: string }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.project_id, (m.get(r.project_id) ?? 0) + 1);
  return m;
}

function topWaiting(counts: Map<string, number>, names: Map<string, string>, href: (id: string) => string): OverviewWaitingList {
  const all = [...counts].filter(([id]) => names.has(id)).map(([id, n]) => ({ projectId: id, projectName: names.get(id)!, count: n }));
  all.sort((a, b) => b.count - a.count || a.projectName.localeCompare(b.projectName, "ko") || a.projectId.localeCompare(b.projectId));
  return { projects: all.slice(0, TOP).map((p) => ({ ...p, targetHref: href(p.projectId) })), totalProjectCount: all.length };
}

/** G1: P3 검수 대기(작성 중·보완 요청 회차)·P4 실행 승인 대기가 있는 프로젝트 상위 3개씩 */
export async function getOverviewWaitingProjects(): Promise<Result<OverviewWaitingProjects>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const ws = workspace.id;
  const [qa, exec] = await Promise.all([
    sb.from("qa_reviews").select("project_id").eq("workspace_id", ws).in("status", ["drafting", "fix_requested"]).is("archived_at", null),
    sb.from("execution_jobs").select("project_id").eq("workspace_id", ws).eq("status", "pending_approval").is("archived_at", null),
  ]);
  const bad = [qa, exec].find((r) => r.error);
  if (bad?.error) return readFail("getOverviewWaitingProjects", bad.error);
  const qaCounts = countBy((qa.data ?? []) as Array<{ project_id: string }>);
  const execCounts = countBy((exec.data ?? []) as Array<{ project_id: string }>);

  const names = await liveProjectNames(sb, ws, [...new Set([...qaCounts.keys(), ...execCounts.keys()])]);
  if (!names.ok) return names;

  // 검수 링크: 프로젝트마다 가장 최근 전략 작업(기존 F5 strategyTaskId 와 같은 기준). 없으면 프로젝트 화면
  const qaIds = [...qaCounts.keys()].filter((id) => names.data.has(id));
  const strategy = new Map<string, string>();
  if (qaIds.length > 0) {
    const { data, error } = await sb
      .from("tasks")
      .select("id, project_id")
      .eq("workspace_id", ws)
      .eq("type", "strategy")
      .in("project_id", qaIds)
      .order("updated_at", { ascending: false });
    if (error) return readFail("getOverviewWaitingProjects", error);
    for (const t of (data ?? []) as Array<{ id: string; project_id: string }>) if (!strategy.has(t.project_id)) strategy.set(t.project_id, t.id);
  }
  return ok({
    qa: topWaiting(qaCounts, names.data, (id) => (strategy.has(id) ? `/tasks/${strategy.get(id)}#qa-checklist` : `/projects/${id}`)),
    execution: topWaiting(execCounts, names.data, (id) => `/projects/${id}/execution#queue`),
  });
}

/**
 * G4: 업무실 CRM 후속 연락 중 기한이 지났거나 오늘~7일 안인 열린 건. today = 화면이 정한 KST 오늘(YYYY-MM-DD),
 * 기존 '납기 임박'(getDashboard)과 같은 범위(지난 것 포함, today+7 까지).
 */
export async function getOverviewCrmFollowups(today: string): Promise<Result<OverviewCrmFollowupSummary>> {
  if (!ISO_DATE.test(today) || Number.isNaN(Date.parse(`${today}T00:00:00Z`))) return fail("VALIDATION", "날짜 형식이 올바르지 않습니다.");
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const ws = workspace.id;
  const { data, error } = await sb
    .from("crm_followups" as never) // 생성 형식에 P4 표가 없어 기존 channels.ts 와 같은 방식
    .select("project_id, due_date")
    .eq("workspace_id", ws)
    .in("status", OPEN_FOLLOWUP)
    .is("archived_at", null)
    .lte("due_date", addDaysIso(today, 7));
  if (error) return readFail("getOverviewCrmFollowups", error);
  const rows = (data ?? []) as unknown as Array<{ project_id: string; due_date: string }>;
  const names = await liveProjectNames(sb, ws, [...new Set(rows.map((r) => r.project_id))]);
  if (!names.ok) return names;

  const live = rows.filter((r) => names.data.has(r.project_id));
  const per = new Map<string, { count: number; earliest: string }>();
  for (const r of live) {
    const d = String(r.due_date).slice(0, 10);
    const cur = per.get(r.project_id);
    per.set(r.project_id, cur ? { count: cur.count + 1, earliest: d < cur.earliest ? d : cur.earliest } : { count: 1, earliest: d });
  }
  const all = [...per].map(([id, v]) => ({ projectId: id, projectName: names.data.get(id)!, count: v.count, earliestDueDate: v.earliest }));
  all.sort(
    (a, b) =>
      a.earliestDueDate.localeCompare(b.earliestDueDate) || b.count - a.count || a.projectName.localeCompare(b.projectName, "ko") || a.projectId.localeCompare(b.projectId),
  );
  return ok({
    totalDueWithin7Days: live.length,
    overdueCount: live.filter((r) => String(r.due_date).slice(0, 10) < today).length,
    projects: all.slice(0, TOP).map((p) => ({ ...p, targetHref: `/projects/${p.projectId}/execution#p4b-ops` })),
    totalProjectCount: all.length,
  });
}
