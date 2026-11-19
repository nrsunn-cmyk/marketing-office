/**
 * P3D-UI-PREP-01 영상 구성·파일 관리 — 화면 쪽 모델(서버 없이 먼저 만든 자리).
 * 근거: AGY Design/p3-production/P3D-HANDOFF.md(한도·필드·상태·보관 archived_at 분리), video-plan.html(배치·라벨),
 * P3-COPY-FINAL.md 의 VP_COPY·P3_COMMON_COPY(그대로 — 새 문구를 만들지 않는다).
 * 영상 생성·편집·자막 합성은 하지 않는다(기획과 완성 파일 버전 관리만, 인계표 3절 1).
 */
import { briefTrim, charLength } from "@/domain/production-brief/constants";

export { P3_COMMON_COPY } from "./design-assets-model";

/** 한도(P3D-HANDOFF 1·2절, 글자 수는 코드 포인트) */
export const VIDEO_PLAN_LIMITS = {
  scenesMax: 30,
  fileVersionsMax: 20,
  assetsPerScene: 10,
  title: 120,
  sceneTitle: 80,
  durationMin: 1,
  durationMax: 600,
  narration: 1000,
  subtitle: 300,
  changeNote: 300,
} as const;

/** 화면 비율·용도(시안 라벨 그대로) */
export const VIDEO_ASPECTS = { "16:9": "16:9 (홈페이지·소개)", "9:16": "9:16 (숏폼·릴스)", "1:1": "1:1 (피드용)" } as const;
export type VideoAspect = keyof typeof VIDEO_ASPECTS;
export const VIDEO_ASPECT_KEYS = Object.keys(VIDEO_ASPECTS) as VideoAspect[];

export const VIDEO_PLAN_STATUSES = { drafting: "작성 중", reviewed: "검토 완료" } as const;
export type VideoPlanStatus = keyof typeof VIDEO_PLAN_STATUSES;
export const VIDEO_PLAN_STATUS_KEYS = Object.keys(VIDEO_PLAN_STATUSES) as VideoPlanStatus[];

// ── 자리용 보기 타입(서버 보기 타입이 오면 바꾼다) ──
export interface VideoSceneView {
  id: string | null; // 새로 추가해 저장 안 한 장면은 null
  sceneTitle: string;
  durationSec: number;
  narration: string;
  subtitle: string;
  assetIds: string[];
  sortOrder: number;
}
export interface VideoFileVersionView {
  version: number;
  fileName: string;
  fileSizeBytes: number;
  savedAt: string; // ISO
  note: string | null;
  current: boolean;
}
export interface VideoPlanView {
  id: string;
  title: string;
  aspectRatio: VideoAspect;
  status: VideoPlanStatus;
  archivedAt: string | null;
  revision: number;
  /** 계산: 기준(공통 제작 브리프·연결 자산)이 새 버전으로 바뀜 */
  stale: boolean;
  scenes: VideoSceneView[];
  files: VideoFileVersionView[];
}
/** 장면에 연결할 디자인 자산 고르기 목록(P3-c 자산) */
export interface VideoAssetOption {
  id: string;
  label: string;
}
export interface VideoPlanData {
  plan: VideoPlanView | null;
  canWrite: boolean;
  /** 만들 수 있는지(확정된 공통 제작 브리프 필요 등, 서버가 정한다) */
  canCreate: boolean;
  createBlockedReason: string | null;
  assets: VideoAssetOption[];
}

