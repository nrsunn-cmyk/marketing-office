import "server-only";
import { createHash, createHmac } from "node:crypto";
import {
  SOURCE_MIME_EXT,
  SOURCE_UPLOAD_DISABLED_MESSAGE,
  SOURCE_UPLOAD_ERROR_MESSAGES,
  sourceConfirmMessage,
  sourceMimeOfKey,
  sourceRejectMessage,
  sourceReserveMessage,
  sourceUploadErrorFromDb,
  type SourceUploadError,
  type SourceUploadErrorCode,
} from "@/domain/assets/direct-upload";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, checkUploadFile, detectMime, displayFileName, extensionOf, type AllowedMime } from "@/domain/assets/file-check";
import { requireWorkspace } from "@/server/auth/session";
import { fail, fromDbError, ok, type Result } from "@/server/result";
import { withDownloadName } from "@/server/storage/download-name";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const ASSET_BUCKET = "source-assets";

export interface AssetSummary {
  id: string;
  kind: "file" | "url" | "text";
  file_name: string | null;
  url: string | null;
  text_content: string | null;
  mime: string | null;
  bytes: number | null;
  upload_status: string;
  extraction_status: string;
  review_status: string;
  created_at: string;
  project_id: string | null;
}

/** 자료가 붙을 곳. 프로젝트를 지정하면 그 프로젝트의 고객으로 자동 연결한다. */
export interface AssetOwner {
  clientId?: string | null;
  projectId?: string | null;
}

async function resolveOwner(owner: AssetOwner): Promise<Result<{ clientId: string | null; projectId: string | null }>> {
  const sb = await createSupabaseServerClient();
  if (owner.projectId) {
    const { data, error } = await sb.from("projects").select("id, client_id").eq("id", owner.projectId).maybeSingle();
    if (error) return fromDbError("resolveOwner", error);
    if (!data) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    if (owner.clientId && owner.clientId !== data.client_id) {
      return fail("VALIDATION", "다른 고객의 프로젝트에는 자료를 붙일 수 없습니다.");
    }
    return ok({ clientId: data.client_id, projectId: data.id });
  }
  if (owner.clientId) return ok({ clientId: owner.clientId, projectId: null });
  return fail("VALIDATION", "자료를 붙일 고객이나 프로젝트를 정해 주세요.");
}

export async function listAssets(owner: AssetOwner): Promise<AssetSummary[]> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  let query = sb
    .from("source_assets")
    .select("id, kind, file_name, url, text_content, mime, bytes, upload_status, extraction_status, review_status, created_at, project_id")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });
  if (owner.projectId) query = query.eq("project_id", owner.projectId);
  else if (owner.clientId) query = query.eq("client_id", owner.clientId);
  const { data, error } = await query;
  if (error) throw new Error(`자료 목록을 불러오지 못했습니다: ${error.message}`);
  return data as AssetSummary[];
}

export async function addTextAsset(owner: AssetOwner, title: string | null, text: string): Promise<Result<{ id: string }>> {
  const { workspace } = await requireWorkspace();
  const target = await resolveOwner(owner);
  if (!target.ok) return target;
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("source_assets")
    .insert({
      workspace_id: workspace.id,
      client_id: target.data.clientId,
      project_id: target.data.projectId,
      kind: "text",
      file_name: title,
      text_content: text,
      upload_status: "stored",
    })
    .select("id")
    .single();
  if (error) return fromDbError("addTextAsset", error);
  return ok(data);
}

export async function addUrlAsset(owner: AssetOwner, title: string | null, url: string): Promise<Result<{ id: string }>> {
  const { workspace } = await requireWorkspace();
  const target = await resolveOwner(owner);
  if (!target.ok) return target;
  const sb = await createSupabaseServerClient();
  // 주소만 기록한다. 서버가 그 주소에 접속해 내용을 가져오지 않는다(F01, 내부망 요청 방지).
  const { data, error } = await sb
    .from("source_assets")
    .insert({
      workspace_id: workspace.id,
      client_id: target.data.clientId,
      project_id: target.data.projectId,
      kind: "url",
      file_name: title,
      url,
      upload_status: "stored",
    })
    .select("id")
    .single();
  if (error) return fromDbError("addUrlAsset", error);
  return ok(data);
}

