/**
 * P3B-BACKEND-IMPL-01: 홈페이지 구조·문구(P3-b) 순수 모듈. 저장 계약(camelCase, Front e739bc8 toWebCopyPayload 그대로) → DB 판 내용(snake_case),
 * DB 오류 → 안내 문구. 값 범위·형식 검사의 최종 판정은 DB(app.web_copy_content_problem)가 한다. 여기서는 모양만 엄격히 본다.
 */
import { z } from "zod";
import { funnelErrorFromDb, funnelIssueMessage } from "@/domain/funnel";
import { WEB_COPY_LIMITS as L, WEB_COPY_STATUSES } from "./constants";

export * from "./constants";

const nullableText = z.string().nullable();
const sectionSchema = z.strictObject({
  id: z.uuid("섹션 id 가 올바르지 않습니다.").nullable(),
  sectionName: z.string(),
  purpose: nullableText,
  headline: z.string(),
  body: nullableText,
  ctaLabel: nullableText,
  ctaTarget: nullableText,
  citationIds: z.array(z.uuid("출처 id 가 올바르지 않습니다.")).max(L.citationsMax, `근거 출처는 ${L.citationsMax}개까지 연결할 수 있습니다.`),
  sortOrder: z.number().int(),
  excluded: z.boolean(),
});
const pageSchema = z.strictObject({
  id: z.uuid("페이지 id 가 올바르지 않습니다.").nullable(),
  title: z.string(),
  slug: z.string(),
  sortOrder: z.number().int(),
  sections: z.array(sectionSchema).min(1, "페이지마다 섹션이 1개 이상 있어야 합니다.").max(L.sectionsPerPageMax, `한 페이지의 섹션은 ${L.sectionsPerPageMax}개까지입니다(제외한 섹션 포함).`),
});

/** 저장 값: { status, pages } — 문서 전체를 한 번에 보낸다. 새 페이지·섹션은 id 를 null 로 */
export const webCopySaveSchema = z.strictObject({
  status: z.enum(WEB_COPY_STATUSES, "알 수 없는 진행 상태입니다."),
  pages: z
    .array(pageSchema)
    .min(1, "페이지가 1개 이상 있어야 합니다.")
    .max(L.pagesMax, `페이지는 ${L.pagesMax}개까지입니다.`)
    .refine((ps) => ps.reduce((n, p) => n + p.sections.length, 0) <= L.sectionsTotalMax, `섹션은 문서 전체 ${L.sectionsTotalMax}개까지입니다(제외한 섹션 포함).`),
});
export type WebCopySaveInput = z.infer<typeof webCopySaveSchema>;

/** 저장 값(camelCase) → DB 판 내용 pages(snake_case). 글 정리는 DB 가 한다 */
export function toDbPages(v: WebCopySaveInput) {
  return v.pages.map((p) => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    sort_order: p.sortOrder,
    sections: p.sections.map((s) => ({
      id: s.id,
      section_name: s.sectionName,
      purpose: s.purpose,
      headline: s.headline,
      body: s.body,
      cta_label: s.ctaLabel,
      cta_target: s.ctaTarget,
      citation_ids: s.citationIds,
      sort_order: s.sortOrder,
      excluded: s.excluded,
    })),
  }));
}

export interface WebCopySectionView {
  id: string;
  sectionName: string;
  purpose: string | null;
  headline: string;
  body: string | null;
  ctaLabel: string | null;
  ctaTarget: string | null;
  citationIds: string[];
  sortOrder: number;
  excluded: boolean;
}
export interface WebCopyPageView {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  sections: WebCopySectionView[];
}

type DbSection = { id: string; section_name: string; purpose: string | null; headline: string; body: string | null; cta_label: string | null; cta_target: string | null; citation_ids: string[]; sort_order: number; excluded: boolean };
type DbPage = { id: string; title: string; slug: string; sort_order: number; sections: DbSection[] };

/** DB 판 내용(snake_case) → 화면 보기(camelCase). 모양이 이상하면 빈 목록(서버가 CHECK 로 막으므로 오지 않는다) */
export function fromDbContent(content: unknown): WebCopyPageView[] {
  const pages = (content as { pages?: DbPage[] } | null)?.pages;
  if (!Array.isArray(pages)) return [];
  return pages.map((p) => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    sortOrder: p.sort_order,
    sections: (p.sections ?? []).map((s) => ({
      id: s.id,
      sectionName: s.section_name,
      purpose: s.purpose,
      headline: s.headline,
      body: s.body,
      ctaLabel: s.cta_label,
      ctaTarget: s.cta_target,
      citationIds: s.citation_ids ?? [],
      sortOrder: s.sort_order,
      excluded: s.excluded,
    })),
  }));
}

export const webCopyIssueMessage = funnelIssueMessage;

/** DB 오류 → 안내 문구. 한도(LIMIT_REACHED)는 VALIDATION 으로, DB 의 한글 문구는 그대로 */
export function webCopyErrorFromDb(message: string | null | undefined): { code: string; message: string } {
  const m = /^\s*LIMIT_REACHED:\s*(.*)$/s.exec(message ?? "");
  if (m && /[가-힣]/.test(m[1])) return { code: "VALIDATION", message: m[1].trim() };
  if (m) return { code: "VALIDATION", message: "한도에 이르렀습니다." };
  const e = funnelErrorFromDb(message);
  if (e.code === "NOT_FOUND") {
    const detail = /^\s*NOT_FOUND:\s*(.*)$/s.exec(message ?? "")?.[1]?.trim();
    return { code: e.code, message: detail && /[가-힣]/.test(detail) && detail.length <= 200 ? detail : "홈페이지 문서를 찾을 수 없습니다. 화면을 새로 고쳐 주세요." };
  }
  return e;
}
