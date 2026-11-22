import "server-only";
import { funnelIssueMessage } from "@/domain/funnel";
import {
  DB_STATUS_KEYS,
  bundleLabel,
  deliveryLogSchema,
  qaErrorFromDb,
  qaItemAddSchema,
  qaItemSetSchema,
  type DbMethod,
  type DbStatus,
  type QaStatus,
  type QaTargetKind,
  type QaVerdict,
} from "@/domain/qa-delivery";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * P3FG-BACKEND-IMPL-01: 검수 체크리스트(P3-f)·납품 묶음(P3-g) 서버 함수. 설계: Plan/Claude-Backend-20261120/P3FG-BACKEND-01-DESIGN.md.
 * - 검수 대상은 같은 제작 브리프의 산출물(홈페이지 문서·디자인 자산 하나하나·영상 구성안·PPT 구성안). 회차·항목·게이트는 DB 가 판정한다.
 * - 납품은 프로젝트 단위. 묶음에 넣을 승인본은 DB(app.delivery_candidates)가 고르고, 화면용 미리보기(included·excluded)는 같은 규칙으로 여기서 계산한다.
 * - 검수자 표시는 "나"(지금 사용자) 또는 "구성원" — 이메일은 내보내지 않는다(Master ⑥).
 * - 외부 발송·AI 호출 0(X11).
 */
