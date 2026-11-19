/**
 * P3B-UI-PREP-01 홈페이지 구조·문구 — 화면 쪽 모델(서버 없이 먼저 만든 자리).
 * 근거: AGY Design/p3-production/P3B-HANDOFF.md(엔티티 한도·필드·상태·되돌리기), web-copy.html.
 *
 * 서버(Backend P3B)가 오면: 한도·허용값은 서버 도메인 상수로, 보기 타입은 서버 보기 타입으로,
 * toWebCopyPayload 의 칸 이름은 서버 입력 계약에 맞춘다. zod·서버 모듈은 가져오지 않는다.
 */
import { charLength } from "./production-brief-model";

export { charLength, counterText } from "./production-brief-model";

/** 한도(인계표 1·2절, 글자 수는 코드 포인트) */
export const WEB_COPY_LIMITS = {
  pagesMax: 10,
  sectionsPerPageMax: 12,
  sectionsTotalMax: 60,
  citationsMax: 10,
  pageTitle: 60,
  slug: 80,
  sectionName: 80,
  purpose: 200,
  headline: 160,
  body: 2000,
  ctaLabel: 60,
  ctaTarget: 200,
} as const;

export const WEB_COPY_STATUSES = {
  drafting: "작성 중",
  reviewed: "검토 완료",
  archived: "보관",
} as const;
export type WebCopyStatus = keyof typeof WEB_COPY_STATUSES;
export const WEB_COPY_EDITABLE_STATUSES = ["drafting", "reviewed"] as const satisfies readonly WebCopyStatus[];
export type WebCopyEditableStatus = (typeof WEB_COPY_EDITABLE_STATUSES)[number];

// ── 자리용 보기 타입(서버 보기 타입이 오면 바꾼다) ──
export interface WebCopySectionView {
  id: string | null; // 새로 추가해 아직 저장 안 한 섹션은 null
  sectionName: string;
  purpose: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaTarget: string;
  citationIds: string[];
  sortOrder: number;
  excluded: boolean;
}
export interface WebCopyPageView {
  id: string | null;
  title: string;
  slug: string;
  sortOrder: number;
  sections: WebCopySectionView[];
}
export interface WebCopyVersionView {
  version: number;
  status: WebCopyStatus;
  savedAt: string; // ISO
  note: string;
  current: boolean;
}
export interface WebCopyDocView {
  id: string;
  status: WebCopyStatus;
  revision: number;
  /** 지금 편집본의 버전 번호(v3 등) */
  version: number;
  /** 기준 제작 브리프 버전 */
  briefVersion: number | null;
  /** 계산: 기준 제작 브리프가 최신 확정본보다 앞섬 */
  stale: boolean;
  pages: WebCopyPageView[];
  versions: WebCopyVersionView[];
}
/** 근거 출처 고르기 목록(P2 리서치 출처) */
export interface WebCopySourceOption {
  id: string;
  label: string;
}
export interface WebCopySectionData {
  doc: WebCopyDocView | null;
  canCreate: boolean;
  createBlockedReason: string | null;
  /** 최신 확정 제작 브리프 버전 */
  latestBriefVersion: number | null;
  sources: WebCopySourceOption[];
}

// ── 섹션 칸(화면 순서) ──
export const SECTION_FIELDS = [
  { key: "sectionName", label: "섹션 이름", required: true, multiline: false, rows: 1, placeholder: "예: 히어로 (Hero)" },
  { key: "purpose", label: "섹션 목적", required: false, multiline: false, rows: 1, placeholder: "예: 첫 화면에서 누구를 위한 서비스인지 알린다" },
  { key: "headline", label: "헤드라인 문구", required: true, multiline: true, rows: 2, placeholder: "예: 대행사 없이도, 승인된 기준으로 끝까지" },
  { key: "body", label: "본문 문구", required: false, multiline: true, rows: 5, placeholder: "섹션 본문을 적어 주세요." },
  { key: "ctaLabel", label: "CTA 버튼 문구", required: false, multiline: false, rows: 1, placeholder: "예: 무료 상담 신청" },
  { key: "ctaTarget", label: "CTA 이동 대상", required: false, multiline: false, rows: 1, placeholder: "/contact 또는 https://…" },
] as const satisfies ReadonlyArray<{ key: keyof WebCopySectionView & keyof typeof WEB_COPY_LIMITS; label: string; required: boolean; multiline: boolean; rows: number; placeholder: string }>;
export type SectionFieldKey = (typeof SECTION_FIELDS)[number]["key"];

