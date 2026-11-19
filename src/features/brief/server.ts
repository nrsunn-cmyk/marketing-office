import "server-only";
import {
  PROFILE_FIELDS,
  briefErrorFromDb,
  briefIssueMessage,
  briefTemplate,
  briefToMarkdown,
  briefUpdateSchema,
  briefWarnings,
  briefChannelSchema,
  claimInputSchema,
  parseBriefSpec,
  sourceLinkSchema,
  type BriefChannel,
  type BriefSpec,
  type BriefStatus,
  type BriefWarning,
  type ClaimKind,
  type ClaimWithSources,
  type ProfileField,
} from "@/domain/brief";
import { assetSendLabel } from "@/domain/brief/ai-copy";
import { funnelStageLabel } from "@/domain/funnel";
import { getFunnelBoard, type FunnelBoard } from "@/features/funnel/server";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type ErrorCode, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/server/supabase/database.types";

/**
 * P2F-BACKEND-01: 콘텐츠 브리프 서버 함수. 화면은 전략 작업(tasks/[taskId]) 아래 퍼널 카드에서 연다.
 * 읽기는 본인 업무실(RLS), 쓰기는 정의자 RPC(20261118002000_p2f_content_brief.sql)만 쓴다.
 */

export interface BriefSummary {
  id: string;
  funnelItemId: string;
  channel: BriefChannel;
  title: string;
  status: BriefStatus;
  stale: boolean;
  revision: number;
}
export interface BriefSourceView {
  id: string;
  kind: "profile" | "asset" | "research";
  label: string;
  /**
   * DEC-08-R2(QA-FINAL-E-01 D3·O5): AI 문구 요청에 보내는 근거 이름. 자료 원문·전체 주소를 넣지 않는다.
   * 파일 → "파일 · 파일 이름", 링크 → "링크 · 제목"(제목 없으면 도메인만), 메모 → "메모 · 제목"(제목 없으면 "메모 자료 n"),
   * 프로필 → "회사 프로필 · 항목 이름", 외부 출처 → "외부 출처 · 제목". 화면용 이름(label)은 그대로다.
   */
  aiLabel: string;
  note: string | null;
}
export interface BriefClaimView extends ClaimWithSources {
  revision: number;
  sourceRows: BriefSourceView[];
}
export type BriefAssetScope = "project" | "client";
export interface BriefSourceOptions {
  /** 브리프가 참조한 전략의 회사 프로필 버전(없으면 null). 항목별로 근거를 고른다 */
  profile: { id: string; version: number; fields: { field: ProfileField; label: string; value: string }[] } | null;
  /** scope: project = 이 프로젝트 자료, client = 같은 고객 공통 자료(DEC-09 B, 프로젝트 없이 고객에게 올린 자료) */
  assets: { id: string; label: string; scope: BriefAssetScope }[];
  research: { id: string; label: string; reviewStatus: string }[];
}
export interface BriefDetail {
  brief: {
    id: string;
    funnelItemId: string;
    stageLabel: string;
    channel: BriefChannel;
    title: string;
    audience: string | null;
    hook: string | null;
    coreMessage: string | null;
    cta: string | null;
    channelSpec: BriefSpec;
    copyDraft: string | null;
    copyOrigin: "manual" | "template";
    /** DEC-08: 지금 카피 초안이 AI 초안을 채택한 것(DB copy_origin = 'ai'). 이때 copyOrigin 은 "manual" 로 오며, 글을 바꾸지 않고 저장하면 DB 가 ai 를 유지한다 */
    copyOriginAi: boolean;
    imageGuide: string | null;
    status: BriefStatus;
    revision: number;
    archived: boolean;
    /** 참조 전략 버전 ≠ 지금 승인본 → "이전 전략 기준" 배지(DEC-P2-01-A 결정 전: 표시만) */
    stale: boolean;
  };
  claims: BriefClaimView[];
  warnings: BriefWarning[];
  options: BriefSourceOptions;
  /** 클립보드 복사용(보관한 주장 제외) */
  markdown: string;
}