/** 화면 문구 최종본(P3-COPY-FINAL.md 2절 VP_COPY — 그대로) */
export const VP_COPY = {
  heading: "영상 구성·파일 관리",
  intro: "장면별 대사·자막·길이·사용 자산을 기획하고, 외부에서 제작한 영상 파일을 버전별로 첨부·관리합니다.",
  scopeNotice: "이 화면은 영상 구성안 작성과 완성 파일 버전 관리만 합니다. 앱 안에서 영상을 직접 생성하거나 편집하지는 않습니다.",
  emptyTitle: "아직 영상 구성안이 없습니다.",
  emptyDesc: "확정된 공통 제작 브리프를 바탕으로 장면 목록과 대사·자막 표를 만들고, 완성된 영상 파일을 첨부할 수 있습니다.",
  create: "+ 영상 구성안 만들기",
  sceneLimitReached: "장면은 30개까지 둘 수 있습니다. 불필요한 장면을 제외한 뒤 추가해 주세요.",
  fileLimitReached: "첨부 파일 버전은 20개까지 둘 수 있습니다.",
  staleBanner: "공통 제작 브리프 또는 연결된 디자인 자산이 새 버전으로 바뀌었습니다. 대사와 연결 자산을 확인해 주세요.",
  rebase: "최신 기준으로 맞추기",
  archivedNote: "보관한 영상 구성안입니다. 조회와 파일 내려받기만 할 수 있고 고치기·첨부는 할 수 없습니다.",
  noPermission: "영상 구성안이나 파일을 고칠 권한이 없습니다.",
  loadError: "영상 구성안을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  attachFile: "+ 새 영상 파일 첨부",
  save: "구성안 저장",
  archive: "이 구성안 보관",
  restore: "이 버전으로 되돌리기",
  savedOk: "영상 구성안을 저장했습니다.",
  attachedOk: "새 영상 파일 버전을 첨부했습니다.",
  archivedOk: "영상 구성안을 보관했습니다.",
} as const;