/** 경로: / 로 시작, 영소문자·숫자·- 와 / 로 나눈 조각. 홈은 "/" */
export const SLUG_RE = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;
export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s) && charLength(s) <= WEB_COPY_LIMITS.slug;
}
/** CTA 이동 대상 권장 형식(/경로 또는 https://) — 경고만, 막지 않는다 */
export function ctaTargetLooksOk(s: string): boolean {
  if (!s.trim()) return true;
  return /^\/\S*$/.test(s) || /^https:\/\/\S+$/.test(s);
}

// ── 편집 조작(새 배열을 돌려준다, sortOrder 는 1부터 다시 매김) ──
const renumber = <T extends { sortOrder: number }>(list: T[]): T[] => list.map((x, i) => (x.sortOrder === i + 1 ? x : { ...x, sortOrder: i + 1 }));
const bySort = <T extends { sortOrder: number }>(list: readonly T[]): T[] => [...list].sort((a, b) => a.sortOrder - b.sortOrder);

/** 섹션을 위(-1)·아래(+1)로 한 칸. 끝이면 그대로 */
export function moveSection(sections: readonly WebCopySectionView[], index: number, dir: -1 | 1): WebCopySectionView[] {
  const list = bySort(sections);
  const to = index + dir;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return renumber(list);
  [list[index], list[to]] = [list[to], list[index]];
  return renumber(list);
}
export function setExcluded(sections: readonly WebCopySectionView[], index: number, excluded: boolean): WebCopySectionView[] {
  return renumber(bySort(sections).map((s, i) => (i === index ? { ...s, excluded } : s)));
}
export const emptySection = (sortOrder: number): WebCopySectionView => ({
  id: null,
  sectionName: "",
  purpose: "",
  headline: "",
  body: "",
  ctaLabel: "",
  ctaTarget: "",
  citationIds: [],
  sortOrder,
  excluded: false,
});
export const totalSections = (pages: readonly WebCopyPageView[]) => pages.reduce((n, p) => n + p.sections.length, 0);
export function canAddSection(pages: readonly WebCopyPageView[], pageIndex: number): boolean {
  const p = pages[pageIndex];
  return Boolean(p) && p.sections.length < WEB_COPY_LIMITS.sectionsPerPageMax && totalSections(pages) < WEB_COPY_LIMITS.sectionsTotalMax;
}
export function addSection(pages: readonly WebCopyPageView[], pageIndex: number): WebCopyPageView[] {
  if (!canAddSection(pages, pageIndex)) return [...pages];
  return pages.map((p, i) => (i === pageIndex ? { ...p, sections: [...bySort(p.sections), emptySection(p.sections.length + 1)] } : p));
}
export const canAddPage = (pages: readonly WebCopyPageView[]) => pages.length < WEB_COPY_LIMITS.pagesMax;
/** 새 페이지: 이름 "새 페이지 n", 겹치지 않는 경로 /new-page-n, 빈 섹션 1개(페이지당 1개 이상) */
export function addPage(pages: readonly WebCopyPageView[]): WebCopyPageView[] {
  if (!canAddPage(pages) || totalSections(pages) >= WEB_COPY_LIMITS.sectionsTotalMax) return [...pages];
  const slugs = new Set(pages.map((p) => p.slug));
  let n = pages.length + 1;
  while (slugs.has(`/new-page-${n}`)) n++;
  return [...bySort(pages), { id: null, title: `새 페이지 ${n}`, slug: `/new-page-${n}`, sortOrder: pages.length + 1, sections: [emptySection(1)] }];
}
export function toggleCitation(ids: readonly string[], id: string, on: boolean, allowed: readonly string[]): string[] {
  const set = new Set(ids.filter((x) => allowed.includes(x)));
  if (on) set.add(id);
  else set.delete(id);
  return allowed.filter((x) => set.has(x));
}

