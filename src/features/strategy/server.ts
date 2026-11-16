import "server-only";
import { strategyInputSchema } from "@/contracts/p2-strategy";
import type { StrategyFormPayload } from "@/contracts/p2-strategy-form";
import { buildStrategyDraft, formToStrategyInput, strategyContractIssueMessage, strategyErrorFromDb, type StrategyProjectContext } from "@/domain/strategy";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/server/supabase/database.types";
import { getTaskDetail, type TaskDetail } from "@/features/tasks/server";

/** 프로필 버전과 현재 승인 상태(마지막 결정) */
export interface ProfileOption {
  id: string;
  version: number;
  status: "approved" | "revoked" | "none";
}
export interface AssetOption {
  id: string;
  label: string;
}
export interface StrategyContext {
  project: StrategyProjectContext;
  profiles: ProfileOption[];
  assets: AssetOption[];
}

const PROJECT_KINDS = new Set(["client", "internal_brand", "personal"]);

export function projectContextOf(detail: TaskDetail): StrategyProjectContext {
  const kind = PROJECT_KINDS.has(detail.project.kind) ? detail.project.kind : "client";
  return { projectId: detail.project.id, clientId: detail.project.client_id, projectKind: kind as StrategyProjectContext["projectKind"] };
}

/** 전략 화면에 필요한 프로필 목록(승인 상태 포함)과 이 프로젝트 자료 목록. 모두 본인 업무실(RLS) 안에서 읽는다 */
export async function getStrategyContext(detail: TaskDetail): Promise<StrategyContext> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const project = projectContextOf(detail);
  let profiles: ProfileOption[] = [];
  if (project.clientId) {
    const [pv, ap] = await Promise.all([
      sb.from("company_profile_versions").select("id, version").eq("workspace_id", workspace.id).eq("client_id", project.clientId).order("version", { ascending: false }),
      sb.from("company_profile_approvals").select("company_profile_version_id, decision, seq").eq("workspace_id", workspace.id).eq("client_id", project.clientId).order("seq", { ascending: true }),
    ]);
    if (pv.error) throw new Error(`프로필을 불러오지 못했습니다: ${pv.error.message}`);
    if (ap.error) throw new Error(`프로필 승인 기록을 불러오지 못했습니다: ${ap.error.message}`);
    const last = new Map<string, string>();
    for (const a of ap.data ?? []) last.set(a.company_profile_version_id, a.decision); // seq 오름차순 → 마지막 값이 최신
    profiles = (pv.data ?? []).map((p) => {
      const d = last.get(p.id);
      return { id: p.id, version: p.version, status: d === "approved" ? "approved" : d === "revoked" ? "revoked" : "none" };
    });
  }
  const { data: assets, error } = await sb
    .from("source_assets")
    .select("id, display_name")
    .eq("workspace_id", workspace.id)
    .eq("project_id", project.projectId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`자료를 불러오지 못했습니다: ${error.message}`);
  return { project, profiles, assets: (assets ?? []).map((a) => ({ id: a.id, label: a.display_name ?? "이름 없는 자료" })) };
}

/** 폼 값 → 계약 입력 → 계약 검사 → 결과. 실패하면 사용자 문구 목록 */
function prepare(form: StrategyFormPayload, profile: { id: string; version: number }, project: StrategyProjectContext) {
  const raw = formToStrategyInput(form, profile, project);
  const parsed = strategyInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, message: strategyContractIssueMessage(parsed.error.issues[0]) };
  const draft = buildStrategyDraft(parsed.data);
  if (!draft.ok) return { ok: false as const, message: draft.issues[0]?.message ?? "입력값이 규칙에 맞지 않습니다." };
  return { ok: true as const, input: parsed.data, content: draft.result };
}

