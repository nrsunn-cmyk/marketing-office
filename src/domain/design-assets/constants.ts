/**
 * P3C-BACKEND-IMPL-01: 디자인 자산(P3-c) 값 규칙. DB migration 20261121004000 과 같은 값이다(최종 판정은 DB).
 * Front design-assets-model.ts DESIGN_ASSET_LIMITS(50/30/20, 100/200/500/300, 10MB)와 같다.
 */
export const DESIGN_ASSET_LIMITS = {
  perProject: 50, // 보관 포함
  versionsPerAsset: 30,
  usagesPerAsset: 20,
  pendingUploadsPerWorkspace: 20,
  title: 100,
  fileName: 200,
  licenseNote: 500,
  changeNote: 300,
  maxFileBytes: 10 * 1024 * 1024,
  maxColorFileBytes: 1024 * 1024,
} as const;

export const DESIGN_ASSET_KIND_KEYS = ["logo", "image", "color", "font"] as const;
export type DesignAssetKind = (typeof DESIGN_ASSET_KIND_KEYS)[number];
export const DESIGN_ASSET_STATUS_KEYS = ["drafting", "reviewed"] as const;
export type DesignAssetStatus = (typeof DESIGN_ASSET_STATUS_KEYS)[number];

export const DESIGN_MIME_TYPES = [
  "image/svg+xml", "image/png", "image/jpeg", "image/webp", "font/woff2", "font/ttf", "font/otf", "application/json", "text/css",
] as const;
export type DesignMime = (typeof DESIGN_MIME_TYPES)[number];

/** 분류별 허용 형식(Q3) */
export const DESIGN_KIND_MIMES: Record<DesignAssetKind, readonly DesignMime[]> = {
  logo: ["image/svg+xml", "image/png"],
  image: ["image/png", "image/jpeg", "image/webp"],
  font: ["font/woff2", "font/ttf", "font/otf"],
  color: ["application/json", "text/css"],
};

/** 형식별 허용 확장자(소문자) */
export const DESIGN_MIME_EXTENSIONS: Record<DesignMime, readonly string[]> = {
  "image/svg+xml": ["svg"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "font/woff2": ["woff2"],
  "font/ttf": ["ttf"],
  "font/otf": ["otf"],
  "application/json": ["json"],
  "text/css": ["css"],
};

export const designKindMaxBytes = (kind: DesignAssetKind) => (kind === "color" ? DESIGN_ASSET_LIMITS.maxColorFileBytes : DESIGN_ASSET_LIMITS.maxFileBytes);

/** 서명 URL 유효 시간(초): 내려받기 60(기존 자료와 같음), 미리보기 300 (Q6) */
export const DESIGN_SIGNED_URL_SECONDS = { download: 60, preview: 300 } as const;

/**
 * 업로드 실패 코드 → AGY DA_COPY 문구 키(P3-COPY-FINAL 1절 upload* 12키). 화면은 이 키로 확정 문구를 고른다.
 * UNSAFE_SVG 는 확정 문구가 따로 없어 형식 오류(uploadErrType)로 보인다(AGY 에 전용 문구 요청).
 */
export const DESIGN_UPLOAD_ERROR_COPY_KEY = {
  TOO_LARGE: "uploadErrSize",
  UNSUPPORTED_TYPE: "uploadErrType",
  UNSAFE_SVG: "uploadErrType",
  TYPE_MISMATCH: "uploadErrMismatch",
  UPLOAD_MISSING: "uploadErrNetwork",
  NETWORK: "uploadErrNetwork",
  UPLOAD_EXPIRED: "uploadErrExpired",
} as const;
export type DesignUploadErrorCode = keyof typeof DESIGN_UPLOAD_ERROR_COPY_KEY;