// ── 점검(미리 알림만, 값은 자르지 않음. 저장 판단은 서버) ──
export type WebCopyIssues = Record<string, string>;
/** 칸 열쇠: page:{p}:title|slug, sec:{p}:{s}:{field}, doc:pages|sections */
export const pageKey = (p: number, k: "title" | "slug") => `page:${p}:${k}`;
export const secKey = (p: number, s: number, k: SectionFieldKey | "citationIds") => `sec:${p}:${s}:${k}`;

export function checkWebCopy(pages: readonly WebCopyPageView[], knownSourceIds: readonly string[]): WebCopyIssues {
  const L = WEB_COPY_LIMITS;
  const out: WebCopyIssues = {};
  if (pages.length < 1) out["doc:pages"] = "페이지가 1개 이상 있어야 합니다.";
  if (pages.length > L.pagesMax) out["doc:pages"] = `페이지는 ${L.pagesMax}개까지 만들 수 있습니다.`;
  if (totalSections(pages) > L.sectionsTotalMax) out["doc:sections"] = `섹션은 문서 전체에서 ${L.sectionsTotalMax}개까지 만들 수 있습니다.`;
  const seen = new Map<string, number>();
  bySort(pages).forEach((p, pi) => {
    if (!p.title.trim()) out[pageKey(pi, "title")] = "페이지 이름을 입력해 주세요.";
    else if (charLength(p.title) > L.pageTitle) out[pageKey(pi, "title")] = `페이지 이름은 ${L.pageTitle}자까지 쓸 수 있습니다.`;
    if (!isValidSlug(p.slug)) out[pageKey(pi, "slug")] = "경로는 / 로 시작하고 영소문자·숫자·- 만 쓸 수 있습니다(예: /about).";
    else if (seen.has(p.slug)) out[pageKey(pi, "slug")] = `경로 ${p.slug} 가 ${seen.get(p.slug)! + 1}번 페이지와 겹칩니다.`;
    seen.set(p.slug, seen.get(p.slug) ?? pi);
    if (p.sections.length < 1) out[`page:${pi}:sections`] = "페이지마다 섹션이 1개 이상 있어야 합니다.";
    if (p.sections.length > L.sectionsPerPageMax) out[`page:${pi}:sections`] = `섹션은 페이지당 ${L.sectionsPerPageMax}개까지입니다.`;
    bySort(p.sections).forEach((s, si) => {
      for (const f of SECTION_FIELDS) {
        const v = s[f.key];
        if (f.required && !v.trim()) out[secKey(pi, si, f.key)] = `${f.label}을(를) 입력해 주세요.`;
        else if (charLength(v) > L[f.key]) out[secKey(pi, si, f.key)] = `${f.label}은(는) ${L[f.key].toLocaleString("ko-KR")}자까지 쓸 수 있습니다.`;
      }
      if (!out[secKey(pi, si, "ctaTarget")] && !ctaTargetLooksOk(s.ctaTarget)) out[secKey(pi, si, "ctaTarget")] = "CTA 이동 대상은 /경로 또는 https:// 주소로 적어 주세요.";
      const unknown = s.citationIds.filter((id) => !knownSourceIds.includes(id)).length;
      if (s.citationIds.length > L.citationsMax) out[secKey(pi, si, "citationIds")] = `근거 출처는 ${L.citationsMax}개까지 연결할 수 있습니다.`;
      else if (unknown) out[secKey(pi, si, "citationIds")] = `목록에 없는 출처 ${unknown}개가 연결되어 있습니다(지워졌거나 다른 업무실 자료).`;
    });
  });
  return out;
}

