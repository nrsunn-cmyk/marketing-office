import "server-only";
import {
  FUNNEL_STAGES,
  funnelErrorFromDb,
  funnelIssueMessage,
  funnelItemInputSchema,
  funnelStageFocusSchema,
  funnelWarnings,
  strategyBasisOf,
  type FunnelBoardWarning,
  type FunnelItemInput,
  type FunnelStageKey,
  type FunnelStrategyBasis,
  type LeadMagnetDetails,
} from "@/domain/funnel";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type ErrorCode, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/server/supabase/database.types";
import { getTaskDetail, type TaskDetail } from "@/features/tasks/server";

/**
 * P2D-BACKEND-01: 퍼널 보드 서버 함수. 화면은 전략 작업 화면(tasks/[taskId]) 아래에 붙는다.
 * 읽기는 본인 업무실(RLS), 쓰기는 정의자 RPC(20261118001000_p2d_funnel_board.sql)만 쓴다.
 */

export interface FunnelItemView {
  id: string;
  kind: FunnelItemInput["kind"];
  title: string;
  description: string | null;
  channel: string | null;
  status: FunnelItemInput["status"];
  targetNote: string | null;
  details: LeadMagnetDetails | null;
  /** 이 카드가 가리키는 리드마그넷 기획(P2-e, cta·lead_magnet 카드만). 없으면 null */
  leadMagnetId: string | null;
  position: number;
  revision: number;
  updatedAt: string;
}
export interface FunnelStageView {
  id: string;
  key: FunnelStageKey;
  label: string;
  position: number;
  focus: string | null;
  revision: number;
  items: FunnelItemView[];
}
export interface FunnelBoard {
  /**
   * no_artifact: 전략 초안이 아직 없다 / not_approved: 전략 승인본이 없다(퍼널을 만들 수 없음)
   * ready: 승인본이 있고 퍼널이 아직 없다(만들 수 있음) / board: 퍼널이 있다
   */
  state: "no_artifact" | "not_approved" | "ready" | "board";
  strategy: {
    artifactId: string | null;
    /** 지금 승인본(없으면 null). 승인이 해제되는 경로는 없지만, 없을 때도 보드는 읽고 고칠 수 있다 */
    approvedVersion: { id: string; version: number } | null;
    /** 퍼널이 이어받는 목표·제안·타깃. 퍼널이 있으면 퍼널이 참조한 버전, 없으면 지금 승인본 기준 */
    basis: FunnelStrategyBasis;
  };
  funnel: {
    id: string;
    revision: number;
    strategyVersion: { id: string; version: number };
    /** 참조 버전 ≠ 지금 승인본 → 화면의 "이전 전략 기준" 배지(DEC-P2-01-A 결정 전: 표시만, 편집은 막지 않음) */
    stale: boolean;
  } | null;
  stages: FunnelStageView[];
  warnings: FunnelBoardWarning[];
}

type VersionRow = { id: string; version: number; content: unknown };

/** 전략 작업의 퍼널 보드. 작업이 없거나 전략이 아니면 null */
export async function getFunnelBoard(taskId: string): Promise<FunnelBoard | null> {
  return getFunnelBoardFor(await getTaskDetail(taskId));
}

/**
 * 이미 읽은 작업 상세로 퍼널 보드를 읽는다(P2D-FRONT-01-R1, QA O-b).
 * 작업 화면이 getTaskDetail 을 한 번 읽었으면 그 값을 넘겨 같은 요청에서 다시 읽지 않는다.
 * detail 은 반드시 서버에서 getTaskDetail 로 읽은 값이어야 한다(브라우저 입력을 받지 않는다).
 * 퍼널 표 조회는 그대로 본인 업무실(workspace_id 조건 + RLS)로 한정된다.
 */
export async function getFunnelBoardFor(detail: TaskDetail | null): Promise<FunnelBoard | null> {
  if (!detail || detail.task.type !== "strategy") return null;
  const art = detail.artifact;
  const versions = detail.versions as unknown as VersionRow[];
  const byId = new Map(versions.map((v) => [v.id, v]));
  const approved = art?.approved_version_id ? byId.get(art.approved_version_id) ?? null : null;
  const empty: FunnelBoard = {
    state: !art ? "no_artifact" : approved ? "ready" : "not_approved",
    strategy: { artifactId: art?.id ?? null, approvedVersion: approved ? { id: approved.id, version: approved.version } : null, basis: strategyBasisOf(approved?.content) },
    funnel: null,
    stages: [],
    warnings: [],
  };
  if (!art) return empty;

  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data: f, error } = await sb
    .from("funnels")
    .select("id, revision, strategy_version_id")
    .eq("workspace_id", workspace.id)
    .eq("strategy_artifact_id", art.id)
    .maybeSingle();
  if (error) throw new Error(`퍼널을 불러오지 못했습니다: ${error.message}`);
  if (!f) return empty;

  const [st, it] = await Promise.all([
    sb.from("funnel_stages").select("id, stage_key, position, focus, revision").eq("workspace_id", workspace.id).eq("funnel_id", f.id).order("position"),
    sb
      .from("funnel_items")
      .select("id, stage_id, kind, title, description, channel, status, target_note, details, lead_magnet_id, position, revision, updated_at")
      .eq("workspace_id", workspace.id)
      .eq("funnel_id", f.id)
      .is("archived_at", null)
      .order("position"),
  ]);
  if (st.error) throw new Error(`퍼널 단계를 불러오지 못했습니다: ${st.error.message}`);
  if (it.error) throw new Error(`퍼널 카드를 불러오지 못했습니다: ${it.error.message}`);

  const items = new Map<string, FunnelItemView[]>();
  for (const i of it.data ?? []) {
    const list = items.get(i.stage_id) ?? [];
    list.push({
      id: i.id,
      kind: i.kind as FunnelItemView["kind"],
      title: i.title,
      description: i.description,
      channel: i.channel,
      status: i.status as FunnelItemView["status"],
      targetNote: i.target_note,
      details: (i.details as LeadMagnetDetails | null) ?? null,
      leadMagnetId: i.lead_magnet_id ?? null,
      position: i.position,
      revision: i.revision,
      updatedAt: i.updated_at,
    });
    items.set(i.stage_id, list);
  }
  const stages: FunnelStageView[] = (st.data ?? []).map((s) => ({
    id: s.id,
    key: s.stage_key as FunnelStageKey,
    label: FUNNEL_STAGES.find((x) => x.key === s.stage_key)?.label ?? s.stage_key,
    position: s.position,
    focus: s.focus,
    revision: s.revision,
    items: items.get(s.id) ?? [],
  }));
  const counts = Object.fromEntries(stages.map((s) => [s.key, s.items.length])) as Partial<Record<FunnelStageKey, number>>;
  const ref = byId.get(f.strategy_version_id);
  return {
    state: "board",
    strategy: { ...empty.strategy, basis: strategyBasisOf(ref?.content) },
    funnel: {
      id: f.id,
      revision: f.revision,
      strategyVersion: { id: f.strategy_version_id, version: ref?.version ?? 0 },
      stale: f.strategy_version_id !== art.approved_version_id,
    },
    stages,
    warnings: funnelWarnings(counts),
  };
}

