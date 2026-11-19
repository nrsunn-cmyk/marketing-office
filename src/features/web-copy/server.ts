import "server-only";
import {
  BRIEF_STALE_LABEL,
  WEB_COPY_DISPLAY,
  WEB_COPY_LIMITS,
  WEB_COPY_VERSION_KINDS,
  fromDbContent,
  toDbPages,
  webCopyDisplayStatus,
  webCopyErrorFromDb,
  webCopyIssueMessage,
  webCopySaveSchema,
  type WebCopyDisplayStatus,
  type WebCopyPageView,
  type WebCopyStatus,
  type WebCopyVersionKind,
} from "@/domain/web-copy";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type ErrorCode, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/server/supabase/database.types";

/**
 * P3B-BACKEND-IMPL-01: 홈페이지 구조·문구(P3-b) 서버 함수. 화면은 제작 브리프 아래에 붙는다(Front, e739bc8 부품).
 * 읽기는 본인 업무실(RLS + workspace_id 조건), 쓰기는 정의자 RPC(20261121002000_p3b_web_copy.sql)만 쓴다. AI·외부 요청 없음.
 */

export interface WebCopyVersionSummary {
  id: string;
  versionNo: number;
  kind: WebCopyVersionKind;
  kindLabel: string;
  status: WebCopyStatus;
  sourceBriefRevision: number;
  restoredFromVersionNo: number | null;
  createdAt: string;
  /** 지금 판인지 */
  current: boolean;
}

