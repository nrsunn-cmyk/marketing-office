/**
 * P3E-BACKEND-IMPL-01: PPT 구성안(P3-e) 순수 모듈. 한도·템플릿 값(AGY P3E-TEMPLATES.md)·기본 뼈대·입력 검사·DB 오류 → 안내.
 * 값 범위의 최종 판정은 DB(20261121010000_p3e_ppt_decks)가 한다. 한도 숫자는 DB 와 같아야 한다.
 */
import { z } from "zod";
import { charLength } from "@/domain/channel-draft/constants";
import { briefTrim } from "@/domain/production-brief/constants";

export const PPT_DECK_LIMITS = {
  slidesMax: 40,
  versionsMax: 20,
  assetsPerSlide: 10,
  activeDecksPerBrief: 5,
  decksPerBrief: 10,
  title: 120,
  slideTitle: 100,
  bulletPoints: 1000,
  speakerNotes: 1000,
} as const;
const L = PPT_DECK_LIMITS;

/**
 * 저장 때 거절하는 제어 문자(줄바꿈 \n·탭은 허용). DB app.ppt_text_ok 와 같은 범위.
 * CR(\r)도 거절 범위다 — 입력의 \r\n·\r 은 clean 이 먼저 \n 으로 바꾸므로 화면 입력은 막히지 않는다(P3DE-BACKEND-FIX-01 D3)
 */
export const PPT_CONTROL_RE = /[\u0001-\u0008\u000B-\u000D\u000E-\u001F\u007F]/;

export const PPT_TEMPLATE_KEYS = ["royal_grid", "minimal_report", "brand_deck"] as const;
export type PptTemplateKey = (typeof PPT_TEMPLATE_KEYS)[number];
export const PPT_DECK_STATUS_KEYS = ["drafting", "reviewed"] as const;
export type PptDeckStatus = (typeof PPT_DECK_STATUS_KEYS)[number];
export const PPT_STATUS_LABELS: Record<PptDeckStatus, string> = { drafting: "작성 중", reviewed: "검토 완료" };

/** 템플릿 값표(AGY P3E-TEMPLATES.md 1절, `#` 없는 6자리 대문자 HEX). 내보내기는 이 객체를 키로 조회만 한다(경로·파일 없음) */
export interface PptTemplate {
  label: string;
  coverBg: string;
  coverTitle: string;
  coverSub: string;
  coverAccent: string;
  bodyBg: string;
  bodyTitle: string;
  bodyText: string;
  mutedText: string;
  accent: string;
  border: string;
  surfaceTint: string;
  /** theme1.xml clrScheme 12색: dk1 lt1 dk2 lt2 accent1~6 hlink folHlink */
  scheme: readonly [string, string, string, string, string, string, string, string, string, string, string, string];
}
export const PPT_TEMPLATES: Readonly<Record<PptTemplateKey, PptTemplate>> = Object.freeze({
  royal_grid: {
    label: "테크 그리드 로열 블루",
    coverBg: "0F172A", coverTitle: "FFFFFF", coverSub: "CBD5E1", coverAccent: "3B82F6",
    bodyBg: "F8FAFC", bodyTitle: "0F172A", bodyText: "1E293B", mutedText: "475569", accent: "2563EB", border: "CBD5E1", surfaceTint: "FFFFFF",
    scheme: ["0F172A", "FFFFFF", "1E293B", "F8FAFC", "2563EB", "3B82F6", "0EA5E9", "16A34A", "D97706", "475569", "2563EB", "1D4ED8"],
  },
  minimal_report: {
    label: "미니멀 보고서형",
    coverBg: "FFFFFF", coverTitle: "0F172A", coverSub: "475569", coverAccent: "1E293B",
    bodyBg: "FFFFFF", bodyTitle: "0F172A", bodyText: "1E293B", mutedText: "475569", accent: "1D4ED8", border: "E2E8F0", surfaceTint: "F8FAFC",
    scheme: ["0F172A", "FFFFFF", "1E293B", "F8FAFC", "1D4ED8", "475569", "0F766E", "15803D", "B45309", "64748B", "1D4ED8", "1E40AF"],
  },
  brand_deck: {
    label: "브랜드 소개서형",
    coverBg: "1E3A8A", coverTitle: "FFFFFF", coverSub: "DBEAFE", coverAccent: "60A5FA",
    bodyBg: "FFFFFF", bodyTitle: "0F172A", bodyText: "1E293B", mutedText: "475569", accent: "1D4ED8", border: "BFDBFE", surfaceTint: "EFF6FF",
    scheme: ["0F172A", "FFFFFF", "1E3A8A", "EFF6FF", "1D4ED8", "60A5FA", "0284C7", "16A34A", "D97706", "475569", "1D4ED8", "1E3A8A"],
  },
});
/** 템플릿 키 조회(자기 속성만 — `__proto__`·`constructor`·경로 같은 값은 null) */
export const pptTemplateOf = (key: string): PptTemplate | null => (Object.hasOwn(PPT_TEMPLATES, key) ? PPT_TEMPLATES[key as PptTemplateKey] : null);

