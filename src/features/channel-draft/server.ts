import "server-only";
import {
  CHANNEL_DRAFT_BRIEF_CHANNEL,
  CHANNEL_DRAFT_DISPLAY_STATUSES,
  CHANNEL_DRAFT_LIMITS,
  channelDraftDisplayStatus,
  channelDraftErrorFromDb,
  channelDraftInputSchema,
  channelDraftIssueMessage,
  isSafeHttpsUrl,
  isTistoryHost,
  normalizePublicationUrl,
  parsePublishedAt,
  publicationInputSchema,
  voidInputSchema,
  type ChannelDraftDisplayStatus,
  type ChannelDraftInput,
  type ChannelDraftStatus,
} from "@/domain/channel-draft";
import { assertSafeHtml, exportFileName, postInfo, renderTistoryHtml, toMarkdown, toPlainText, type PostInfo } from "@/domain/channel-draft/render";
import type { BriefDetail } from "@/features/brief/server";
import type { FunnelBoard } from "@/features/funnel/server";
import { requireWorkspace } from "@/server/auth/session";
import { fail, ok, type ErrorCode, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/server/supabase/database.types";

/**
 * P2G-BACKEND-01: 채널 초안(P2-g, 티스토리 블로그·한국어) 서버 함수. 화면은 브리프 화면 아래에 붙는다.
 * 읽기는 본인 업무실(RLS + workspace_id 조건), 쓰기는 정의자 RPC(20261120001000_p2g_channel_drafts.sql)만 쓴다.
 * 자동 게시는 없다(R08): 이 모듈은 외부로 요청을 보내지 않는다. 복사·내보내기 글은 서버가 허용 태그만으로 만든다.
 */

export interface ChannelPublicationView {
  id: string;
  /** record = 게시 기록, void = 취소 표시 */
  kind: "record" | "void";
  /** record 만. 같은 규칙(https)을 다시 통과한 값만 온다 — 화면은 이 값만 href 로 쓴다 */
  url: string | null;
  /** 티스토리 기본 주소가 아니면 안내(막지 않음) */
  nonTistoryHost: boolean;
  publishedAt: string | null;
  note: string | null;
  /** record 가 취소되었는지(취소 행이 가리킴) */
  voided: boolean;
  /** void 가 가리키는 기록 */
  voidsId: string | null;
  createdAt: string;
}
export interface ChannelDraftExport {
  /** 티스토리 HTML 모드용 조각(허용 태그만) */
  html: string;
  /** .md 내보내기(제목 + 본문) */
  markdown: string;
  /** 서식 없는 글자 */
  text: string;
  /** 발행 화면에 따로 넣는 글 정보 */
  info: PostInfo;
  /** 파일 이름(확장자 포함) */
  fileNames: { html: string; md: string; txt: string };
}
export interface ChannelDraftView {
  id: string;
  title: string;
  body: string;
  tags: string[];
  imageNote: string | null;
  metaDescription: string | null;
  status: ChannelDraftStatus;
  displayStatus: ChannelDraftDisplayStatus;
  displayLabel: string;
  revision: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  strategyVersion: { id: string; version: number | null };
  /** 참조 전략 버전 ≠ 지금 승인본 → "이전 전략 기준" 배지(DEC-P2-01-A: 표시만, 막지 않음) */
  stale: boolean;
  /** 만든 뒤 브리프가 고쳐졌는지(정보만 — 초안 내용은 그대로) */
  briefChanged: boolean;
  sourceBriefRevision: number;
  /** 만들 때 고정한 브리프 입력 사본 */
  sourceSnapshot: Json;
  publications: ChannelPublicationView[];
  export: ChannelDraftExport;
}
export interface ChannelDraftsForBrief {
  drafts: ChannelDraftView[];
  /** 새 초안을 만들 수 있는지와 못 만드는 이유(화면 안내용, 최종 판단은 DB) */
  canCreate: boolean;
  createBlockedReason: string | null;
  activeCount: number;
  limit: number;
}

const COLS =
  "id, brief_id, title, body, tags, image_note, meta_description, status, revision, archived_at, created_at, updated_at, strategy_version_id, source_brief_revision, source_snapshot";
type Row = {
  id: string;
  brief_id: string;
  title: string;
  body: string;
  tags: Json;
  image_note: string | null;
  meta_description: string | null;
  status: string;
  revision: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  strategy_version_id: string;
  source_brief_revision: number;
  source_snapshot: Json;
};
type PubRow = { id: string; draft_id: string; kind: string; url: string | null; published_at: string | null; note: string | null; voids_id: string | null; created_at: string };
const strings = (v: Json): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function buildExport(d: { title: string; body: string; tags: string[]; metaDescription: string | null; imageNote: string | null }): ChannelDraftExport {
  const html = renderTistoryHtml(d.body);
  // 차단선 한 번 더: 허용 목록 밖이 하나라도 있으면 내보내지 않고 멈춘다(실패하면 닫힌 쪽)
  assertSafeHtml(html);
  return {
    html,
    markdown: toMarkdown(d.title, d.body),
    text: toPlainText(d.body),
    info: postInfo(d),
    fileNames: { html: exportFileName(d.title, "html"), md: exportFileName(d.title, "md"), txt: exportFileName(d.title, "txt") },
  };
}

function blockedReason(brief: BriefDetail["brief"], active: number): string | null {
  if (brief.channel !== CHANNEL_DRAFT_BRIEF_CHANNEL) return "티스토리 초안은 블로그 브리프로만 만들 수 있습니다.";
  if (brief.archived) return "보관한 브리프로는 초안을 만들 수 없습니다.";
  if (brief.status !== "ready") return "브리프를 준비 완료로 바꾸면 초안을 만들 수 있습니다.";
  if (active >= CHANNEL_DRAFT_LIMITS.perBrief) return `한 브리프에는 초안을 ${CHANNEL_DRAFT_LIMITS.perBrief}개까지 둘 수 있습니다.`;
  return null;
}

/**
 * 브리프의 채널 초안 목록. board·detail 은 반드시 서버에서 getFunnelBoardFor·getContentBriefFor 로 읽은 값이어야 한다(브라우저 입력을 받지 않는다).
 * 보관하지 않은 것 먼저(만든 순서), 보관한 것은 뒤에. 게시 기록은 만든 순서.
 */
export async function getChannelDraftsFor(board: FunnelBoard | null, detail: BriefDetail | null): Promise<ChannelDraftsForBrief | null> {
  if (!board?.funnel || !detail) return null;
  const brief = detail.brief;
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const dr = await sb.from("channel_drafts").select(COLS).eq("workspace_id", workspace.id).eq("brief_id", brief.id).order("created_at");
  if (dr.error) throw new Error(`채널 초안을 불러오지 못했습니다: ${dr.error.message}`);
  const rows = (dr.data ?? []) as Row[];

  const pubs = new Map<string, PubRow[]>();
  if (rows.length) {
    const pr = await sb
      .from("channel_publications")
      .select("id, draft_id, kind, url, published_at, note, voids_id, created_at")
      .eq("workspace_id", workspace.id)
      .in("draft_id", rows.map((r) => r.id))
      .order("created_at");
    if (pr.error) throw new Error(`게시 기록을 불러오지 못했습니다: ${pr.error.message}`);
    for (const p of (pr.data ?? []) as PubRow[]) pubs.set(p.draft_id, [...(pubs.get(p.draft_id) ?? []), p]);
  }

  const known = new Map<string, number>();
  if (board.strategy.approvedVersion) known.set(board.strategy.approvedVersion.id, board.strategy.approvedVersion.version);
  known.set(board.funnel.strategyVersion.id, board.funnel.strategyVersion.version);
  const unknown = [...new Set(rows.map((r) => r.strategy_version_id))].filter((id) => !known.has(id));
  if (unknown.length) {
    const v = await sb.from("artifact_versions").select("id, version").eq("workspace_id", workspace.id).in("id", unknown);
    if (v.error) throw new Error(`전략 버전을 불러오지 못했습니다: ${v.error.message}`);
    for (const x of v.data ?? []) known.set(x.id, x.version);
  }
  const approvedId = board.strategy.approvedVersion?.id ?? null;

  const drafts = rows.map((r): ChannelDraftView => {
    const list = pubs.get(r.id) ?? [];
    const voidedIds = new Set(list.filter((p) => p.kind === "void" && p.voids_id).map((p) => p.voids_id as string));
    const publications = list.map((p): ChannelPublicationView => {
      const url = p.kind === "record" && isSafeHttpsUrl(p.url) ? p.url : null;
      return {
        id: p.id,
        kind: p.kind === "void" ? "void" : "record",
        url,
        nonTistoryHost: url !== null && !isTistoryHost(url),
        publishedAt: p.published_at,
        note: p.note,
        voided: voidedIds.has(p.id),
        voidsId: p.voids_id,
        createdAt: p.created_at,
      };
    });
    const archived = r.archived_at !== null;
    const status = (r.status === "reviewed" ? "reviewed" : "drafting") as ChannelDraftStatus;
    const displayStatus = channelDraftDisplayStatus({ archived, hasActivePublication: publications.some((p) => p.kind === "record" && !p.voided), status });
    const tags = strings(r.tags);
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      tags,
      imageNote: r.image_note,
      metaDescription: r.meta_description,
      status,
      displayStatus,
      displayLabel: CHANNEL_DRAFT_DISPLAY_STATUSES[displayStatus],
      revision: r.revision,
      archived,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      strategyVersion: { id: r.strategy_version_id, version: known.get(r.strategy_version_id) ?? null },
      stale: approvedId !== null && r.strategy_version_id !== approvedId,
      briefChanged: r.source_brief_revision !== brief.revision,
      sourceBriefRevision: r.source_brief_revision,
      sourceSnapshot: r.source_snapshot,
      publications,
      export: buildExport({ title: r.title, body: r.body, tags, metaDescription: r.meta_description, imageNote: r.image_note }),
    };
  });
  drafts.sort((x, y) => Number(x.archived) - Number(y.archived));
  const activeCount = drafts.filter((d) => !d.archived).length;
  const reason = blockedReason(brief, activeCount);
  return { drafts, canCreate: reason === null, createBlockedReason: reason, activeCount, limit: CHANNEL_DRAFT_LIMITS.perBrief };
}