/** 전략 초안 만들기. 프로필 버전·프로젝트·출처는 서버가 다시 확인하고, DB RPC 가 최종 확인한다 */
export async function generateStrategy(taskId: string, idempotencyKey: string, form: StrategyFormPayload): Promise<Result<{ version: number; reused: boolean }>> {
  const detail = await getTaskDetail(taskId);
  if (!detail) return fail("NOT_FOUND", "작업을 찾을 수 없습니다.");
  if (detail.task.type !== "strategy") return fail("VALIDATION", "전략 작업이 아닙니다.");
  const ctx = await getStrategyContext(detail);
  if (!ctx.project.clientId) return fail("VALIDATION", "전략은 지금 고객 프로젝트에서만 만들 수 있습니다.");
  const profile = ctx.profiles.find((p) => p.id === form.profileVersionId);
  if (!profile) return fail("VALIDATION", "이 프로젝트 고객의 회사 프로필 버전을 골라 주세요.");
  if (profile.status !== "approved") return fail("VALIDATION", "승인된 회사 프로필 버전만 쓸 수 있습니다.");
  const assetIds = new Set(ctx.assets.map((a) => a.id));
  const badAsset = Object.values(form.sections).some((s) => s.facts.some((f) => f.source.kind === "asset" && !assetIds.has(f.source.assetId)));
  if (badAsset) return fail("VALIDATION", "이 프로젝트의 자료만 출처로 쓸 수 있습니다.");

  const prepared = prepare(form, profile, ctx.project);
  if (!prepared.ok) return fail("VALIDATION", prepared.message);
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .rpc("generate_strategy", {
      p_task_id: taskId,
      p_idempotency_key: idempotencyKey,
      p_profile_version_id: profile.id,
      p_extra_inputs: prepared.input as unknown as Json,
      p_content: prepared.content as unknown as Json,
    })
    .single();
  if (error) {
    const e = strategyErrorFromDb(error.message);
    if (e.code === "ERROR") console.error("[generateStrategy]", error.code, error.message);
    return fail(e.code === "CONFLICT" || e.code === "IDEMPOTENCY_MISMATCH" ? "CONFLICT" : "VALIDATION", e.message);
  }
  return ok({ version: data.version, reused: data.reused });
}

/** 직접 고치기 → 새 초안 버전. 프로필·프로젝트 참조는 현재 초안 것을 그대로 쓴다(바꿀 수 없음) */
export async function saveStrategyEdit(taskId: string, artifactId: string, expectedRevision: number, form: StrategyFormPayload): Promise<Result<{ version: number }>> {
  const detail = await getTaskDetail(taskId);
  if (!detail || detail.artifact?.id !== artifactId) return fail("NOT_FOUND", "결과물을 찾을 수 없습니다.");
  if (detail.task.type !== "strategy") return fail("VALIDATION", "전략 작업이 아닙니다.");
  const current = detail.versions.find((v) => v.id === detail.artifact?.current_draft_version_id);
  const ref = (current?.content as unknown as { profileRef?: { id?: unknown; version?: unknown } } | undefined)?.profileRef;
  if (!current || typeof ref?.id !== "string" || typeof ref.version !== "number") return fail("NOT_FOUND", "고칠 초안이 없습니다.");
  if (form.profileVersionId !== ref.id) return fail("VALIDATION", "직접 고치기에서는 회사 프로필 버전을 바꿀 수 없습니다. 새로 만들어 주세요.");
  const ctx = await getStrategyContext(detail);
  const assetIds = new Set(ctx.assets.map((a) => a.id));
  const badAsset = Object.values(form.sections).some((s) => s.facts.some((f) => f.source.kind === "asset" && !assetIds.has(f.source.assetId)));
  if (badAsset) return fail("VALIDATION", "이 프로젝트의 자료만 출처로 쓸 수 있습니다.");

  const prepared = prepare(form, { id: ref.id, version: ref.version }, ctx.project);
  if (!prepared.ok) return fail("VALIDATION", prepared.message);
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .rpc("save_strategy_manual_version", {
      p_artifact_id: artifactId,
      p_expected_revision: expectedRevision,
      p_content: prepared.content as unknown as Json,
    })
    .single();
  if (error) {
    const e = strategyErrorFromDb(error.message);
    if (e.code === "ERROR") console.error("[saveStrategyEdit]", error.code, error.message);
    return fail(e.code === "CONFLICT" ? "CONFLICT" : "VALIDATION", e.message);
  }
  return ok({ version: data.version });
}
