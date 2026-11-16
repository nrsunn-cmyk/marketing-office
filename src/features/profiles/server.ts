import "server-only";
import { createHash } from "node:crypto";
import { lastDecisions, profileHashInput, type ProfileDecision, type ProfileFields } from "@/domain/profile/review";
import { strategyErrorFromDb } from "@/domain/strategy";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** 승인 확인 해시(SHA-256, 앞 16자). 같은 버전·내용이면 항상 같다 */
export function profileContentHash(p: ProfileFields): string {
  return createHash("sha256").update(profileHashInput(p)).digest("hex").slice(0, 16);
}

/** 고객의 프로필 승인 기록(본인 업무실, RLS). seq 오름차순 */
export async function listProfileDecisions(clientId: string): Promise<ProfileDecision[]> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("company_profile_approvals")
    .select("company_profile_version_id, decision, seq, created_at, actor_id")
    .eq("workspace_id", workspace.id)
    .eq("client_id", clientId)
    .order("seq", { ascending: true });
  if (error) throw new Error(`프로필 승인 기록을 불러오지 못했습니다: ${error.message}`);
  return (data ?? []).map((d) => ({ versionId: d.company_profile_version_id, decision: d.decision, seq: d.seq, createdAt: d.created_at, actorId: d.actor_id }));
}

/**
 * 프로필 버전 승인·철회. 서버에서 다시 확인하는 것:
 * - 버전이 이 업무실·이 고객의 것인지(RLS 조회), 화면에서 본 내용 해시와 DB 내용이 같은지(버전 불변 확인)
 * - 화면을 그릴 때의 마지막 결정(seq)이 지금도 같은지(이중 제출·다른 탭 결정 방지)
 * - 결정이 지금 상태에서 의미 있는지(이미 승인된 버전 재승인, 승인 안 된 버전 철회 금지)
 * 실제 기록은 정의자 RPC approve_company_profile_version 이 남긴다(행위자 = 로그인 본인).
 */
export async function decideProfileVersion(input: {
  clientId: string;
  versionId: string;
  decision: "approved" | "revoked";
  expectedLastSeq: number;
  contentHash: string;
  comment: string | null;
}): Promise<Result<{ status: "approved" | "revoked" }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data: pv, error } = await sb
    .from("company_profile_versions")
    .select("id, version, products, audience, strengths, brand_rules, channel_urls")
    .eq("workspace_id", workspace.id)
    .eq("client_id", input.clientId)
    .eq("id", input.versionId)
    .maybeSingle();
  if (error) return fail("ERROR", "프로필을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  if (!pv) return fail("NOT_FOUND", "프로필 버전을 찾을 수 없습니다. 권한이 없거나 다른 고객의 프로필입니다.");
  if (profileContentHash(pv) !== input.contentHash) {
    return fail("CONFLICT", "화면에서 본 프로필 내용과 저장된 내용이 다릅니다. 화면을 새로 고쳐 주세요.");
  }

  const last = lastDecisions(await listProfileDecisions(input.clientId)).get(pv.id);
  if ((last?.seq ?? 0) !== input.expectedLastSeq) {
    return fail("CONFLICT", "그 사이 이 버전에 다른 결정이 기록되었습니다. 화면을 새로 고친 뒤 확인해 주세요.");
  }
  if (input.decision === "approved" && last?.decision === "approved") return fail("CONFLICT", "이미 승인된 버전입니다.");
  if (input.decision === "revoked" && last?.decision !== "approved") return fail("VALIDATION", "승인된 버전만 철회할 수 있습니다.");

  const { error: rpcError } = await sb.rpc("approve_company_profile_version", {
    p_profile_version_id: pv.id,
    p_decision: input.decision,
    p_comment: input.comment ?? undefined,
  });
  if (rpcError) {
    const e = strategyErrorFromDb(rpcError.message);
    if (e.code === "ERROR") console.error("[decideProfileVersion]", rpcError.code, rpcError.message);
    return fail(e.code === "NOT_FOUND" ? "NOT_FOUND" : "VALIDATION", e.message);
  }
  return ok({ status: input.decision });
}
