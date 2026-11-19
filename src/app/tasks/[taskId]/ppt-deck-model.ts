/**
 * P3E-UI-PREP-01 PPT 구성·템플릿·내보내기 — 화면 쪽 모델(서버 없이 먼저 만든 자리).
 * 근거: AGY Design/p3-production/P3E-HANDOFF.md(한도·필드·상태·보관 archived_at 분리·내보내기 자리), ppt-deck.html(배치·라벨),
 * P3-COPY-FINAL.md 의 PPT_COPY·P3_COMMON_COPY(그대로 — 새 문구를 만들지 않는다).
 * 실제 .pptx 생성은 하지 않는다(내보내기 단추 자리만, 인계표 3절 1).
 */
import { briefTrim, charLength } from "@/domain/production-brief/constants";
import { maxLengthMessage, requiredMessage } from "../../_components/josa";

export { P3_COMMON_COPY } from "./design-assets-model";

/** 한도(P3E-HANDOFF 1·2절, 글자 수는 코드 포인트) */
export const PPT_DECK_LIMITS = {
  slidesMax: 40,
  assetsPerSlide: 10,
  title: 120,
  slideTitle: 100,
  bulletPoints: 1000,
  speakerNotes: 1000,
} as const;

/** 템플릿(코드 = 인계표, 이름·설명 = 시안 라벨 그대로) */
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

// ── 자리용 보기 타입(서버 보기 타입이 오면 바꾼다) ──
export interface PptSlideView {
  id: string | null; // 새로 추가해 저장 안 한 슬라이드는 null
  slideTitle: string;
  bulletPoints: string;
  speakerNotes: string;
  assetIds: string[];
  sortOrder: number;
}
export interface PptDeckView {
  id: string;
  title: string;
  templateKey: PptTemplate;
  status: PptDeckStatus;
  archivedAt: string | null;
  revision: number;
  /** 계산: 기준(공통 제작 브리프·연결 자산)이 새 버전으로 바뀜 */
  stale: boolean;
  slides: PptSlideView[];
}
export interface PptAssetOption {
  id: string;
  label: string;
}
export interface PptDeckData {
  deck: PptDeckView | null;
  canWrite: boolean;
  canCreate: boolean;
  createBlockedReason: string | null;
  assets: PptAssetOption[];
}

/** 화면 문구 최종본(P3-COPY-FINAL.md 3절 PPT_COPY — 그대로) */
export const PPT_COPY = {
  heading: "PPT 구성·템플릿·내보내기",
  intro: "슬라이드별 제목·요점·사용 디자인 자산을 구성하고 템플릿을 골라 내보냅니다.",
  exportNotice: "실제 .pptx 생성 방식과 템플릿 렌더링은 서버 기준을 따릅니다.",
  emptyTitle: "아직 PPT 구성안이 없습니다.",
  emptyDesc: "확정된 공통 제작 브리프를 바탕으로 기본 표지·목차·본문 슬라이드 뼈대를 바로 만들 수 있습니다.",
  create: "+ PPT 구성안 만들기",
  slideLimitReached: "슬라이드는 40장까지 둘 수 있습니다. 불필요한 슬라이드를 제외한 뒤 추가해 주세요.",
  staleBanner: "공통 제작 브리프 또는 연결된 디자인 자산이 새 버전으로 바뀌었습니다. 슬라이드 요점과 연결 자산을 확인해 주세요.",
  rebase: "최신 기준으로 맞추기",
  archivedNote: "보관한 PPT 구성안입니다. 조회와 내보내기만 할 수 있고 고치기·추가는 할 수 없습니다.",
  noPermission: "PPT 구성안을 고칠 권한이 없습니다.",
  loadError: "PPT 구성안을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  exportPptx: ".pptx 내보내기",
  exportMd: ".md 구성안 내려받기",
  save: "구성안 저장",
  archive: "이 구성안 보관",
  savedOk: "PPT 구성안을 저장했습니다.",
  exportedOk: "PPT 구성 파일을 내려받았습니다.",
  archivedOk: "PPT 구성안을 보관했습니다.",
} as const;

/** 시안 ppt-deck.html 의 라벨(AGY 문구 — 그대로) */
export const PPT_LABELS = {
  stalePrefix: "이전 기준:",
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
} as const;

// ── 표시 도우미 ──
export const countChars = (s: string) => charLength(briefTrim(s));
export function counterText(n: number, max: number): string {
  return `${n.toLocaleString("ko-KR")} / ${max.toLocaleString("ko-KR")}자`;
}
export const nearLimit = (n: number, max: number) => n >= Math.ceil(max * 0.9);
/** 시안 머리 배지 "슬라이드 2 / 40장" */
export const slideCountText = (n: number) => `슬라이드 ${n} / ${PPT_DECK_LIMITS.slidesMax}장`;

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
/** 제외: 인계표 슬라이드 칸에 제외가 없어 구성안에서 뺀다(저장할 때 반영). 마지막 1장은 빼지 않는다 */
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

/** 서버로 보낼 값(자리용 이름 — 서버 계약이 오면 맞춘다). 값은 자르지 않는다 */
export function toPptDeckPayload(v: { title: string; templateKey: PptTemplate; status: PptDeckStatus; slides: readonly PptSlideView[] }) {
  return {
    title: v.title,
    templateKey: v.templateKey,
    status: v.status,
    slides: sortedSlides(v.slides).map((s, i) => ({ id: s.id, slideTitle: s.slideTitle, bulletPoints: s.bulletPoints, speakerNotes: s.speakerNotes, assetIds: [...s.assetIds], sortOrder: i + 1 })),
  };
}
