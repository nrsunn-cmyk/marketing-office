import "server-only";
import {
  PRODUCTION_BRIEF_DISPLAY,
  PRODUCTION_BRIEF_LIMITS,
  STALE_LABEL,
  isStaleStrategy,
  productionBriefCreateSchema,
  productionBriefDisplayStatus,
  productionBriefErrorFromDb,
  productionBriefIssueMessage,
  productionBriefUpdateSchema,
  type DeliverableType,
  type ProductionBriefDisplayStatus,
  type ProductionBriefStatus,
} from "@/domain/production-brief";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type ErrorCode, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * P3A-BACKEND-01: 공통 제작 브리프(P3-a) 서버 함수. 화면은 프로젝트 상세의 제작 영역에 붙는다(Front).
 * 읽기는 본인 업무실(RLS + workspace_id 조건), 쓰기는 정의자 RPC(20261121001000_p3a_production_briefs.sql)만 쓴다.
 * AI 호출·외부 요청 없음(Master Q8).
 */

export interface ProductionStrategyOption {
  artifactId: string;
  /** 승인본 판 번호(없으면 null — 고를 수 없음) */
  approvedVersion: number | null;
  approvedVersionId: string | null;
  /** 전략 작업이 취소됐으면 고를 수 없음 */
  cancelled: boolean;
  /** 만들기에 고를 수 있는지 */
  selectable: boolean;
}

export interface ProductionBriefView {
  id: string;
  title: string;
  targetAudience: string;
  coreMessage: string;
  deliverableTypes: DeliverableType[];
  scopeSummary: string;
  brandToneConstraints: string | null;
  referenceNotes: string | null;
  status: ProductionBriefStatus;
  displayStatus: ProductionBriefDisplayStatus;
  displayLabel: string;
  archived: boolean;
  archivedAt: string | null;
  /** 낙관적 잠금 값. 뒤 단계(P3-b~e)는 이 값을 source_brief_revision 으로 저장한다(D9) */
  revision: number;
  strategyArtifactId: string;
  strategyVersion: { id: string; version: number | null };
  /** 바탕 판이 지금 승인본과 다르거나 승인본이 없으면 true(막지 않고 경고, '지금 승인본 기준으로 맞추기'로 해소) */
  stale: boolean;
  staleLabel: string | null;
  /** 지금 승인본이 있어서 맞추기를 누를 수 있는지 */
  canRebase: boolean;
  /** 고칠 수 없는 이유(보관·프로젝트 보관·전략 작업 취소). null 이면 고칠 수 있음 */
  readOnlyReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionBriefBoard {
  projectId: string;
  briefs: ProductionBriefView[];
  strategies: ProductionStrategyOption[];
  canCreate: boolean;
  createBlockedReason: string | null;
  activeCount: number;
  limit: number;
}

const PROJECT_ARCHIVED = "보관한 프로젝트입니다. 프로젝트를 다시 열어야 제작 브리프를 만들거나 고칠 수 있습니다.";
const TASK_CANCELLED = "취소된 전략 작업을 바탕으로 한 제작 브리프입니다. 읽기만 할 수 있습니다.";
const ARCHIVED = "보관한 제작 브리프입니다. 읽기만 할 수 있습니다.";

const asStatus = (s: string): ProductionBriefStatus => (s === "ready" ? "ready" : "drafting");

/** 프로젝트의 제작 브리프 목록과 만들기 가능 여부. 남의 프로젝트·없는 프로젝트는 NOT_FOUND */
export async function getProductionBriefsFor(projectId: string): Promise<Result<ProductionBriefBoard>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const pr = await sb.from("projects").select("id, status").eq("id", projectId).eq("workspace_id", workspace.id).maybeSingle();
  if (pr.error) return readFail("getProductionBriefsFor.project", pr.error);
  if (!pr.data) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  const projectArchived = pr.data.status === "archived";

  const [br, ar] = await Promise.all([
    sb.from("production_briefs").select("*").eq("workspace_id", workspace.id).eq("project_id", projectId).order("created_at", { ascending: true }),
    sb.from("artifacts").select("id, approved_version_id, task_id").eq("workspace_id", workspace.id).eq("project_id", projectId).eq("type", "strategy"),
  ]);
  if (br.error) return readFail("getProductionBriefsFor.briefs", br.error);
  if (ar.error) return readFail("getProductionBriefsFor.strategies", ar.error);

