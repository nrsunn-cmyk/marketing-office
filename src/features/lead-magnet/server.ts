import "server-only";
import { funnelStageLabel, type FunnelStageKey } from "@/domain/funnel";
import {
  leadMagnetErrorFromDb,
  leadMagnetInputSchema,
  leadMagnetIssueMessage,
  type LeadMagnetDelivery,
  type LeadMagnetFormat,
  type LeadMagnetInput,
  type LeadMagnetStatus,
} from "@/domain/lead-magnet";
import type { FunnelBoard } from "@/features/funnel/server";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type ErrorCode, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/server/supabase/database.types";

/**
 * P2E-BACKEND-01: 리드마그넷 기획(P2-e) 서버 함수. 화면은 퍼널 보드(전략 작업 화면) 아래에 붙는다.
 * 읽기는 본인 업무실(RLS + workspace_id 조건), 쓰기는 정의자 RPC(20261119004000_p2e_lead_magnets.sql)만 쓴다.
 */

export interface LeadMagnetLinkedItem {
  id: string;
  title: string;
  kind: string;
  stageId: string;
}
export interface LeadMagnetView {
  id: string;
  stageId: string;
  stageKey: FunnelStageKey | null;
  stageLabel: string;
  title: string;
  format: LeadMagnetFormat;
  audience: string | null;
  promise: string | null;
  delivery: LeadMagnetDelivery | null;
  leadFields: string[];
  outline: string[];
  status: LeadMagnetStatus;
  revision: number;
  updatedAt: string;
  /** 보관한 것. 목록에는 보관하지 않은 카드가 아직 가리키는 것만 함께 온다("보관된 리드마그넷" 표시용) */
  archived: boolean;
  strategyVersion: { id: string; version: number | null };
  /** 참조 전략 버전 ≠ 지금 승인본 → "이전 전략 기준" 배지(DEC-P2-01-A: 표시만, 편집은 막지 않음) */
  stale: boolean;
  /** 이 리드마그넷을 가리키는 보관하지 않은 퍼널 카드 */
  linkedItems: LeadMagnetLinkedItem[];
}

const COLS =
  "id, stage_id, title, format, audience, promise, delivery, lead_fields, outline, status, revision, updated_at, archived_at, strategy_version_id";
type Row = {
  id: string;
  stage_id: string;
  title: string;
  format: string;
  audience: string | null;
  promise: string | null;
  delivery: string | null;
  lead_fields: Json;
  outline: Json;
  status: string;
  revision: number;
  updated_at: string;
  archived_at: string | null;
  strategy_version_id: string;
};
const strings = (v: Json): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * 퍼널 보드의 리드마그넷 목록. board 는 반드시 서버에서 getFunnelBoard·getFunnelBoardFor 로 읽은 값이어야 한다(브라우저 입력을 받지 않는다).
 * 퍼널이 없으면 DB 를 읽지 않고 빈 목록. 만든 순서대로, 보관한 것은 활성 카드가 가리키는 것만 뒤에 붙인다.
 */
export async function getLeadMagnetsFor(board: FunnelBoard | null): Promise<LeadMagnetView[]> {
  if (!board?.funnel) return [];
  const funnelId = board.funnel.id;
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const [lm, it] = await Promise.all([
    sb.from("lead_magnets").select(COLS).eq("workspace_id", workspace.id).eq("funnel_id", funnelId).is("archived_at", null).order("created_at"),
    sb
      .from("funnel_items")
      .select("id, title, kind, stage_id, lead_magnet_id")
      .eq("workspace_id", workspace.id)
      .eq("funnel_id", funnelId)
      .is("archived_at", null)
      .not("lead_magnet_id", "is", null)
      .order("position"),
  ]);
  if (lm.error) throw new Error(`리드마그넷을 불러오지 못했습니다: ${lm.error.message}`);
  if (it.error) throw new Error(`퍼널 카드 연결을 불러오지 못했습니다: ${it.error.message}`);
  const rows: Row[] = [...((lm.data ?? []) as Row[])];

  const active = new Set(rows.map((r) => r.id));
  const missing = [...new Set((it.data ?? []).map((i) => i.lead_magnet_id as string))].filter((id) => !active.has(id));
  if (missing.length) {
    const ar = await sb.from("lead_magnets").select(COLS).eq("workspace_id", workspace.id).eq("funnel_id", funnelId).in("id", missing).order("created_at");
    if (ar.error) throw new Error(`보관한 리드마그넷을 불러오지 못했습니다: ${ar.error.message}`);
    rows.push(...((ar.data ?? []) as Row[]));
  }
  if (!rows.length) return [];

  // 참조 전략 버전 번호(퍼널 보드가 아는 버전은 다시 읽지 않는다)
  const known = new Map<string, number>();
  if (board.strategy.approvedVersion) known.set(board.strategy.approvedVersion.id, board.strategy.approvedVersion.version);
  known.set(board.funnel.strategyVersion.id, board.funnel.strategyVersion.version);
  const unknown = [...new Set(rows.map((r) => r.strategy_version_id))].filter((id) => !known.has(id));
  if (unknown.length) {
    const v = await sb.from("artifact_versions").select("id, version").eq("workspace_id", workspace.id).in("id", unknown);
    if (v.error) throw new Error(`전략 버전을 불러오지 못했습니다: ${v.error.message}`);
    for (const x of v.data ?? []) known.set(x.id, x.version);
  }

  const stageKey = new Map(board.stages.map((s) => [s.id, s.key]));
  const links = new Map<string, LeadMagnetLinkedItem[]>();
  for (const i of it.data ?? []) {
    const list = links.get(i.lead_magnet_id as string) ?? [];
    list.push({ id: i.id, title: i.title, kind: i.kind, stageId: i.stage_id });
    links.set(i.lead_magnet_id as string, list);
  }
  const approvedId = board.strategy.approvedVersion?.id ?? null;
  return rows.map((r) => {
    const key = stageKey.get(r.stage_id) ?? null;
    return {
      id: r.id,
      stageId: r.stage_id,
      stageKey: key,
      stageLabel: key ? funnelStageLabel(key) : "",
      title: r.title,
      format: r.format as LeadMagnetFormat,
      audience: r.audience,
      promise: r.promise,
      delivery: (r.delivery as LeadMagnetDelivery | null) ?? null,
      leadFields: strings(r.lead_fields),
      outline: strings(r.outline),
      status: r.status as LeadMagnetStatus,
      revision: r.revision,
      updatedAt: r.updated_at,
      archived: r.archived_at !== null,
      strategyVersion: { id: r.strategy_version_id, version: known.get(r.strategy_version_id) ?? null },
      stale: approvedId !== null && r.strategy_version_id !== approvedId,
      linkedItems: links.get(r.id) ?? [],
    };
  });
}

