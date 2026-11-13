import "server-only";
import { requireWorkspace } from "@/server/auth/session";
import { fail, fromDbError, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const DELIVERY_METHODS = {
  email_manual: "이메일로 직접 보냄",
  messenger_manual: "메신저로 직접 보냄",
  download: "파일을 내려받아 전달",
  in_person: "직접 만나 전달",
  other: "기타",
} as const;

export type DeliveryMethod = keyof typeof DELIVERY_METHODS;

export interface DeliveryRow {
  id: string;
  delivered_at: string;
  method: DeliveryMethod;
  note: string | null;
  version: number;
}

export async function listDeliveries(artifactId: string): Promise<DeliveryRow[]> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("delivery_records")
    .select("id, delivered_at, method, note, artifact_versions!inner(version, artifact_id)")
    .eq("workspace_id", workspace.id)
    .eq("artifact_versions.artifact_id", artifactId)
    .order("delivered_at", { ascending: false });
  if (error) throw new Error(`전달 기록을 불러오지 못했습니다: ${error.message}`);
  return (data as unknown as Array<DeliveryRow & { artifact_versions: { version: number } }>).map((d) => ({
    id: d.id,
    delivered_at: d.delivered_at,
    method: d.method,
    note: d.note,
    version: d.artifact_versions.version,
  }));
}

/** 수동 전달 기록. 앱이 보내는 것이 아니다 (R08: 외부 발송 없음). */
export async function recordDelivery(
  artifactId: string,
  method: DeliveryMethod,
  deliveredAt: Date,
  note: string | null,
): Promise<Result<{ id: string }>> {
  await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("record_delivery", {
    p_artifact_id: artifactId,
    p_method: method,
    p_delivered_at: deliveredAt.toISOString(),
    p_note: note ?? undefined,
  });
  if (error) {
    if (error.message.includes("승인된 결과만")) return fail("VALIDATION", "승인된 결과만 전달 기록을 남길 수 있습니다.");
    if (error.message.includes("전달 시각")) return fail("VALIDATION", "전달 시각이 올바르지 않습니다(미래 시각 불가).");
    return fromDbError("recordDelivery", error);
  }
  return ok({ id: data });
}