const BRIEF_COLS =
  "id, funnel_item_id, channel, title, audience, hook, core_message, cta, channel_spec, copy_draft, copy_origin, image_guide, status, revision, archived_at, strategy_artifact_id, strategy_version_id";

/** 전략 작업 퍼널의 브리프 목록(보관 제외). 퍼널이 없으면 빈 목록 */
export async function listContentBriefs(taskId: string): Promise<BriefSummary[] | null> {
  return listContentBriefsFor(await getFunnelBoard(taskId));
}

/**
 * 이미 읽은 퍼널 보드로 브리프 목록을 읽는다(P2F-FRONT-01, P2D-FRONT-01-R1 과 같은 이유: 한 요청에서 작업 상세·보드를 다시 읽지 않음).
 * board 는 반드시 서버에서 getFunnelBoard·getFunnelBoardFor 로 읽은 값이어야 한다. 조회는 그대로 본인 업무실·그 퍼널로 한정된다.
 */
export async function listContentBriefsFor(board: FunnelBoard | null): Promise<BriefSummary[] | null> {
  if (!board) return null;
  if (!board.funnel) return [];
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("content_briefs")
    .select("id, funnel_item_id, channel, title, status, revision, strategy_version_id")
    .eq("workspace_id", workspace.id)
    .eq("funnel_id", board.funnel.id)
    .is("archived_at", null)
    .order("created_at");
  if (error) throw new Error(`브리프를 불러오지 못했습니다: ${error.message}`);
  const approved = board.strategy.approvedVersion?.id ?? null;
  return (data ?? []).map((b) => ({
    id: b.id,
    funnelItemId: b.funnel_item_id,
    channel: b.channel as BriefChannel,
    title: b.title,
    status: b.status as BriefStatus,
    stale: b.strategy_version_id !== approved,
    revision: b.revision,
  }));
}

/** 브리프 상세: 주장·근거(이름 포함)·경고·근거 후보·복사용 마크다운 */
export async function getContentBrief(taskId: string, briefId: string): Promise<BriefDetail | null> {
  return getContentBriefFor(await getFunnelBoard(taskId), briefId);
}

