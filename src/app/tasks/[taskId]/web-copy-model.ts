/**
 * P3B 홈페이지 구조·문구 — 화면 쪽 모델(P3B-UI-PREP-01 → P3B-UI-CONNECT-01 서버 연결).
 * 근거: AGY Design/p3-production/P3B-HANDOFF.md, web-copy.html, P3-COPY-FINAL.md 6절.
 * 한도·경로·CTA 규칙은 서버 도메인 상수(@/domain/web-copy/constants, DB 와 같은 값)를 그대로 쓴다.
 * 보기 타입은 서버(src/features/web-copy/server.ts) 것, 편집 값은 빈 칸을 ""로 둔 화면용 타입.
 * zod·서버 모듈은 가져오지 않는다(type 만).
 */
import { PUBLICATION_URL_RE } from "@/domain/channel-draft/constants";
import { CTA_PATH_RE, SLUG_RE, WEB_COPY_LIMITS } from "@/domain/web-copy/constants";
import type { WebCopyDocView } from "@/features/web-copy/server";
import { charLength } from "./production-brief-model";

export { charLength, counterText } from "./production-brief-model";
export { SLUG_RE, WEB_COPY_LIMITS };

export const WEB_COPY_STATUSES = {
  drafting: "작성 중",
  reviewed: "검토 완료",
  archived: "보관",
} as const;
export type WebCopyStatus = keyof typeof WEB_COPY_STATUSES;
export const WEB_COPY_EDITABLE_STATUSES = ["drafting", "reviewed"] as const satisfies readonly WebCopyStatus[];
export type WebCopyEditableStatus = (typeof WEB_COPY_EDITABLE_STATUSES)[number];

// ── 편집 값(서버 보기에서 빈 칸 null 을 ""로 바꾼 것). 새로 추가해 아직 저장 안 한 페이지·섹션은 id = null ──
export interface WebCopySectionView {
  id: string | null;
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
/** 근거 출처 고르기 목록(P2 리서치 출처) */
export interface WebCopySourceOption {
  id: string;
  label: string;
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

/** 경로: 홈 "/" 또는 한 단계 "/영소문자-숫자"(서버 SLUG_RE, Tester QA-P3B-PREP-01 Q1) */
export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s) && charLength(s) <= WEB_COPY_LIMITS.slug;
}
/**
 * CTA 이동 대상: 비우거나, 서버와 같은 '/경로'(CTA_PATH_RE) 또는 https 주소(PUBLICATION_URL_RE).
 * '//evil.com' 처럼 // 로 시작하는 주소(다른 사이트로 가는 상대 주소)는 거절(Tester QA-P3B-PREP-01 Q2). 최종 판단은 서버
 */
export function ctaTargetLooksOk(s: string): boolean {
  const v = s.trim();
  if (!v) return true;
  return CTA_PATH_RE.test(v) || PUBLICATION_URL_RE.test(v);
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
/** 서버 보기 → 편집 값(정렬해서 번호를 1부터, 빈 칸 null 은 ""). 페이지·섹션 id 는 그대로 둔다 — 빠지면 서버가 새 섹션으로 본다(Tester QA-P3B-BACKEND-01 O2) */
export function docToEditor(doc: Pick<WebCopyDocView, "status" | "pages">): { status: WebCopyEditableStatus; pages: WebCopyPageView[] } {
  return {
    status: doc.status === "reviewed" ? "reviewed" : "drafting",
    pages: renumber(bySort(doc.pages)).map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      sortOrder: p.sortOrder,
      sections: renumber(bySort(p.sections)).map((x) => ({
        id: x.id,
        sectionName: x.sectionName,
        purpose: x.purpose ?? "",
        headline: x.headline,
        body: x.body ?? "",
        ctaLabel: x.ctaLabel ?? "",
        ctaTarget: x.ctaTarget ?? "",
        citationIds: [...x.citationIds],
        sortOrder: x.sortOrder,
        excluded: x.excluded,
      })),
    })),
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
  // 원인별 안내(AGY P3-COPY-FINAL.md 6절, DESIGN-P3B-COPY-02)
  briefArchivedNotice: "바탕이 된 공통 제작 브리프가 보관되었습니다. 이 문서는 계속 고칠 수 있지만 최신 기준으로 맞추기는 할 수 없습니다.",
  staleBanner: "바탕이 된 공통 제작 브리프가 새 버전으로 바뀌었습니다. 페이지 문구와 연결된 근거가 최신 기준과 맞는지 확인해 주세요.",
  briefNotConfirmedNotice: "바탕이 된 공통 제작 브리프가 아직 확정 전이라 최신 기준으로 맞출 수 없습니다. 브리프 확정 후 다시 시도해 주세요.",
  rebase: "최신 제작 브리프 기준으로 맞추기",
  // 보관 문서 복사·판 100개(AGY P3-COPY-FINAL.md 6절 추가 3키)
  copyFromArchived: "보관한 문서 내용을 복사해 새로 만들기",
  copyFromArchivedHint: "보관한 문서나 판이 가득 찬 문서의 내용을 복사해 새 홈페이지 문서로 이어서 작업할 수 있습니다.",
  versionLimitReached: "판 이력이 100개에 도달해 더 저장하거나 되돌릴 수 없습니다. 보관한 뒤 내용을 복사해 새 문서로 만들어 주세요.",
} as const;

