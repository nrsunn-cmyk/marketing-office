/**
 * P2F-FRONT-01 콘텐츠 브리프 폼 값 ↔ 서버 계약 변환(화면 없이 시험할 수 있게 따로 둔다).
 * 계약: src/domain/brief (briefUpdateSchema, BRIEF_SPEC_SCHEMAS, claimInputSchema, sourceLinkSchema)
 */
import type { BriefChannel, BriefSpec, BriefStatus, ClaimKind, ProfileField } from "@/domain/brief";

/** 채널별 항목(서버 BRIEF_SPEC_SCHEMAS 와 같은 키). lines = 한 줄에 하나, text = 한 칸, format = 인스타그램 게시 형식 */
export type SpecFieldType = "lines" | "text" | "format";
export interface SpecField {
  key: string;
  label: string;
  type: SpecFieldType;
  /** lines: 최대 개수 / text: 최대 글자 */
  max: number;
  help?: string;
}
export const SPEC_FIELDS: Record<BriefChannel, SpecField[]> = {
  blog: [
    { key: "titleIdeas", label: "제목 후보", type: "lines", max: 5 },
    { key: "outline", label: "아웃라인", type: "lines", max: 20 },
    { key: "keywords", label: "키워드", type: "lines", max: 10 },
  ],
  instagram: [
    { key: "format", label: "게시 형식", type: "format", max: 0 },
    { key: "captionGuide", label: "캡션 지침", type: "text", max: 1000 },
    { key: "hashtags", label: "해시태그", type: "lines", max: 30, help: "# 없이 적어도 됩니다." },
  ],
  ad_copy: [
    { key: "platform", label: "매체", type: "text", max: 50, help: "예: 네이버 검색광고" },
    { key: "headlines", label: "헤드라인", type: "lines", max: 5 },
    { key: "descriptions", label: "설명문", type: "lines", max: 5 },
  ],
  linkedin: [
    { key: "outline", label: "아웃라인", type: "lines", max: 20 },
    { key: "hashtags", label: "해시태그", type: "lines", max: 10 },
  ],
  newsletter: [
    { key: "subjectLines", label: "메일 제목", type: "lines", max: 5 },
    { key: "outline", label: "아웃라인", type: "lines", max: 20 },
  ],
};
export const INSTAGRAM_FORMATS = { feed: "피드", carousel: "캐러셀(여러 장)", reel: "릴스" } as const;

export interface BriefFormValue {
  title: string;
  audience: string;
  hook: string;
  coreMessage: string;
  cta: string;
  /** 채널 항목: lines 는 줄바꿈으로 이은 글, 나머지는 그대로 */
  spec: Record<string, string>;
  copyDraft: string;
  copyOrigin: "manual" | "template";
  imageGuide: string;
  status: BriefStatus;
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

/** 저장된 채널 항목 → 폼 글 */
export function specToForm(channel: BriefChannel, spec: BriefSpec | Record<string, unknown>): Record<string, string> {
  const src = (spec ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const f of SPEC_FIELDS[channel]) {
    const v = src[f.key];
    out[f.key] = Array.isArray(v) ? v.map(String).join("\n") : typeof v === "string" ? v : "";
  }
  return out;
}

/** 폼 글 → 채널 항목. 빈 줄·빈 칸은 보내지 않는다(서버는 빈 줄을 거절한다). 길이·개수는 자르지 않고 서버가 판단한다 */
export function formToSpec(channel: BriefChannel, form: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of SPEC_FIELDS[channel]) {
    const raw = form[f.key] ?? "";
    if (f.type === "lines") {
      const ls = lines(raw);
      if (ls.length) out[f.key] = ls;
    } else if (raw.trim()) {
      out[f.key] = f.type === "format" ? raw : raw.trim();
    }
  }
  return out;
}

/** 브리프 수정 payload(briefUpdateSchema) */
export function toBriefPayload(channel: BriefChannel, v: BriefFormValue) {
  return {
    title: v.title,
    audience: v.audience,
    hook: v.hook,
    coreMessage: v.coreMessage,
    cta: v.cta,
    channelSpec: formToSpec(channel, v.spec),
    copyDraft: v.copyDraft,
    copyOrigin: v.copyOrigin,
    imageGuide: v.imageGuide,
    status: v.status,
  };
}

/** 주장 payload(claimInputSchema) */
export const toClaimPayload = (text: string, kind: ClaimKind) => ({ text, kind });

/** 근거 연결 payload(sourceLinkSchema). 선택값은 "profile:<versionId>:<field>" · "asset:<id>" · "research:<id>" */
export function toSourcePayload(choice: string, note: string) {
  const [kind, id, field] = choice.split(":");
  if (kind === "profile") return { kind, targetId: id, profileField: field as ProfileField, note };
  return { kind, targetId: id, note };
}