// ─────────────────────────────────────────────
// 파일 올리기 (SOURCE-UPLOAD-FIX-01)
//   운영 Vercel 함수 요청 본문은 4.5MB 까지라 서버 액션으로는 10MB 파일을 받을 수 없다.
//   1) prepareSourceUpload: 이름·크기·형식 선언 검사 → 예약 RPC(서버 서명, 경로는 DB 가 정함) → 서명 업로드 URL
//   2) 브라우저: supabase.storage.from("source-assets").uploadToSignedUrl(path, token, file, { contentType: mime })
//   3) confirmSourceUpload: 서버가 객체를 받아 앞 바이트(시그니처) 검사·sha256 → 확정 RPC(서버 서명) → source_assets(stored)
//      검사에서 떨어지면 reject RPC 로 예약을 닫는다.
//   서명 키 SOURCE_ASSET_SIGNING_KEY = DB app.server_secrets 'source_asset_signing'. 없으면 파일 올리기가 꺼진다.
// ─────────────────────────────────────────────
const NULL = null as unknown as string; // RPC 인자 타입이 null 을 받지 않게 생성돼 있어 null 을 그대로 넘길 때 쓴다
const signingKey = () => process.env.SOURCE_ASSET_SIGNING_KEY?.trim() || "";
export const sourceUploadEnabled = () => signingKey() !== "";

/** 서버 서명: HMAC-SHA256(키, "용도|메시지|서명시각ms") — DB app.assert_source_signature 와 같은 값 */
export function signSource(purpose: "source_reserve" | "source_confirm" | "source_reject", message: string, at = Date.now(), key = signingKey()) {
  return { at, sig: createHmac("sha256", key).update(`${purpose}|${message}|${at}`, "utf8").digest("hex") };
}

type UploadErrors = { uploadCode?: SourceUploadErrorCode };
function uploadFail<T>(e: SourceUploadError): Result<T, UploadErrors> {
  return e.uploadCode ? { ok: false, code: e.code, message: e.message, errors: { uploadCode: e.uploadCode } } : { ok: false, code: e.code, message: e.message };
}
function rpcUploadFail<T>(where: string, error: { code?: string; message: string }): Result<T, UploadErrors> {
  const e = sourceUploadErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  return uploadFail(e);
}
const uploadCodeOf = (c: "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "TYPE_MISMATCH" | "UPLOAD_MISSING"): SourceUploadError => ({
  code: "UPLOAD_FAILED",
  message: SOURCE_UPLOAD_ERROR_MESSAGES[c],
  uploadCode: c,
});

export interface SourceUploadTicket {
  uploadId: string;
  /** 저장소 경로와 서명 업로드 토큰: 브라우저가 uploadToSignedUrl(path, token, file, { contentType: mime }) 로 올린다 */
  path: string;
  token: string;
  mime: AllowedMime;
  expiresAt: string;
}

