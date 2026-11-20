import "server-only";
import { createHmac } from "node:crypto";
import { funnelIssueMessage } from "@/domain/funnel";
import {
  VIDEO_DISABLED_MESSAGE,
  VIDEO_MIME_EXT,
  VIDEO_PLAN_LIMITS,
  VIDEO_SIGNED_URL_SECONDS,
  toDbScenes,
  videoCloseMessage,
  videoErrorFromDb,
  videoPlanCreateSchema,
  videoPlanSaveSchema,
  videoReserveMessage,
  videoSignatureOk,
  videoUploadFinishSchema,
  videoUploadPrepareSchema,
  type VideoCloseReason,
  type VideoMime,
} from "@/domain/video-plans";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type Result } from "@/server/result";
import { withDownloadName } from "@/server/storage/download-name";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * P3D-BACKEND-IMPL-01: 영상 구성·파일 관리(P3-d) 서버 함수. 설계: Plan/Claude-Backend-20261120/P3D-BACKEND-01-DESIGN.md.
 *
 * 구성안: 저장할 때마다 새 판(제목·비율·상태·장면). 장면 빼기 = 목록에서 제거, 되살리기는 구성안 판 되돌리기.
 * 영상 파일(Vercel 함수 본문 4.5MB 한도라 브라우저 직접 업로드):
 *   1) startVideoUpload: 이름·크기·형식 검사 → 예약 RPC(서버 서명) → 서명 업로드 URL(경로·토큰)
 *   2) 브라우저: supabase.storage.from("video-files").uploadToSignedUrl(path, token, file, { contentType: mime })
 *   3) finishVideoUpload: 서명 URL 로 앞 4KB 만 받아 영상 형식 표식 확인(DS5) → 확정 RPC(서버 서명). 떨어지면 예약을 닫는다
 * 서명 키: P3-c 와 공유(DESIGN_ASSET_SIGNING_KEY = DB 'design_asset_signing', Master 결정 ④). 용도 video_file_* 로 구분한다.
 *   키가 없으면 파일 첨부만 꺼진다(구성안 작성·내려받기는 됨).
 * 외부 API·AI 호출 없음(X11). 저장소는 이 앱의 Supabase 만 쓴다.
 */

const BUCKET = "video-files";
const NULL = null as unknown as string; // RPC 인자 타입이 null 을 받지 않게 생성돼 있어 null 을 그대로 넘길 때 쓴다
const HEAD_BYTES = 4096;

const signingKey = () => process.env.DESIGN_ASSET_SIGNING_KEY?.trim() || "";
export const videoUploadEnabled = () => signingKey() !== "";

/** 서버 서명: HMAC-SHA256(키, "용도|메시지|서명시각ms") — DB app.assert_design_signature 와 같은 값. 용도로 디자인 자산 서명과 구분 */
export function signVideo(purpose: "video_file_reserve" | "video_file_confirm" | "video_file_close", message: string, at = Date.now(), key = signingKey()) {
  return { at, sig: createHmac("sha256", key).update(`${purpose}|${message}|${at}`, "utf8").digest("hex") };
}