type Sb = Awaited<ReturnType<typeof createSupabaseServerClient>>;
function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  const e = qaErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  return fail(e.code, e.message);
}
function readFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  console.error(`[${where}]`, error.code, error.message);
  return fail("ERROR", "검수·납품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

const KIND_TITLE: Record<QaTargetKind, string> = {
  web_copy: "홈페이지 구조·문구",
  design_assets: "디자인 자산",
  video_plan: "영상 구성안",
  ppt_deck: "PPT 구성안",
};
const PAIR: Record<QaTargetKind, { parent: string; version: string }> = {
  web_copy: { parent: "web_copy_doc_id", version: "web_copy_version_id" },
  design_assets: { parent: "design_asset_id", version: "design_asset_version_id" },
  video_plan: { parent: "video_plan_id", version: "video_plan_version_id" },
  ppt_deck: { parent: "ppt_deck_id", version: "ppt_deck_version_id" },
};

/** 같은 브리프(또는 프로젝트)의 산출물 하나를 같은 모양으로 */
interface Artifact {
  kind: QaTargetKind;
  id: string;
  title: string;
  versionNo: number;
  reviewed: boolean;
  archived: boolean;
}
async function artifactsOf(sb: Sb, ws: string, by: { briefId?: string; projectId?: string }): Promise<Result<Artifact[]>> {
  const col = by.briefId ? "production_brief_id" : "project_id";
  const val = by.briefId ?? by.projectId!;
  const [w, d, v, p] = await Promise.all([
    sb.from("web_copy_docs").select("id, status, current_version_no, archived_at").eq("workspace_id", ws).eq(col, val),
    sb.from("design_assets").select("id, title, status, current_version_no, archived_at").eq("workspace_id", ws).eq(col, val),
    sb.from("video_plans").select("id, title, status, current_version_no, archived_at").eq("workspace_id", ws).eq(col, val),
    sb.from("ppt_decks").select("id, title, status, current_version_no, archived_at").eq("workspace_id", ws).eq(col, val),
  ]);
  for (const r of [w, d, v, p]) if (r.error) return readFail("artifactsOf", r.error);
  const list: Artifact[] = [
    ...(w.data ?? []).map((x) => ({ kind: "web_copy" as const, id: x.id, title: KIND_TITLE.web_copy, versionNo: x.current_version_no, reviewed: x.status === "reviewed", archived: x.archived_at !== null })),
    ...(d.data ?? []).map((x) => ({ kind: "design_assets" as const, id: x.id, title: x.title, versionNo: x.current_version_no, reviewed: x.status === "reviewed", archived: x.archived_at !== null })),
    ...(v.data ?? []).map((x) => ({ kind: "video_plan" as const, id: x.id, title: x.title, versionNo: x.current_version_no, reviewed: x.status === "reviewed", archived: x.archived_at !== null })),
    ...(p.data ?? []).map((x) => ({ kind: "ppt_deck" as const, id: x.id, title: x.title, versionNo: x.current_version_no, reviewed: x.status === "reviewed", archived: x.archived_at !== null })),
  ];
  return ok(list);
}

type ReviewRow = {
  id: string;
  target_kind: string;
  target_id: string;
  target_version_no: number;
  round_no: number;
  status: string;
  archived_at: string | null;
  approved_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

// ─────────────────────────────────────────────
// 검수 읽기(Front fa27040 보기 타입 + Master ① targetId·title, 게이트)
// ─────────────────────────────────────────────
export interface QaItemView {
  id: string;
  itemTitle: string;
  isRequired: boolean;
  isDefault: boolean;
  verdict: QaVerdict;
  memo: string;
  checkedByName: string | null;
  checkedAt: string | null;
  sortOrder: number;
}
export type QaGateBlock = "pending" | "needs_fix" | "stale" | "archived" | "not_reviewed" | null;
export interface QaRoundView {
  id: string;
  roundNo: number;
  status: QaStatus;
  archivedAt: string | null;
  approvedAt: string | null;
  revision: number;
  targetVersionId: string;
  targetVersionNo: number;
  stale: boolean;
  items: QaItemView[];
  /** 승인 게이트(실제 개수, 근거 없는 진행률 없음). blockedBy 가 null 이면 승인 가능 */
  gate: { requiredTotal: number; requiredPassed: number; optionalNeedsFix: number; blockedBy: QaGateBlock };
  createdAt: string;
  updatedAt: string;
}
export interface QaTargetView {
  kind: QaTargetKind;
  /** 산출물 id(디자인 자산은 자산마다 하나, Master ①). 산출물이 없으면 null */
  targetId: string | null;
  title: string;
  exists: boolean;
  baseArchived: boolean;
  /** 지금 판이 검토 완료 전이면 true(baseNotReadyNotice) */
  baseNotReady: boolean;
  currentVersionNo: number | null;
  /** 지금 열 수 있는지(열린 회차 없음·검토 완료·보관 안 됨·30회차 미만) */
  canOpen: boolean;
  rounds: QaRoundView[];
}
export interface QaChecklistData {
  targets: QaTargetView[];
  canWrite: boolean;
}

export async function getQaChecklistFor(productionBriefId: string): Promise<Result<QaChecklistData>> {
  const { workspace, user } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const br = await sb.from("production_briefs").select("id, project_id").eq("id", productionBriefId).eq("workspace_id", workspace.id).maybeSingle();
  if (br.error) return readFail("getQaChecklistFor.brief", br.error);
  if (!br.data) return fail("NOT_FOUND", "제작 브리프를 찾을 수 없습니다.");
  const pr = await sb.from("projects").select("status").eq("id", br.data.project_id).eq("workspace_id", workspace.id).maybeSingle();
  if (pr.error) return readFail("getQaChecklistFor.project", pr.error);
  const arts = await artifactsOf(sb, workspace.id, { briefId: productionBriefId });
  if (!arts.ok) return arts;
  const ids = arts.data.map((a) => a.id);
  const rv = ids.length
    ? await sb.from("qa_reviews").select("*").eq("workspace_id", workspace.id).in("target_id", ids).order("round_no", { ascending: false })
    : { data: [] as ReviewRow[], error: null };
  if (rv.error) return readFail("getQaChecklistFor.reviews", rv.error);
  const reviews = (rv.data ?? []) as ReviewRow[];
  const its = reviews.length
    ? await sb.from("qa_check_items").select("*").eq("workspace_id", workspace.id).in("review_id", reviews.map((r) => r.id)).order("sort_order", { ascending: true })
    : { data: [] as Array<Record<string, unknown>>, error: null };
  if (its.error) return readFail("getQaChecklistFor.items", its.error);
  const me = user.userId;

  const roundView = (r: ReviewRow, a: Artifact): QaRoundView => {
    const items = ((its.data ?? []) as Array<Record<string, unknown>>)
      .filter((x) => x.review_id === r.id)
      .map((x) => ({
        id: String(x.id),
        itemTitle: String(x.item_title),
        isRequired: Boolean(x.is_required),
        isDefault: Boolean(x.is_default),
        verdict: x.verdict as QaVerdict,
        memo: (x.memo as string | null) ?? "",
        checkedByName: x.checked_by ? (x.checked_by === me ? "나" : "구성원") : null,
        checkedAt: (x.checked_at as string | null) ?? null,
        sortOrder: Number(x.sort_order),
      }));
    const required = items.filter((x) => x.isRequired);
    const stale = r.target_version_no < a.versionNo;
    const open = r.status !== "reviewed" && r.archived_at === null;
    const blockedBy: QaGateBlock = !open
      ? null
      : a.archived
        ? "archived"
        : stale
          ? "stale"
          : !a.reviewed
            ? "not_reviewed"
            : required.some((x) => x.verdict === "needs_fix")
              ? "needs_fix"
              : required.some((x) => x.verdict !== "passed") || required.length === 0
                ? "pending"
                : null;
    return {
      id: r.id,
      roundNo: r.round_no,
      status: r.status as QaStatus,
      archivedAt: r.archived_at,
      approvedAt: r.approved_at,
      revision: r.revision,
      targetVersionId: String(r[PAIR[a.kind].version]),
      targetVersionNo: r.target_version_no,
      stale,
      items,
      gate: { requiredTotal: required.length, requiredPassed: required.filter((x) => x.verdict === "passed").length, optionalNeedsFix: items.filter((x) => !x.isRequired && x.verdict === "needs_fix").length, blockedBy },
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  };
  const projectOpen = pr.data?.status !== "archived";
  const targets: QaTargetView[] = [];
  for (const kind of Object.keys(KIND_TITLE) as QaTargetKind[]) {
    const list = arts.data.filter((a) => a.kind === kind);
    if (!list.length) targets.push({ kind, targetId: null, title: KIND_TITLE[kind], exists: false, baseArchived: false, baseNotReady: false, currentVersionNo: null, canOpen: false, rounds: [] });
    for (const a of list) {
      const rounds = reviews.filter((r) => r.target_id === a.id).map((r) => roundView(r, a));
      const hasOpen = rounds.some((r) => r.status !== "reviewed" && r.archivedAt === null);
      const maxRound = rounds.reduce((n, r) => Math.max(n, r.roundNo), 0);
      targets.push({
        kind,
        targetId: a.id,
        title: a.title,
        exists: true,
        baseArchived: a.archived,
        baseNotReady: !a.reviewed,
        currentVersionNo: a.versionNo,
        canOpen: projectOpen && !a.archived && a.reviewed && !hasOpen && maxRound < 30,
        rounds,
      });
    }
  }
  return ok({ targets, canWrite: projectOpen });
}

// ─────────────────────────────────────────────
// 검수 쓰기
// ─────────────────────────────────────────────
type RevisionCall = { data: number | null; error: { code?: string; message: string } | null };
async function revisionRpc(where: string, call: (sb: Sb) => PromiseLike<RevisionCall>): Promise<Result<{ revision: number }>> {
  await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const r = await call(sb);
  if (r.error) return rpcFail(where, r.error);
  return ok({ revision: r.data ?? 0 });
}
async function idRpc(where: string, call: (sb: Sb) => PromiseLike<{ data: string | null; error: { code?: string; message: string } | null }>): Promise<Result<{ id: string }>> {
  await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const r = await call(sb);
  if (r.error) return rpcFail(where, r.error);
  return ok({ id: r.data ?? "" });
}
export const openQaReview = (kind: QaTargetKind, targetId: string) => idRpc("openQaReview", (sb) => sb.rpc("open_qa_review", { p_target_kind: kind, p_target_id: targetId }));
/** raw = { itemId, verdict, memo } */
export async function setQaItem(reviewId: string, expectedRevision: number, raw: unknown): Promise<Result<{ revision: number }>> {
  const p = qaItemSetSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  return revisionRpc("setQaItem", (sb) => sb.rpc("set_qa_item", { p_review_id: reviewId, p_expected_revision: expectedRevision, p_item_id: p.data.itemId, p_verdict: p.data.verdict, p_memo: p.data.memo as string }));
}
/** raw = { title, isRequired } */
export async function addQaItem(reviewId: string, expectedRevision: number, raw: unknown): Promise<Result<{ revision: number }>> {
  const p = qaItemAddSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  return revisionRpc("addQaItem", (sb) => sb.rpc("add_qa_item", { p_review_id: reviewId, p_expected_revision: expectedRevision, p_title: p.data.title, p_is_required: p.data.isRequired }));
}
export const removeQaItem = (reviewId: string, expectedRevision: number, itemId: string) =>
  revisionRpc("removeQaItem", (sb) => sb.rpc("remove_qa_item", { p_review_id: reviewId, p_expected_revision: expectedRevision, p_item_id: itemId }));
export const requestQaFix = (reviewId: string, expectedRevision: number) => revisionRpc("requestQaFix", (sb) => sb.rpc("request_qa_fix", { p_review_id: reviewId, p_expected_revision: expectedRevision }));
export const approveQaReview = (reviewId: string, expectedRevision: number) => revisionRpc("approveQaReview", (sb) => sb.rpc("approve_qa_review", { p_review_id: reviewId, p_expected_revision: expectedRevision }));
export const rebaseQaReview = (reviewId: string, expectedRevision: number) => idRpc("rebaseQaReview", (sb) => sb.rpc("rebase_qa_review", { p_review_id: reviewId, p_expected_revision: expectedRevision }));
export const archiveQaReview = (reviewId: string, expectedRevision: number) => revisionRpc("archiveQaReview", (sb) => sb.rpc("archive_qa_review", { p_review_id: reviewId, p_expected_revision: expectedRevision }));

// ─────────────────────────────────────────────
// 납품 읽기(Front e69e994 보기 타입 + 원인 코드)
// ─────────────────────────────────────────────
export type DbExcludeCode = "not_reviewed" | "no_qa" | "qa_open" | "fix_requested" | "archived";
export interface DbIncludedItem {
  kind: string;
  targetId: string;
  title: string;
  versionNo: number;
  stateLabel: string;
  qaRoundNo: number | null;
  detail: string | null;
}
export interface DbExcludedItem {
  kind: string;
  targetId: string;
  title: string;
  versionNo: number | null;
  stateLabel: string;
  reasonCode: DbExcludeCode;
  reason: string;
}
export interface DbLogView {
  id: string;
  method: DbMethod;
  deliveredAt: string;
  note: string;
  bundleVersion: string;
}
export interface DbBundleView {
  id: string;
  bundleNo: number;
  bundleVersion: string;
  status: DbStatus;
  archivedAt: string | null;
  revision: number;
  createdAt: string;
  restoredFromVersion: string | null;
  itemCount: number;
  itemsSummary: string[];
  logs: DbLogView[];
}
export type DbCreateBlockedCode = "project_archived" | "no_approved" | "bundle_limit";
export interface DeliveryBundleData {
  projectId: string;
  included: DbIncludedItem[];
  excluded: DbExcludedItem[];
  bundles: DbBundleView[];
  stale: boolean;
  baseArchived: boolean;
  canWrite: boolean;
  canCreate: boolean;
  createBlockedCode: DbCreateBlockedCode | null;
}
const EXCLUDE: Record<DbExcludeCode, string> = {
  not_reviewed: "결과물이 아직 검토 완료 전입니다.",
  no_qa: "검수 체크리스트를 아직 시작하지 않았습니다.",
  qa_open: "검수가 진행 중입니다.",
  fix_requested: "보완 요청 후 재검수를 기다리고 있습니다.",
  archived: "보관한 결과물이라 담지 않습니다.",
};

export async function getDeliveryBundleFor(productionBriefId: string): Promise<Result<DeliveryBundleData>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const br = await sb.from("production_briefs").select("project_id").eq("id", productionBriefId).eq("workspace_id", workspace.id).maybeSingle();
  if (br.error) return readFail("getDeliveryBundleFor.brief", br.error);
  if (!br.data) return fail("NOT_FOUND", "제작 브리프를 찾을 수 없습니다.");
  const projectId = br.data.project_id;
  const [pr, briefs, rv, bs] = await Promise.all([
    sb.from("projects").select("status").eq("id", projectId).eq("workspace_id", workspace.id).maybeSingle(),
    sb.from("production_briefs").select("id, title, revision, status, archived_at").eq("workspace_id", workspace.id).eq("project_id", projectId),
    sb.from("qa_reviews").select("*").eq("workspace_id", workspace.id).eq("project_id", projectId).order("round_no", { ascending: false }),
    sb.from("delivery_bundles").select("*").eq("workspace_id", workspace.id).eq("project_id", projectId).order("bundle_no", { ascending: false }),
  ]);
  for (const r of [pr, briefs, rv, bs]) if (r.error) return readFail("getDeliveryBundleFor", r.error);
  const arts = await artifactsOf(sb, workspace.id, { projectId });
  if (!arts.ok) return arts;
  const reviews = (rv.data ?? []) as ReviewRow[];
  const bundles = bs.data ?? [];
  const bundleIds = bundles.map((b) => b.id);
  const [bi, logs] = bundleIds.length
    ? await Promise.all([
        sb.from("delivery_bundle_items").select("*").eq("workspace_id", workspace.id).in("bundle_id", bundleIds).order("sort_order", { ascending: true }),
        sb.from("delivery_logs").select("*").eq("workspace_id", workspace.id).in("bundle_id", bundleIds).order("delivered_at", { ascending: false }),
      ])
    : [{ data: [] as Array<Record<string, unknown>>, error: null }, { data: [] as Array<Record<string, unknown>>, error: null }];
  if (bi.error) return readFail("getDeliveryBundleFor.items", bi.error);
  if (logs.error) return readFail("getDeliveryBundleFor.logs", logs.error);

  // 지금 넣을 승인본(DB app.delivery_candidates 와 같은 규칙)
  const included: DbIncludedItem[] = [];
  const excluded: DbExcludedItem[] = [];
  for (const b of (briefs.data ?? []).filter((x) => x.status === "ready" && x.archived_at === null))
    included.push({ kind: "production_brief", targetId: b.id, title: `공통 제작 브리프 · ${b.title}`, versionNo: b.revision, stateLabel: "확정", qaRoundNo: null, detail: null });
  for (const a of arts.data) {
    const mine = reviews.filter((r) => r.target_id === a.id);
    const approved = mine.find((r) => r.status === "reviewed" && r.archived_at === null);
    const latest = mine.find((r) => r.archived_at === null);
    if (a.archived) excluded.push({ kind: a.kind, targetId: a.id, title: a.title, versionNo: a.versionNo, stateLabel: "보관", reasonCode: "archived", reason: EXCLUDE.archived });
    else if (approved)
      included.push({
        kind: a.kind,
        targetId: a.id,
        title: a.title,
        versionNo: approved.target_version_no,
        stateLabel: "승인됨",
        qaRoundNo: approved.round_no,
        detail: approved.target_version_no < a.versionNo ? `이후 새 판 v${a.versionNo} 있음(재검수 필요)` : null,
      });
    else {
      const code: DbExcludeCode = !a.reviewed && !latest ? "not_reviewed" : !latest ? "no_qa" : latest.status === "fix_requested" ? "fix_requested" : "qa_open";
      excluded.push({ kind: a.kind, targetId: a.id, title: a.title, versionNo: a.versionNo, stateLabel: code === "fix_requested" ? "보완 요청됨" : code === "qa_open" ? "검수 중" : "작성 중", reasonCode: code, reason: EXCLUDE[code] });
    }
  }
  const itemRows = (bi.data ?? []) as Array<Record<string, unknown>>;
  const titleOf = (r: Record<string, unknown>) => {
    const tid = String(r.production_brief_id ?? r.web_copy_doc_id ?? r.design_asset_id ?? r.video_plan_id ?? r.ppt_deck_id);
    if (r.kind === "production_brief") return `브리프 v${r.version_no}`;
    const a = arts.data.find((x) => x.id === tid);
    return `${a?.title ?? KIND_TITLE[r.kind as QaTargetKind]} v${r.version_no}`;
  };
  const labelOf = new Map(bundles.map((b) => [b.id, bundleLabel(b.bundle_no)]));
  const views: DbBundleView[] = bundles.map((b) => ({
    id: b.id,
    bundleNo: b.bundle_no,
    bundleVersion: bundleLabel(b.bundle_no),
    status: b.status as DbStatus,
    archivedAt: b.archived_at,
    revision: b.revision,
    createdAt: b.created_at,
    restoredFromVersion: b.restored_from_id ? (labelOf.get(b.restored_from_id) ?? null) : null,
    itemCount: b.item_count,
    itemsSummary: itemRows.filter((r) => r.bundle_id === b.id).map(titleOf),
    logs: ((logs.data ?? []) as Array<Record<string, unknown>>)
      .filter((l) => l.bundle_id === b.id)
      .map((l) => ({ id: String(l.id), method: l.method as DbMethod, deliveredAt: String(l.delivered_at), note: (l.note as string | null) ?? "", bundleVersion: bundleLabel(b.bundle_no) })),
  }));
  // 이전 기준: 마지막 묶음 이후 새로 승인된 판(또는 새 확정 브리프 revision)이 있으면
  const last = bundles[0];
  const key = (kind: string, id: string, v: number) => `${kind}/${id}/${v}`;
  const lastKeys = new Set(itemRows.filter((r) => last && r.bundle_id === last.id).map((r) => key(String(r.kind), String(r.production_brief_id ?? r.web_copy_doc_id ?? r.design_asset_id ?? r.video_plan_id ?? r.ppt_deck_id), Number(r.version_no))));
  const stale = Boolean(last) && included.some((x) => !lastKeys.has(key(x.kind, x.targetId, x.versionNo)));
  const baseArchived = pr.data?.status === "archived";
  const hasApproved = included.some((x) => x.kind !== "production_brief");
  const createBlockedCode: DbCreateBlockedCode | null = baseArchived ? "project_archived" : !hasApproved ? "no_approved" : bundles.length >= 50 ? "bundle_limit" : null;
  return ok({ projectId, included, excluded, bundles: views, stale, baseArchived, canWrite: !baseArchived, canCreate: createBlockedCode === null, createBlockedCode });
}

// ─────────────────────────────────────────────
// 납품 쓰기
// ─────────────────────────────────────────────
export const createDeliveryBundle = (projectId: string) => idRpc("createDeliveryBundle", (sb) => sb.rpc("create_delivery_bundle", { p_project_id: projectId }));
export const restoreDeliveryBundle = (bundleId: string) => idRpc("restoreDeliveryBundle", (sb) => sb.rpc("restore_delivery_bundle", { p_bundle_id: bundleId }));
export async function updateDeliveryBundle(bundleId: string, expectedRevision: number, status: string): Promise<Result<{ revision: number }>> {
  if (!(DB_STATUS_KEYS as readonly string[]).includes(status)) return fail("VALIDATION", "알 수 없는 진행 상태입니다.");
  return revisionRpc("updateDeliveryBundle", (sb) => sb.rpc("update_delivery_bundle", { p_bundle_id: bundleId, p_expected_revision: expectedRevision, p_status: status }));
}
export const archiveDeliveryBundle = (bundleId: string, expectedRevision: number) =>
  revisionRpc("archiveDeliveryBundle", (sb) => sb.rpc("archive_delivery_bundle", { p_bundle_id: bundleId, p_expected_revision: expectedRevision }));
/** raw = { method, deliveredAt(ISO), note } — 실제 발송은 하지 않는다(기록만) */
export async function addDeliveryLog(bundleId: string, expectedRevision: number, raw: unknown): Promise<Result<{ revision: number }>> {
  const p = deliveryLogSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  return revisionRpc("addDeliveryLog", (sb) =>
    sb.rpc("add_delivery_log", { p_bundle_id: bundleId, p_expected_revision: expectedRevision, p_method: p.data.method, p_delivered_at: p.data.deliveredAt, p_note: p.data.note as string }),
  );
}