/** 1단계. 파일 이름(확장자)·크기만 보고 예약한다. 실제 내용 검사는 3단계에서 서버가 한다 */
export async function prepareSourceUpload(owner: AssetOwner, file: { name: string; size: number }): Promise<Result<SourceUploadTicket, UploadErrors>> {
  if (!sourceUploadEnabled()) return fail("ERROR", SOURCE_UPLOAD_DISABLED_MESSAGE);
  const fileName = displayFileName(file.name);
  const ext = extensionOf(fileName);
  const mime = (Object.keys(ALLOWED_TYPES) as AllowedMime[]).find((m) => (ALLOWED_TYPES[m].extensions as readonly string[]).includes(ext));
  if (!mime) return uploadFail(uploadCodeOf("UNSUPPORTED_TYPE"));
  if (!Number.isInteger(file.size) || file.size < 1) return uploadFail(uploadCodeOf("EMPTY"));
  if (file.size > MAX_UPLOAD_BYTES) return uploadFail(uploadCodeOf("TOO_LARGE"));
  const target = await resolveOwner(owner);
  if (!target.ok) return target;
  const sb = await createSupabaseServerClient();
  const msg = sourceReserveMessage({ clientId: owner.clientId ?? null, projectId: owner.projectId ?? null, size: file.size, mime, fileName });
  const g = signSource("source_reserve", msg);
  const r = await sb.rpc("reserve_source_upload", {
    p_client_id: owner.clientId ?? NULL,
    p_project_id: owner.projectId ?? NULL,
    p_file_name: fileName,
    p_size: file.size,
    p_mime: mime,
    p_signed_at: g.at,
    p_signature: g.sig,
  });
  if (r.error) return rpcUploadFail("prepareSourceUpload", r.error);
  const row = r.data?.[0];
  if (!row) return fail("ERROR", "파일을 저장하지 못했습니다. 다시 올려 주세요.");
  // 서명 업로드 URL 은 저장소 insert 정책(진행 중인 내 예약 경로만)을 통과해야 만들어진다
  const s = await sb.storage.from(ASSET_BUCKET).createSignedUploadUrl(row.object_key);
  if (s.error || !s.data) {
    console.error("[prepareSourceUpload.sign]", s.error?.message);
    return fail("ERROR", "파일을 저장하지 못했습니다. 다시 올려 주세요.");
  }
  return ok({ uploadId: row.upload_id, path: row.object_key, token: s.data.token, mime, expiresAt: row.expires_at });
}

/** 3단계. path = 1단계에서 받은 경로(모양을 대조한다. 확정 RPC 도 자기 기록의 경로만 본다) */
export async function confirmSourceUpload(uploadId: string, path: string): Promise<Result<{ id: string }, UploadErrors>> {
  if (!sourceUploadEnabled()) return fail("ERROR", SOURCE_UPLOAD_DISABLED_MESSAGE);
  const { workspace } = await requireWorkspace();
  const mime = sourceMimeOfKey(path);
  if (!mime || path !== `${workspace.id}/${uploadId}/original.${SOURCE_MIME_EXT[mime]}`) return fail("VALIDATION", "업로드 경로가 올바르지 않습니다.");
  const sb = await createSupabaseServerClient();
  const d = await sb.storage.from(ASSET_BUCKET).download(path);
  if (d.error || !d.data) return uploadFail(uploadCodeOf("UPLOAD_MISSING"));
  const bytes = new Uint8Array(await d.data.arrayBuffer());
  const problem = bytes.length === 0 ? "EMPTY" : bytes.length > MAX_UPLOAD_BYTES ? "TOO_LARGE" : detectMime(bytes) !== mime ? "TYPE_MISMATCH" : null;
  if (problem) {
    const g = signSource("source_reject", sourceRejectMessage(uploadId, problem));
    const rj = await sb.rpc("reject_source_upload", { p_upload_id: uploadId, p_reason: problem, p_signed_at: g.at, p_signature: g.sig });
    if (rj.error) console.error("[confirmSourceUpload.reject]", rj.error.code, rj.error.message);
    return uploadFail(uploadCodeOf(problem));
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  const g = signSource("source_confirm", sourceConfirmMessage(uploadId, sha));
  const r = await sb.rpc("confirm_source_upload", { p_upload_id: uploadId, p_sha256: sha, p_signed_at: g.at, p_signature: g.sig });
  if (r.error) return rpcUploadFail("confirmSourceUpload", r.error);
  return ok({ id: r.data });
}

/**
 * 파일 올리기(서버 액션 경로, 기존 화면 호환). Front 가 브라우저 직접 업로드로 바꾸기 전까지 쓴다.
 * 같은 예약·확정을 거치므로 저장소 정책(예약 경로만)을 지킨다. 운영 Vercel 에서는 4.5MB 넘는 파일이 이 경로에 닿지 못한다(413).
 */
export async function uploadFileAsset(owner: AssetOwner, file: File): Promise<Result<{ id: string }, UploadErrors>> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUploadFile(file.name, bytes);
  if (!check.ok) return uploadFail(uploadCodeOf(check.code));
  const t = await prepareSourceUpload(owner, { name: file.name, size: bytes.length });
  if (!t.ok) return t;
  const sb = await createSupabaseServerClient();
  const up = await sb.storage.from(ASSET_BUCKET).uploadToSignedUrl(t.data.path, t.data.token, bytes, { contentType: t.data.mime });
  if (up.error) {
    console.error("[uploadFileAsset] 저장소 업로드 실패:", up.error.message);
    return fail("UPLOAD_FAILED", "파일을 저장하지 못했습니다. 다시 올려 주세요.");
  }
  return confirmSourceUpload(t.data.uploadId, t.data.path);
}