function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  const e = funnelErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  const code: ErrorCode =
    e.code === "CONFLICT" ? "CONFLICT" : e.code === "NOT_FOUND" ? "NOT_FOUND" : e.code === "INVALID_TRANSITION" ? "INVALID_TRANSITION" : e.code === "ERROR" ? "ERROR" : "VALIDATION";
  return fail(code, e.message);
}

/** 퍼널 만들기(전략 승인본 기준). 이미 있으면 기존 것 */
export async function createFunnel(taskId: string): Promise<Result<{ funnelId: string; reused: boolean }>> {
  const detail = await getTaskDetail(taskId);
  if (!detail || detail.task.type !== "strategy") return fail("NOT_FOUND", "전략 작업을 찾을 수 없습니다.");
  if (!detail.artifact) return fail("VALIDATION", "전략 초안을 먼저 만들어 주세요.");
  if (!detail.artifact.approved_version_id) return fail("VALIDATION", "전략을 승인한 뒤 퍼널을 만들 수 있습니다.");
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("create_funnel", { p_strategy_artifact_id: detail.artifact.id }).single();
  if (error) return rpcFail("createFunnel", error);
  return ok({ funnelId: data.funnel_id, reused: data.reused });
}

/** 참조 전략을 지금 승인본으로 다시 맞춘다(주인님이 누를 때만) */
export async function rebaseFunnel(funnelId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("rebase_funnel", { p_funnel_id: funnelId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("rebaseFunnel", error);
  return ok({ revision: data });
}

export async function updateFunnelStage(stageId: string, expectedRevision: number, focus: string | null): Promise<Result<{ revision: number }>> {
  const parsed = funnelStageFocusSchema.safeParse(focus);
  if (!parsed.success) return fail("VALIDATION", funnelIssueMessage(parsed.error.issues[0]));
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("update_funnel_stage", { p_stage_id: stageId, p_expected_revision: expectedRevision, p_focus: parsed.data ?? "" });
  if (error) return rpcFail("updateFunnelStage", error);
  return ok({ revision: data });
}

/** 입력 계약 확인. 실패하면 첫 안내 문구 */
export function parseFunnelItem(raw: unknown): Result<FunnelItemInput> {
  const parsed = funnelItemInputSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION", funnelIssueMessage(parsed.error.issues[0]));
  return ok(parsed.data);
}

export async function addFunnelItem(stageId: string, raw: unknown): Promise<Result<{ itemId: string }>> {
  const p = parseFunnelItem(raw);
  if (!p.ok) return p;
  const v = p.data;
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("add_funnel_item", {
    p_stage_id: stageId,
    p_kind: v.kind,
    p_title: v.title,
    p_description: v.description ?? undefined,
    p_channel: v.channel ?? undefined,
    p_status: v.status,
    p_target_note: v.targetNote ?? undefined,
    p_details: (v.details ?? undefined) as Json | undefined,
  });
  if (error) return rpcFail("addFunnelItem", error);
  return ok({ itemId: data });
}

/** 카드 값 전체 교체. stageId 가 바뀌면 같은 퍼널의 그 단계 맨 끝으로 옮긴다 */
export async function updateFunnelItem(itemId: string, expectedRevision: number, stageId: string, raw: unknown): Promise<Result<{ revision: number }>> {
  const p = parseFunnelItem(raw);
  if (!p.ok) return p;
  const v = p.data;
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("update_funnel_item", {
    p_item_id: itemId,
    p_expected_revision: expectedRevision,
    p_stage_id: stageId,
    p_kind: v.kind,
    p_title: v.title,
    p_description: v.description as string,
    p_channel: v.channel as string,
    p_status: v.status,
    p_target_note: v.targetNote as string,
    p_details: v.details as Json,
  });
  if (error) return rpcFail("updateFunnelItem", error);
  return ok({ revision: data });
}

export async function archiveFunnelItem(itemId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("archive_funnel_item", { p_item_id: itemId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("archiveFunnelItem", error);
  return ok({ revision: data });
}
