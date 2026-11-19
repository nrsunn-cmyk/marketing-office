import "server-only";
import { createHash, createHmac } from "node:crypto";
import {
  DESIGN_ASSET_LIMITS,
  DESIGN_DISABLED_MESSAGE,
  DESIGN_MIME_EXTENSIONS,
  DESIGN_SIGNED_URL_SECONDS,
  checkDesignBytes,
  checkDesignDeclared,
  designAssetCreateSchema,
  designAssetReplaceSchema,
  designAssetUpdateSchema,
  designAssetUsagesSchema,
  designConfirmMessage,
  designErrorFromDb,
  designRejectMessage,
  designReserveMessage,
  designTextPreview,
  designUploadError,
  designUploadPrepareSchema,
  sectionLabel,
  toDbUsages,
  type DesignAssetKind,
  type DesignAssetStatus,
  type DesignError,
  type DesignMime,
} from "@/domain/design-assets";
import { funnelIssueMessage } from "@/domain/funnel";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type Result } from "@/server/result";
import { withDownloadName } from "@/server/storage/download-name";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * P3C-BACKEND-IMPL-01: 디자인 자산(P3-c) 서버 함수. 설계: Plan/Claude-Backend-20261120/P3C-BACKEND-01-DESIGN.md.
 *
 * 업로드(Master 결정 ①): Vercel 함수 요청 본문은 4.5MB 까지라 파일은 브라우저가 저장소에 직접 올린다.
 *   1) prepareDesignAssetUpload: 이름·크기·선언 형식 검사 → 예약 RPC(서버 서명) → 서명 업로드 URL(경로·토큰)
 *   2) 브라우저: supabase.storage.from("design-assets").uploadToSignedUrl(path, token, file, { contentType: mime })
 *   3) confirmDesignAssetCreate / confirmDesignAssetReplace: 서버가 객체를 받아 앞 바이트·SVG 위험 요소를 검사하고 sha256 을 잰 뒤
 *      확정 RPC(서버 서명). 검사에서 떨어지면 예약을 닫는다(reject RPC).
 * 서명 키: DESIGN_ASSET_SIGNING_KEY = DB app.server_secrets 'design_asset_signing'. 없으면 올리기 기능이 꺼진다(읽기는 됨).
 * 업로드 실패는 errors.uploadCode·copyKey 로 AGY DA_COPY upload* 문구 키를 함께 준다.
 */

const BUCKET = "design-assets";
const NULL = null as unknown as string; // RPC 인자 타입이 null 을 받지 않게 생성돼 있어 null 을 그대로 넘길 때 쓴다

const signingKey = () => process.env.DESIGN_ASSET_SIGNING_KEY?.trim() || "";
export const designUploadEnabled = () => signingKey() !== "";

/** 서버 서명: HMAC-SHA256(키, "용도|메시지|서명시각ms") — DB app.assert_design_signature 와 같은 값 */
export function signDesign(purpose: "design_reserve" | "design_confirm" | "design_reject", message: string, at = Date.now(), key = signingKey()) {
  return { at, sig: createHmac("sha256", key).update(`${purpose}|${message}|${at}`, "utf8").digest("hex") };
}

type UploadErrors = Pick<DesignError, "uploadCode" | "copyKey">;
type DResult<T> = Result<T, UploadErrors>;