/**
 * '올리는 중'으로 남은 파일 다시 확인 (CR05 복구).
 * 파일을 다시 올리지 않고 저장소에 실제로 있는지만 보고 상태를 정한다. 그래서 자료·파일이 중복되지 않는다.
 */
export async function confirmPendingUpload(assetId: string): Promise<Result<{ status: "stored" | "failed" }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data: asset, error } = await sb
    .from("source_assets")
    .select("id, kind, object_key, upload_status")
    .eq("workspace_id", workspace.id)
    .eq("id", assetId)
    .maybeSingle();
  if (error) return fromDbError("confirmPendingUpload", error);
  if (!asset || asset.kind !== "file" || !asset.object_key) return fail("NOT_FOUND", "파일을 찾을 수 없습니다.");
  if (asset.upload_status === "stored") return ok({ status: "stored" });
  if (asset.upload_status !== "pending") return fail("VALIDATION", "다시 확인할 수 있는 상태가 아닙니다.");

  const key = asset.object_key;
  const folder = key.slice(0, key.lastIndexOf("/"));
  const name = key.slice(key.lastIndexOf("/") + 1);
  const { data: listed, error: listError } = await sb.storage.from(ASSET_BUCKET).list(folder, { search: name });
  if (listError) {
    console.error("[confirmPendingUpload] 저장소 확인 실패:", listError.message);
    return fail("ERROR", "저장소를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  const status = listed?.some((o) => o.name === name) ? "stored" : "failed";
  const { data: marked, error: updateError } = await sb
    .from("source_assets")
    .update({ upload_status: status })
    .eq("id", assetId)
    .eq("upload_status", "pending")
    .select("id");
  if (updateError || !marked || marked.length !== 1) {
    console.error("[confirmPendingUpload] 상태 기록 실패:", updateError?.code, updateError?.message ?? `갱신 ${marked?.length ?? 0}행`);
    return fail("UPLOAD_FAILED", "상태를 기록하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return ok({ status });
}

/** 내려받기용 1분짜리 서명 주소. 저장이 끝난 본인 파일만. */
export async function getAssetDownloadUrl(assetId: string): Promise<Result<{ url: string }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("source_assets")
    .select("object_key, file_name, upload_status, kind")
    .eq("workspace_id", workspace.id)
    .eq("id", assetId)
    .maybeSingle();
  if (error) return fromDbError("getAssetDownloadUrl", error);
  if (!data || data.kind !== "file" || !data.object_key) return fail("NOT_FOUND", "파일을 찾을 수 없습니다.");
  if (data.upload_status !== "stored") return fail("NOT_FOUND", "저장이 끝나지 않은 파일입니다.");
  // download=true 로 서명하고 이름은 한 번만 인코딩해 붙인다. supabase-js 의 { download: 이름 } 은 한글 이름을 두 번 인코딩한다(P3C 실측, F2)
  const signed = await sb.storage.from(ASSET_BUCKET).createSignedUrl(data.object_key, 60, { download: true });
  if (signed.error) {
    console.error("[getAssetDownloadUrl]", signed.error.message);
    return fail("NOT_FOUND", "파일을 찾을 수 없습니다.");
  }
  return ok({ url: data.file_name ? withDownloadName(signed.data.signedUrl, data.file_name) : signed.data.signedUrl });
}
