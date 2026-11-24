import "server-only";
import { encodeCursor, PAGE_SIZE, type Cursor } from "@/domain/paging";
import { requireWorkspace } from "@/server/auth/session";
import { escapeLike } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * 자료실·결과물 모아 보기 (AGY 04 §2.1 탭 5개 중 자료실·결과물).
 * 여러 고객·프로젝트의 자료와 결과물을 한곳에서 본다. 모두 로그인·업무실 확인 뒤 RLS 아래에서 읽는다.
 * 같은 테이블로 가는 외래키가 여러 개라 연결 이름을 정확히 적는다.
 *
 * 페이지 나누기(CR07): 50개씩, (시각, 고유번호) 순서로 '어디까지 봤는지'를 기억해 다음 쪽을 읽는다.
 * 같은 시각인 행도 빠지거나 겹치지 않는다. 전체 개수도 함께 돌려준다.
 */

export const ASSET_KINDS = ["file", "url", "text"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface Page<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
}

/** 검사를 마친 기준값만 받는다(decodeCursor). 시각 순서가 같으면 고유번호로 이어 본다. */
function afterCursor(column: string, c: Cursor): string {
  return `${column}.lt."${c.at}",and(${column}.eq."${c.at}",id.lt."${c.id}")`;
}

export interface LibraryItem {
  id: string;
  kind: AssetKind;
  /** 화면 표시·검색용 이름(제목 → 링크 주소 → 메모 앞부분, DB 자동 계산) */
  display_name: string | null;
  url: string | null;
  mime: string | null;
  bytes: number | null;
  upload_status: string;
  extraction_status: string;
  created_at: string;
  client_id: string | null;
  client_name: string | null;
  project_id: string | null;
  project_title: string | null;
}

export async function listLibrary(
  opts: { kind?: AssetKind | null; q?: string | null; cursor?: Cursor | null } = {},
): Promise<Page<LibraryItem>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const q = opts.q?.trim();

  const filter = <T extends { eq: (c: string, v: string) => T; ilike: (c: string, v: string) => T }>(query: T) => {
    let out = query.eq("workspace_id", workspace.id);
    if (opts.kind) out = out.eq("kind", opts.kind);
    // CR08: 화면에 보이는 이름(display_name)으로 찾는다. LIKE 특수문자(%, _, \)는 글자 그대로.
    if (q) out = out.ilike("display_name", `%${escapeLike(q)}%`);
    return out;
  };

  let query = filter(
    sb
      .from("source_assets")
      .select(
        "id, kind, display_name, url, mime, bytes, upload_status, extraction_status, created_at, client_id, project_id, clients!source_assets_workspace_id_client_id_fkey(name), projects!source_assets_workspace_id_project_id_fkey(title)",
      ),
  );
  if (opts.cursor) query = query.or(afterCursor("created_at", opts.cursor));
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE + 1),
    filter(sb.from("source_assets").select("id", { count: "exact", head: true })),
  ]);
  if (error || countError) throw new Error(`자료실을 불러오지 못했습니다: ${(error ?? countError)!.message}`);

  type Row = Omit<LibraryItem, "client_name" | "project_title"> & {
    clients: { name: string } | null;
    projects: { title: string } | null;
  };
  const rows = data as unknown as Row[];
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(({ clients, projects, ...r }) => ({
      ...r,
      client_name: clients?.name ?? null,
      project_title: projects?.title ?? null,
    })),
    total: count ?? 0,
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor({ at: last.created_at, id: last.id }) : null,
  };
}

export interface ResultItem {
  id: string;
  type: string;
  task_id: string;
  task_status: string;
  project_id: string;
  project_title: string;
  client_name: string | null;
  current_version: number | null;
  approved_version: number | null;
  updated_at: string;
}

export type ArtifactResultType = "logo_brief" | "quote" | "strategy";

export async function listResults(
  opts: { type?: ArtifactResultType | null; approvedOnly?: boolean; cursor?: Cursor | null } = {},
): Promise<Page<ResultItem>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  return readArtifacts(sb, workspace.id, opts);
}