/** 새 구성안 기본 뼈대 3장(AGY P3E-TEMPLATES.md 2절). 화면이 채워 create 로 보낸다. 표지 제목은 브리프 제목이 있으면 그 값 */
export const DEFAULT_PPT_SLIDES = [
  {
    title: "[직접 입력: 발표 자료 제목]",
    bullets: "[직접 입력: 대상 고객과 핵심 주제를 한 줄로 적어 주세요.]\n[직접 입력: 작성 일자와 담당 부서 또는 작성자 구분을 적어 주세요.]",
    notes: "표지에서는 발표 목적과 대상 고객을 짧게 소개합니다.",
  },
  {
    title: "발표 순서",
    bullets: "1. [직접 입력: 현황 및 배경]\n2. [직접 입력: 핵심 제안 내용]\n3. [직접 입력: 진행 일정 및 다음 단계]",
    notes: "목차 제목이 실제 본문 슬라이드 순서와 맞는지 저장 전 확인합니다.",
  },
  {
    title: "[직접 입력: 첫 번째 핵심 내용 제목]",
    bullets:
      "[직접 입력: 확인된 사실이나 진행 기준을 한 줄씩 적어 주세요.]\n[직접 입력: 고객에게 전달할 구체적 실행 내용을 적어 주세요.]\n[직접 입력: 참고할 디자인 자산이 있다면 아래에서 연결해 주세요.]",
    notes: "확인된 출처나 브리프 내용에 맞게 숫자와 문구를 채워 주세요.",
  },
] as const;

// 글자 수는 코드 포인트, 앞뒤 공백 정리, 제어 문자 거절(줄바꿈은 줄 끝 \r\n → \n 으로 맞춘다)
const clean = (s: string) => briefTrim(s.replace(/\r\n?/g, "\n"));
const text = (max: number, obj: string, topic: string) =>
  z
    .string()
    .transform(clean)
    .pipe(
      z
        .string()
        .min(1, `${obj} 입력해 주세요.`)
        .refine((s) => charLength(s) <= max, `${topic} ${max.toLocaleString("en-US")}자까지입니다.`)
        .refine((s) => !PPT_CONTROL_RE.test(s), `${topic} 쓸 수 없는 제어 문자가 들어 있습니다.`),
    );
const optionalText = (max: number, topic: string) =>
  z
    .string()
    .nullable()
    .transform((s) => (s === null ? null : clean(s) || null))
    .pipe(
      z
        .string()
        .refine((s) => charLength(s) <= max, `${topic} ${max.toLocaleString("en-US")}자까지입니다.`)
        .refine((s) => !PPT_CONTROL_RE.test(s), `${topic} 쓸 수 없는 제어 문자가 들어 있습니다.`)
        .nullable(),
    );

