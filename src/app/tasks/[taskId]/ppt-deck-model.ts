/**
 * P3-e PPT 구성·템플릿·내보내기 — 화면 쪽 모델.
 * 근거: AGY Design/p3-production/P3E-HANDOFF.md(한도·필드·상태·보관 archived_at 분리·내보내기), ppt-deck.html(배치·라벨),
 * P3-COPY-FINAL.md 3절 PPT_COPY·P3_COMMON_COPY(그대로 — 새 문구를 만들지 않는다).
 * P3E-UI-CONNECT-01: 보기 타입은 서버(src/features/ppt-decks/server.ts, Backend P3E-BACKEND-IMPL-01) 것.
 * 'use client' 편집기가 이 파일을 가져오므로 zod 를 쓰는 도메인 값은 가져오지 않는다(한도는 같은 값을 두고 시험으로 대조).
 */
import { briefTrim, charLength } from "@/domain/production-brief/constants";
import type {
  PptCreateBlockedCode,
  PptDeckData,
  PptDeckVersionView,
  PptDeckView,
  PptRebaseBlockedKey,
  PptSlideView,
  PptStaleReason,
} from "@/features/ppt-decks/server";
import { maxLengthMessage, requiredMessage } from "../../_components/josa";

export { P3_COMMON_COPY } from "./design-assets-model";
export type { PptCreateBlockedCode, PptDeckData, PptDeckVersionView, PptDeckView, PptRebaseBlockedKey, PptSlideView, PptStaleReason };
export type PptAssetOption = PptDeckData["assets"][number];

/** 한도(P3E-HANDOFF 1·2절, 글자 수는 코드 포인트). 서버 도메인 PPT_DECK_LIMITS 와 같은 값 — 시험이 대조 */
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

/** 템플릿(코드 = 서버 키, 이름·설명 = 시안 라벨 그대로) */
export const PPT_TEMPLATES = {
  royal_grid: { name: "테크 그리드 로열 블루", desc: "밝은 그리드 바탕 + 로열 블루 강조" },
  minimal_report: { name: "미니멀 보고서형", desc: "여백 중심 깔끔한 문서형" },
  brand_deck: { name: "브랜드 소개서형", desc: "큰 이미지와 핵심 숫자 강조" },
} as const;
export type PptTemplate = keyof typeof PPT_TEMPLATES;
export const PPT_TEMPLATE_KEYS = Object.keys(PPT_TEMPLATES) as PptTemplate[];

export const PPT_DECK_STATUSES = { drafting: "작성 중", reviewed: "검토 완료" } as const;
export type PptDeckStatus = keyof typeof PPT_DECK_STATUSES;
export const PPT_DECK_STATUS_KEYS = Object.keys(PPT_DECK_STATUSES) as PptDeckStatus[];

/** 화면 문구 최종본(P3-COPY-FINAL.md 3절 PPT_COPY — 그대로). {n} 이 있는 키는 같은 키 이름의 함수 */
export const PPT_COPY = {
  heading: "PPT 구성·템플릿·내보내기",
  intro: "슬라이드별 제목·요점·사용 디자인 자산을 구성하고 템플릿을 골라 내보냅니다.",
  exportNotice: "실제 .pptx 생성 방식과 템플릿 렌더링은 서버 기준을 따릅니다.",
  emptyTitle: "아직 PPT 구성안이 없습니다.",
  emptyDesc: "확정된 공통 제작 브리프를 바탕으로 기본 표지·목차·본문 슬라이드 뼈대를 바로 만들 수 있습니다.",
  create: "+ PPT 구성안 만들기",
  slideLimitReached: "슬라이드는 40장까지 둘 수 있습니다. 불필요한 슬라이드를 제외한 뒤 추가해 주세요.",
  staleBanner: "공통 제작 브리프 또는 연결된 디자인 자산이 새 판으로 바뀌었습니다. 슬라이드 요점과 연결 자산을 확인해 주세요.",
  rebase: "최신 기준으로 맞추기",
  archivedNote: "보관한 PPT 구성안입니다. 조회와 내보내기만 할 수 있고 고치기·추가는 할 수 없습니다.",
  noPermission: "PPT 구성안을 고칠 권한이 없습니다.",
  loadError: "PPT 구성안을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  exportPptx: ".pptx 내보내기",
  exportMd: ".md 구성안 내려받기",
  save: "구성안 저장",
  archive: "이 구성안 보관",
  restore: "이 판으로 되돌리기",
  savedOk: "PPT 구성안을 저장했습니다.",
  exportedOk: "PPT 구성 파일을 내려받았습니다.",
  archivedOk: "PPT 구성안을 보관했습니다.",
  restoredOk: "선택한 판의 PPT 구성안을 새 판으로 복원했습니다.",
  staleReasonBrief: "공통 제작 브리프가 새 판으로 바뀌었습니다. 슬라이드 제목과 요점을 확인해 주세요.",
  staleReasonAsset: (n: number) => `연결된 디자인 자산 ${n}개가 새 판으로 바뀌었습니다. 사용 자산을 확인해 주세요.`,
  archivedAssetsWarn: (n: number) => `연결된 디자인 자산 ${n}개가 보관되었습니다. 필요하면 다른 자산으로 바꿔 주세요.`,
  rebaseBlockedBriefArchived: "바탕 제작 브리프가 보관되어 최신 기준으로 맞출 수 없습니다.",
  rebaseBlockedBriefDraft: "바탕 제작 브리프가 아직 확정 전이라 최신 기준으로 맞출 수 없습니다.",
  rebaseBlockedVersionLimit: "PPT 구성안 판 이력이 20개에 도달해 최신 기준으로 맞출 수 없습니다.",
  versionLimitReached: "PPT 구성안 판 이력이 20개에 도달해 더 저장하거나 되돌릴 수 없습니다. 보관한 뒤 새 구성안으로 만들어 주세요.",
  planLimitReached: "PPT 구성안은 브리프당 활성 5개(전체 10개)까지 둘 수 있습니다.",
} as const;

