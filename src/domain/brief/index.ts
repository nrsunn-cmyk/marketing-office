/**
 * P2F-BACKEND-01: 콘텐츠 제작 브리프(P2-f) 순수 모듈.
 * 브리프 데이터 계약(채널별 spec 포함), 템플릿 초기값, 보드 경고(미확인 주장·빈 브리프), 복사용 마크다운, DB 오류 문구.
 * DB 규칙: supabase/migrations/20261118002000_p2f_content_brief.sql (값 범위는 DB와 같게 둔다)
 */
import { z } from "zod";
import { funnelErrorFromDb, type FunnelStrategyBasis } from "@/domain/funnel";

export const BRIEF_CHANNELS = { blog: "블로그", instagram: "인스타그램", ad_copy: "광고 카피", linkedin: "LinkedIn", newsletter: "뉴스레터" } as const;
export type BriefChannel = keyof typeof BRIEF_CHANNELS;
export const BRIEF_STATUSES = { drafting: "작성 중", ready: "사용 준비" } as const;
export type BriefStatus = keyof typeof BRIEF_STATUSES;
export const CLAIM_KINDS = { statistic: "수치·통계", capability: "제품 역량", reference: "레퍼런스", other: "기타" } as const;
export type ClaimKind = keyof typeof CLAIM_KINDS;
export const PROFILE_FIELDS = { products: "제품·서비스", audience: "고객층", strengths: "강점", brand_rules: "브랜드 규칙", channel_urls: "채널 주소" } as const;
export type ProfileField = keyof typeof PROFILE_FIELDS;
/** DB copy_origin. 'ai' 는 자동 문구 생성이 결정되기 전까지 없다(ai-contract.ts) */
export const COPY_ORIGINS = ["manual", "template"] as const;

export const BRIEF_LIMITS = {
  title: 200, audience: 500, hook: 300, coreMessage: 1000, cta: 200, copyDraft: 5000, imageGuide: 2000,
  claimText: 500, claimsPerBrief: 30, sourcesPerClaim: 10, sourceNote: 300,
} as const;
const L = BRIEF_LIMITS;

const line = (max: number, label: string) => z.string().trim().min(1, `${label}이(가) 비어 있습니다.`).max(max, `${label}은(는) ${max}자 이하여야 합니다.`);
const lines = (n: number, max: number, label: string) => z.array(line(max, label)).max(n, `${label}은(는) ${n}개까지입니다.`).optional();

/** 채널별 항목(DB app.brief_spec_ok 와 같은 규칙). 모든 키는 선택, 모르는 키 거절 */
export const BRIEF_SPEC_SCHEMAS = {
  blog: z.strictObject({ titleIdeas: lines(5, 200, "제목 후보"), outline: lines(20, 300, "아웃라인"), keywords: lines(10, 50, "키워드") }),
  instagram: z.strictObject({
    format: z.enum(["feed", "carousel", "reel"], "게시 형식을 골라 주세요.").optional(),
    captionGuide: line(1000, "캡션 지침").optional(),
    hashtags: lines(30, 50, "해시태그"),
  }),
  ad_copy: z.strictObject({ platform: line(50, "매체").optional(), headlines: lines(5, 60, "헤드라인"), descriptions: lines(5, 150, "설명문") }),
  linkedin: z.strictObject({ outline: lines(20, 300, "아웃라인"), hashtags: lines(10, 50, "해시태그") }),
  newsletter: z.strictObject({ subjectLines: lines(5, 100, "메일 제목"), outline: lines(20, 300, "아웃라인") }),
} as const;
export type BriefSpec<C extends BriefChannel = BriefChannel> = z.infer<(typeof BRIEF_SPEC_SCHEMAS)[C]>;

const optionalText = (max: number, label: string) =>
  z.string().max(max * 2, `${label}이(가) 너무 깁니다.`).nullable().optional()
    .transform((s) => (s ?? "").trim())
    .pipe(z.string().max(max, `${label}은(는) ${max}자 이하여야 합니다.`))
    .transform((s) => (s === "" ? null : s));

