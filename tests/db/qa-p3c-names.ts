/**
 * QA-P3C-PREP-01(Tester): P3-c 디자인 자산 공격 시험이 쓰는 이름·인자·서명 형식·한도를 한곳에 모은다.
 * 근거: Plan/Claude-Backend-20261120/P3C-BACKEND-01-DESIGN.md(1~4절)와 Backend 구현 초안(migration 31 20261121004000)의 선언.
 * 구현에서 이름·인자·서명 메시지가 바뀌면 이 파일만 고친다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const P3C = {
  migrationTable: "design_assets",
  tables: {
    assets: "design_assets",
    versions: "design_asset_versions",
    uploads: "design_asset_uploads",
    usages: "design_asset_usages",
  },
  bucket: "design-assets",
  auditEntity: "design_asset",
  secretName: "design_asset_signing",
  /** 서명 용도(purpose). 서명 = hex HMAC-SHA256(비밀값, `${purpose}|${message}|${signedAtMs}`), 서명 시각 ±5분 */
  purpose: {
    reserve: "design_reserve",
    confirm: "design_confirm",
    reject: "design_reject",
  },
  signWindowMs: 300_000,
  rpc: {
    reserve: "reserve_design_asset_upload",
    reject: "reject_design_asset_upload",
    create: "create_design_asset",
    replace: "replace_design_asset_file",
    update: "update_design_asset",
    restore: "restore_design_asset_version",
    rebase: "rebase_design_asset",
    archive: "archive_design_asset",
    usages: "set_design_asset_usages",
  },
  limits: {
    perProject: 50,
    versionsPerAsset: 30,
    usagesPerAsset: 20,
    pendingUploads: 20,
    title: 100,
    fileName: 200,
    licenseNote: 500,
    changeNote: 300,
    maxBytes: 10 * 1024 * 1024,
    colorMaxBytes: 1024 * 1024,
  },
  kinds: {
    logo: ["image/svg+xml", "image/png"],
    image: ["image/png", "image/jpeg", "image/webp"],
    font: ["font/woff2", "font/ttf", "font/otf"],
    color: ["application/json", "text/css"],
  } as Record<string, string[]>,
  ext: {
    "image/svg+xml": "svg",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "font/woff2": "woff2",
    "font/ttf": "ttf",
    "font/otf": "otf",
    "application/json": "json",
    "text/css": "css",
  } as Record<string, string>,
  /** 예약 경로: `<workspace_id>/design-assets/<upload_id>.<ext>` */
  keyRe: (ws: string) =>
    new RegExp(`^${ws}/design-assets/[0-9a-f-]{36}\\.[a-z0-9]+$`),
  err: {
    badSig: /BAD_SIGNATURE/,
    notFound: /NOT_FOUND/,
    invalid: /INVALID_TRANSITION/,
    validation: /VALIDATION|UNSUPPORTED_TYPE|TYPE_MISMATCH/,
    tooLarge: /TOO_LARGE|VALIDATION/,
    mismatch: /TYPE_MISMATCH/,
    missing: /UPLOAD_MISSING/,
    expired: /UPLOAD_EXPIRED|INVALID_TRANSITION/,
    limit: /LIMIT_REACHED/,
    conflict: /CONFLICT/,
    denied: /permission denied|row-level security|violates row-level/i,
    frozen: /IMMUTABLE_ROW|FROZEN_COLUMN|INVALID_TRANSITION|바꿀 수 없/i,
  },
  /** 도메인 파일 검사 모듈(단위 시험). 없으면 건너뛴다 */
  fileCheckModule: "src/domain/design-assets/file-check.ts",
} as const;

/** 예약 서명 메시지(구현: concat_ws('|', 브리프, 자산 또는 '', 분류, 크기, MIME, 파일 이름)) */
export const reserveMessage = (
  briefId: string,
  assetId: string | null,
  kind: string,
  size: number,
  mime: string,
  fileName: string,
) => [briefId, assetId ?? "", kind, String(size), mime, fileName].join("|");
/** 확정 서명 메시지(구현: concat_ws('|', upload_id, sha256)) */
export const confirmMessage = (uploadId: string, sha256: string) =>
  [uploadId, sha256].join("|");

export const sql = {
  reserve: (
    briefId: string,
    assetId: string | null,
    kind: string,
    fileName: string,
    size: number,
    mime: string,
    signedAt: number,
    sig: string | null,
  ) => ({
    text: `select * from ${P3C.rpc.reserve}($1, $2, $3, $4, $5, $6, $7, $8)`,
    params: [briefId, assetId, kind, fileName, size, mime, signedAt, sig],
  }),
  create: (
    uploadId: string,
    title: string,
    license: string | null,
    origin: string,
    sha: string,
    signedAt: number,
    sig: string | null,
  ) => ({
    text: `select ${P3C.rpc.create}($1, $2, $3, $4, $5, $6, $7) as id`,
    params: [uploadId, title, license, origin, sha, signedAt, sig],
  }),
  replace: (
    assetId: string,
    rev: number,
    uploadId: string,
    note: string | null,
    sha: string,
    signedAt: number,
    sig: string | null,
  ) => ({
    text: `select ${P3C.rpc.replace}($1, $2, $3, $4, $5, $6, $7) as r`,
    params: [assetId, rev, uploadId, note, sha, signedAt, sig],
  }),
  update: (
    assetId: string,
    rev: number,
    title: string,
    license: string | null,
    status: string,
  ) => ({
    text: `select ${P3C.rpc.update}($1, $2, $3, $4, $5) as r`,
    params: [assetId, rev, title, license, status],
  }),
  restore: (assetId: string, rev: number, versionNo: number) => ({
    text: `select ${P3C.rpc.restore}($1, $2, $3) as r`,
    params: [assetId, rev, versionNo],
  }),
  rebase: (assetId: string, rev: number) => ({
    text: `select ${P3C.rpc.rebase}($1, $2) as r`,
    params: [assetId, rev],
  }),
  archive: (assetId: string, rev: number) => ({
    text: `select ${P3C.rpc.archive}($1, $2) as r`,
    params: [assetId, rev],
  }),
  usages: (assetId: string, rev: number, usages: unknown) => ({
    text: `select ${P3C.rpc.usages}($1, $2, $3::jsonb) as r`,
    params: [assetId, rev, JSON.stringify(usages)],
  }),
};

export function p3cMigrationPresent(): boolean {
  const dir = join(import.meta.dirname, "..", "..", "supabase", "migrations");
  const re = new RegExp(
    `create table (if not exists )?public\\.${P3C.migrationTable}\\b`,
    "i",
  );
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .some((f) => re.test(readFileSync(join(dir, f), "utf8")));
}
