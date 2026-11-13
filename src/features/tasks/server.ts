import "server-only";
import { createHash } from "node:crypto";
import type { LogoBriefFormInput } from "@/contracts";
import { canonicalJson } from "@/domain/canonical";
import { buildLogoBrief, LOGO_TEMPLATE_VERSION, type LogoBriefResult } from "@/domain/logo";
import { requireWorkspace } from "@/server/auth/session";
import { CONFLICT_MESSAGE, fail, fromDbError, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/server/supabase/database.types";

export type TaskType = "logo_brief" | "quote";

export interface TaskSummary {
  id: string;
  type: TaskType;
  status: string;
  created_at: string;
}

/** 로고 결과물 내용 (artifact_versions.content) */
export interface LogoContent {
  brief: string;
  imagePrompt: string;
  constraints: string[];
  missingInformation: LogoBriefResult["missingInformation"];
  input: LogoBriefFormInput;
  generator: LogoBriefResult["generator"] | { mode: "manual" };
}

export interface VersionInfo {
  id: string;
  version: number;
  generator: string;
  created_at: string;
  content: LogoContent;
  input_snapshot_id: string | null;
}

export interface ApprovalInfo {
  artifact_version_id: string;
  decision: string;
  comment: string | null;
  created_at: string;
}

/** 작업 화면에 필요한 모든 것 */
export interface TaskDetail {
  task: TaskSummary & { project_id: string; revision: number };
  project: { id: string; title: string; kind: string; client_id: string | null };
  client: { id: string; name: string; industry: string | null; description: string | null } | null;
  profile: {
    id: string;
    version: number;
    products: string | null;
    audience: string | null;
    strengths: string[];
    brand_rules: string | null;
    channel_urls: string[];
  } | null;
  workspaceName: string;
  artifact: { id: string; revision: number; current_draft_version_id: string | null; approved_version_id: string | null } | null;
  versions: VersionInfo[];
  approvals: ApprovalInfo[];
}

export async function listTasks(projectId: string): Promise<TaskSummary[]> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("tasks")
    .select("id, type, status, created_at")
    .eq("workspace_id", workspace.id)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`작업 목록을 불러오지 못했습니다: ${error.message}`);
  return data as TaskSummary[];
}

/**
 * 작업 만들기. 같은 키로 다시 요청하면(중복 클릭·재전송) 이미 만든 작업을 돌려준다 (T15).
 * 아직 구현하지 않은 작업 유형은 만들지 않는다.
 */
export async function createTask(projectId: string, type: TaskType, idempotencyKey: string): Promise<Result<{ id: string }>> {
  if (type !== "logo_brief") return fail("VALIDATION", "아직 지원하지 않는 작업입니다.");
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data: template, error: tplError } = await sb
    .from("templates")
    .select("id")
    .eq("type", type)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  if (tplError) return fromDbError("createTask.template", tplError);

  const { data, error } = await sb
    .from("tasks")
    .insert({
      workspace_id: workspace.id,
      project_id: projectId,
      type,
      template_id: template.id,
      idempotency_key: idempotencyKey,
      status: "draft",
    })
    .select("id")
    .single();
  if (!error) return ok(data);
  if (error.code === "23505") {
    const { data: existing } = await sb
      .from("tasks")
      .select("id")
      .eq("project_id", projectId)
      .eq("idempotency_key", idempotencyKey)
      .single();
    if (existing) return ok(existing);
  }
  return fromDbError("createTask", error);
}

export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data: task, error } = await sb
    .from("tasks")
    .select("id, type, status, created_at, project_id, revision, projects(id, title, kind, client_id)")
    .eq("workspace_id", workspace.id)
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error(`작업을 불러오지 못했습니다: ${error.message}`);
  if (!task) return null;
  const project = task.projects as unknown as TaskDetail["project"];

  const [clientRes, profileRes, artifactRes] = await Promise.all([
    project.client_id
      ? sb.from("clients").select("id, name, industry, description").eq("id", project.client_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sb
      .from("project_profiles")
      .select("company_profile_versions(id, version, products, audience, strengths, brand_rules, channel_urls)")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("artifacts")
      .select("id, revision, current_draft_version_id, approved_version_id")
      .eq("task_id", taskId)
      .maybeSingle(),
  ]);

  const artifact = artifactRes.data;
  let versions: VersionInfo[] = [];
  let approvals: ApprovalInfo[] = [];
  if (artifact) {
    const [v, a] = await Promise.all([
      sb
        .from("artifact_versions")
        .select("id, version, generator, created_at, content, input_snapshot_id")
        .eq("artifact_id", artifact.id)
        .order("version", { ascending: false }),
      sb
        .from("approvals")
        .select("artifact_version_id, decision, comment, created_at")
        .eq("artifact_id", artifact.id)
        .order("seq", { ascending: false }),
    ]);
    versions = (v.data ?? []) as unknown as VersionInfo[];
    approvals = (a.data ?? []) as ApprovalInfo[];
  }

  const profile = (profileRes.data as { company_profile_versions: TaskDetail["profile"] } | null)?.company_profile_versions ?? null;
  return {
    task: {
      id: task.id,
      type: task.type as TaskType,
      status: task.status,
      created_at: task.created_at,
      project_id: task.project_id,
      revision: task.revision,
    },
    project,
    client: clientRes.data,
    profile,
    workspaceName: workspace.name,
    artifact,
    versions,
    approvals,
  };
}