/** 이미 읽은 퍼널 보드로 브리프 상세를 읽는다(listContentBriefsFor 와 같은 조건) */
export async function getContentBriefFor(board: FunnelBoard | null, briefId: string): Promise<BriefDetail | null> {
  if (!board?.funnel) return null;
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data: b, error } = await sb
    .from("content_briefs")
    .select(BRIEF_COLS)
    .eq("workspace_id", workspace.id)
    .eq("funnel_id", board.funnel.id)
    .eq("id", briefId)
    .maybeSingle();
  if (error) throw new Error(`브리프를 불러오지 못했습니다: ${error.message}`);
  if (!b) return null;

  const [claimsRes, versionRes] = await Promise.all([
    sb.from("content_brief_claims").select("id, text, claim_kind, revision").eq("workspace_id", workspace.id).eq("brief_id", b.id).is("archived_at", null).order("position"),
    sb.from("artifact_versions").select("content").eq("workspace_id", workspace.id).eq("id", b.strategy_version_id).maybeSingle(),
  ]);
  if (claimsRes.error) throw new Error(`주장을 불러오지 못했습니다: ${claimsRes.error.message}`);
  if (versionRes.error) throw new Error(`전략을 불러오지 못했습니다: ${versionRes.error.message}`);
  const claimRows = claimsRes.data ?? [];
  const profileId = (versionRes.data?.content as { profileRef?: { id?: unknown } } | null)?.profileRef?.id;

  const projectId = (await sb.from("funnels").select("project_id").eq("workspace_id", workspace.id).eq("id", board.funnel.id).single()).data?.project_id;
  // DEC-09 B: 근거 후보에 "같은 고객 공통 자료"(프로젝트 없이 그 고객에게 올린 자료)도 넣는다. 고객 없는 프로젝트는 이 프로젝트 자료만.
  const clientId = projectId
    ? (await sb.from("projects").select("client_id").eq("workspace_id", workspace.id).eq("id", projectId).maybeSingle()).data?.client_id ?? null
    : null;
  const assetQuery = sb.from("source_assets").select("id, display_name, url, file_name, project_id, kind").eq("workspace_id", workspace.id);
  const [srcRes, profRes, assetRes, researchRes] = await Promise.all([
    claimRows.length
      ? sb.from("content_claim_sources")
          .select("id, claim_id, kind, company_profile_version_id, profile_field, source_asset_id, research_source_id, note")
          .eq("workspace_id", workspace.id).in("claim_id", claimRows.map((c) => c.id)).is("unlinked_at", null).order("created_at")
      : Promise.resolve({ data: [], error: null }),
    typeof profileId === "string"
      ? sb.from("company_profile_versions").select("id, version, products, audience, strengths, brand_rules, channel_urls").eq("workspace_id", workspace.id).eq("id", profileId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    (clientId
      ? assetQuery.or(`project_id.eq.${projectId},and(project_id.is.null,client_id.eq.${clientId})`)
      : assetQuery.eq("project_id", projectId ?? "")
    ).order("created_at", { ascending: false }).limit(100),
    sb.from("research_sources").select("id, title, review_status").eq("workspace_id", workspace.id).eq("project_id", projectId ?? "").order("created_at", { ascending: false }).limit(100),
  ]);
  for (const r of [srcRes, profRes, assetRes, researchRes]) if (r.error) throw new Error(`근거를 불러오지 못했습니다: ${r.error.message}`);

  const p = profRes.data as null | { id: string; version: number; products: string | null; audience: string | null; strengths: string[]; brand_rules: string | null; channel_urls: string[] };
  const profileFields = p
    ? (Object.keys(PROFILE_FIELDS) as ProfileField[])
        .map((field) => {
          const v = p[field];
          const value = Array.isArray(v) ? v.join(", ") : v ?? "";
          return { field, label: PROFILE_FIELDS[field], value };
        })
        .filter((x) => x.value.trim() !== "")
    : [];
  const assets = (assetRes.data ?? []).map((a) => ({
    id: a.id,
    label: a.display_name ?? a.file_name ?? a.url ?? "이름 없는 자료",
    scope: (a.project_id ? "project" : "client") as BriefAssetScope,
  }));
  const research = (researchRes.data ?? []).map((r) => ({ id: r.id, label: r.title, reviewStatus: r.review_status }));
  const assetLabel = new Map(assets.map((a) => [a.id, a.scope === "client" ? `고객 공통 · ${a.label}` : a.label]));
  const assetRow = new Map((assetRes.data ?? []).map((a) => [a.id, a]));
  const untitledMemo = new Map<string, number>();
  const aiAssetLabel = (id: string | null): string => {
    const a = id ? assetRow.get(id) : undefined;
    if (!a) return "자료";
    return assetSendLabel(a, () => {
      if (!untitledMemo.has(a.id)) untitledMemo.set(a.id, untitledMemo.size + 1);
      return untitledMemo.get(a.id)!;
    });
  };
  const researchLabel = new Map(research.map((r) => [r.id, r.label]));

  const byClaim = new Map<string, BriefSourceView[]>();
  for (const s of srcRes.data ?? []) {
    const label =
      s.kind === "profile"
        ? `회사 프로필 v${p?.id === s.company_profile_version_id ? p.version : "?"} · ${PROFILE_FIELDS[s.profile_field as ProfileField] ?? s.profile_field}`
        : s.kind === "asset"
          ? `자료 · ${assetLabel.get(s.source_asset_id ?? "") ?? "목록 밖 자료"}`
          : `외부 출처 · ${researchLabel.get(s.research_source_id ?? "") ?? "목록 밖 출처"}`;
    const list = byClaim.get(s.claim_id) ?? [];
    const aiLabel =
      s.kind === "profile"
        ? `회사 프로필 · ${PROFILE_FIELDS[s.profile_field as ProfileField] ?? "항목"}`
        : s.kind === "asset"
          ? aiAssetLabel(s.source_asset_id)
          : `외부 출처 · ${researchLabel.get(s.research_source_id ?? "") ?? "출처"}`;
    list.push({ id: s.id, kind: s.kind as BriefSourceView["kind"], label, aiLabel, note: s.note });
    byClaim.set(s.claim_id, list);
  }
  const claims: BriefClaimView[] = claimRows.map((c) => {
    const rows = byClaim.get(c.id) ?? [];
    return { id: c.id, text: c.text, kind: c.claim_kind as ClaimKind, revision: c.revision, sources: rows.map((r) => ({ label: r.label })), sourceRows: rows };
  });

  const item = board.stages.flatMap((s) => s.items.map((i) => ({ i, stage: s.key }))).find((x) => x.i.id === b.funnel_item_id);
  const brief: BriefDetail["brief"] = {
    id: b.id,
    funnelItemId: b.funnel_item_id,
    stageLabel: item ? funnelStageLabel(item.stage) : "보관한 카드",
    channel: b.channel as BriefChannel,
    title: b.title,
    audience: b.audience,
    hook: b.hook,
    coreMessage: b.core_message,
    cta: b.cta,
    channelSpec: (b.channel_spec ?? {}) as BriefSpec,
    copyDraft: b.copy_draft,
    copyOrigin: b.copy_origin === "template" ? "template" : "manual",
    copyOriginAi: b.copy_origin === "ai",
    imageGuide: b.image_guide,
    status: b.status as BriefStatus,
    revision: b.revision,
    archived: b.archived_at !== null,
    stale: b.strategy_version_id !== (board.strategy.approvedVersion?.id ?? null),
  };
  return {
    brief,
    claims,
    warnings: briefWarnings(brief, claims),
    options: { profile: p ? { id: p.id, version: p.version, fields: profileFields } : null, assets, research },
    markdown: briefToMarkdown(brief, claims),
  };
}