function designFail<T>(e: DesignError): DResult<T> {
  return e.uploadCode
    ? { ok: false, code: e.code, message: e.message, errors: { uploadCode: e.uploadCode, copyKey: e.copyKey } }
    : { ok: false, code: e.code, message: e.message };
}
function rpcFail<T>(where: string, error: { code?: string; message: string }): DResult<T> {
  const e = designErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  return designFail(e);
}
function readFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  console.error(`[${where}]`, error.code, error.message);
  return fail("ERROR", "디자인 자산 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

const mimeOfKey = (key: string): DesignMime | null => {
  const ext = /\.([a-z0-9]+)$/.exec(key)?.[1] ?? "";
  const hit = (Object.entries(DESIGN_MIME_EXTENSIONS) as [DesignMime, readonly string[]][]).find(([, exts]) => exts[0] === ext);
  return hit ? hit[0] : null;
};
const kindOfMime = (m: DesignMime): DesignAssetKind =>
  m === "application/json" || m === "text/css" ? "color" : m.startsWith("font/") ? "font" : m === "image/svg+xml" ? "logo" : "image";

// ─────────────────────────────────────────────
// 읽기
// ─────────────────────────────────────────────
export interface DesignAssetVersionView {
  id: string;
  version: number;
  kind: "create" | "replace" | "restore" | "rebase";
  savedAt: string;
  note: string | null;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  restoredFromVersion: number | null;
  current: boolean;
}
export interface DesignAssetView {
  id: string;
  title: string;
  kind: DesignAssetKind;
  origin: "external_upload" | "app_generated";
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  licenseNote: string | null;
  status: DesignAssetStatus;
  archivedAt: string | null;
  revision: number;
  version: number;
  /** 자산이 지난 제작 브리프 기준인지(맞추기 대상) */
  stale: boolean;
  /** label 이 null 이면 홈페이지 문서 현재 판에서 사라진 섹션(또는 보관한 문서) */
  usages: Array<{ id: string; docId: string; sectionId: string; label: string | null }>;
  versions: DesignAssetVersionView[];
}
export interface DesignAssetsData {
  brief: { id: string; title: string; revision: number; status: string; archived: boolean; includesDesignAssets: boolean };
  assets: DesignAssetView[];
  /** 기준(공통 제작 브리프·홈페이지 구조)이 바뀌었는지: 지난 기준 자산이 있거나 사라진 사용처가 있으면 true */
  stale: boolean;
  /** 이 프로젝트 자산을 올리거나 고칠 수 있는지(프로젝트 보관·작업 취소·서명 키 없음이면 false) */
  canWrite: boolean;
  /** canWrite 가 false 인 이유 */
  readOnlyReason: string | null;
  /** 새 자산을 올릴 수 있는지(브리프 확정·design_assets 포함·50개 미만) */
  canCreate: boolean;
  createBlockedReason: string | null;
  /** 프로젝트 자산 수(보관 포함)와 한도 */
  count: number;
  limit: number;
  /** 사용처로 고를 수 있는 홈페이지 섹션(같은 프로젝트·작업 중 문서의 현재 판) */
  usageOptions: Array<{ docId: string; sectionId: string; label: string }>;
}

export async function getDesignAssetsFor(productionBriefId: string): Promise<Result<DesignAssetsData>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const br = await sb
    .from("production_briefs")
    .select("id, title, revision, status, archived_at, project_id, strategy_artifact_id, deliverable_types")
    .eq("id", productionBriefId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (br.error) return readFail("getDesignAssetsFor.brief", br.error);
  if (!br.data) return fail("NOT_FOUND", "제작 브리프를 찾을 수 없습니다.");
  const b = br.data;

  const [pr, ar, as, docs] = await Promise.all([
    sb.from("projects").select("status").eq("id", b.project_id).eq("workspace_id", workspace.id).maybeSingle(),
    sb.from("artifacts").select("task_id").eq("id", b.strategy_artifact_id).eq("workspace_id", workspace.id).maybeSingle(),
    sb.from("design_assets").select("*").eq("workspace_id", workspace.id).eq("project_id", b.project_id).order("created_at", { ascending: true }),
    sb.from("web_copy_docs").select("id, current_version_no, archived_at").eq("workspace_id", workspace.id).eq("project_id", b.project_id),
  ]);
  for (const [where, r] of [["project", pr], ["artifact", ar], ["assets", as], ["docs", docs]] as const) if (r.error) return readFail(`getDesignAssetsFor.${where}`, r.error);
  let taskCancelled = false;
  if (ar.data?.task_id) {
    const tk = await sb.from("tasks").select("status").eq("id", ar.data.task_id).eq("workspace_id", workspace.id).maybeSingle();
    if (tk.error) return readFail("getDesignAssetsFor.task", tk.error);
    taskCancelled = tk.data?.status === "cancelled";
  }
  const allProject = as.data ?? [];
  const mine = allProject.filter((x) => x.production_brief_id === b.id);
  const ids = mine.map((x) => x.id);
  const activeDocs = (docs.data ?? []).filter((d) => d.archived_at === null);

  const [vs, us, contents] = await Promise.all([
    ids.length
      ? sb.from("design_asset_versions").select("id, asset_id, version_no, kind, change_note, file_name, file_size_bytes, mime_type, restored_from_version_no, created_at").eq("workspace_id", workspace.id).in("asset_id", ids).order("version_no", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? sb.from("design_asset_usages").select("id, asset_id, web_copy_doc_id, section_id").eq("workspace_id", workspace.id).in("asset_id", ids)
      : Promise.resolve({ data: [], error: null }),
    Promise.all(activeDocs.map((d) => sb.from("web_copy_versions").select("doc_id, content").eq("workspace_id", workspace.id).eq("doc_id", d.id).eq("version_no", d.current_version_no).maybeSingle())),
  ]);
  if (vs.error) return readFail("getDesignAssetsFor.versions", vs.error);
  if (us.error) return readFail("getDesignAssetsFor.usages", us.error);
  const contentByDoc = new Map<string, unknown>();
  for (const c of contents) {
    if (c.error) return readFail("getDesignAssetsFor.webCopy", c.error);
    if (c.data) contentByDoc.set(c.data.doc_id, c.data.content);
  }

  const usageOptions: DesignAssetsData["usageOptions"] = [];
  for (const [docId, content] of contentByDoc) {
    const pages = (content as { pages?: Array<{ sections?: Array<{ id?: string }> }> } | null)?.pages ?? [];
    for (const p of pages) for (const s of p.sections ?? []) if (s.id) usageOptions.push({ docId, sectionId: s.id, label: sectionLabel(content, s.id) ?? "" });
  }

  let anyStale = false;
  const assets: DesignAssetView[] = mine.map((x) => {
    const versions = (vs.data ?? []).filter((v) => v.asset_id === x.id);
    const cur = versions.find((v) => v.version_no === x.current_version_no);
    const usages = (us.data ?? [])
      .filter((u) => u.asset_id === x.id)
      .map((u) => ({ id: u.id, docId: u.web_copy_doc_id, sectionId: u.section_id, label: contentByDoc.has(u.web_copy_doc_id) ? sectionLabel(contentByDoc.get(u.web_copy_doc_id), u.section_id) : null }));
    const stale = x.archived_at === null && x.source_brief_revision !== b.revision;
    if (x.archived_at === null && (stale || usages.some((u) => u.label === null))) anyStale = true;
    return {
      id: x.id,
      title: x.title,
      kind: x.asset_kind as DesignAssetKind,
      origin: x.origin_type as DesignAssetView["origin"],
      fileName: cur?.file_name ?? "",
      fileSizeBytes: cur?.file_size_bytes ?? 0,
      mimeType: cur?.mime_type ?? "",
      licenseNote: x.license_note,
      status: x.status as DesignAssetStatus,
      archivedAt: x.archived_at,
      revision: x.revision,
      version: x.current_version_no,
      stale,
      usages,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version_no,
        kind: v.kind as DesignAssetVersionView["kind"],
        savedAt: v.created_at,
        note: v.change_note,
        fileName: v.file_name,
        fileSizeBytes: v.file_size_bytes,
        mimeType: v.mime_type,
        restoredFromVersion: v.restored_from_version_no,
        current: v.version_no === x.current_version_no,
      })),
    };
  });

  const readOnlyReason =
    pr.data?.status === "archived"
      ? "보관한 프로젝트라 디자인 자산을 고칠 수 없습니다."
      : taskCancelled
        ? "바탕 전략 작업이 취소되어 디자인 자산을 고칠 수 없습니다."
        : !designUploadEnabled()
          ? DESIGN_DISABLED_MESSAGE
          : null;
  const includesDesignAssets = (b.deliverable_types ?? []).includes("design_assets");
  const createBlockedReason =
    readOnlyReason ??
    (b.archived_at !== null
      ? "보관한 제작 브리프로는 디자인 자산을 올릴 수 없습니다."
      : b.status !== "ready"
        ? "제작 브리프를 확정해야 디자인 자산을 올릴 수 있습니다."
        : !includesDesignAssets
          ? "이 제작 브리프의 포함 산출물에 디자인 자산이 없습니다."
          : allProject.length >= DESIGN_ASSET_LIMITS.perProject
            ? "디자인 자산이 50개라 더 올릴 수 없습니다. 쓰지 않는 자산을 보관한 뒤 다시 올려 주세요."
            : null);
  return ok({
    brief: { id: b.id, title: b.title, revision: b.revision, status: b.status, archived: b.archived_at !== null, includesDesignAssets },
    assets,
    stale: anyStale,
    canWrite: readOnlyReason === null,
    readOnlyReason,
    canCreate: createBlockedReason === null,
    createBlockedReason,
    count: allProject.length,
    limit: DESIGN_ASSET_LIMITS.perProject,
    usageOptions,
  });
}