/** 로고 입력 기본값: 고객 정보·최신 프로필에서 채운다 (R02 다시 입력하지 않기). */
export function logoDefaults(detail: TaskDetail): LogoBriefFormInput {
  const last = detail.versions[0]?.content?.input;
  if (last) return last;
  return {
    companyName: detail.client?.name ?? detail.workspaceName,
    industry: detail.client?.industry ?? null,
    description: detail.client?.description ?? detail.profile?.products ?? null,
    mainCustomers: detail.profile?.audience ?? null,
    strengths: detail.profile?.strengths ?? [],
    preferredStyles: [],
    colors: [],
    references: [],
    forbidden: [],
    extraNotes: null,
  };
}

/**
 * 로고 브리프 만들기 (입력 조합형). 입력 스냅샷과 결과를 한 번에 저장한다.
 * 같은 키·같은 입력으로 다시 요청하면 새로 만들지 않는다 (T15).
 */
export async function generateLogoBrief(
  taskId: string,
  idempotencyKey: string,
  input: LogoBriefFormInput,
): Promise<Result<{ version: number; reused: boolean }>> {
  const detail = await getTaskDetail(taskId);
  if (!detail) return fail("NOT_FOUND", "작업을 찾을 수 없습니다.");
  if (detail.task.type !== "logo_brief") return fail("VALIDATION", "로고 작업이 아닙니다.");

  const built = buildLogoBrief(input);
  if (!built.ok) return fail("VALIDATION", built.message);

  const profileSnapshot = {
    project: { id: detail.project.id, title: detail.project.title, kind: detail.project.kind },
    client: detail.client,
    profile: detail.profile,
  };
  const sourceRefs = detail.profile
    ? [{ type: "company_profile_version", id: detail.profile.id, version: detail.profile.version }]
    : [];
  const content: LogoContent = {
    brief: built.result.brief,
    imagePrompt: built.result.imagePrompt,
    constraints: built.result.constraints,
    missingInformation: built.result.missingInformation,
    input,
    generator: built.result.generator,
  };
  const inputHash = createHash("sha256")
    .update(canonicalJson({ profileSnapshot, input, template: LOGO_TEMPLATE_VERSION }))
    .digest("hex");

  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .rpc("record_generation", {
      p_task_id: taskId,
      p_idempotency_key: idempotencyKey,
      p_input_hash: inputHash,
      p_profile_snapshot: profileSnapshot as unknown as Json,
      p_extra_inputs: input as unknown as Json,
      p_source_refs: sourceRefs as unknown as Json,
      p_content: content as unknown as Json,
      p_mode: "template",
    })
    .single();
  if (error) {
    if (error.message.includes("IDEMPOTENCY_MISMATCH")) {
      return fail("CONFLICT", "같은 요청이 다른 내용으로 두 번 들어왔습니다. 화면을 새로 고쳐 주세요.");
    }
    return fromDbError("generateLogoBrief", error);
  }
  return ok({ version: data.version, reused: data.reused });
}

/** 직접 고친 내용을 새 버전으로 저장 (승인본은 바뀌지 않는다). */
export async function saveLogoEdit(
  artifactId: string,
  expectedRevision: number,
  edit: { brief: string; imagePrompt: string },
): Promise<Result<{ version: number }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data: art } = await sb
    .from("artifacts")
    .select("current_draft_version_id")
    .eq("workspace_id", workspace.id)
    .eq("id", artifactId)
    .maybeSingle();
  if (!art?.current_draft_version_id) return fail("NOT_FOUND", "결과물을 찾을 수 없습니다.");
  const { data: base } = await sb.from("artifact_versions").select("content").eq("id", art.current_draft_version_id).single();
  const prev = base?.content as unknown as LogoContent;
  const content: LogoContent = { ...prev, brief: edit.brief, imagePrompt: edit.imagePrompt, generator: { mode: "manual" } };

  const { data, error } = await sb
    .rpc("save_manual_version", {
      p_artifact_id: artifactId,
      p_expected_revision: expectedRevision,
      p_content: content as unknown as Json,
    })
    .single();
  if (error) {
    if (error.message.includes("CONFLICT")) return fail("CONFLICT", CONFLICT_MESSAGE);
    return fromDbError("saveLogoEdit", error);
  }
  return ok({ version: data.version });
}

export async function decideVersion(
  artifactId: string,
  versionId: string,
  decision: "approved" | "changes_requested",
  comment: string | null,
): Promise<Result<null>> {
  await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { error } = await sb.rpc("decide_version", {
    p_artifact_id: artifactId,
    p_version_id: versionId,
    p_decision: decision,
    p_comment: comment ?? undefined,
  });
  if (error) {
    if (error.message.includes("CONFLICT")) return fail("CONFLICT", "최신 버전이 아닙니다. 화면을 새로 고친 뒤 다시 결정해 주세요.");
    return fromDbError("decideVersion", error);
  }
  return ok(null);
}
