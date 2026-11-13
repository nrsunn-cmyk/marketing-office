import "server-only";
import type { ClientInput, CompanyProfileInput } from "@/contracts";
import { requireWorkspace } from "@/server/auth/session";
import { CONFLICT_MESSAGE, escapeLike, fail, fromDbError, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

export interface ClientSummary {
  id: string;
  name: string;
  industry: string | null;
  archived_at: string | null;
  updated_at: string;
}

export interface ClientDetail extends ClientSummary {
  description: string | null;
  revision: number;
}

export interface ProfileVersion {
  id: string;
  version: number;
  products: string | null;
  audience: string | null;
  strengths: string[];
  brand_rules: string | null;
  channel_urls: string[];
  created_at: string;
}

export async function listClients(opts: { q?: string; includeArchived?: boolean } = {}): Promise<ClientSummary[]> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  let query = sb
    .from("clients")
    .select("id, name, industry, archived_at, updated_at")
    .eq("workspace_id", workspace.id)
    .order("name");
  if (!opts.includeArchived) query = query.is("archived_at", null);
  const q = opts.q?.trim();
  if (q) query = query.ilike("name", `%${escapeLike(q)}%`);
  const { data, error } = await query;
  if (error) throw new Error(`고객 목록을 불러오지 못했습니다: ${error.message}`);
  return data;
}

export async function getClient(id: string): Promise<ClientDetail | null> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("clients")
    .select("id, name, industry, description, archived_at, updated_at, revision")
    .eq("workspace_id", workspace.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`고객을 불러오지 못했습니다: ${error.message}`);
  return data;
}

export async function createClientRecord(input: ClientInput): Promise<Result<{ id: string }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("clients")
    .insert({ workspace_id: workspace.id, ...input })
    .select("id")
    .single();
  if (error) return fromDbError("createClient", error);
  return ok(data);
}

/** 낙관적 잠금: 화면이 본 revision과 DB가 같을 때만 저장한다 (T13). */
export async function updateClientRecord(
  id: string,
  expectedRevision: number,
  input: ClientInput,
): Promise<Result<{ revision: number }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("clients")
    .update(input)
    .eq("workspace_id", workspace.id)
    .eq("id", id)
    .eq("revision", expectedRevision)
    .select("revision");
  if (error) return fromDbError("updateClient", error);
  if (data.length === 1) return ok(data[0]);
  return (await getClient(id)) ? fail("CONFLICT", CONFLICT_MESSAGE) : fail("NOT_FOUND", "고객을 찾을 수 없습니다.");
}

/** 보관(삭제 대신). 보관된 고객도 과거 결과물은 그대로 남는다. */
export async function setClientArchived(id: string, expectedRevision: number, archived: boolean): Promise<Result<null>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("clients")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("workspace_id", workspace.id)
    .eq("id", id)
    .eq("revision", expectedRevision)
    .select("id");
  if (error) return fromDbError("archiveClient", error);
  if (data.length === 1) return ok(null);
  return (await getClient(id)) ? fail("CONFLICT", CONFLICT_MESSAGE) : fail("NOT_FOUND", "고객을 찾을 수 없습니다.");
}

export async function listProfileVersions(clientId: string): Promise<ProfileVersion[]> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("company_profile_versions")
    .select("id, version, products, audience, strengths, brand_rules, channel_urls, created_at")
    .eq("workspace_id", workspace.id)
    .eq("client_id", clientId)
    .order("version", { ascending: false });
  if (error) throw new Error(`회사 프로필을 불러오지 못했습니다: ${error.message}`);
  return data;
}

/**
 * 회사 프로필 새 버전 추가 (R06: 과거 버전은 바꾸지 않는다).
 * 동시에 두 번 저장되면 버전 번호 유일 제약이 막고, 한 번 더 시도한다.
 */
export async function addProfileVersion(clientId: string, input: CompanyProfileInput): Promise<Result<{ version: number }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const latest = await listProfileVersions(clientId);
    const version = (latest[0]?.version ?? 0) + 1;
    const { error } = await sb.from("company_profile_versions").insert({
      workspace_id: workspace.id,
      client_id: clientId,
      version,
      products: input.products,
      audience: input.audience,
      strengths: input.strengths,
      brand_rules: input.brandRules,
      channel_urls: input.channelUrls,
    });
    if (!error) return ok({ version });
    if (error.code !== "23505") return fromDbError("addProfileVersion", error);
  }
  return fail("CONFLICT", CONFLICT_MESSAGE);
}