function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  const e = leadMagnetErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  const code: ErrorCode =
    e.code === "CONFLICT" ? "CONFLICT" : e.code === "NOT_FOUND" ? "NOT_FOUND" : e.code === "INVALID_TRANSITION" ? "INVALID_TRANSITION" : e.code === "ERROR" ? "ERROR" : "VALIDATION";
  return fail(code, e.message);
}

/** 입력 계약 확인. 실패하면 첫 안내 문구 */
export function parseLeadMagnet(raw: unknown): Result<LeadMagnetInput> {
  const parsed = leadMagnetInputSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION", leadMagnetIssueMessage(parsed.error.issues[0]));
  return ok(parsed.data);
}

/** 만들기. 퍼널은 단계에서 정해지고, 참조 전략 버전은 퍼널의 것을 복사한다 */
export async function createLeadMagnet(stageId: string, raw: unknown): Promise<Result<{ leadMagnetId: string }>> {
  const p = parseLeadMagnet(raw);
  if (!p.ok) return p;
  const v = p.data;
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("create_lead_magnet", {
    p_stage_id: stageId,
    p_title: v.title,
    p_format: v.format,
    p_audience: v.audience ?? undefined,
    p_promise: v.promise ?? undefined,
    p_delivery: v.delivery ?? undefined,
    p_lead_fields: v.leadFields,
    p_outline: v.outline,
    p_status: v.status,
  });
  if (error) return rpcFail("createLeadMagnet", error);
  return ok({ leadMagnetId: data });
}

/** 값 전체 교체. stageId 는 같은 퍼널의 단계만 */
export async function updateLeadMagnet(leadMagnetId: string, expectedRevision: number, stageId: string, raw: unknown): Promise<Result<{ revision: number }>> {
  const p = parseLeadMagnet(raw);
  if (!p.ok) return p;
  const v = p.data;
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("update_lead_magnet", {
    p_lead_magnet_id: leadMagnetId,
    p_expected_revision: expectedRevision,
    p_stage_id: stageId,
    p_title: v.title,
    p_format: v.format,
    p_audience: v.audience as string,
    p_promise: v.promise as string,
    p_delivery: v.delivery as string,
    p_lead_fields: v.leadFields,
    p_outline: v.outline,
    p_status: v.status,
  });
  if (error) return rpcFail("updateLeadMagnet", error);
  return ok({ revision: data });
}

/** 참조 전략을 지금 승인본으로 다시 맞춘다(주인님이 누를 때만) */
export async function rebaseLeadMagnet(leadMagnetId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("rebase_lead_magnet", { p_lead_magnet_id: leadMagnetId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("rebaseLeadMagnet", error);
  return ok({ revision: data });
}

/** 보관(삭제 대신). 가리키던 카드 연결은 남는다 */
export async function archiveLeadMagnet(leadMagnetId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("archive_lead_magnet", { p_lead_magnet_id: leadMagnetId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("archiveLeadMagnet", error);
  return ok({ revision: data });
}

/** 퍼널 카드(전환 오퍼·리드마그넷 카드) → 리드마그넷 연결. null 이면 해제. expectedRevision 은 카드의 revision */
export async function setFunnelItemLeadMagnet(itemId: string, expectedRevision: number, leadMagnetId: string | null): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("set_funnel_item_lead_magnet", {
    p_item_id: itemId,
    p_expected_revision: expectedRevision,
    p_lead_magnet_id: leadMagnetId,
  });
  if (error) return rpcFail("setFunnelItemLeadMagnet", error);
  return ok({ revision: data });
}