/** 브리프 수정 입력(update_content_brief). 채널은 바꿀 수 없으므로 spec 은 채널로 따로 검사한다 */
export const briefUpdateSchema = z.strictObject({
  title: line(L.title, "제목"),
  audience: optionalText(L.audience, "타깃 독자"),
  hook: optionalText(L.hook, "훅 문장"),
  coreMessage: optionalText(L.coreMessage, "핵심 요지"),
  cta: optionalText(L.cta, "CTA"),
  channelSpec: z.record(z.string(), z.unknown()).default({}),
  copyDraft: optionalText(L.copyDraft, "카피 초안"),
  copyOrigin: z.enum(COPY_ORIGINS, "카피 작성 방식이 올바르지 않습니다.").default("manual"),
  imageGuide: optionalText(L.imageGuide, "이미지 가이드"),
  status: z.enum(Object.keys(BRIEF_STATUSES) as [BriefStatus, ...BriefStatus[]], "진행 상태를 골라 주세요.").default("drafting"),
});
export type BriefUpdateInput = z.infer<typeof briefUpdateSchema>;

export const briefChannelSchema = z.enum(Object.keys(BRIEF_CHANNELS) as [BriefChannel, ...BriefChannel[]], "채널을 골라 주세요.");
export const claimInputSchema = z.strictObject({
  text: line(L.claimText, "주장 문장"),
  kind: z.enum(Object.keys(CLAIM_KINDS) as [ClaimKind, ...ClaimKind[]], "주장 종류를 골라 주세요.").default("other"),
});
export const sourceLinkSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("profile"), targetId: z.uuid(), profileField: z.enum(Object.keys(PROFILE_FIELDS) as [ProfileField, ...ProfileField[]], "프로필 항목을 골라 주세요."), note: optionalText(L.sourceNote, "근거 메모") }),
  z.strictObject({ kind: z.literal("asset"), targetId: z.uuid(), note: optionalText(L.sourceNote, "근거 메모") }),
  z.strictObject({ kind: z.literal("research"), targetId: z.uuid(), note: optionalText(L.sourceNote, "근거 메모") }),
]);
export type SourceLinkInput = z.infer<typeof sourceLinkSchema>;

/** 채널 spec 검사. 실패하면 첫 안내 문구 */
export function parseBriefSpec(channel: BriefChannel, spec: unknown): { ok: true; data: BriefSpec } | { ok: false; message: string } {
  const r = BRIEF_SPEC_SCHEMAS[channel].safeParse(spec ?? {});
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, message: briefIssueMessage(r.error.issues[0], "채널별 항목 형식이 올바르지 않습니다.") };
}

/**
 * 템플릿 초기값(채널별 빈 틀 + 퍼널 카드·전략 문장). 문장을 지어내지 않는다:
 * 제목 = 카드 제목, 타깃 = 전략 타깃 첫 문장, 핵심 요지 = 전략 제안 첫 문장, 나머지는 비움.
 */
export function briefTemplate(channel: BriefChannel, ctx: { itemTitle: string; basis: FunnelStrategyBasis }) {
  const spec: Record<BriefChannel, BriefSpec> = {
    blog: { titleIdeas: [ctx.itemTitle.trim()].filter(Boolean).slice(0, 1) },
    instagram: { format: "feed" },
    ad_copy: {},
    linkedin: {},
    newsletter: {},
  };
  return {
    channel,
    title: ctx.itemTitle.trim().slice(0, L.title) || BRIEF_CHANNELS[channel],
    audience: ctx.basis.audiences[0]?.slice(0, L.audience) ?? null,
    coreMessage: ctx.basis.offers[0]?.slice(0, L.coreMessage) ?? null,
    cta: null as string | null,
    channelSpec: spec[channel],
  };
}

export interface ClaimWithSources {
  id: string;
  text: string;
  kind: ClaimKind;
  /** 해제하지 않은 근거의 화면 이름 */
  sources: { label: string }[];
}

