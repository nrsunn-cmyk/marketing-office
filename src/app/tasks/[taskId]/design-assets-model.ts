/**
 * P3C-UI-PREP-01 디자인 자산 관리 — 화면 쪽 모델(서버 없이 먼저 만든 자리).
 * 근거: AGY Design/p3-production/P3C-HANDOFF.md(한도·필드·상태·보관 archived_at 분리), assets.html(배치·라벨),
 * P3-COPY-FINAL.md 의 DA_COPY·P3_COMMON_COPY(화면 문구 최종본 — 그대로 쓴다, 새 문구를 만들지 않는다).
 *
 * 서버(Backend P3C)가 오면: 한도·허용값은 서버 도메인 상수로, 보기 타입은 서버 보기 타입으로 바꾼다.
 * 글자 수 정리는 P3-a 와 같은 briefTrim(서버 funnel_trim 과 같은 규칙)을 쓴다.
 */
import { briefTrim, charLength } from "@/domain/production-brief/constants";

/** 한도(P3C-HANDOFF 1·2절, 글자 수는 코드 포인트) */
export const DESIGN_ASSET_LIMITS = {
  perProject: 50, // 보관 포함
  versionsPerAsset: 30,
  usagesPerAsset: 20,
  title: 100,
  fileName: 200,
  licenseNote: 500,
  changeNote: 300,
  maxFileBytes: 10 * 1024 * 1024,
} as const;

/** 자산 분류(화면 순서 = 시안 필터 순서) */
export const DESIGN_ASSET_KINDS = { logo: "로고", image: "이미지", color: "색상", font: "글꼴" } as const;
export type DesignAssetKind = keyof typeof DESIGN_ASSET_KINDS;
export const DESIGN_ASSET_KIND_KEYS = Object.keys(DESIGN_ASSET_KINDS) as DesignAssetKind[];

/** 출처 구분 */
export const DESIGN_ASSET_ORIGINS = { external_upload: "외부 업로드", app_generated: "앱 내 생성" } as const;
export type DesignAssetOrigin = keyof typeof DESIGN_ASSET_ORIGINS;

/** 저장 상태 2종(보관은 archived_at 따로) */
export const DESIGN_ASSET_STATUSES = { drafting: "작성 중", reviewed: "검토 완료" } as const;
export type DesignAssetStatus = keyof typeof DESIGN_ASSET_STATUSES;
export const DESIGN_ASSET_STATUS_KEYS = Object.keys(DESIGN_ASSET_STATUSES) as DesignAssetStatus[];

// ── 자리용 보기 타입(서버 보기 타입이 오면 바꾼다) ──
export interface DesignAssetVersionView {
  version: number;
  savedAt: string; // ISO
  note: string | null;
  current: boolean;
}
export interface DesignAssetView {
  id: string;
  title: string;
  kind: DesignAssetKind;
  origin: DesignAssetOrigin;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  licenseNote: string | null;
  status: DesignAssetStatus;
  archivedAt: string | null;
  revision: number;
  /** 지금 버전 번호 */
  version: number;
  usages: Array<{ id: string; label: string }>;
  versions: DesignAssetVersionView[];
}
export interface DesignAssetsData {
  assets: DesignAssetView[];
  /** 기준(공통 제작 브리프·홈페이지 구조)이 새 버전으로 바뀌었는지(계산) */
  stale: boolean;
  /** 이 프로젝트 자산을 올리거나 고칠 권한 */
  canWrite: boolean;
  limit: number;
}

/** 화면 문구 최종본(P3-COPY-FINAL.md 1절 DA_COPY — 그대로) */
export const DA_COPY = {
  heading: "디자인 자산 관리",
  intro: "로고·이미지·색상·글꼴 자산을 외부 업로드와 앱 내 생성으로 구분하고, 사용처와 버전 이력을 관리합니다.",
  fileRuleNotice: "로고(SVG·PNG), 이미지(PNG·JPEG·WEBP), 글꼴(WOFF2·TTF·OTF), 색상(JSON·CSS)을 올릴 수 있습니다. 파일당 최대 10MB, 프로젝트당 50개까지 둘 수 있으며 실제 검사는 서버 기준을 따릅니다.",
  emptyTitle: "아직 등록된 디자인 자산이 없습니다.",
  emptyDesc: "외부 도구에서 만든 파일을 올리거나, 앱 안에서 만든 로고·이미지 산출물을 연결해 관리할 수 있습니다.",
  createUpload: "+ 외부 파일 올리기",
  createGenerated: "+ 앱 내 산출물 등록",
  limitReached: "디자인 자산이 50개라 더 올릴 수 없습니다. 쓰지 않는 자산을 보관한 뒤 다시 올려 주세요.",
  staleBanner: "공통 제작 브리프 또는 홈페이지 구조가 새 버전으로 바뀌었습니다. 자산 사용처와 톤이 최신 기준과 맞는지 확인해 주세요.",
  rebase: "최신 기준으로 맞추기",
  archivedNote: "보관한 자산입니다. 조회와 내려받기만 할 수 있고 고치기·교체는 할 수 없습니다.",
  noPermission: "이 프로젝트의 디자인 자산을 올리거나 고칠 권한이 없습니다.",
  loadError: "디자인 자산 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  save: "저장",
  replaceFile: "새 버전으로 교체",
  archive: "이 자산 보관",
  restore: "이 버전으로 되돌리기",
  savedOk: "디자인 자산 정보를 저장했습니다.",
  replacedOk: "새 파일 버전으로 교체했습니다.",
  archivedOk: "디자인 자산을 보관했습니다.",
  restoredOk: "선택한 파일 버전을 새 버전으로 복원했습니다.",
} as const;