/** 시안 ppt-deck.html 의 라벨(AGY 문구 — 그대로) */
export const PPT_LABELS = {
  stalePrefix: "이전 기준:",
  versionLimitPrefix: "판 20개 도달:",
  title: "발표 자료(PPT) 제목",
  template: "템플릿 선택 (16:9 기본)",
  slidesHeading: "슬라이드 목록",
  addSlide: "+ 슬라이드 추가",
  up: "위로",
  down: "아래로",
  exclude: "제외",
  slideTitle: "슬라이드 제목",
  bulletPoints: "핵심 요점",
  speakerNotes: "발표자 메모", // 인계표 2절 나 UI 라벨
  assets: "사용 디자인 자산 연결 (0~10개)",
  exportHeading: "내보내기 자리",
  status: "진행 상태",
  archivedBadge: "보관",
  staleBadge: "이전 기준",
  versionsHeading: (n: number) => `구성안 판 이력 · 되돌리기 (${n} / ${PPT_DECK_LIMITS.versionsMax}판 · 빼기 슬라이드 복구)`,
  versionsHint: "되돌리기를 누르면 과거 기록을 지우지 않고, 선택한 판의 내용(슬라이드 id 포함)을 새 버전으로 복원합니다.",
  currentMark: "(현재)",
  currentVersion: "현재 판",
  // 영상 구성(P3-d)과 같은 꼴 — 대표 구성안 1개만 그린다(P3E-HANDOFF 1절)
  representative: (active: number) => `대표 구성안 · 활성 ${active} / ${PPT_DECK_LIMITS.activeDecksPerBrief}개`,
} as const;
export const PPT_VERSION_KINDS = { create: "처음 만듦", save: "저장", restore: "되돌림", rebase: "최신 기준 맞춤" } as const;