function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  const e = channelDraftErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  const code: ErrorCode =
    e.code === "CONFLICT" ? "CONFLICT" : e.code === "NOT_FOUND" ? "NOT_FOUND" : e.code === "INVALID_TRANSITION" ? "INVALID_TRANSITION" : e.code === "ERROR" ? "ERROR" : "VALIDATION";
  return fail(code, e.message);
}

/** 입력 계약 확인. 실패하면 첫 안내 문구 */
export function parseChannelDraft(raw: unknown): Result<ChannelDraftInput> {
  const parsed = channelDraftInputSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION", channelDraftIssueMessage(parsed.error.issues[0]));
  return ok(parsed.data);
}

/** 만들기. 바탕은 준비 완료·보관 안 된 blog 브리프. 제목·본문·태그·메타 설명 초기값은 DB 가 브리프에서 만든다(템플릿, AI 없음) */
export async function createChannelDraft(briefId: string): Promise<Result<{ draftId: string }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("create_channel_draft", { p_brief_id: briefId });
  if (error) return rpcFail("createChannelDraft", error);
  return ok({ draftId: data });
}

/** 값 전체 교체(제목·본문·태그·대표 이미지 안내·메타 설명·상태) */
export async function updateChannelDraft(draftId: string, expectedRevision: number, raw: unknown): Promise<Result<{ revision: number }>> {
  const p = parseChannelDraft(raw);
  if (!p.ok) return p;
  const v = p.data;
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("update_channel_draft", {
    p_draft_id: draftId,
    p_expected_revision: expectedRevision,
    p_title: v.title,
    p_body: v.body,
    p_tags: v.tags,
    p_image_note: v.imageNote as string,
    p_meta_description: v.metaDescription as string,
    p_status: v.status,
  });
  if (error) return rpcFail("updateChannelDraft", error);
  return ok({ revision: data });
}