  const taskIds = [...new Set(ar.data.map((a) => a.task_id))];
  const versionIds = [...new Set([...ar.data.map((a) => a.approved_version_id), ...br.data.map((b) => b.strategy_version_id)].filter((x): x is string => !!x))];
  const [tk, vs] = await Promise.all([
    taskIds.length ? sb.from("tasks").select("id, status").eq("workspace_id", workspace.id).in("id", taskIds) : Promise.resolve({ data: [], error: null }),
    versionIds.length ? sb.from("artifact_versions").select("id, version").eq("workspace_id", workspace.id).in("id", versionIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (tk.error) return readFail("getProductionBriefsFor.tasks", tk.error);
  if (vs.error) return readFail("getProductionBriefsFor.versions", vs.error);
  const taskStatus = new Map((tk.data ?? []).map((t) => [t.id, t.status]));
  const versionNo = new Map((vs.data ?? []).map((v) => [v.id, v.version]));

  const strategies: ProductionStrategyOption[] = ar.data.map((a) => {
    const cancelled = taskStatus.get(a.task_id) === "cancelled";
    return {
      artifactId: a.id,
      approvedVersionId: a.approved_version_id,
      approvedVersion: a.approved_version_id ? (versionNo.get(a.approved_version_id) ?? null) : null,
      cancelled,
      selectable: !cancelled && a.approved_version_id !== null,
    };
  });
  const byArtifact = new Map(strategies.map((s) => [s.artifactId, s]));

  const briefs: ProductionBriefView[] = br.data.map((b) => {
    const s = byArtifact.get(b.strategy_artifact_id);
    const approved = s?.approvedVersionId ?? null;
    const archived = b.archived_at !== null;
    const status = asStatus(b.status);
    const stale = isStaleStrategy(b.strategy_version_id, approved);
    const displayStatus = productionBriefDisplayStatus({ archived, status });
    const readOnlyReason = archived ? ARCHIVED : projectArchived ? PROJECT_ARCHIVED : s?.cancelled ? TASK_CANCELLED : null;
    return {
      id: b.id,
      title: b.title,
      targetAudience: b.target_audience,
      coreMessage: b.core_message,
      deliverableTypes: b.deliverable_types as DeliverableType[],
      scopeSummary: b.scope_summary,
      brandToneConstraints: b.brand_tone_constraints,
      referenceNotes: b.reference_notes,
      status,
      displayStatus,
      displayLabel: PRODUCTION_BRIEF_DISPLAY[displayStatus],
      archived,
      archivedAt: b.archived_at,
      revision: b.revision,
      strategyArtifactId: b.strategy_artifact_id,
      strategyVersion: { id: b.strategy_version_id, version: versionNo.get(b.strategy_version_id) ?? null },
      stale,
      staleLabel: stale ? STALE_LABEL : null,
      canRebase: stale && approved !== null && readOnlyReason === null,
      readOnlyReason,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    };
  });
  briefs.sort((x, y) => Number(x.archived) - Number(y.archived));
  const activeCount = briefs.filter((b) => !b.archived).length;
  const reason = projectArchived
    ? PROJECT_ARCHIVED
    : !strategies.some((s) => s.selectable)
      ? "승인된 전략이 있어야 제작 브리프를 만들 수 있습니다. 전략을 먼저 승인해 주세요."
      : activeCount >= PRODUCTION_BRIEF_LIMITS.perProject
        ? `한 프로젝트에는 제작 브리프를 ${PRODUCTION_BRIEF_LIMITS.perProject}개까지 둘 수 있습니다. 쓰지 않는 것을 보관해 주세요.`
        : null;
  return ok({ projectId, briefs, strategies, canCreate: reason === null, createBlockedReason: reason, activeCount, limit: PRODUCTION_BRIEF_LIMITS.perProject });
}

function readFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  console.error(`[${where}]`, error.code, error.message);
  return fail("ERROR", "제작 브리프를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  const e = productionBriefErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  const code: ErrorCode =
    e.code === "CONFLICT" ? "CONFLICT" : e.code === "NOT_FOUND" ? "NOT_FOUND" : e.code === "INVALID_TRANSITION" ? "INVALID_TRANSITION" : e.code === "ERROR" ? "ERROR" : "VALIDATION";
  return fail(code, e.message);
}

/** 만들기. raw = { title, targetAudience, coreMessage, deliverableTypes, scopeSummary, brandToneConstraints?, referenceNotes? } */
export async function createProductionBrief(projectId: string, strategyArtifactId: string, raw: unknown): Promise<Result<{ briefId: string }>> {
  const parsed = productionBriefCreateSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION", productionBriefIssueMessage(parsed.error.issues[0]));
  const v = parsed.data;
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("create_production_brief", {
    p_project_id: projectId,
    p_strategy_artifact_id: strategyArtifactId,
    p_title: v.title,
    p_target_audience: v.targetAudience,
    p_core_message: v.coreMessage,
    p_deliverable_types: v.deliverableTypes,
    p_scope_summary: v.scopeSummary,
    p_brand_tone_constraints: v.brandToneConstraints ?? undefined,
    p_reference_notes: v.referenceNotes ?? undefined,
  });
  if (error) return rpcFail("createProductionBrief", error);
  return ok({ briefId: data });
}

/** 값 전체 교체 + 상태(drafting·ready). 바뀐 것이 없으면 VALIDATION */
export async function updateProductionBrief(briefId: string, expectedRevision: number, raw: unknown): Promise<Result<{ revision: number }>> {
  const parsed = productionBriefUpdateSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION", productionBriefIssueMessage(parsed.error.issues[0]));
  const v = parsed.data;
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("update_production_brief", {
    p_brief_id: briefId,
    p_expected_revision: expectedRevision,
    p_title: v.title,
    p_target_audience: v.targetAudience,
    p_core_message: v.coreMessage,
    p_deliverable_types: v.deliverableTypes,
    p_scope_summary: v.scopeSummary,
    p_brand_tone_constraints: v.brandToneConstraints as string,
    p_reference_notes: v.referenceNotes as string,
    p_status: v.status,
  });
  if (error) return rpcFail("updateProductionBrief", error);
  return ok({ revision: data });
}

/** 바탕 판을 지금 승인본으로 다시 맞춘다(주인님이 누를 때만) */
export async function rebaseProductionBrief(briefId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("rebase_production_brief", { p_brief_id: briefId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("rebaseProductionBrief", error);
  return ok({ revision: data });
}

/** 보관(삭제 대신, 되돌리기 없음) */
export async function archiveProductionBrief(briefId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("archive_production_brief", { p_brief_id: briefId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("archiveProductionBrief", error);
  return ok({ revision: data });
}