function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  const e = videoErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  return fail(e.code, e.message);
}
function readFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  console.error(`[${where}]`, error.code, error.message);
  return fail("ERROR", "영상 구성안을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

// ─────────────────────────────────────────────
// 읽기 (Front d0b2546 video-plan-model.ts 보기 타입 + Master 결정 ⑤ 칸)
// ─────────────────────────────────────────────
type StoredScene = { id: string; title: string; duration_sec: number; narration: string | null; subtitle: string | null; assets: Array<{ asset_id: string; version_no: number }> };

export interface VideoSceneView {
  id: string | null;
  sceneTitle: string;
  durationSec: number;
  narration: string;
  subtitle: string;
  assetIds: string[];
  sortOrder: number;
}
export interface VideoFileVersionView {
  version: number;
  fileName: string;
  fileSizeBytes: number;
  savedAt: string;
  note: string | null;
  current: boolean;
  kind: "upload" | "restore";
  restoredFromVersion: number | null;
}
export interface VideoPlanVersionView {
  version: number;
  kind: "create" | "save" | "restore" | "rebase";
  status: "drafting" | "reviewed";
  savedAt: string;
  sceneCount: number;
  totalSec: number;
  restoredFromVersion: number | null;
  current: boolean;
}
export type VideoStaleReason = "brief" | "asset";
/** 맞추기 막힘 원인 코드(화면이 AGY 문구를 고른다, Front P3D-UI-CONNECT-01 요청) */
export type VideoRebaseBlockedCode = "plan_archived" | "brief_archived" | "brief_drafting" | "version_limit";
/** 만들기 막힘 원인 코드 */
export type VideoCreateBlockedCode = "project_archived" | "task_cancelled" | "brief_archived" | "brief_drafting" | "no_video_deliverable" | "plan_limit_total" | "plan_limit_active";
export interface VideoPlanView {
  id: string;
  title: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
  status: "drafting" | "reviewed";
  archivedAt: string | null;
  revision: number;
  /** 계산: 기준(공통 제작 브리프·연결 자산)이 새 버전으로 바뀜 */
  stale: boolean;
  staleReasons: VideoStaleReason[];
  /** 판이 바뀐 연결 자산 수(서로 다른 자산 기준) — AGY staleReasonAsset 의 {n} */
  staleAssetCount: number;
  /** 맞추기를 할 수 없는 이유(원인별). null 이면 맞추기 가능(stale 일 때) */
  rebaseBlockedReason: string | null;
  rebaseBlockedCode: VideoRebaseBlockedCode | null;
  /** 연결돼 있는데 그 뒤 보관된 디자인 자산 수(경고만) */
  archivedAssetCount: number;
  /** 서버가 계산한 총 길이(초). 화면 합계와 같아야 한다(D5) */
  totalSec: number;
  scenes: VideoSceneView[];
  files: VideoFileVersionView[];
  /** 구성안 판 목록(최신 먼저). 장면 빼기를 되살리는 되돌리기 화면용(Q15) */
  planVersions: VideoPlanVersionView[];
}
export interface VideoPlanData {
  plan: VideoPlanView | null;
  canWrite: boolean;
  /** canWrite 가 false 인 이유(프로젝트 보관·작업 취소·구성안 보관) */
  readOnlyReason: string | null;
  canCreate: boolean;
  createBlockedReason: string | null;
  createBlockedCode: VideoCreateBlockedCode | null;
  /** 파일 첨부를 할 수 있는지(서명 키·판 20·보관) */
  canAttach: boolean;
  attachBlockedReason: string | null;
  /** 장면에 연결할 디자인 자산(같은 프로젝트·보관 안 됨) */
  assets: Array<{ id: string; label: string }>;
  /** 이 브리프의 작업 중(보관 안 된) 구성안 수. 화면은 대표 1개만 그린다(대표 = 최근에 고친 것) */
  activePlanCount: number;
}

const REBASE_BLOCKED: Record<VideoRebaseBlockedCode, string> = {
  plan_archived: "보관한 영상 구성안은 맞출 수 없습니다.",
  brief_archived: "보관한 제작 브리프라 맞출 수 없습니다. 이 구성안은 지난 브리프 기준 그대로 고칠 수 있습니다.",
  brief_drafting: "제작 브리프가 작성 중이라 맞출 수 없습니다. 브리프를 확정한 뒤 맞춰 주세요.",
  version_limit: `구성안 판이 ${VIDEO_PLAN_LIMITS.planVersionsMax}개라 맞출 수 없습니다. 구성안을 보관하고 새로 만들어 주세요.`,
};
const CREATE_BLOCKED: Record<VideoCreateBlockedCode, string> = {
  project_archived: "보관한 프로젝트라 영상 구성안을 고칠 수 없습니다.",
  task_cancelled: "바탕 전략 작업이 취소되어 영상 구성안을 고칠 수 없습니다.",
  brief_archived: "보관한 제작 브리프로는 영상 구성안을 만들 수 없습니다.",
  brief_drafting: "확정된 공통 제작 브리프가 있어야 영상 구성안을 만들 수 있습니다.",
  no_video_deliverable: "이 제작 브리프의 포함 산출물에 영상 구성이 없습니다.",
  plan_limit_total: `영상 구성안은 제작 브리프당 ${VIDEO_PLAN_LIMITS.plansPerBrief}개까지입니다(보관 포함).`,
  plan_limit_active: `작업 중인 영상 구성안은 ${VIDEO_PLAN_LIMITS.activePlansPerBrief}개까지입니다. 쓰지 않는 구성안을 보관한 뒤 만들어 주세요.`,
};

export async function getVideoPlanFor(productionBriefId: string): Promise<Result<VideoPlanData>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const br = await sb
    .from("production_briefs")
    .select("id, revision, status, archived_at, project_id, strategy_artifact_id, deliverable_types")
    .eq("id", productionBriefId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (br.error) return readFail("getVideoPlanFor.brief", br.error);
  if (!br.data) return fail("NOT_FOUND", "제작 브리프를 찾을 수 없습니다.");
  const b = br.data;

  const [pr, ar, plans, das] = await Promise.all([
    sb.from("projects").select("status").eq("id", b.project_id).eq("workspace_id", workspace.id).maybeSingle(),
    sb.from("artifacts").select("task_id").eq("id", b.strategy_artifact_id).eq("workspace_id", workspace.id).maybeSingle(),
    sb.from("video_plans").select("*").eq("workspace_id", workspace.id).eq("production_brief_id", b.id).order("updated_at", { ascending: false }),
    sb.from("design_assets").select("id, title, current_version_no, archived_at").eq("workspace_id", workspace.id).eq("project_id", b.project_id).order("created_at", { ascending: true }),
  ]);
  for (const [where, r] of [["project", pr], ["artifact", ar], ["plans", plans], ["assets", das]] as const) if (r.error) return readFail(`getVideoPlanFor.${where}`, r.error);
  let taskCancelled = false;
  if (ar.data?.task_id) {
    const tk = await sb.from("tasks").select("status").eq("id", ar.data.task_id).eq("workspace_id", workspace.id).maybeSingle();
    if (tk.error) return readFail("getVideoPlanFor.task", tk.error);
    taskCancelled = tk.data?.status === "cancelled";
  }
  const all = plans.data ?? [];
  const active = all.filter((p) => p.archived_at === null);
  // 대표 구성안(Master 결정 ②): 보관 안 된 것 중 최근에 고친 것. 모두 보관이면 최근 보관한 것을 읽기 전용으로
  const rep = active[0] ?? all[0] ?? null;
  const assetRows = das.data ?? [];

  let plan: VideoPlanView | null = null;
  if (rep) {
    const [vs, fs] = await Promise.all([
      sb.from("video_plan_versions").select("version_no, kind, status, scenes, total_duration_sec, restored_from_version_no, created_at").eq("workspace_id", workspace.id).eq("plan_id", rep.id).order("version_no", { ascending: false }),
      sb.from("video_file_versions").select("version_no, kind, file_name, file_size_bytes, change_note, restored_from_version_no, created_at").eq("workspace_id", workspace.id).eq("plan_id", rep.id).order("version_no", { ascending: false }),
    ]);
    if (vs.error) return readFail("getVideoPlanFor.versions", vs.error);
    if (fs.error) return readFail("getVideoPlanFor.files", fs.error);
    const cur = (vs.data ?? []).find((v) => v.version_no === rep.current_version_no);
    const scenes = ((cur?.scenes ?? []) as StoredScene[]);
    const byId = new Map(assetRows.map((x) => [x.id, x]));
    const linked = scenes.flatMap((s) => s.assets);
    const staleAssetIds = new Set(linked.filter((x) => (byId.get(x.asset_id)?.current_version_no ?? x.version_no) > x.version_no).map((x) => x.asset_id));
    const assetStale = staleAssetIds.size > 0;
    const briefStale = rep.source_brief_revision !== b.revision;
    const staleReasons: VideoStaleReason[] = [...(briefStale ? (["brief"] as const) : []), ...(assetStale ? (["asset"] as const) : [])];
    const rebaseBlockedCode: VideoRebaseBlockedCode | null =
      rep.archived_at !== null
        ? "plan_archived"
        : b.archived_at !== null
          ? "brief_archived"
          : b.status !== "ready"
            ? "brief_drafting"
            : rep.current_version_no >= VIDEO_PLAN_LIMITS.planVersionsMax
              ? "version_limit"
              : null;
    const rebaseBlockedReason = rebaseBlockedCode === null ? null : REBASE_BLOCKED[rebaseBlockedCode];
    plan = {
      id: rep.id,
      title: rep.title,
      aspectRatio: rep.aspect_ratio as VideoPlanView["aspectRatio"],
      status: rep.status as VideoPlanView["status"],
      archivedAt: rep.archived_at,
      revision: rep.revision,
      stale: rep.archived_at === null && staleReasons.length > 0,
      staleReasons,
      staleAssetCount: staleAssetIds.size,
      rebaseBlockedReason,
      rebaseBlockedCode,
      archivedAssetCount: new Set(linked.filter((x) => byId.get(x.asset_id)?.archived_at != null).map((x) => x.asset_id)).size,
      totalSec: cur?.total_duration_sec ?? 0,
      scenes: scenes.map((s, i) => ({
        id: s.id,
        sceneTitle: s.title,
        durationSec: s.duration_sec,
        narration: s.narration ?? "",
        subtitle: s.subtitle ?? "",
        assetIds: s.assets.map((x) => x.asset_id),
        sortOrder: i + 1,
      })),
      files: (fs.data ?? []).map((f) => ({
        version: f.version_no,
        fileName: f.file_name,
        fileSizeBytes: Number(f.file_size_bytes),
        savedAt: f.created_at,
        note: f.change_note,
        current: f.version_no === rep.current_file_version_no,
        kind: f.kind as VideoFileVersionView["kind"],
        restoredFromVersion: f.restored_from_version_no,
      })),
      planVersions: (vs.data ?? []).map((v) => ({
        version: v.version_no,
        kind: v.kind as VideoPlanVersionView["kind"],
        status: v.status as VideoPlanVersionView["status"],
        savedAt: v.created_at,
        sceneCount: Array.isArray(v.scenes) ? v.scenes.length : 0,
        totalSec: v.total_duration_sec,
        restoredFromVersion: v.restored_from_version_no,
        current: v.version_no === rep.current_version_no,
      })),
    };
  }

  const projectReason =
    pr.data?.status === "archived" ? "보관한 프로젝트라 영상 구성안을 고칠 수 없습니다." : taskCancelled ? "바탕 전략 작업이 취소되어 영상 구성안을 고칠 수 없습니다." : null;
  const readOnlyReason = projectReason ?? (plan?.archivedAt ? "보관한 영상 구성안입니다. 조회와 파일 내려받기만 할 수 있고 고치기·첨부는 할 수 없습니다." : null);
  const createBlockedCode: VideoCreateBlockedCode | null =
    pr.data?.status === "archived"
      ? "project_archived"
      : taskCancelled
        ? "task_cancelled"
        : b.archived_at !== null
          ? "brief_archived"
          : b.status !== "ready"
            ? "brief_drafting"
            : !(b.deliverable_types ?? []).includes("video_plan")
              ? "no_video_deliverable"
              : all.length >= VIDEO_PLAN_LIMITS.plansPerBrief
                ? "plan_limit_total"
                : active.length >= VIDEO_PLAN_LIMITS.activePlansPerBrief
                  ? "plan_limit_active"
                  : null;
  const createBlockedReason = createBlockedCode === null ? null : CREATE_BLOCKED[createBlockedCode];
  const fileCount = plan?.files.length ?? 0;
  const attachBlockedReason =
    readOnlyReason ??
    (!plan
      ? "영상 구성안을 먼저 만들어 주세요."
      : !videoUploadEnabled()
        ? VIDEO_DISABLED_MESSAGE
        : fileCount >= VIDEO_PLAN_LIMITS.fileVersionsMax
          ? `첨부 파일 버전은 ${VIDEO_PLAN_LIMITS.fileVersionsMax}개까지 둘 수 있습니다.`
          : null);
  return ok({
    plan,
    canWrite: plan !== null && readOnlyReason === null,
    readOnlyReason,
    canCreate: createBlockedCode === null,
    createBlockedReason,
    createBlockedCode,
    canAttach: attachBlockedReason === null,
    attachBlockedReason,
    assets: assetRows.filter((x) => x.archived_at === null).map((x) => ({ id: x.id, label: x.title })),
    activePlanCount: active.length,
  });
}

// ─────────────────────────────────────────────
// 구성안 쓰기
// ─────────────────────────────────────────────
/** raw = { productionBriefId, title, aspectRatio, scenes: [{ id: null, sceneTitle, durationSec, narration, subtitle, assetIds }] } */
export async function createVideoPlan(raw: unknown): Promise<Result<{ planId: string }>> {
  const p = videoPlanCreateSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("create_video_plan", {
    p_production_brief_id: p.data.productionBriefId,
    p_title: p.data.title,
    p_aspect_ratio: p.data.aspectRatio,
    p_scenes: toDbScenes(p.data.scenes),
  });
  if (r.error) return rpcFail("createVideoPlan", r.error);
  return ok({ planId: r.data });
}

/** raw = { title, aspectRatio, status, scenes } — 저장 = 새 판. 뺀 장면은 목록에서 빠진다 */
export async function saveVideoPlan(planId: string, expectedRevision: number, raw: unknown): Promise<Result<{ revision: number }>> {
  const p = videoPlanSaveSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("save_video_plan", {
    p_plan_id: planId,
    p_expected_revision: expectedRevision,
    p_title: p.data.title,
    p_aspect_ratio: p.data.aspectRatio,
    p_status: p.data.status,
    p_scenes: toDbScenes(p.data.scenes),
  });
  if (r.error) return rpcFail("saveVideoPlan", r.error);
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
/** 구성안 옛 판으로 되돌리기(새 판, 장면 id·연결 자산 판 번호 그대로). 장면 빼기 복구용 */
export const restoreVideoPlanVersion = (planId: string, expectedRevision: number, versionNo: number) =>
  revisionRpc("restoreVideoPlanVersion", (sb) => sb.rpc("restore_video_plan_version", { p_plan_id: planId, p_expected_revision: expectedRevision, p_version_no: versionNo }));
/** 최신 기준으로 맞추기(브리프 revision·자산 판 번호) */
export const rebaseVideoPlan = (planId: string, expectedRevision: number) =>
  revisionRpc("rebaseVideoPlan", (sb) => sb.rpc("rebase_video_plan", { p_plan_id: planId, p_expected_revision: expectedRevision }));
/** 보관(되돌리기 없음) */
export const archiveVideoPlan = (planId: string, expectedRevision: number) =>
  revisionRpc("archiveVideoPlan", (sb) => sb.rpc("archive_video_plan", { p_plan_id: planId, p_expected_revision: expectedRevision }));
/** 영상 파일 옛 버전으로 되돌리기(같은 파일로 새 버전) */
export const restoreVideoFileVersion = (planId: string, expectedRevision: number, fileVersionNo: number) =>
  revisionRpc("restoreVideoFileVersion", (sb) => sb.rpc("restore_video_file_version", { p_plan_id: planId, p_expected_revision: expectedRevision, p_file_version_no: fileVersionNo }));

// ─────────────────────────────────────────────
// 영상 파일 첨부(3단계)
// ─────────────────────────────────────────────
export interface VideoUploadTicket {
  uploadId: string;
  /** 저장소 경로와 서명 업로드 토큰: 브라우저가 uploadToSignedUrl(path, token, file, { contentType: mime }) 로 올린다 */
  path: string;
  token: string;
  mime: VideoMime;
  expiresAt: string;
}

/** 1단계. raw = { planId, fileName, size, mime } */
export async function startVideoUpload(raw: unknown): Promise<Result<VideoUploadTicket>> {
  if (!videoUploadEnabled()) return fail("ERROR", VIDEO_DISABLED_MESSAGE);
  const p = videoUploadPrepareSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  const i = p.data;
  if (i.size > VIDEO_PLAN_LIMITS.maxFileBytes) return fail("UPLOAD_FAILED", `영상 파일은 ${VIDEO_PLAN_LIMITS.maxFileBytes / 1024 / 1024}MB까지 첨부할 수 있습니다.`);
  await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const g = signVideo("video_file_reserve", videoReserveMessage(i));
  const r = await sb.rpc("reserve_video_file_upload", { p_plan_id: i.planId, p_file_name: i.fileName, p_size: i.size, p_mime: i.mime, p_signed_at: g.at, p_signature: g.sig });
  if (r.error) return rpcFail("startVideoUpload", r.error);
  const row = r.data?.[0];
  if (!row) return fail("ERROR", "업로드를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  // 서명 업로드 URL 은 저장소 insert 정책(진행 중 예약 경로만)을 통과해야 만들어진다
  const s = await sb.storage.from(BUCKET).createSignedUploadUrl(row.storage_key);
  if (s.error || !s.data) {
    console.error("[startVideoUpload.sign]", s.error?.message);
    return fail("ERROR", "업로드를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return ok({ uploadId: row.upload_id, path: row.storage_key, token: s.data.token, mime: i.mime, expiresAt: row.expires_at });
}

async function closeUpload(uploadId: string, reason: VideoCloseReason) {
  const sb = await createSupabaseServerClient();
  const g = signVideo("video_file_close", videoCloseMessage(uploadId, reason));
  const r = await sb.rpc("close_video_file_upload", { p_upload_id: uploadId, p_reason: reason, p_signed_at: g.at, p_signature: g.sig });
  if (r.error) console.error("[closeVideoUpload]", r.error.code, r.error.message);
}

/** 브라우저가 올리지 않고 그만둘 때(취소) */
export async function cancelVideoUpload(uploadId: string): Promise<Result<null>> {
  if (!videoUploadEnabled()) return fail("ERROR", VIDEO_DISABLED_MESSAGE);
  await requireWorkspace();
  await closeUpload(uploadId, "CANCELLED");
  return ok(null);
}

/** 3단계. path = 1단계에서 받은 경로, raw = { uploadId, changeNote } */
export async function finishVideoUpload(planId: string, expectedRevision: number, path: string, raw: unknown): Promise<Result<{ revision: number }>> {
  if (!videoUploadEnabled()) return fail("ERROR", VIDEO_DISABLED_MESSAGE);
  const p = videoUploadFinishSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  const { workspace } = await requireWorkspace();
  const uploadId = p.data.uploadId;
  // 경로는 예약 RPC 가 만든 모양만 받는다(업무실/video-files/예약id.확장자). 그래야 아래 형식 표식 검사가 그 예약의 객체를 본다
  const ext = /\.([a-z0-9]+)$/.exec(path)?.[1] ?? "";
  const mime = (Object.entries(VIDEO_MIME_EXT) as [VideoMime, string][]).find(([, e]) => e === ext)?.[0];
  if (!mime || path !== `${workspace.id}/${BUCKET}/${uploadId}.${ext}`) return fail("VALIDATION", "업로드 경로가 올바르지 않습니다.");
  const sb = await createSupabaseServerClient();
  // 영상 전체를 받지 않고 앞 4KB 만(Range). 표식이 다르면 예약을 닫는다(DS5)
  const s = await sb.storage.from(BUCKET).createSignedUrl(path, 60);
  if (s.error || !s.data) {
    await closeUpload(uploadId, "MISSING");
    return fail("UPLOAD_FAILED", "저장소에 올린 파일이 없습니다. 다시 첨부해 주세요.");
  }
  let head: Uint8Array;
  try {
    const res = await fetch(s.data.signedUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` }, cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    head = new Uint8Array(await res.arrayBuffer()).subarray(0, HEAD_BYTES);
  } catch (e) {
    console.error("[finishVideoUpload.head]", e instanceof Error ? e.message : e);
    await closeUpload(uploadId, "MISSING");
    return fail("UPLOAD_FAILED", "저장소에 올린 파일을 확인하지 못했습니다. 다시 첨부해 주세요.");
  }
  if (!videoSignatureOk(head, mime)) {
    await closeUpload(uploadId, "TYPE_MISMATCH");
    return fail("UPLOAD_FAILED", "영상 파일 형식이 확장자와 맞지 않습니다. MP4·MOV·WEBM 영상만 첨부할 수 있습니다.");
  }
  const g = signVideo("video_file_confirm", uploadId);
  const r = await sb.rpc("confirm_video_file_upload", {
    p_upload_id: uploadId,
    p_expected_revision: expectedRevision,
    p_change_note: p.data.changeNote ?? NULL,
    p_signed_at: g.at,
    p_signature: g.sig,
  });
  if (r.error) return rpcFail("finishVideoUpload", r.error);
  void planId; // 화면이 어느 구성안인지 넘기지만, DB 는 예약에서 구성안을 찾는다(엉뚱한 구성안 id 는 영향 없음)
  return ok({ revision: r.data });
}

/** 영상 파일 내려받기(서명 URL 60초, 늘 attachment). 보관한 구성안도 된다. 발급 감사는 남기지 않는다(읽기) */
export async function getVideoFileUrl(planId: string, fileVersionNo: number): Promise<Result<{ url: string; expiresIn: number }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const v = await sb.from("video_file_versions").select("storage_key, file_name").eq("workspace_id", workspace.id).eq("plan_id", planId).eq("version_no", fileVersionNo).maybeSingle();
  if (v.error) return readFail("getVideoFileUrl", v.error);
  if (!v.data) return fail("NOT_FOUND", "그 파일 버전을 찾을 수 없습니다.");
  const s = await sb.storage.from(BUCKET).createSignedUrl(v.data.storage_key, VIDEO_SIGNED_URL_SECONDS, { download: true });
  if (s.error || !s.data) {
    console.error("[getVideoFileUrl.sign]", s.error?.message);
    return fail("ERROR", "파일 주소를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return ok({ url: withDownloadName(s.data.signedUrl, v.data.file_name), expiresIn: VIDEO_SIGNED_URL_SECONDS });
}