/** 슬라이드 하나(Front PptSlideView 에서 sortOrder 를 뺀 것. 순서는 배열 순서) */
export const pptSlideInputSchema = z.strictObject({
  id: z.uuid("슬라이드 id 가 올바르지 않습니다.").nullable(),
  slideTitle: text(L.slideTitle, "슬라이드 제목을", "슬라이드 제목은"),
  bulletPoints: optionalText(L.bulletPoints, "핵심 요점은"),
  speakerNotes: optionalText(L.speakerNotes, "발표자 메모는"),
  assetIds: z.array(z.uuid("디자인 자산 id 가 올바르지 않습니다.")).max(L.assetsPerSlide, `슬라이드 하나에 디자인 자산은 ${L.assetsPerSlide}개까지 연결할 수 있습니다.`),
});
const slides = z
  .array(pptSlideInputSchema)
  .min(1, "슬라이드는 1장 이상이어야 합니다.")
  .max(L.slidesMax, `슬라이드는 ${L.slidesMax}장까지 둘 수 있습니다. 불필요한 슬라이드를 제외한 뒤 추가해 주세요.`);

export const pptDeckCreateSchema = z.strictObject({
  productionBriefId: z.uuid("제작 브리프 id 가 올바르지 않습니다."),
  title: text(L.title, "발표 자료 제목을", "발표 자료 제목은"),
  templateKey: z.enum(PPT_TEMPLATE_KEYS, "알 수 없는 템플릿입니다."),
  slides,
});
export const pptDeckSaveSchema = z.strictObject({
  title: text(L.title, "발표 자료 제목을", "발표 자료 제목은"),
  templateKey: z.enum(PPT_TEMPLATE_KEYS, "알 수 없는 템플릿입니다."),
  status: z.enum(PPT_DECK_STATUS_KEYS, "알 수 없는 진행 상태입니다."),
  slides,
});
export type PptDeckCreateInput = z.infer<typeof pptDeckCreateSchema>;
export type PptDeckSaveInput = z.infer<typeof pptDeckSaveSchema>;

/** DB RPC 로 넘길 슬라이드 JSON(snake_case). DB 가 id·자산 판 번호를 다시 정한다 */
export const toDbSlides = (list: z.infer<typeof slides>) =>
  list.map((s) => ({ id: s.id, title: s.slideTitle, bullets: s.bulletPoints, notes: s.speakerNotes, asset_ids: s.assetIds }));

/** 저장된 판의 슬라이드(내보내기·읽기용) */
export interface StoredSlide {
  id: string;
  title: string;
  bullets: string | null;
  notes: string | null;
  assets: Array<{ asset_id: string; version_no: number }>;
}

export type PptErrorCode = "VALIDATION" | "CONFLICT" | "NOT_FOUND" | "INVALID_TRANSITION" | "ERROR";
const hangulDetail = (d: string) => (/[가-힣]/.test(d) && d.length <= 200 ? (/[.?!]$/.test(d) ? d : `${d}.`) : null);

/** DB 오류 머리 → 앱 오류. 자세한 글은 DB 의 한글 문구(PPT_COPY 와 같은 문장)를 쓴다 */
export function pptErrorFromDb(message: string | null | undefined): { code: PptErrorCode; message: string } {
  const m = /^\s*([A-Z_]+):\s*(.*)$/s.exec(message ?? "");
  const head = m?.[1] ?? "";
  const detail = m?.[2]?.trim() ?? "";
  switch (head) {
    case "LIMIT_REACHED":
    case "VALIDATION":
      return { code: "VALIDATION", message: hangulDetail(detail) ?? "입력값이 규칙에 맞지 않습니다." };
    case "INVALID_TRANSITION":
      return { code: "INVALID_TRANSITION", message: hangulDetail(detail) ?? "지금 상태에서는 할 수 없습니다." };
    case "FROZEN_COLUMN":
      return { code: "INVALID_TRANSITION", message: "보관한 PPT 구성안은 고칠 수 없습니다." };
    case "CONFLICT":
      return { code: "CONFLICT", message: "다른 곳에서 먼저 수정되었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요." };
    case "NOT_FOUND":
      return { code: "NOT_FOUND", message: hangulDetail(detail) ?? "찾을 수 없습니다." };
    default:
      return { code: "ERROR", message: "PPT 구성안을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