type Sb = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** 결과물(artifacts) 한 쪽 읽기 — listResults 와 listResultEntries 가 같이 쓴다(동작 동일) */
async function readArtifacts(
  sb: Sb,
  workspaceId: string,
  opts: { type?: ArtifactResultType | null; approvedOnly?: boolean; cursor?: Cursor | null },
): Promise<Page<ResultItem>> {
  const workspace = { id: workspaceId };
  const filter = <T extends { eq: (c: string, v: string) => T; not: (c: string, op: string, v: null) => T }>(query: T) => {
    let out = query.eq("workspace_id", workspace.id);
    if (opts.type) out = out.eq("type", opts.type);
    if (opts.approvedOnly) out = out.not("approved_version_id", "is", null);
    return out;
  };

  let query = filter(
    sb
      .from("artifacts")
      .select(
        "id, type, task_id, project_id, updated_at, approved_version_id, tasks!artifacts_project_id_task_id_fkey(status), projects!artifacts_workspace_id_project_id_fkey(title, clients(name)), current:artifact_versions!artifacts_id_current_draft_version_id_fkey(version), approved:artifact_versions!artifacts_id_approved_version_id_fkey(version)",
      ),
  );
  if (opts.cursor) query = query.or(afterCursor("updated_at", opts.cursor));
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    query.order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE + 1),
    filter(sb.from("artifacts").select("id", { count: "exact", head: true })),
  ]);
  if (error || countError) throw new Error(`결과물을 불러오지 못했습니다: ${(error ?? countError)!.message}`);

  type Row = {
    id: string;
    type: string;
    task_id: string;
    project_id: string;
    updated_at: string;
    tasks: { status: string } | null;
    projects: { title: string; clients: { name: string } | null } | null;
    current: { version: number } | null;
    approved: { version: number } | null;
  };
  const rows = data as unknown as Row[];
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id,
      type: r.type,
      task_id: r.task_id,
      task_status: r.tasks?.status ?? "",
      project_id: r.project_id,
      project_title: r.projects?.title ?? "",
      client_name: r.projects?.clients?.name ?? null,
      current_version: r.current?.version ?? null,
      approved_version: r.approved?.version ?? null,
      updated_at: r.updated_at,
    })),
    total: count ?? 0,
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor({ at: last.updated_at, id: last.id }) : null,
  };
}

// ─────────────────────────────────────────────
// UX-F1-RESULTS-BACKEND-01: /results 에 납품 묶음(P3-g delivery_bundles)까지 한 목록으로
// 계약 Plan/Claude-Backend-20261123/UX-F1-RESULTS-BACKEND-01-CONTRACT.md
// ─────────────────────────────────────────────

export type ResultEntryType = ArtifactResultType | "delivery_bundle";
const RESULT_ENTRY_TYPES: readonly ResultEntryType[] = ["logo_brief", "quote", "strategy", "delivery_bundle"];
export function isResultEntryType(v: unknown): v is ResultEntryType {
  return typeof v === "string" && (RESULT_ENTRY_TYPES as readonly string[]).includes(v);
}

export interface DeliveryBundleResultItem {
  kind: "delivery_bundle";
  id: string;
  type: "delivery_bundle";
  project_id: string;
  project_title: string;
  client_name: string | null;
  bundle_no: number;
  status: "drafting" | "reviewed";
  item_count: number;
  /** 복구본이면 원본 묶음 번호(화면 "v1.{n - 1}에서 복구"), 아니면 null */
  restored_from_bundle_no: number | null;
  created_at: string;
  updated_at: string;
  /** 납품 묶음 영역이 보이는 같은 프로젝트의 전략 작업(취소 아닌 것 → 최신 순), 없으면 null */
  task_id: string | null;
  /** `/tasks/{task_id}#delivery-bundle`, 작업이 없으면 null */
  href: string | null;
}

export type ResultEntry = (ResultItem & { kind: "artifact" }) | DeliveryBundleResultItem;

