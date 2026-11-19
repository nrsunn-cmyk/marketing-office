/**
 * P3-c 디자인 자산 관리 — 화면 쪽 모델(P3C-UI-PREP-01 → P3C-UI-CONNECT-01 서버 연결).
 * 근거: AGY Design/p3-production/P3C-HANDOFF.md, assets.html(배치·라벨·업로드 상태),
 * P3-COPY-FINAL.md 의 DA_COPY(업로드 12키·unsafeSvg·svgPreviewNotice 포함)·P3_COMMON_COPY(그대로 — 새 문구를 만들지 않는다).
 * 한도·형식 규칙은 서버 도메인 상수(@/domain/design-assets/constants·file-check, 서버 전용 코드 없음)를, 보기 타입은 서버 것을 쓴다.
 */
import { DESIGN_ASSET_LIMITS, DESIGN_KIND_MIMES, DESIGN_MIME_EXTENSIONS, DESIGN_MIME_TYPES, DESIGN_UPLOAD_ERROR_COPY_KEY, type DesignMime, type DesignUploadErrorCode } from "@/domain/design-assets/constants";
import { checkDesignDeclared, extensionOf } from "@/domain/design-assets/file-check";
import { briefTrim, charLength } from "@/domain/production-brief/constants";
import type { DesignAssetView, DesignAssetsData, DesignAssetVersionView } from "@/features/design-assets/server";
import { maxLengthMessage, requiredMessage } from "../../_components/josa";

export { DESIGN_ASSET_LIMITS };
export type { DesignAssetView, DesignAssetsData, DesignAssetVersionView };

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
  // 업로드·확정(실제 바이트 진행만, 임의 % 금지)
  uploadDropTitle: "여기에 파일을 끌어 놓거나 파일 고르기 단추를 눌러 주세요.",
  uploadPickFile: "파일 고르기",
  uploadCancel: "올리기 취소",
  uploadRetry: "다시 시도",
  uploadConfirming: "서버에서 파일 형식과 크기를 확인해 확정하는 중…",
  uploadErrSize: "파일 크기가 한도(10MB)를 넘어 올릴 수 없습니다.",
  uploadErrType: "허용되지 않는 파일 형식입니다. 안내된 형식만 올려 주세요.",
  uploadErrMismatch: "파일 실제 내용이 확장자와 달라 올릴 수 없습니다.",
  uploadErrNetwork: "네트워크 연결이 끊겨 올리기를 마칠 수 없습니다. 잠시 후 다시 시도해 주세요.",
  uploadErrExpired: "올리기 링크 유효 시간이 지났습니다. 다시 시도를 누르면 새 링크로 올립니다.",
  unsafeSvg: "보안상 위험한 요소(스크립트·외부 연결 등)가 들어 있는 SVG 파일은 올릴 수 없습니다. 위험 요소를 빼고 다시 저장하거나 PNG 파일로 올려 주세요.",
  svgPreviewNotice: "보안상 SVG 파일은 실행을 막기 위해 읽기 전용 이미지로만 미리 보며, 내려받을 때만 원본 파일로 받습니다.",
  // DESIGN-P3C-COPY-03: 확장자만 있는 이름·저장 용량(막대 없이 실제 숫자 글)
  uploadErrNameOnlyExt: "확장자만 있는 파일 이름은 사용할 수 없습니다. 파일 이름을 붙인 뒤 다시 올려 주세요.",
} as const;
/** storageUsed "사용 중 {used} / {limit}"(실측값, 막대 없음) */
export const storageUsedText = (used: number, limit: number) => `사용 중 ${formatBytes(used)} / ${formatBytes(limit)}`;
export const storageNearLimitText = (limit: number) => `업무실 디자인 자산 저장 용량(${formatBytes(limit)})이 거의 찼습니다. 쓰지 않는 자산을 정리해 주세요.`;
export const storageLimitReachedText = (limit: number) => `업무실 디자인 자산 저장 용량(${formatBytes(limit)})이 가득 차 더 올릴 수 없습니다. 쓰지 않는 자산을 정리한 뒤 다시 올려 주세요.`;

/**
 * 업무실 저장 용량(서버가 줄 때만 보인다 — Backend 요청 중). usedBytes = 모든 판의 서로 다른 파일 + 진행 중 예약 합,
 * limitBytes = app.design_asset_quota_bytes(). 서버가 아직 주지 않으면 null → 화면에 아무것도 안 보임.
 */