export interface WebCopyDocView {
  id: string;
  status: WebCopyStatus;
  displayStatus: WebCopyDisplayStatus;
  displayLabel: string;
  archived: boolean;
  archivedAt: string | null;
  /** 낙관적 잠금 값(저장·되돌리기·맞추기·보관에 그대로 보낸다) */
  revision: number;
  currentVersionNo: number;
  /** 지금 판 id(P3-f 검수·P3-g 납품이 가리킨다) */
  currentVersionId: string;
  pages: WebCopyPageView[];
  sourceBriefRevision: number;
  /** 바탕 브리프가 그 뒤 바뀌었으면 true(막지 않고 경고, '최신 제작 브리프 기준으로 맞추기'로 해소) */
  stale: boolean;
  staleLabel: string | null;
  /** 맞추기를 누를 수 있는지(브리프가 확정·보관 안 됨이고 문서를 고칠 수 있을 때) */
  canRebase: boolean;
  /** 판 100개가 차서 저장·되돌리기·맞추기를 할 수 없는지(보관 뒤 마지막 판 복사로 새 문서) */
  versionsFull: boolean;
  /** 고칠 수 없는 이유. null 이면 고칠 수 있음 */
  readOnlyReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebCopySourceOption {
  id: string;
  title: string;
  url: string;
  reviewStatus: string;
}

export interface WebCopyBoard {
  brief: { id: string; title: string; revision: number; status: string; archived: boolean; includesWebCopy: boolean };
  /** 보관 안 된 문서(없으면 null) */
  doc: WebCopyDocView | null;
  /** 지금 문서의 판 목록(최신이 위, 본문 없음) */
  versions: WebCopyVersionSummary[];
  /** 같은 브리프의 보관한 문서(복사해서 새로 만들 때 고른다) */
  archivedDocs: { id: string; currentVersionNo: number; archivedAt: string }[];
  /** 같은 프로젝트의 출처(섹션에 연결할 수 있는 것만) */
  sources: WebCopySourceOption[];
  canCreate: boolean;
  createBlockedReason: string | null;
  docCount: number;
  limits: typeof WEB_COPY_LIMITS;
}

const PROJECT_ARCHIVED = "보관한 프로젝트입니다. 프로젝트를 다시 열어야 홈페이지 문서를 만들거나 고칠 수 있습니다.";
const TASK_CANCELLED = "취소된 전략 작업을 바탕으로 한 제작 브리프입니다. 읽기만 할 수 있습니다.";

const asStatus = (s: string): WebCopyStatus => (s === "reviewed" ? "reviewed" : "drafting");
const asKind = (k: string): WebCopyVersionKind => (k in WEB_COPY_VERSION_KINDS ? (k as WebCopyVersionKind) : "save");

/** 제작 브리프 하나의 홈페이지 문서·판 목록·만들기 가능 여부. 남의 것·없는 브리프는 NOT_FOUND */
export async function getWebCopyFor(productionBriefId: string): Promise<Result<WebCopyBoard>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const br = await sb
    .from("production_briefs")
    .select("id, title, revision, status, archived_at, project_id, strategy_artifact_id, deliverable_types")
    .eq("id", productionBriefId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (br.error) return readFail("getWebCopyFor.brief", br.error);
  if (!br.data) return fail("NOT_FOUND", "제작 브리프를 찾을 수 없습니다.");
  const b = br.data;

  const [pr, ar, docs, src] = await Promise.all([
    sb.from("projects").select("status").eq("id", b.project_id).eq("workspace_id", workspace.id).maybeSingle(),
    sb.from("artifacts").select("task_id").eq("id", b.strategy_artifact_id).eq("workspace_id", workspace.id).maybeSingle(),
    sb.from("web_copy_docs").select("*").eq("workspace_id", workspace.id).eq("production_brief_id", b.id).order("created_at", { ascending: false }),
    sb.from("research_sources").select("id, title, url, review_status").eq("workspace_id", workspace.id).eq("project_id", b.project_id).order("created_at", { ascending: true }),
  ]);
  for (const [where, r] of [["project", pr], ["artifact", ar], ["docs", docs], ["sources", src]] as const) if (r.error) return readFail(`getWebCopyFor.${where}`, r.error);
  let taskCancelled = false;
  if (ar.data?.task_id) {
    const tk = await sb.from("tasks").select("status").eq("id", ar.data.task_id).eq("workspace_id", workspace.id).maybeSingle();
    if (tk.error) return readFail("getWebCopyFor.task", tk.error);
    taskCancelled = tk.data?.status === "cancelled";
  }
  const projectArchived = pr.data?.status === "archived";
  const briefArchived = b.archived_at !== null;
  const includesWebCopy = (b.deliverable_types ?? []).includes("web_copy");
  const all = docs.data ?? [];
  const active = all.find((d) => d.archived_at === null) ?? null;

  let doc: WebCopyDocView | null = null;
  let versions: WebCopyVersionSummary[] = [];
  if (active) {
    const vs = await sb
      .from("web_copy_versions")
      .select("id, version_no, kind, status, source_brief_revision, restored_from_version_no, created_at")
      .eq("workspace_id", workspace.id)
      .eq("doc_id", active.id)
      .order("version_no", { ascending: false });
    if (vs.error) return readFail("getWebCopyFor.versions", vs.error);
    const cur = await sb.from("web_copy_versions").select("id, content").eq("workspace_id", workspace.id).eq("doc_id", active.id).eq("version_no", active.current_version_no).maybeSingle();
    if (cur.error) return readFail("getWebCopyFor.current", cur.error);
    versions = (vs.data ?? []).map((v) => ({
      id: v.id,
      versionNo: v.version_no,
      kind: asKind(v.kind),
      kindLabel: WEB_COPY_VERSION_KINDS[asKind(v.kind)],
      status: asStatus(v.status),
      sourceBriefRevision: v.source_brief_revision,
      restoredFromVersionNo: v.restored_from_version_no,
      createdAt: v.created_at,
      current: v.version_no === active.current_version_no,
    }));
    const status = asStatus(active.status);
    const readOnlyReason = projectArchived ? PROJECT_ARCHIVED : taskCancelled ? TASK_CANCELLED : null;
    const stale = active.source_brief_revision !== b.revision;
    const versionsFull = active.current_version_no >= WEB_COPY_LIMITS.versionsMax;
    const displayStatus = webCopyDisplayStatus({ archived: false, status });
    doc = {
      id: active.id,
      status,
      displayStatus,
      displayLabel: WEB_COPY_DISPLAY[displayStatus],
      archived: false,
      archivedAt: null,
      revision: active.revision,
      currentVersionNo: active.current_version_no,
      currentVersionId: cur.data?.id ?? "",
      pages: fromDbContent(cur.data?.content ?? null),
      sourceBriefRevision: active.source_brief_revision,
      stale,
      staleLabel: stale ? BRIEF_STALE_LABEL : null,
      canRebase: stale && b.status === "ready" && !briefArchived && readOnlyReason === null && !versionsFull,
      versionsFull,
      readOnlyReason,
      createdAt: active.created_at,
      updatedAt: active.updated_at,
    };
  }

  const reason = projectArchived
    ? PROJECT_ARCHIVED
    : taskCancelled
      ? TASK_CANCELLED
      : briefArchived
        ? "보관한 제작 브리프로는 홈페이지 문서를 만들 수 없습니다."
        : b.status !== "ready"
          ? "제작 브리프를 확정해야 홈페이지 문서를 만들 수 있습니다."
          : !includesWebCopy
            ? "이 제작 브리프의 포함 산출물에 홈페이지 구조·문구가 없습니다."
            : active
              ? "작업 중인 홈페이지 문서가 이미 있습니다. 그 문서를 쓰거나 보관한 뒤 새로 만들어 주세요."
              : all.length >= WEB_COPY_LIMITS.docsPerBrief
                ? `한 제작 브리프에는 홈페이지 문서를 ${WEB_COPY_LIMITS.docsPerBrief}개까지(보관 포함) 만들 수 있습니다.`
                : null;
  return ok({
    brief: { id: b.id, title: b.title, revision: b.revision, status: b.status, archived: briefArchived, includesWebCopy },
    doc,
    versions,
    archivedDocs: all.filter((d) => d.archived_at !== null).map((d) => ({ id: d.id, currentVersionNo: d.current_version_no, archivedAt: d.archived_at as string })),
    sources: (src.data ?? []).map((s) => ({ id: s.id, title: s.title, url: s.url, reviewStatus: s.review_status })),
    canCreate: reason === null,
    createBlockedReason: reason,
    docCount: all.length,
    limits: WEB_COPY_LIMITS,
  });
}

/** 지난 판 하나의 내용(판 목록에는 본문이 없으므로 따로 읽는다). 보관한 문서의 판도 읽을 수 있다 */
export async function getWebCopyVersion(docId: string, versionNo: number): Promise<Result<{ versionId: string; versionNo: number; pages: WebCopyPageView[] }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const r = await sb.from("web_copy_versions").select("id, version_no, content").eq("workspace_id", workspace.id).eq("doc_id", docId).eq("version_no", versionNo).maybeSingle();
  if (r.error) return readFail("getWebCopyVersion", r.error);
  if (!r.data) return fail("NOT_FOUND", "그 판을 찾을 수 없습니다.");
  return ok({ versionId: r.data.id, versionNo: r.data.version_no, pages: fromDbContent(r.data.content) });
}

function readFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  console.error(`[${where}]`, error.code, error.message);
  return fail("ERROR", "홈페이지 문서를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  const e = webCopyErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  const code: ErrorCode =
    e.code === "CONFLICT" ? "CONFLICT" : e.code === "NOT_FOUND" ? "NOT_FOUND" : e.code === "INVALID_TRANSITION" ? "INVALID_TRANSITION" : e.code === "ERROR" ? "ERROR" : "VALIDATION";
  return fail(code, e.message);
}

/** 만들기. copyFromDocId 를 주면 같은 브리프의 그 문서 지금 판을 복사(판 100 이 찼을 때 이어 쓰기), 없으면 기본 4페이지 */
export async function createWebCopyDoc(productionBriefId: string, copyFromDocId?: string | null): Promise<Result<{ docId: string }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("create_web_copy_doc", { p_production_brief_id: productionBriefId, p_copy_from_doc_id: copyFromDocId ?? undefined });
  if (error) return rpcFail("createWebCopyDoc", error);
  return ok({ docId: data });
}

/** 저장: raw = { status, pages } (Front toWebCopyPayload 그대로). 문서 전체를 한 번에, 새 판 1개 */
export async function saveWebCopy(docId: string, expectedRevision: number, raw: unknown): Promise<Result<{ revision: number }>> {
  const parsed = webCopySaveSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION", webCopyIssueMessage(parsed.error.issues[0]));
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("save_web_copy", {
    p_doc_id: docId,
    p_expected_revision: expectedRevision,
    p_status: parsed.data.status,
    p_pages: toDbPages(parsed.data) as unknown as Json,
  });
  if (error) return rpcFail("saveWebCopy", error);
  return ok({ revision: data });
}

/** 되돌리기: 고른 판(번호)의 내용으로 새 판 */
export async function restoreWebCopyVersion(docId: string, expectedRevision: number, versionNo: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("restore_web_copy_version", { p_doc_id: docId, p_expected_revision: expectedRevision, p_version_no: versionNo });
  if (error) return rpcFail("restoreWebCopyVersion", error);
  return ok({ revision: data });
}

/** 최신 제작 브리프 기준으로 맞추기(내용은 그대로, 판 하나 더함) */
export async function rebaseWebCopy(docId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("rebase_web_copy", { p_doc_id: docId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("rebaseWebCopy", error);
  return ok({ revision: data });
}

/** 보관(삭제 대신, 되돌리기 없음) */
export async function archiveWebCopy(docId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("archive_web_copy", { p_doc_id: docId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("archiveWebCopy", error);
  return ok({ revision: data });
}