async function readBundles(
  sb: Sb,
  workspaceId: string,
  opts: { approvedOnly?: boolean; cursor?: Cursor | null },
): Promise<Page<DeliveryBundleResultItem>> {
  const filter = <T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(query: T) => {
    // 보관한 묶음은 목록에서 뺀다. 승인본만 보기 = 검토 완료(reviewed) 묶음만
    let out = query.eq("workspace_id", workspaceId).is("archived_at", null);
    if (opts.approvedOnly) out = out.eq("status", "reviewed");
    return out;
  };
  let query = filter(
    sb
      .from("delivery_bundles")
      .select(
        "id, project_id, bundle_no, status, item_count, restored_from_id, created_at, updated_at, projects!delivery_bundles_workspace_id_project_id_fkey(title, clients(name))",
      ),
  );
  if (opts.cursor) query = query.or(afterCursor("updated_at", opts.cursor));
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    query.order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE + 1),
    filter(sb.from("delivery_bundles").select("id", { count: "exact", head: true })),
  ]);
  if (error || countError) throw new Error(`결과물을 불러오지 못했습니다: ${(error ?? countError)!.message}`);

  type Row = {
    id: string;
    project_id: string;
    bundle_no: number;
    status: "drafting" | "reviewed";
    item_count: number;
    restored_from_id: string | null;
    created_at: string;
    updated_at: string;
    projects: { title: string; clients: { name: string } | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  return {
    items: rows.map((r) => ({
      kind: "delivery_bundle" as const,
      id: r.id,
      type: "delivery_bundle" as const,
      project_id: r.project_id,
      project_title: r.projects?.title ?? "",
      client_name: r.projects?.clients?.name ?? null,
      bundle_no: r.bundle_no,
      status: r.status,
      item_count: r.item_count,
      restored_from_bundle_no: null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      task_id: null,
      href: null,
      // 아래 채우기 단계에서 쓰는 원본 id(돌려주기 전에 지운다)
      _restored_from_id: r.restored_from_id,
    })) as DeliveryBundleResultItem[],
    total: count ?? 0,
    nextCursor: null,
  };
}

/**
 * DB 시각(마이크로초 6자리까지)을 마이크로초 수로 바꾼다. Date.parse 는 밀리초까지만 보므로
 * 마이크로초만 다른 두 행의 순서가 DB 와 달라져 쪽 넘김에서 빠지거나 겹칠 수 있다.
 */
export function microsOf(ts: string): number {
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(.*)$/.exec(ts);
  if (!m) return Date.parse(ts) * 1000;
  const frac = (m[2] ?? "").padEnd(6, "0");
  return Date.parse(`${m[1]}${m[3]}`) * 1000 + Number(frac);
}

/** 같은 시각이면 고유번호가 큰 쪽이 앞 — DB 정렬(updated_at desc, id desc)과 같은 비교 */
function newerFirst(a: { updated_at: string; id: string }, b: { updated_at: string; id: string }): number {
  const ta = microsOf(a.updated_at);
  const tb = microsOf(b.updated_at);
  if (ta !== tb) return tb - ta;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** 이번 쪽에 보이는 묶음만 복구 원본 번호·링크 작업을 채운다(질의 2번, 행 수와 무관) */
async function fillBundleLinks(sb: Sb, workspaceId: string, bundles: DeliveryBundleResultItem[]): Promise<void> {
  if (bundles.length === 0) return;
  const raw = bundles as Array<DeliveryBundleResultItem & { _restored_from_id?: string | null }>;
  const originIds = [...new Set(raw.map((b) => b._restored_from_id).filter((v): v is string => !!v))];
  const projectIds = [...new Set(raw.map((b) => b.project_id))];
  const [origins, tasks] = await Promise.all([
    originIds.length
      ? sb.from("delivery_bundles").select("id, bundle_no").eq("workspace_id", workspaceId).in("id", originIds)
      : Promise.resolve({ data: [] as Array<{ id: string; bundle_no: number }>, error: null }),
    sb
      .from("tasks")
      .select("id, project_id, status, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("type", "strategy")
      .in("project_id", projectIds),
  ]);
  const bad = origins.error ?? tasks.error;
  if (bad) throw new Error(`결과물을 불러오지 못했습니다: ${bad.message}`);

  const originNo = new Map(((origins.data ?? []) as Array<{ id: string; bundle_no: number }>).map((o) => [o.id, o.bundle_no]));
  // 프로젝트마다 링크할 전략 작업: 취소 아닌 것 → updated_at 최신 → id 큰 것
  const best = new Map<string, { id: string; status: string; updated_at: string }>();
  for (const t of (tasks.data ?? []) as Array<{ id: string; project_id: string; status: string; updated_at: string }>) {
    const cur = best.get(t.project_id);
    const rank = (x: { status: string }) => (x.status === "cancelled" ? 0 : 1);
    if (!cur || rank(t) > rank(cur) || (rank(t) === rank(cur) && newerFirst(t, cur) < 0)) best.set(t.project_id, t);
  }
  for (const b of raw) {
    b.restored_from_bundle_no = b._restored_from_id ? (originNo.get(b._restored_from_id) ?? null) : null;
    const task = best.get(b.project_id);
    b.task_id = task?.id ?? null;
    b.href = task ? `/tasks/${task.id}#delivery-bundle` : null;
    delete b._restored_from_id;
  }
}

/**
 * /results 목록: 결과물과 납품 묶음을 (updated_at desc, id desc) 한 순서로 섞어 50개씩.
 * 결과물은 같은 커서 뒤 50개(+다음 쪽 여부), 묶음은 51개를 읽어 합친 뒤 앞 50개를 돌려준다 — 합친 순서의 앞 50개는 반드시 이 안에 있다.
 * 총계 = 각 표의 같은 필터 개수 합. 기존 listResults 는 그대로 둔다.
 */
export async function listResultEntries(
  opts: { type?: ResultEntryType | null; approvedOnly?: boolean; cursor?: Cursor | null } = {},
): Promise<Page<ResultEntry>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const type = opts.type ?? null;
  const wantArtifacts = type !== "delivery_bundle";
  const wantBundles = type === null || type === "delivery_bundle";

  const empty = { items: [], total: 0, nextCursor: null };
  const [arts, bundles] = await Promise.all([
    wantArtifacts
      ? readArtifacts(sb, workspace.id, { type: type as ArtifactResultType | null, approvedOnly: opts.approvedOnly, cursor: opts.cursor })
      : Promise.resolve(empty as Page<ResultItem>),
    wantBundles
      ? readBundles(sb, workspace.id, { approvedOnly: opts.approvedOnly, cursor: opts.cursor })
      : Promise.resolve(empty as Page<DeliveryBundleResultItem>),
  ]);

  const merged: ResultEntry[] = [
    ...arts.items.map((a) => ({ ...a, kind: "artifact" as const })),
    ...bundles.items,
  ].sort(newerFirst);
  const page = merged.slice(0, PAGE_SIZE);
  await fillBundleLinks(sb, workspace.id, page.filter((e): e is DeliveryBundleResultItem => e.kind === "delivery_bundle"));
  const last = page[page.length - 1];
  return {
    items: page,
    total: arts.total + bundles.total,
    nextCursor: (merged.length > PAGE_SIZE || arts.nextCursor !== null) && last ? encodeCursor({ at: last.updated_at, id: last.id }) : null,
  };
}