/** 참조 전략을 지금 승인본으로 다시 맞춘다(주인님이 누를 때만) */
export async function rebaseChannelDraft(draftId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("rebase_channel_draft", { p_draft_id: draftId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("rebaseChannelDraft", error);
  return ok({ revision: data });
}

/** 보관(삭제 대신). 보관한 초안은 읽기·복사·내보내기만 된다 */
export async function archiveChannelDraft(draftId: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("archive_channel_draft", { p_draft_id: draftId, p_expected_revision: expectedRevision });
  if (error) return rpcFail("archiveChannelDraft", error);
  return ok({ revision: data });
}

/**
 * 수동 게시 기록. raw = { url, publishedAt, note? }. 주소는 new URL 로 정규화한 뒤 DB 와 같은 규칙으로 보고,
 * 시간대가 없는 게시 시각은 한국 시간으로 본다. 초안 revision 은 바뀌지 않는다.
 */
export async function recordChannelPublication(draftId: string, raw: unknown): Promise<Result<{ publicationId: string }>> {
  const parsed = publicationInputSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION", channelDraftIssueMessage(parsed.error.issues[0]));
  const u = normalizePublicationUrl(parsed.data.url);
  if (!u.ok) return fail("VALIDATION", u.message);
  const t = parsePublishedAt(parsed.data.publishedAt);
  if (!t.ok) return fail("VALIDATION", t.message);
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("record_channel_publication", {
    p_draft_id: draftId,
    p_url: u.url,
    p_published_at: t.iso,
    p_note: parsed.data.note ?? undefined,
  });
  if (error) return rpcFail("recordChannelPublication", error);
  return ok({ publicationId: data });
}

/** 게시 기록 취소(취소 행 추가, 지우지 않음). raw = { reason } */
export async function voidChannelPublication(publicationId: string, raw: unknown): Promise<Result<{ voidId: string }>> {
  const parsed = voidInputSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION", channelDraftIssueMessage(parsed.error.issues[0]));
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("void_channel_publication", { p_publication_id: publicationId, p_reason: parsed.data.reason });
  if (error) return rpcFail("voidChannelPublication", error);
  return ok({ voidId: data });
}
