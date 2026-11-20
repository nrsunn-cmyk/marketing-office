import { unstable_rethrow } from "next/navigation";
import { getProductionBriefsFor } from "@/features/production-brief/server";
import { getQaChecklistFor } from "@/features/qa-delivery/server";
import { fixRequestedTargetIds } from "./qa-checklist-model";

/**
 * P3FG-UI-CONNECT-01-R1: 프로젝트의 산출물 중 검수에서 보완 요청된 것(열린 회차가 fix_requested)의 id 목록.
 * 서버 추가 없이 기존 검수 읽기(getQaChecklistFor)로 계산한다(Backend P3FG-ACTIONS-REVIEW-01 3절 ②).
 * 각 단계 화면(홈페이지·디자인 자산·영상·PPT)이 "검수에서 보완 요청됨" 배지에 쓴다. 읽기에 실패하면 배지만 빠진다(빈 목록).
 */
export async function fixRequestedIdsFor(projectId: string): Promise<string[]> {
  try {
    const r = await getProductionBriefsFor(projectId);
    if (!r.ok) return [];
    const results = await Promise.all(r.data.briefs.map((b) => getQaChecklistFor(b.id)));
    return fixRequestedTargetIds(results.flatMap((x) => (x.ok ? x.data.targets : [])));
  } catch (e) {
    unstable_rethrow(e);
    console.error("[qa-fix-flags]", e);
    return [];
  }
}
