import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { checkUploadFile, displayFileName } from "@/domain/assets/file-check";
import { requireWorkspace } from "@/server/auth/session";
import { fail, fromDbError, ok, type Result } from "@/server/result";
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

/**
 * 파일 올리기 (T04).
 * 1) 내용 검사 → 2) DB에 '올리는 중' 기록 → 3) 비공개 저장소에 저장 → 4) 성공·실패를 기록.
 * 저장에 실패하면 '실패'로 남기고 성공처럼 보이지 않게 한다.
 */
export async function uploadFileAsset(owner: AssetOwner, file: File): Promise<Result<{ id: string }>> {
  const { workspace } = await requireWorkspace();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUploadFile(file.name, bytes);
  if (!check.ok) return fail("VALIDATION", check.message);

  const target = await resolveOwner(owner);
  if (!target.ok) return target;

  const sb = await createSupabaseServerClient();
  const id = randomUUID();
  const objectKey = `${workspace.id}/${id}/original.${check.extension}`;
  const checksum = createHash("sha256").update(bytes).digest("hex");

  const { error: insertError } = await sb.from("source_assets").insert({
    id,
    workspace_id: workspace.id,
    client_id: target.data.clientId,
    project_id: target.data.projectId,
    kind: "file",
    file_name: displayFileName(file.name),
    object_key: objectKey,
    mime: check.mime,
    bytes: bytes.length,
    checksum_sha256: checksum,
    upload_status: "pending",
  });
  if (insertError) return fromDbError("uploadFileAsset.insert", insertError);

  const { error: uploadError } = await sb.storage
    .from(ASSET_BUCKET)
    .upload(objectKey, bytes, { contentType: check.mime, upsert: false });

  const { error: statusError } = await sb
    .from("source_assets")
    .update({ upload_status: uploadError ? "failed" : "stored" })
    .eq("id", id);
  if (statusError) console.error("[uploadFileAsset] 상태 기록 실패:", statusError.code, statusError.message);

  if (uploadError) {
    console.error("[uploadFileAsset] 저장소 업로드 실패:", uploadError.message);
    return fail("UPLOAD_FAILED", "파일을 저장하지 못했습니다. 다시 올려 주세요.");
  }
  return ok({ id });
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
  const signed = await sb.storage
    .from(ASSET_BUCKET)
    .createSignedUrl(data.object_key, 60, { download: data.file_name ?? true });
  if (signed.error) {
    console.error("[getAssetDownloadUrl]", signed.error.message);
    return fail("NOT_FOUND", "파일을 찾을 수 없습니다.");
  }
  return ok({ url: signed.data.signedUrl });
}