/** 서버로 보낼 값(자리용 이름). 제외한 섹션도 지우지 않고 excluded 로 보낸다 */
export function toWebCopyPayload(status: WebCopyEditableStatus, pages: readonly WebCopyPageView[]) {
  return {
    status,
    pages: bySort(pages).map((p, pi) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      sortOrder: pi + 1,
      sections: bySort(p.sections).map((s, si) => ({
        id: s.id,
        sectionName: s.sectionName,
        purpose: s.purpose,
        headline: s.headline,
        body: s.body,
        ctaLabel: s.ctaLabel,
        ctaTarget: s.ctaTarget,
        citationIds: [...s.citationIds],
        sortOrder: si + 1,
        excluded: s.excluded,
      })),
    })),
  };
}
/** 보기 → 편집 값(정렬해서 번호를 1부터) */
export function docToEditor(doc: WebCopyDocView): { status: WebCopyEditableStatus; pages: WebCopyPageView[] } {
  return {
    status: doc.status === "reviewed" ? "reviewed" : "drafting",
    pages: renumber(bySort(doc.pages)).map((p) => ({ ...p, sections: renumber(bySort(p.sections)) })),
  };
}
export const sortedPages = (pages: readonly WebCopyPageView[]) => bySort(pages);
export const sortedSections = (sections: readonly WebCopySectionView[]) => bySort(sections);

/** "2026-11-20 03:20 KST" */
export function formatKstMinute(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "시각 알 수 없음";
  const d = new Date(t + 9 * 3600 * 1000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} KST`;
}

/** 확정 문구(AGY 시안 web-copy.html) */
export const WC_COPY = {
  heading: "홈페이지 구조·문구",
  intro: "확정된 공통 제작 브리프를 기준으로 페이지와 섹션 구조를 짜고, 근거 출처를 연결해 문구를 작성합니다.",
  emptyTitle: "아직 홈페이지 구조·문구 초안이 없습니다.",
  emptyDesc: "확정된 공통 제작 브리프가 있으면 기본 4페이지(홈·회사 소개·서비스 안내·문의) 뼈대로 시작할 수 있습니다.",
  create: "+ 홈페이지 구조·문구 시작하기",
  archivedNote: "보관한 홈페이지 문구 문서입니다. 조회만 가능하며 수정·되돌리기는 할 수 없습니다.",
  projectReadOnly: "보관한 프로젝트이거나 취소한 작업이라 홈페이지 구조·문구를 고칠 수 없습니다.",
  pageHint: "섹션 순서를 바꾸거나 문구·근거 출처를 연결할 수 있습니다.",
  addPage: "+ 페이지",
  addSection: "+ 섹션 추가",
  up: "위로",
  down: "아래로",
  exclude: "제외",
  include: "다시 포함",
  citationLegend: "근거·출처 연결 (P2 리서치 출처 패턴 · 선택)",
  citationHint: "수치나 주장을 쓸 때는 연결된 출처에 있는 내용만 사용합니다.",
  noSources: "연결할 수 있는 리서치 출처가 없습니다. 자료실에서 출처를 먼저 등록해 주세요.",
  save: "문구·구조 저장",
  archive: "이 문서 보관",
  versionsTitle: "버전 이력 (이전 판으로 되돌리기)",
  restore: "이 판으로 되돌리기",
  currentVersion: "현재 판",
  loadError: "홈페이지 구조·문구를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
} as const;

export function staleWebCopyText(latestBriefVersion: number | null): string {
  const v = latestBriefVersion ? `v${latestBriefVersion}로 ` : "";
  return `공통 제작 브리프가 ${v}새로 확정되었습니다. 페이지 구조와 문구가 최신 제작 브리프와 맞는지 확인해 주세요. 맞추지 않아도 고칠 수 있습니다.`;
}
export const rebaseLabel = (latestBriefVersion: number | null) => (latestBriefVersion ? `최신 제작 브리프(v${latestBriefVersion}) 기준으로 맞추기` : "최신 제작 브리프 기준으로 맞추기");
export const restoreHint = (nextVersion: number) => `되돌리기를 누르면 과거 기록을 지우지 않고, 선택한 판의 내용을 새 편집본(v${nextVersion})으로 복원합니다.`;
