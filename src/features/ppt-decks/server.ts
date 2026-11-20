import "server-only";
import { funnelIssueMessage } from "@/domain/funnel";
import {
  PPT_DECK_LIMITS,
  pptDeckCreateSchema,
  pptDeckSaveSchema,
  pptErrorFromDb,
  toDbSlides,
  type PptDeckStatus,
  type PptTemplateKey,
  type StoredSlide,
} from "@/domain/ppt-decks";
import { requireWorkspace } from "@/server/auth/session";
import type { PptxInput } from "@/server/export/pptx";
import { fail, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * P3E-BACKEND-IMPL-01: PPT 구성안(P3-e) 서버 함수. 설계: Plan/Claude-Backend-20261120/P3E-BACKEND-01-DESIGN.md. P3-d 영상과 같은 규칙.
 * 구성안: 저장할 때마다 새 판(최대 20). 슬라이드 빼기 = 목록에서 제거, 되살리기는 구성안 판 되돌리기.
 * 내보내기(.pptx·.md)는 경로 처리기 /ppt-decks/[deckId]/export 가 getPptExportInput 으로 읽어 만든다(읽기라 보관·읽기 전용도 됨).
 * AI·외부 API 호출 없음(X11).
 */

function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  const e = pptErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  return fail(e.code, e.message);
}
function readFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  console.error(`[${where}]`, error.code, error.message);
  return fail("ERROR", "PPT 구성안을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

// ─────────────────────────────────────────────
// 읽기 (Front 303f951 ppt-deck-model.ts 보기 타입 + 설계 7절 칸)
// ─────────────────────────────────────────────
export interface PptSlideView {
  id: string | null;
  slideTitle: string;
  bulletPoints: string;
  speakerNotes: string;
  assetIds: string[];
  sortOrder: number;
}
export interface PptDeckVersionView {
  version: number;
  kind: "create" | "save" | "restore" | "rebase";
  status: PptDeckStatus;
  savedAt: string;
  slideCount: number;
  restoredFromVersion: number | null;
  current: boolean;
}
export type PptStaleReason = "brief" | "asset";
/** 맞추기 막힘 원인 = PPT_COPY 문구 키(AGY) */
export type PptRebaseBlockedKey = "archivedNote" | "rebaseBlockedBriefArchived" | "rebaseBlockedBriefDraft" | "rebaseBlockedVersionLimit";
export type PptCreateBlockedCode = "project_archived" | "task_cancelled" | "brief_archived" | "brief_drafting" | "no_ppt_deliverable" | "deck_limit";
export interface PptDeckView {
  id: string;
  title: string;
  templateKey: PptTemplateKey;
  status: PptDeckStatus;
  archivedAt: string | null;
  revision: number;
  versionNo: number;
  stale: boolean;
  staleReasons: PptStaleReason[];
  /** 판이 바뀐 연결 자산 수(서로 다른 자산) — PPT_COPY.staleReasonAsset 의 {n} */
  staleAssetCount: number;
  /** 연결 자산 중 보관된 것 수(stale 아님, PPT_COPY.archivedAssetsWarn 의 {n}) */
  archivedAssetCount: number;
  /** null 이면 맞추기 가능(stale 일 때). 값은 PPT_COPY 문구 키 */
  rebaseBlockedReason: PptRebaseBlockedKey | null;
  /** 판 20개 도달(PPT_COPY.versionLimitReached) */
  versionLimitReached: boolean;
  slides: PptSlideView[];
  deckVersions: PptDeckVersionView[];
}
export interface PptDeckData {
  deck: PptDeckView | null;
  canWrite: boolean;
  readOnlyReason: string | null;
  canCreate: boolean;
  createBlockedReason: string | null;
  createBlockedCode: PptCreateBlockedCode | null;
  /** 내보내기는 읽기라 보관·읽기 전용에서도 된다(구성안이 있으면 true) */
  canExport: boolean;
  /** 슬라이드에 연결할 디자인 자산(같은 프로젝트·보관 안 됨) */
  assets: Array<{ id: string; label: string }>;
  activeDeckCount: number;
  /** 화면이 기본 뼈대 표지 제목으로 쓸 브리프 제목(AGY P3E-TEMPLATES 2절) */
  briefTitle: string;
}

const CREATE_BLOCKED: Record<PptCreateBlockedCode, string> = {
  project_archived: "보관한 프로젝트라 PPT 구성안을 고칠 수 없습니다.",
  task_cancelled: "바탕 전략 작업이 취소되어 PPT 구성안을 고칠 수 없습니다.",
  brief_archived: "보관한 제작 브리프로는 PPT 구성안을 만들 수 없습니다.",
  brief_drafting: "확정된 공통 제작 브리프가 있어야 PPT 구성안을 만들 수 있습니다.",
  no_ppt_deliverable: "이 제작 브리프의 포함 산출물에 PPT 구성이 없습니다.",
  deck_limit: "PPT 구성안은 브리프당 활성 5개(전체 10개)까지 둘 수 있습니다.",
};

export async function getPptDeckFor(productionBriefId: string): Promise<Result<PptDeckData>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const br = await sb
    .from("production_briefs")
    .select("id, title, revision, status, archived_at, project_id, strategy_artifact_id, deliverable_types")
    .eq("id", productionBriefId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (br.error) return readFail("getPptDeckFor.brief", br.error);
  if (!br.data) return fail("NOT_FOUND", "제작 브리프를 찾을 수 없습니다.");
  const b = br.data;

  const [pr, ar, decks, das] = await Promise.all([
    sb.from("projects").select("status").eq("id", b.project_id).eq("workspace_id", workspace.id).maybeSingle(),
    sb.from("artifacts").select("task_id").eq("id", b.strategy_artifact_id).eq("workspace_id", workspace.id).maybeSingle(),
    sb.from("ppt_decks").select("*").eq("workspace_id", workspace.id).eq("production_brief_id", b.id).order("updated_at", { ascending: false }),
    sb.from("design_assets").select("id, title, current_version_no, archived_at").eq("workspace_id", workspace.id).eq("project_id", b.project_id).order("created_at", { ascending: true }),
  ]);
  for (const [where, r] of [["project", pr], ["artifact", ar], ["decks", decks], ["assets", das]] as const) if (r.error) return readFail(`getPptDeckFor.${where}`, r.error);
  let taskCancelled = false;
  if (ar.data?.task_id) {
    const tk = await sb.from("tasks").select("status").eq("id", ar.data.task_id).eq("workspace_id", workspace.id).maybeSingle();
    if (tk.error) return readFail("getPptDeckFor.task", tk.error);
    taskCancelled = tk.data?.status === "cancelled";
  }
  const all = decks.data ?? [];
  const active = all.filter((d) => d.archived_at === null);
  // 대표 구성안: 보관 안 된 것 중 최근에 고친 것. 모두 보관이면 최근 것을 읽기 전용으로
  const rep = active[0] ?? all[0] ?? null;
  const assetRows = das.data ?? [];

  let deck: PptDeckView | null = null;
  if (rep) {
    const vs = await sb
      .from("ppt_deck_versions")
      .select("version_no, kind, status, slides, slide_count, restored_from_version_no, created_at")
      .eq("workspace_id", workspace.id)
      .eq("deck_id", rep.id)
      .order("version_no", { ascending: false });
    if (vs.error) return readFail("getPptDeckFor.versions", vs.error);
    const cur = (vs.data ?? []).find((v) => v.version_no === rep.current_version_no);
    const slides = (cur?.slides ?? []) as unknown as StoredSlide[];
    const byId = new Map(assetRows.map((x) => [x.id, x]));
    const linked = slides.flatMap((s) => s.assets);
    const staleAssets = new Set(linked.filter((x) => (byId.get(x.asset_id)?.current_version_no ?? x.version_no) > x.version_no).map((x) => x.asset_id));
    const staleReasons: PptStaleReason[] = [...(rep.source_brief_revision !== b.revision ? (["brief"] as const) : []), ...(staleAssets.size ? (["asset"] as const) : [])];
    const versionLimitReached = rep.current_version_no >= PPT_DECK_LIMITS.versionsMax;
    deck = {
      id: rep.id,
      title: rep.title,
      templateKey: rep.template_key as PptTemplateKey,
      status: rep.status as PptDeckStatus,
      archivedAt: rep.archived_at,
      revision: rep.revision,
      versionNo: rep.current_version_no,
      stale: rep.archived_at === null && staleReasons.length > 0,
      staleReasons,
      staleAssetCount: staleAssets.size,
      archivedAssetCount: new Set(linked.filter((x) => byId.get(x.asset_id)?.archived_at != null).map((x) => x.asset_id)).size,
      rebaseBlockedReason:
        rep.archived_at !== null
          ? "archivedNote"
          : b.archived_at !== null
            ? "rebaseBlockedBriefArchived"
            : b.status !== "ready"
              ? "rebaseBlockedBriefDraft"
              : versionLimitReached
                ? "rebaseBlockedVersionLimit"
                : null,
      versionLimitReached,
      slides: slides.map((s, i) => ({
        id: s.id,
        slideTitle: s.title,
        bulletPoints: s.bullets ?? "",
        speakerNotes: s.notes ?? "",
        assetIds: s.assets.map((x) => x.asset_id),
        sortOrder: i + 1,
      })),
      deckVersions: (vs.data ?? []).map((v) => ({
        version: v.version_no,
        kind: v.kind as PptDeckVersionView["kind"],
        status: v.status as PptDeckStatus,
        savedAt: v.created_at,
        slideCount: v.slide_count,
        restoredFromVersion: v.restored_from_version_no,
        current: v.version_no === rep.current_version_no,
      })),
    };
  }

  const projectCode: PptCreateBlockedCode | null = pr.data?.status === "archived" ? "project_archived" : taskCancelled ? "task_cancelled" : null;
  const readOnlyReason = projectCode
    ? CREATE_BLOCKED[projectCode]
    : deck?.archivedAt
      ? "보관한 PPT 구성안입니다. 조회와 내보내기만 할 수 있고 고치기·추가는 할 수 없습니다."
      : null;
  const createBlockedCode: PptCreateBlockedCode | null =
    projectCode ??
    (b.archived_at !== null
      ? "brief_archived"
      : b.status !== "ready"
        ? "brief_drafting"
        : !(b.deliverable_types ?? []).includes("ppt_deck")
          ? "no_ppt_deliverable"
          : all.length >= PPT_DECK_LIMITS.decksPerBrief || active.length >= PPT_DECK_LIMITS.activeDecksPerBrief
            ? "deck_limit"
            : null);
  return ok({
    deck,
    canWrite: deck !== null && readOnlyReason === null,
    readOnlyReason,
    canCreate: createBlockedCode === null,
    createBlockedReason: createBlockedCode === null ? null : CREATE_BLOCKED[createBlockedCode],
    createBlockedCode,
    canExport: deck !== null,
    assets: assetRows.filter((x) => x.archived_at === null).map((x) => ({ id: x.id, label: x.title })),
    activeDeckCount: active.length,
    briefTitle: b.title,
  });
}

// ─────────────────────────────────────────────
// 쓰기
// ─────────────────────────────────────────────
/** raw = { productionBriefId, title, templateKey, slides: [{ id: null, slideTitle, bulletPoints, speakerNotes, assetIds }] } */
export async function createPptDeck(raw: unknown): Promise<Result<{ deckId: string }>> {
  const p = pptDeckCreateSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("create_ppt_deck", { p_production_brief_id: p.data.productionBriefId, p_title: p.data.title, p_template_key: p.data.templateKey, p_slides: toDbSlides(p.data.slides) });
  if (r.error) return rpcFail("createPptDeck", r.error);
  return ok({ deckId: r.data });
}

/** raw = { title, templateKey, status, slides } — 저장 = 새 판 */
export async function savePptDeck(deckId: string, expectedRevision: number, raw: unknown): Promise<Result<{ revision: number }>> {
  const p = pptDeckSaveSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("save_ppt_deck", {
    p_deck_id: deckId,
    p_expected_revision: expectedRevision,
    p_title: p.data.title,
    p_template_key: p.data.templateKey,
    p_status: p.data.status,
    p_slides: toDbSlides(p.data.slides),
  });
  if (r.error) return rpcFail("savePptDeck", r.error);
  return ok({ revision: r.data });
}

type RevisionCall = { data: number | null; error: { code?: string; message: string } | null };
async function revisionRpc(where: string, call: (sb: Awaited<ReturnType<typeof createSupabaseServerClient>>) => PromiseLike<RevisionCall>): Promise<Result<{ revision: number }>> {
  await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const r = await call(sb);
  if (r.error) return rpcFail(where, r.error);
  return ok({ revision: r.data ?? 0 });
}
/** 옛 판으로 되돌리기(새 판, 슬라이드 id·연결 자산 판 번호 그대로). 빼기 복구용 */
export const restorePptDeckVersion = (deckId: string, expectedRevision: number, versionNo: number) =>
  revisionRpc("restorePptDeckVersion", (sb) => sb.rpc("restore_ppt_deck_version", { p_deck_id: deckId, p_expected_revision: expectedRevision, p_version_no: versionNo }));
/** 최신 기준으로 맞추기 */
export const rebasePptDeck = (deckId: string, expectedRevision: number) => revisionRpc("rebasePptDeck", (sb) => sb.rpc("rebase_ppt_deck", { p_deck_id: deckId, p_expected_revision: expectedRevision }));
/** 보관(되돌리기 없음, 내보내기는 계속 됨) */
export const archivePptDeck = (deckId: string, expectedRevision: number) => revisionRpc("archivePptDeck", (sb) => sb.rpc("archive_ppt_deck", { p_deck_id: deckId, p_expected_revision: expectedRevision }));

// ─────────────────────────────────────────────
// 내보내기 입력(읽기만 — RLS 가 본인 업무실만 준다. 남의 것·없는 id 는 null)
// ─────────────────────────────────────────────
export async function getPptExportInput(deckId: string, versionNo: number | null, exportedAt = new Date()): Promise<PptxInput | null> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const d = await sb.from("ppt_decks").select("id, project_id, current_version_no").eq("id", deckId).eq("workspace_id", workspace.id).maybeSingle();
  if (d.error) {
    console.error("[getPptExportInput.deck]", d.error.code, d.error.message);
    return null;
  }
  if (!d.data) return null;
  const v = await sb
    .from("ppt_deck_versions")
    .select("version_no, title, template_key, status, slides")
    .eq("workspace_id", workspace.id)
    .eq("deck_id", deckId)
    .eq("version_no", versionNo ?? d.data.current_version_no)
    .maybeSingle();
  if (v.error || !v.data) {
    if (v.error) console.error("[getPptExportInput.version]", v.error.code, v.error.message);
    return null;
  }
  const slides = v.data.slides as unknown as StoredSlide[];
  const ids = [...new Set(slides.flatMap((s) => s.assets.map((a) => a.asset_id)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const a = await sb.from("design_assets").select("id, title").eq("workspace_id", workspace.id).eq("project_id", d.data.project_id).in("id", ids);
    if (a.error) console.error("[getPptExportInput.assets]", a.error.code, a.error.message);
    for (const x of a.data ?? []) names.set(x.id, x.title);
  }
  return {
    title: v.data.title,
    templateKey: v.data.template_key,
    status: v.data.status as PptDeckStatus,
    versionNo: v.data.version_no,
    slides,
    assetNames: names,
    exportedAt,
  };
}