/** P3-c~g 공통 문구 최종본(P3-COPY-FINAL.md 0절 P3_COMMON_COPY — 그대로) */
export const P3_COMMON_COPY = {
  projectReadOnly: "보관한 프로젝트이거나 취소한 작업이라 고칠 수 없습니다.",
  reload: "다시 불러오기",
  archiveConfirm: "보관하면 내용만 볼 수 있고 고칠 수 없습니다. 보관은 되돌릴 수 없습니다.",
  restoreHint: "되돌리기를 누르면 과거 기록을 지우지 않고, 선택한 판의 내용을 새 버전으로 복원합니다.",
  notConnected: "아직 서버와 연결되지 않아 저장할 수 없습니다.",
  savePending: "저장하는 중…",
  archivePending: "보관 중…",
  rebasePending: "맞추는 중…",
} as const;

/** 시안 assets.html 의 라벨(AGY 문구 — 그대로) */
export const DA_LABELS = {
  stalePrefix: "이전 기준:",
  filterAll: "전체",
  kindGroup: "자산 분류",
  detailsSummary: "버전·교체 이력 및 정보 고치기",
  usages: "사용처",
  noUsages: "아직 연결된 홈페이지 섹션·결과물이 없습니다.",
  currentVersionMark: "(현재)",
  inUse: "사용 중",
  title: "자산 이름",
  licenseNote: "라이선스·주의 메모",
  changeNote: "버전 교체 사유",
  status: "진행 상태",
  archivedBadge: "보관",
} as const;

// ── 표시 도우미 ──

/** 바이트 → "2.4 MB"·"12 KB"·"512 B" */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "크기 알 수 없음";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const MIME_LABEL: Record<string, string> = {
  "image/svg+xml": "SVG",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WEBP",
  "font/woff2": "WOFF2",
  "font/ttf": "TTF",
  "font/otf": "OTF",
  "application/json": "JSON",
  "text/css": "CSS",
};
/** 파일 형식 표시(MIME 우선, 모르면 확장자 대문자) */
export function fileFormatLabel(mimeType: string, fileName: string): string {
  const m = MIME_LABEL[mimeType.toLowerCase()];
  if (m) return m;
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(fileName)?.[1];
  return ext ? ext.toUpperCase() : "형식 알 수 없음";
}

/** 시안의 정보 줄: "분류: 로고 · 파일: a.svg (2.4 MB · SVG) · 라이선스: …" */
export function assetMetaLine(a: DesignAssetView): string {
  const parts = [`분류: ${DESIGN_ASSET_KINDS[a.kind] ?? a.kind}`, `파일: ${a.fileName} (${formatBytes(a.fileSizeBytes)} · ${fileFormatLabel(a.mimeType, a.fileName)})`];
  if (a.licenseNote) parts.push(`라이선스: ${a.licenseNote}`);
  return parts.join(" · ");
}

/** "2026-11-20 03:20 KST" */
export function formatKstMinute(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "시각 알 수 없음";
  const d = new Date(t + 9 * 3600 * 1000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} KST`;
}

/** 분류별 개수(전체 포함) */
export function kindCounts(assets: readonly DesignAssetView[]): Record<DesignAssetKind | "all", number> {
  const out = { all: assets.length, logo: 0, image: 0, color: 0, font: 0 };
  for (const a of assets) if (a.kind in out) out[a.kind]++;
  return out;
}
export const filterAssets = (assets: readonly DesignAssetView[], kind: DesignAssetKind | "all") => (kind === "all" ? [...assets] : assets.filter((a) => a.kind === kind));

/** 서버와 같은 정리 뒤 글자 수 */
export const countChars = (s: string) => charLength(briefTrim(s));
export function counterText(n: number, max: number): string {
  return `${n.toLocaleString("ko-KR")} / ${max.toLocaleString("ko-KR")}자`;
}
export const nearLimit = (n: number, max: number) => n >= Math.ceil(max * 0.9);

export interface DesignAssetFormValue {
  title: string;
  licenseNote: string;
  status: DesignAssetStatus;
}
export const assetToForm = (a: DesignAssetView): DesignAssetFormValue => ({ title: a.title, licenseNote: a.licenseNote ?? "", status: a.status });

/** 미리 알려 줄 문제(저장은 서버가 판단, 값은 자르지 않는다) */
export function checkAssetForm(v: DesignAssetFormValue): Partial<Record<"title" | "licenseNote", string>> {
  const L = DESIGN_ASSET_LIMITS;
  const out: Partial<Record<"title" | "licenseNote", string>> = {};
  const t = countChars(v.title);
  if (t === 0) out.title = `${DA_LABELS.title}을(를) 입력해 주세요.`;
  else if (t > L.title) out.title = `${DA_LABELS.title}은(는) ${L.title}자까지 쓸 수 있습니다.`;
  if (countChars(v.licenseNote) > L.licenseNote) out.licenseNote = `${DA_LABELS.licenseNote}은(는) ${L.licenseNote}자까지 쓸 수 있습니다.`;
  return out;
}
export const toAssetPayload = (v: DesignAssetFormValue) => ({ title: v.title, licenseNote: v.licenseNote, status: v.status });