/** 시안 video-plan.html 의 라벨(AGY 문구 — 그대로) */
export const VP_LABELS = {
  stalePrefix: "이전 기준:",
  scopePrefix: "범위 안내:",
  title: "영상 제목",
  aspect: "화면 비율·용도",
  scenesHeading: "1. 장면 목록",
  addScene: "+ 장면 추가",
  up: "위로",
  down: "아래로",
  exclude: "제외",
  sceneTitle: "장면 이름",
  duration: "길이 (초, 1~600)",
  narration: "대사 / 내레이션",
  subtitle: "화면 자막",
  assets: "사용 디자인 자산 연결 (P3-c 자산 · 0~10개)",
  filesHeading: "2. 첨부 영상 파일 및 버전",
  allowedFormats: "허용 형식: MP4, MOV, WEBM (파일 크기·저장소 한도는 서버 정책 따름)",
  currentMark: "(현재)",
  currentVersion: "현재 버전",
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

/** 길이 합계(1~600 정수인 장면만 더함 — 잘못 적은 값은 합계에 넣지 않는다) */
export function totalSeconds(scenes: readonly VideoSceneView[]): number {
  return scenes.reduce((s, x) => s + (validDuration(x.durationSec) ? x.durationSec : 0), 0);
}
export const validDuration = (n: number) => Number.isInteger(n) && n >= VIDEO_PLAN_LIMITS.durationMin && n <= VIDEO_PLAN_LIMITS.durationMax;
/** "38초"·"1분 38초"·"2분" */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}
/** 시안 머리 배지 "총 38초 · 2장면" */
export const durationSummary = (scenes: readonly VideoSceneView[]) => `총 ${formatDuration(totalSeconds(scenes))} · ${scenes.length}장면`;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "크기 알 수 없음";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
export function formatKstMinute(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "시각 알 수 없음";
  const d = new Date(t + 9 * 3600 * 1000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} KST`;
}

// ── 장면 편집(새 배열, sortOrder 1부터 다시) ──
const renumber = (list: VideoSceneView[]) => list.map((x, i) => (x.sortOrder === i + 1 ? x : { ...x, sortOrder: i + 1 }));
export const sortedScenes = (list: readonly VideoSceneView[]) => [...list].sort((a, b) => a.sortOrder - b.sortOrder);
export function moveScene(list: readonly VideoSceneView[], index: number, dir: -1 | 1): VideoSceneView[] {
  const s = sortedScenes(list);
  const to = index + dir;
  if (index < 0 || index >= s.length || to < 0 || to >= s.length) return renumber(s);
  [s[index], s[to]] = [s[to], s[index]];
  return renumber(s);
}
/**
 * 제외: 인계표에 장면 '제외' 칸이 없어서(P3D-HANDOFF 2절 나) 구성안에서 그 장면을 뺀다(저장할 때 반영).
 * 장면은 1개 이상이어야 하므로 마지막 1개는 빼지 않는다.
 */
export function removeScene(list: readonly VideoSceneView[], index: number): VideoSceneView[] {
  const s = sortedScenes(list);
  if (s.length <= 1 || index < 0 || index >= s.length) return renumber(s);
  return renumber(s.filter((_, i) => i !== index));
}
export const emptyScene = (sortOrder: number): VideoSceneView => ({ id: null, sceneTitle: "", durationSec: 10, narration: "", subtitle: "", assetIds: [], sortOrder });
export const canAddScene = (list: readonly VideoSceneView[]) => list.length < VIDEO_PLAN_LIMITS.scenesMax;
export function addScene(list: readonly VideoSceneView[]): VideoSceneView[] {
  if (!canAddScene(list)) return renumber(sortedScenes(list));
  return renumber([...sortedScenes(list), emptyScene(list.length + 1)]);
}
export function toggleAsset(ids: readonly string[], id: string, on: boolean, allowed: readonly string[]): string[] {
  const set = new Set(ids.filter((x) => allowed.includes(x)));
  if (on) set.add(id);
  else set.delete(id);
  return allowed.filter((x) => set.has(x));
}

// ── 점검(미리 알림만, 값은 자르지 않음) ──
export type VideoPlanIssues = Record<string, string>;
export const sceneKey = (i: number, k: "sceneTitle" | "durationSec" | "narration" | "subtitle" | "assetIds") => `scene:${i}:${k}`;

export function checkVideoPlan(title: string, scenes: readonly VideoSceneView[], knownAssetIds: readonly string[]): VideoPlanIssues {
  const L = VIDEO_PLAN_LIMITS;
  const out: VideoPlanIssues = {};
  const t = countChars(title);
  if (t === 0) out.title = `${VP_LABELS.title}을(를) 입력해 주세요.`;
  else if (t > L.title) out.title = `${VP_LABELS.title}은(는) ${L.title}자까지 쓸 수 있습니다.`;
  if (scenes.length < 1) out.scenes = "장면이 1개 이상 있어야 합니다.";
  if (scenes.length > L.scenesMax) out.scenes = VP_COPY.sceneLimitReached;
  sortedScenes(scenes).forEach((s, i) => {
    const n = countChars(s.sceneTitle);
    if (n === 0) out[sceneKey(i, "sceneTitle")] = `${VP_LABELS.sceneTitle}을(를) 입력해 주세요.`;
    else if (n > L.sceneTitle) out[sceneKey(i, "sceneTitle")] = `${VP_LABELS.sceneTitle}은(는) ${L.sceneTitle}자까지 쓸 수 있습니다.`;
    if (!validDuration(s.durationSec)) out[sceneKey(i, "durationSec")] = "길이는 1초부터 600초까지 정수로 적어 주세요.";
    if (countChars(s.narration) > L.narration) out[sceneKey(i, "narration")] = `${VP_LABELS.narration}은(는) ${L.narration.toLocaleString("ko-KR")}자까지 쓸 수 있습니다.`;
    if (countChars(s.subtitle) > L.subtitle) out[sceneKey(i, "subtitle")] = `${VP_LABELS.subtitle}은(는) ${L.subtitle}자까지 쓸 수 있습니다.`;
    const unknown = s.assetIds.filter((x) => !knownAssetIds.includes(x)).length;
    if (s.assetIds.length > L.assetsPerScene) out[sceneKey(i, "assetIds")] = `디자인 자산은 ${L.assetsPerScene}개까지 연결할 수 있습니다.`;
    else if (unknown) out[sceneKey(i, "assetIds")] = `목록에 없는 자산 ${unknown}개가 연결되어 있습니다.`;
  });
  return out;
}

/** 서버로 보낼 값(자리용 이름 — 서버 계약이 오면 맞춘다). 값은 자르지 않는다 */
export function toVideoPlanPayload(v: { title: string; aspectRatio: VideoAspect; status: VideoPlanStatus; scenes: readonly VideoSceneView[] }) {
  return {
    title: v.title,
    aspectRatio: v.aspectRatio,
    status: v.status,
    scenes: sortedScenes(v.scenes).map((s, i) => ({ id: s.id, sceneTitle: s.sceneTitle, durationSec: s.durationSec, narration: s.narration, subtitle: s.subtitle, assetIds: [...s.assetIds], sortOrder: i + 1 })),
  };
}