/**
 * 파일 주소(서명 URL). 내려받기 60초·미리보기 300초, 늘 attachment(download 옵션).
 * <img> 미리보기는 attachment 여도 그림으로 보이고, SVG 를 주소창으로 열어도 실행되지 않고 내려받아진다(Q4·Q6). 보관한 자산도 된다.
 */
export async function getDesignAssetFileUrl(assetId: string, versionNo: number, purpose: "download" | "preview"): Promise<Result<{ url: string; expiresIn: number }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const v = await sb.from("design_asset_versions").select("storage_key, file_name").eq("workspace_id", workspace.id).eq("asset_id", assetId).eq("version_no", versionNo).maybeSingle();
  if (v.error) return readFail("getDesignAssetFileUrl", v.error);
  if (!v.data) return fail("NOT_FOUND", "그 판을 찾을 수 없습니다.");
  const seconds = DESIGN_SIGNED_URL_SECONDS[purpose];
  // download=true 로 서명하고 이름은 한 번만 인코딩해 붙인다(라이브러리가 두 번 인코딩하는 문제, withDownloadName 참고)
  const s = await sb.storage.from(BUCKET).createSignedUrl(v.data.storage_key, seconds, { download: true });
  if (s.error || !s.data) {
    console.error("[getDesignAssetFileUrl.sign]", s.error?.message);
    return fail("ERROR", "파일 주소를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return ok({ url: withDownloadName(s.data.signedUrl, v.data.file_name), expiresIn: seconds });
}

/** 색상·토큰(JSON·CSS) 글자 미리보기(화면에 적용하지 않음, Q5). 화면은 이 글을 글자로만(이스케이프) 보인다 */
export async function getDesignAssetTextPreview(assetId: string, versionNo: number): Promise<Result<{ text: string }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const v = await sb.from("design_asset_versions").select("storage_key, mime_type").eq("workspace_id", workspace.id).eq("asset_id", assetId).eq("version_no", versionNo).maybeSingle();
  if (v.error) return readFail("getDesignAssetTextPreview", v.error);
  if (!v.data) return fail("NOT_FOUND", "그 판을 찾을 수 없습니다.");
  const d = await sb.storage.from(BUCKET).download(v.data.storage_key);
  if (d.error || !d.data) return fail("ERROR", "파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  const text = designTextPreview(v.data.mime_type as DesignMime, new Uint8Array(await d.data.arrayBuffer()));
  if (text === null) return fail("VALIDATION", "글자로 미리 볼 수 없는 파일입니다.");
  return ok({ text });
}

// ─────────────────────────────────────────────
// 올리기(3단계)
// ─────────────────────────────────────────────
export interface DesignUploadTicket {
  uploadId: string;
  /** 저장소 경로와 서명 업로드 토큰: 브라우저가 uploadToSignedUrl(path, token, file, { contentType: mime }) 로 올린다 */
  path: string;
  token: string;
  mime: DesignMime;
  expiresAt: string;
}

/** 1단계. raw = { productionBriefId, assetId(교체면 자산 id, 새것이면 null), kind, fileName, size, mime } */
export async function prepareDesignAssetUpload(raw: unknown): Promise<DResult<DesignUploadTicket>> {
  if (!designUploadEnabled()) return fail("ERROR", DESIGN_DISABLED_MESSAGE);
  const p = designUploadPrepareSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  const i = p.data;
  const c = checkDesignDeclared(i.kind, i.fileName, i.size, i.mime);
  if (!c.ok) return designFail(designUploadError(c.code));
  const sb = await createSupabaseServerClient();
  const g = signDesign("design_reserve", designReserveMessage(i));
  const r = await sb.rpc("reserve_design_asset_upload", {
    p_production_brief_id: i.productionBriefId,
    p_asset_id: i.assetId ?? NULL,
    p_kind: i.kind,
    p_file_name: i.fileName,
    p_size: i.size,
    p_mime: i.mime,
    p_signed_at: g.at,
    p_signature: g.sig,
  });
  if (r.error) return rpcFail("prepareDesignAssetUpload", r.error);
  const row = r.data?.[0];
  if (!row) return fail("ERROR", "업로드를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  // 서명 업로드 URL 은 저장소 insert 정책(진행 중 예약 경로만)을 통과해야 만들어진다
  const s = await sb.storage.from(BUCKET).createSignedUploadUrl(row.storage_key);
  if (s.error || !s.data) {
    console.error("[prepareDesignAssetUpload.sign]", s.error?.message);
    return fail("ERROR", "업로드를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return ok({ uploadId: row.upload_id, path: row.storage_key, token: s.data.token, mime: i.mime, expiresAt: row.expires_at });
}

/** 2단계 뒤: 저장소에서 받아 실제 바이트 검사. 떨어지면 예약을 닫는다 */
async function inspectUploaded(uploadId: string, path: string): Promise<DResult<{ sha256: string }>> {
  const { workspace } = await requireWorkspace();
  const mime = mimeOfKey(path);
  // 경로는 예약 RPC 가 만든 모양만 받는다(업무실/design-assets/예약id.확장자). 다른 경로를 주면 확정 RPC 의 객체 대조에서도 걸린다
  if (!mime || path !== `${workspace.id}/design-assets/${uploadId}.${DESIGN_MIME_EXTENSIONS[mime][0]}`) return fail("VALIDATION", "업로드 경로가 올바르지 않습니다.");
  const sb = await createSupabaseServerClient();
  const d = await sb.storage.from(BUCKET).download(path);
  if (d.error || !d.data) return designFail(designUploadError("UPLOAD_MISSING"));
  const bytes = new Uint8Array(await d.data.arrayBuffer());
  const c = checkDesignBytes(kindOfMime(mime), mime, bytes);
  if (!c.ok) {
    const g = signDesign("design_reject", designRejectMessage(uploadId, c.code));
    const r = await sb.rpc("reject_design_asset_upload", { p_upload_id: uploadId, p_reason: c.code, p_signed_at: g.at, p_signature: g.sig });
    if (r.error) console.error("[inspectUploaded.reject]", r.error.code, r.error.message);
    return designFail(designUploadError(c.code));
  }
  return ok({ sha256: createHash("sha256").update(bytes).digest("hex") });
}

/** 3단계(새 자산). raw = { uploadId, title, licenseNote, origin: "external_upload" }, path = 1단계에서 받은 경로 */
export async function confirmDesignAssetCreate(path: string, raw: unknown): Promise<DResult<{ assetId: string }>> {
  if (!designUploadEnabled()) return fail("ERROR", DESIGN_DISABLED_MESSAGE);
  const p = designAssetCreateSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  const ins = await inspectUploaded(p.data.uploadId, path);
  if (!ins.ok) return ins;
  const sb = await createSupabaseServerClient();
  const g = signDesign("design_confirm", designConfirmMessage(p.data.uploadId, ins.data.sha256));
  const r = await sb.rpc("create_design_asset", {
    p_upload_id: p.data.uploadId,
    p_title: p.data.title,
    p_license_note: p.data.licenseNote ?? NULL,
    p_origin_type: p.data.origin,
    p_sha256: ins.data.sha256,
    p_signed_at: g.at,
    p_signature: g.sig,
  });
  if (r.error) return rpcFail("confirmDesignAssetCreate", r.error);
  return ok({ assetId: r.data });
}

/** 3단계(파일 교체). raw = { uploadId, changeNote } */
export async function confirmDesignAssetReplace(assetId: string, expectedRevision: number, path: string, raw: unknown): Promise<DResult<{ revision: number }>> {
  if (!designUploadEnabled()) return fail("ERROR", DESIGN_DISABLED_MESSAGE);
  const p = designAssetReplaceSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  const ins = await inspectUploaded(p.data.uploadId, path);
  if (!ins.ok) return ins;
  const sb = await createSupabaseServerClient();
  const g = signDesign("design_confirm", designConfirmMessage(p.data.uploadId, ins.data.sha256));
  const r = await sb.rpc("replace_design_asset_file", {
    p_asset_id: assetId,
    p_expected_revision: expectedRevision,
    p_upload_id: p.data.uploadId,
    p_change_note: p.data.changeNote ?? NULL,
    p_sha256: ins.data.sha256,
    p_signed_at: g.at,
    p_signature: g.sig,
  });
  if (r.error) return rpcFail("confirmDesignAssetReplace", r.error);
  return ok({ revision: r.data });
}

// ─────────────────────────────────────────────
// 그 밖의 쓰기
// ─────────────────────────────────────────────
/** 정보 저장. raw = Front toAssetPayload { title, licenseNote, status } */
export async function updateDesignAsset(assetId: string, expectedRevision: number, raw: unknown): Promise<DResult<{ revision: number }>> {
  const p = designAssetUpdateSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("update_design_asset", { p_asset_id: assetId, p_expected_revision: expectedRevision, p_title: p.data.title, p_license_note: p.data.licenseNote ?? NULL, p_status: p.data.status });
  if (r.error) return rpcFail("updateDesignAsset", r.error);
  return ok({ revision: r.data });
}

export async function restoreDesignAssetVersion(assetId: string, expectedRevision: number, versionNo: number): Promise<DResult<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("restore_design_asset_version", { p_asset_id: assetId, p_expected_revision: expectedRevision, p_version_no: versionNo });
  if (r.error) return rpcFail("restoreDesignAssetVersion", r.error);
  return ok({ revision: r.data });
}

export async function rebaseDesignAsset(assetId: string, expectedRevision: number): Promise<DResult<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("rebase_design_asset", { p_asset_id: assetId, p_expected_revision: expectedRevision });
  if (r.error) return rpcFail("rebaseDesignAsset", r.error);
  return ok({ revision: r.data });
}

export async function archiveDesignAsset(assetId: string, expectedRevision: number): Promise<DResult<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("archive_design_asset", { p_asset_id: assetId, p_expected_revision: expectedRevision });
  if (r.error) return rpcFail("archiveDesignAsset", r.error);
  return ok({ revision: r.data });
}

/** 사용처 목록 전체 교체. raw = [{ docId, sectionId }] (0~20) */
export async function setDesignAssetUsages(assetId: string, expectedRevision: number, raw: unknown): Promise<DResult<{ revision: number }>> {
  const p = designAssetUsagesSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", funnelIssueMessage(p.error.issues[0]));
  const sb = await createSupabaseServerClient();
  const r = await sb.rpc("set_design_asset_usages", { p_asset_id: assetId, p_expected_revision: expectedRevision, p_usages: toDbUsages(p.data) });
  if (r.error) return rpcFail("setDesignAssetUsages", r.error);
  return ok({ revision: r.data });
}