export type DesignStorage = { usedBytes: number; limitBytes: number };
export function storageOf(d: object): DesignStorage | null {
  const s = (d as { storage?: unknown }).storage as Partial<DesignStorage> | null | undefined;
  return s && Number.isFinite(s.usedBytes) && Number.isFinite(s.limitBytes) && (s.limitBytes as number) > 0 ? { usedBytes: s.usedBytes as number, limitBytes: s.limitBytes as number } : null;
}
/** 90% 이상이면 near, 한도 이상이면 full */
export function storageLevel(s: DesignStorage | null): "ok" | "near" | "full" | null {
  if (!s) return null;
  if (s.usedBytes >= s.limitBytes) return "full";
  return s.usedBytes >= s.limitBytes * 0.9 ? "near" : "ok";
}
/** uploadProgressBytes "{loaded} / {total} 올리는 중…"(실측 바이트) */
export const uploadProgressText = (loaded: number, total: number) => `${formatBytes(loaded)} / ${formatBytes(total)} 올리는 중…`;
/** 시안 업로드 안내 줄 "로고(SVG·PNG), … · 최대 10MB" */
export const UPLOAD_RULE_LINE = "로고(SVG·PNG), 이미지(PNG·JPEG·WEBP), 글꼴(WOFF2·TTF·OTF), 색상(JSON·CSS) · 최대 10MB";

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
  if (t === 0) out.title = requiredMessage(DA_LABELS.title);
  else if (t > L.title) out.title = maxLengthMessage(DA_LABELS.title, L.title);
  if (countChars(v.licenseNote) > L.licenseNote) out.licenseNote = maxLengthMessage(DA_LABELS.licenseNote, L.licenseNote);
  return out;
}
export const toAssetPayload = (v: DesignAssetFormValue) => ({ title: v.title, licenseNote: v.licenseNote, status: v.status });

// ── 올리기(P3C-UI-CONNECT-01) ──

/** 업로드 실패 → 확정 문구. 위험 SVG 는 서버 copyKey(uploadErrType) 대신 AGY unsafeSvg 를 쓴다. 모르는 키면 서버 문구 */
export function uploadErrorText(r: { message: string; uploadCode?: DesignUploadErrorCode | string; copyKey?: string }): string {
  if (r.uploadCode === "UNSAFE_SVG") return DA_COPY.unsafeSvg;
  const key = r.copyKey ?? (r.uploadCode && r.uploadCode in DESIGN_UPLOAD_ERROR_COPY_KEY ? DESIGN_UPLOAD_ERROR_COPY_KEY[r.uploadCode as DesignUploadErrorCode] : undefined);
  if (key && key in DA_COPY) return DA_COPY[key as keyof typeof DA_COPY];
  return r.message;
}

/** 브라우저 파일 형식(비어 있거나 다르면 확장자로). 서버가 확정 때 바이트로 다시 본다 */
export function guessMime(name: string, type: string): DesignMime | null {
  const t = type.toLowerCase();
  if ((DESIGN_MIME_TYPES as readonly string[]).includes(t)) return t as DesignMime;
  const ext = extensionOf(name);
  const hit = (Object.entries(DESIGN_MIME_EXTENSIONS) as [DesignMime, readonly string[]][]).find(([, exts]) => exts.includes(ext));
  return hit ? hit[0] : null;
}
/** 그 형식으로 고를 수 있는 분류(로고는 SVG·PNG, 이미지는 PNG·JPEG·WEBP …). 첫째가 기본 */
export const kindsForMime = (m: DesignMime | null): DesignAssetKind[] => (m ? DESIGN_ASSET_KIND_KEYS.filter((k) => DESIGN_KIND_MIMES[k].includes(m)) : []);

/** 올리기 전 미리 거르기(크기·형식·이름). 통과면 null, 아니면 확정 문구 */
export function precheckFile(kind: DesignAssetKind, file: { name: string; size: number; type: string }): string | null {
  // 확장자만 있는 이름(".png")은 서버도 거절한다(Backend 1bafec5, 서버는 형식 불일치 코드) — 화면은 전용 확정 문구로 먼저 알린다
  if (/^\.[A-Za-z0-9]+$/.test(file.name.trim())) return DA_COPY.uploadErrNameOnlyExt;
  const mime = guessMime(file.name, file.type);
  if (!mime) return DA_COPY.uploadErrType;
  const c = checkDesignDeclared(kind, file.name, file.size, mime);
  return c.ok ? null : uploadErrorText({ message: DA_COPY.uploadErrType, uploadCode: c.code });
}
/** 파일 이름에서 자산 이름 기본값(확장자 뺌, 100자까지 — 넘치면 칸 안내) */
export const titleFromFileName = (name: string) => name.replace(/\.[A-Za-z0-9]{1,8}$/, "");
