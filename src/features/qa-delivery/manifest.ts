import "server-only";
import { requireWorkspace } from "@/server/auth/session";
import type { DeliveryManifestInput } from "@/server/export/delivery-md";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * P3FG-BACKEND-IMPL-01: 납품 목록 .md 입력(읽기만 — RLS 로 본인 업무실 묶음만, 남의 것·없는 id 는 null). 보관한 묶음도 된다.
 * 링크는 앱 안 고정 경로가 있는 것만(PPT 내보내기). 디자인 자산·영상은 화면에서 서명 주소를 받으므로 목록에 넣지 않는다(만료 주소를 파일에 남기지 않음).
 */
export async function getDeliveryManifestInput(bundleId: string, exportedAt = new Date()): Promise<DeliveryManifestInput | null> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const b = await sb.from("delivery_bundles").select("*").eq("id", bundleId).eq("workspace_id", workspace.id).maybeSingle();
  if (b.error) console.error("[getDeliveryManifestInput.bundle]", b.error.code, b.error.message);
  if (!b.data) return null;
  const [items, logs, origin] = await Promise.all([
    sb.from("delivery_bundle_items").select("*").eq("workspace_id", workspace.id).eq("bundle_id", bundleId).order("sort_order", { ascending: true }),
    sb.from("delivery_logs").select("method, delivered_at, note").eq("workspace_id", workspace.id).eq("bundle_id", bundleId).order("delivered_at", { ascending: true }),
    b.data.restored_from_id ? sb.from("delivery_bundles").select("bundle_no").eq("id", b.data.restored_from_id).eq("workspace_id", workspace.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (items.error || logs.error) {
    console.error("[getDeliveryManifestInput]", items.error?.message ?? logs.error?.message);
    return null;
  }
  const rows = items.data ?? [];
  const reviewIds = rows.map((r) => r.qa_review_id).filter((x): x is string => Boolean(x));
  const ids = (k: string, col: "web_copy_doc_id" | "design_asset_id" | "video_plan_id" | "ppt_deck_id" | "production_brief_id") => rows.filter((r) => r.kind === k).map((r) => r[col] as string);
  const [rv, briefs, docs, assets, plans, decks] = await Promise.all([
    reviewIds.length ? sb.from("qa_reviews").select("id, round_no, approved_at").eq("workspace_id", workspace.id).in("id", reviewIds) : Promise.resolve({ data: [], error: null }),
    sb.from("production_briefs").select("id, title").eq("workspace_id", workspace.id).in("id", ids("production_brief", "production_brief_id")),
    sb.from("web_copy_docs").select("id").eq("workspace_id", workspace.id).in("id", ids("web_copy", "web_copy_doc_id")),
    sb.from("design_assets").select("id, title").eq("workspace_id", workspace.id).in("id", ids("design_assets", "design_asset_id")),
    sb.from("video_plans").select("id, title").eq("workspace_id", workspace.id).in("id", ids("video_plan", "video_plan_id")),
    sb.from("ppt_decks").select("id, title").eq("workspace_id", workspace.id).in("id", ids("ppt_deck", "ppt_deck_id")),
  ]);
  const name = new Map<string, string>();
  for (const x of briefs.data ?? []) name.set(x.id, x.title);
  for (const x of docs.data ?? []) name.set(x.id, "홈페이지 구조·문구");
  for (const r of [assets, plans, decks]) for (const x of (r.data ?? []) as Array<{ id: string; title: string }>) name.set(x.id, x.title);
  const review = new Map(((rv.data ?? []) as Array<{ id: string; round_no: number; approved_at: string | null }>).map((x) => [x.id, x]));
  return {
    bundleNo: b.data.bundle_no,
    status: b.data.status as "drafting" | "reviewed",
    archived: b.data.archived_at !== null,
    createdAt: new Date(b.data.created_at),
    restoredFromNo: (origin.data as { bundle_no: number } | null)?.bundle_no ?? null,
    items: rows.map((r) => {
      const tid = (r.production_brief_id ?? r.web_copy_doc_id ?? r.design_asset_id ?? r.video_plan_id ?? r.ppt_deck_id) as string;
      const q = r.qa_review_id ? review.get(r.qa_review_id) : undefined;
      return {
        kind: r.kind,
        title: name.get(tid) ?? "알 수 없는 항목",
        versionNo: r.version_no,
        qaRoundNo: q?.round_no ?? null,
        approvedAt: q?.approved_at ? new Date(q.approved_at) : null,
        link: r.kind === "ppt_deck" ? `/ppt-decks/${tid}/export?format=pptx&version=${r.version_no}` : null,
        sha256: r.content_sha256,
      };
    }),
    logs: (logs.data ?? []).map((l) => ({ method: l.method, deliveredAt: new Date(l.delivered_at), note: l.note })),
    exportedAt,
  };
}