export type BriefWarning = { kind: "empty" } | { kind: "unverified"; claimIds: string[] };
/** 시안 상태: 빈 브리프(훅·핵심 요지·주장 모두 없음), 미확인 주장(근거 0개). 이전 전략 기준은 stale 로 따로 준다 */
export function briefWarnings(brief: { hook: string | null; coreMessage: string | null }, claims: ClaimWithSources[]): BriefWarning[] {
  if (!brief.hook && !brief.coreMessage && claims.length === 0) return [{ kind: "empty" }];
  const unverified = claims.filter((c) => c.sources.length === 0).map((c) => c.id);
  return unverified.length ? [{ kind: "unverified", claimIds: unverified }] : [];
}

/** 클립보드 복사용 마크다운. 근거 없는 주장에는 [미확인 주장] 을 붙인다 */
export function briefToMarkdown(b: {
  channel: BriefChannel; title: string; stageLabel?: string; audience: string | null; hook: string | null; coreMessage: string | null;
  cta: string | null; channelSpec: BriefSpec; copyDraft: string | null; imageGuide: string | null; stale?: boolean;
}, claims: ClaimWithSources[]): string {
  const out: string[] = [`# ${b.title}`, "", `- 채널: ${BRIEF_CHANNELS[b.channel]}`];
  if (b.stageLabel) out.push(`- 퍼널 단계: ${b.stageLabel}`);
  if (b.stale) out.push("- ⚠ 이전 전략 기준으로 작성된 브리프입니다");
  const field = (label: string, v: string | null) => { if (v) out.push(`- ${label}: ${v}`); };
  field("타깃 독자", b.audience); field("훅", b.hook); field("핵심 요지", b.coreMessage); field("CTA", b.cta);
  const SPEC_LABELS: Record<string, string> = {
    titleIdeas: "제목 후보", outline: "아웃라인", keywords: "키워드", format: "게시 형식", captionGuide: "캡션 지침", hashtags: "해시태그",
    platform: "매체", headlines: "헤드라인", descriptions: "설명문", subjectLines: "메일 제목",
  };
  const specEntries = Object.entries(b.channelSpec as Record<string, unknown>).filter(([, v]) => (Array.isArray(v) ? v.length : v));
  if (specEntries.length) {
    out.push("", "## 채널별 지침");
    for (const [k, v] of specEntries) {
      if (Array.isArray(v)) { out.push(`- ${SPEC_LABELS[k] ?? k}:`); for (const x of v) out.push(`  - ${String(x)}`); }
      else out.push(`- ${SPEC_LABELS[k] ?? k}: ${String(v)}`);
    }
  }
  if (claims.length) {
    out.push("", "## 주장과 근거");
    claims.forEach((c, i) => {
      const tag = c.sources.length ? "" : " [미확인 주장]";
      out.push(`${i + 1}. ${c.text}${tag}`);
      for (const s of c.sources) out.push(`   - 근거: ${s.label}`);
    });
  }
  if (b.copyDraft) out.push("", "## 카피 초안", "", b.copyDraft);
  if (b.imageGuide) out.push("", "## 이미지 가이드", "", b.imageGuide);
  return out.join("\n") + "\n";
}

/** DB 오류 → 안내 문구. 퍼널과 같은 규칙 + SOURCE_MISMATCH(근거 무결성)는 DB의 한국어 설명을 그대로 */
export function briefErrorFromDb(message: string | null | undefined): { code: string; message: string } {
  const m = /^\s*SOURCE_MISMATCH:\s*(.+)$/s.exec(message ?? "");
  if (m && /[가-힣]/.test(m[1]) && m[1].length <= 200) return { code: "SOURCE_MISMATCH", message: m[1].trim() };
  return funnelErrorFromDb(message);
}

export function briefIssueMessage(issue: { message: string } | undefined, fallback = "입력값이 규칙에 맞지 않습니다."): string {
  if (issue && /[가-힣]/.test(issue.message)) return issue.message;
  return fallback;
}

export * from "./ai-contract";