// ── 표시 도우미 ──
export const countChars = (s: string) => charLength(briefTrim(s));
export function counterText(n: number, max: number): string {
  return `${n.toLocaleString("ko-KR")} / ${max.toLocaleString("ko-KR")}자`;
}
export const nearLimit = (n: number, max: number) => n >= Math.ceil(max * 0.9);
/** 시안 머리 배지 "슬라이드 2 / 40장" */
export const slideCountText = (n: number) => `슬라이드 ${n} / ${PPT_DECK_LIMITS.slidesMax}장`;
/** 판 저장 시각(한국 시간, 분까지) */
export function formatKstMinute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const k = new Date(d.getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())} KST`;
}

// ── 서버 값 → 화면 문구 ──
/** 원인별 이전 기준 안내(브리프·자산 {n}). 보관·stale 아님이면 없음. 자산 원인인데 0개(계약상 없음)면 공통 안내 */
export function pptStaleNotices(deck: Pick<PptDeckView, "stale" | "staleReasons" | "archivedAt" | "staleAssetCount">): string[] {
  if (!deck.stale || deck.archivedAt) return [];
  const out: string[] = [];
  if (deck.staleReasons.includes("brief")) out.push(PPT_COPY.staleReasonBrief);
  if (deck.staleReasons.includes("asset")) out.push(deck.staleAssetCount > 0 ? PPT_COPY.staleReasonAsset(deck.staleAssetCount) : PPT_COPY.staleBanner);
  return out;
}
/** 맞추기 막힘: 서버가 주는 값이 곧 PPT_COPY 문구 키 */
export const pptRebaseBlockedText = (key: PptRebaseBlockedKey | null): string | null => (key ? PPT_COPY[key] : null);
/** 만들기 막힘: 구성안 한도(deck_limit)는 PPT_COPY.planLimitReached, 그 밖은 서버 한글 사유 */
export const pptCreateBlockedText = (code: PptCreateBlockedCode | null, reason: string | null): string | null => (code === "deck_limit" ? PPT_COPY.planLimitReached : reason);
/** 내보내기 주소(경로 처리기 GET /ppt-decks/[deckId]/export). 옛 판은 version */
export function pptExportHref(deckId: string, format: "pptx" | "md", version?: number): string {
  const q = new URLSearchParams({ format });
  if (version !== undefined) q.set("version", String(version));
  return `/ppt-decks/${encodeURIComponent(deckId)}/export?${q.toString()}`;
}

// ── 슬라이드 편집(새 배열, sortOrder 1부터 다시) ──
const renumber = (list: PptSlideView[]) => list.map((x, i) => (x.sortOrder === i + 1 ? x : { ...x, sortOrder: i + 1 }));
export const sortedSlides = (list: readonly PptSlideView[]) => [...list].sort((a, b) => a.sortOrder - b.sortOrder);
export function moveSlide(list: readonly PptSlideView[], index: number, dir: -1 | 1): PptSlideView[] {
  const s = sortedSlides(list);
  const to = index + dir;
  if (index < 0 || index >= s.length || to < 0 || to >= s.length) return renumber(s);
  [s[index], s[to]] = [s[to], s[index]];
  return renumber(s);
}
/** 제외: 구성안에서 뺀다(저장할 때 반영, 되살리기는 판 되돌리기). 마지막 1장은 빼지 않는다 */
export function removeSlide(list: readonly PptSlideView[], index: number): PptSlideView[] {
  const s = sortedSlides(list);
  if (s.length <= 1 || index < 0 || index >= s.length) return renumber(s);
  return renumber(s.filter((_, i) => i !== index));
}
export const emptySlide = (sortOrder: number): PptSlideView => ({ id: null, slideTitle: "", bulletPoints: "", speakerNotes: "", assetIds: [], sortOrder });
export const canAddSlide = (list: readonly PptSlideView[]) => list.length < PPT_DECK_LIMITS.slidesMax;
export function addSlide(list: readonly PptSlideView[]): PptSlideView[] {
  if (!canAddSlide(list)) return renumber(sortedSlides(list));
  return renumber([...sortedSlides(list), emptySlide(list.length + 1)]);
}
export function toggleAsset(ids: readonly string[], id: string, on: boolean, allowed: readonly string[]): string[] {
  const set = new Set(ids.filter((x) => allowed.includes(x)));
  if (on) set.add(id);
  else set.delete(id);
  return allowed.filter((x) => set.has(x));
}

// ── 점검(미리 알림만, 값은 자르지 않음). 안내는 받침 맞춘 확정 형식(AGY DESIGN-REVIEW-P3C-UI-01 1번) ──
export type PptDeckIssues = Record<string, string>;
export const slideKey = (i: number, k: "slideTitle" | "bulletPoints" | "speakerNotes" | "assetIds") => `slide:${i}:${k}`;

export function checkPptDeck(title: string, slides: readonly PptSlideView[], knownAssetIds: readonly string[]): PptDeckIssues {
  const L = PPT_DECK_LIMITS;
  const out: PptDeckIssues = {};
  const t = countChars(title);
  if (t === 0) out.title = requiredMessage(PPT_LABELS.title);
  else if (t > L.title) out.title = maxLengthMessage(PPT_LABELS.title, L.title);
  if (slides.length > L.slidesMax) out.slides = PPT_COPY.slideLimitReached;
  sortedSlides(slides).forEach((s, i) => {
    const n = countChars(s.slideTitle);
    if (n === 0) out[slideKey(i, "slideTitle")] = requiredMessage(PPT_LABELS.slideTitle);
    else if (n > L.slideTitle) out[slideKey(i, "slideTitle")] = maxLengthMessage(PPT_LABELS.slideTitle, L.slideTitle);
    if (countChars(s.bulletPoints) > L.bulletPoints) out[slideKey(i, "bulletPoints")] = maxLengthMessage(PPT_LABELS.bulletPoints, L.bulletPoints);
    if (countChars(s.speakerNotes) > L.speakerNotes) out[slideKey(i, "speakerNotes")] = maxLengthMessage(PPT_LABELS.speakerNotes, L.speakerNotes);
    const unknown = s.assetIds.filter((x) => !knownAssetIds.includes(x)).length;
    if (s.assetIds.length > L.assetsPerSlide) out[slideKey(i, "assetIds")] = `디자인 자산은 ${L.assetsPerSlide}개까지 연결할 수 있습니다.`;
    else if (unknown) out[slideKey(i, "assetIds")] = `목록에 없는 자산 ${unknown}개가 연결되어 있습니다.`;
  });
  return out;
}

/**
 * 서버로 보낼 값(Backend 5절 계약): 슬라이드 id 는 받은 그대로(새 장만 null), sortOrder 는 보내지 않는다(배열 순서, 있으면 strict 거절).
 * 값은 자르지 않는다(검사는 서버 zod·DB)
 */
export function toPptDeckPayload(v: { title: string; templateKey: PptTemplate; status: PptDeckStatus; slides: readonly PptSlideView[] }) {
  return {
    title: v.title,
    templateKey: v.templateKey,
    status: v.status,
    slides: sortedSlides(v.slides).map((s) => ({ id: s.id, slideTitle: s.slideTitle, bulletPoints: s.bulletPoints, speakerNotes: s.speakerNotes, assetIds: [...s.assetIds] })),
  };
}