function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  const e = briefErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  const code: ErrorCode =
    e.code === "CONFLICT" ? "CONFLICT" : e.code === "NOT_FOUND" ? "NOT_FOUND" : e.code === "INVALID_TRANSITION" ? "INVALID_TRANSITION" : e.code === "ERROR" ? "ERROR" : "VALIDATION";
  return fail(code, e.message);
}

/** 브리프 만들기: 카드 제목·참조 전략의 타깃·제안 문장으로 템플릿 초기값(지어내는 문장 없음). 같은 카드·채널이 있으면 기존 것 */
export async function createContentBrief(taskId: string, funnelItemId: string, channelRaw: unknown): Promise<Result<{ briefId: string; reused: boolean }>> {
  const ch = briefChannelSchema.safeParse(channelRaw);
  if (!ch.success) return fail("VALIDATION", "채널을 골라 주세요.");
  const board = await getFunnelBoard(taskId);
  if (!board?.funnel) return fail("NOT_FOUND", "퍼널 보드를 먼저 만들어 주세요.");
  const item = board.stages.flatMap((s) => s.items).find((i) => i.id === funnelItemId);
  if (!item) return fail("NOT_FOUND", "퍼널 카드를 찾을 수 없습니다.");
  const t = briefTemplate(ch.data, { itemTitle: item.title, basis: board.strategy.basis });
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .rpc("create_content_brief", {
      p_funnel_item_id: funnelItemId,
      p_channel: ch.data,
      p_title: t.title,
      p_audience: t.audience ?? undefined,
      p_core_message: t.coreMessage ?? undefined,
      p_cta: t.cta ?? undefined,
      p_channel_spec: t.channelSpec as Json,
    })
    .single();
  if (error) return rpcFail("createContentBrief", error);
  return ok({ briefId: data.brief_id, reused: data.reused });
}