/** 되돌리려는 판에 지금 없는 출처가 n개(AGY 6절). 서버가 출처 재검사를 하게 되면 쓴다(Master: 출처 삭제 경로가 없어 지금은 검사 안 함) */
export const restoreMissingCitationsText = (n: number) => `되돌리려는 판에 지금은 없는 근거 출처가 ${n}개 있어 되돌릴 수 없습니다. 출처를 먼저 확인해 주세요.`;

/**
 * 바탕 브리프 안내(Master 최종 결정, Tester QA-P3B-BACKEND-01 O1): 서버 doc.stale·canRebase·rebaseBlockedReason 기준.
 * - 맞출 수 있음 → staleBanner + 맞추기 단추
 * - 막힘: 바탕 브리프 보관 → briefArchivedNotice 만(staleBanner 없음), 브리프 작성 중 → briefNotConfirmedNotice,
 *   판 100개 → 없음(화면이 versionLimitReached 를 따로 한 번 보인다), 그 밖 → 서버 문구
 * - 고칠 수 없는 문서(readOnlyReason)나 이전 기준이 아니면 없음
 */
export type WebCopyBriefNotice = { kind: "stale"; text: string; canRebase: true } | { kind: "archived" | "notConfirmed" | "other"; text: string; canRebase: false } | null;
export function webCopyBriefNotice(
  doc: Pick<WebCopyDocView, "stale" | "canRebase" | "rebaseBlockedReason" | "readOnlyReason"> & { versionsFull?: boolean },
  brief: { archived: boolean; status: string },
): WebCopyBriefNotice {
  if (!doc.stale || doc.readOnlyReason !== null) return null;
  if (doc.canRebase) return { kind: "stale", text: WC_COPY.staleBanner, canRebase: true };
  if (!doc.rebaseBlockedReason) return null;
  if (brief.archived) return { kind: "archived", text: WC_COPY.briefArchivedNotice, canRebase: false };
  if (brief.status !== "ready") return { kind: "notConfirmed", text: WC_COPY.briefNotConfirmedNotice, canRebase: false };
  if (doc.versionsFull) return null;
  return { kind: "other", text: doc.rebaseBlockedReason, canRebase: false };
}

/** 복사해 새로 만들 때 고르는 보관 문서 이름("v12 · 2026-11-20 03:20 KST 보관") */
export const archivedDocOption = (d: { currentVersionNo: number; archivedAt: string }) => `v${d.currentVersionNo} · ${formatKstMinute(d.archivedAt)} 보관`;

export const restoreHint = (nextVersion: number) => `되돌리기를 누르면 과거 기록을 지우지 않고, 선택한 판의 내용을 새 편집본(v${nextVersion})으로 복원합니다.`;