/** 브리프 값 전체 교체. 채널 spec 은 그 브리프의 채널 계약으로 검사한다 */
export async function updateContentBrief(briefId: string, expectedRevision: number, raw: unknown): Promise<Result<{ revision: number }>> {
  const parsed = briefUpdateSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION", briefIssueMessage(parsed.error.issues[0]));
  const v = parsed.data;
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data: row, error: e0 } = await sb.from("content_briefs").select("channel").eq("workspace_id", workspace.id).eq("id", briefId).maybeSingle();
  if (e0) throw new Error(`브리프를 불러오지 못했습니다: ${e0.message}`);
  if (!row) return fail("NOT_FOUND", "브리프를 찾을 수 없습니다.");
  const spec = parseBriefSpec(row.channel as BriefChannel, v.channelSpec);
  if (!spec.ok) return fail("VALIDATION", spec.message);
  const { data, error } = await sb.rpc("update_content_brief", {
    p_brief_id: briefId,
    p_expected_revision: expectedRevision,
    p_title: v.title,
    p_audience: v.audience as string,
    p_hook: v.hook as string,
    p_core_message: v.coreMessage as string,
    p_cta: v.cta as string,
    p_channel_spec: spec.data as Json,
    p_copy_draft: v.copyDraft as string,
    p_copy_origin: v.copyOrigin,
    p_image_guide: v.imageGuide as string,
    p_status: v.status,
  });
  if (error) return rpcFail("updateContentBrief", error);
  return ok({ revision: data });
}

export async function rebaseContentBrief(briefId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("rebase_content_brief", { p_brief_id: briefId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("rebaseContentBrief", error);
  return ok({ revision: data });
}

export async function archiveContentBrief(briefId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("archive_content_brief", { p_brief_id: briefId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("archiveContentBrief", error);
  return ok({ revision: data });
}

export async function addBriefClaim(briefId: string, raw: unknown): Promise<Result<{ claimId: string }>> {
  const p = claimInputSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", briefIssueMessage(p.error.issues[0]));
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("add_brief_claim", { p_brief_id: briefId, p_text: p.data.text, p_claim_kind: p.data.kind });
  if (error) return rpcFail("addBriefClaim", error);
  return ok({ claimId: data });
}

export async function updateBriefClaim(claimId: string, expectedRevision: number, raw: unknown): Promise<Result<{ revision: number }>> {
  const p = claimInputSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", briefIssueMessage(p.error.issues[0]));
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("update_brief_claim", { p_claim_id: claimId, p_expected_revision: expectedRevision, p_text: p.data.text, p_claim_kind: p.data.kind });
  if (error) return rpcFail("updateBriefClaim", error);
  return ok({ revision: data });
}

export async function archiveBriefClaim(claimId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("archive_brief_claim", { p_claim_id: claimId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("archiveBriefClaim", error);
  return ok({ revision: data });
}

export async function linkClaimSource(claimId: string, raw: unknown): Promise<Result<{ sourceId: string }>> {
  const p = sourceLinkSchema.safeParse(raw);
  if (!p.success) return fail("VALIDATION", briefIssueMessage(p.error.issues[0], "근거를 다시 골라 주세요."));
  const v = p.data;
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("link_claim_source", {
    p_claim_id: claimId,
    p_kind: v.kind,
    p_target_id: v.targetId,
    p_profile_field: v.kind === "profile" ? v.profileField : undefined,
    p_note: v.note ?? undefined,
  });
  if (error) return rpcFail("linkClaimSource", error);
  return ok({ sourceId: data });
}

export async function unlinkClaimSource(sourceId: string): Promise<Result<null>> {
  const sb = await createSupabaseServerClient();
  const { error } = await sb.rpc("unlink_claim_source", { p_source_id: sourceId });
  if (error) return rpcFail("unlinkClaimSource", error);
  return ok(null);
}

