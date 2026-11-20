/**
 * QA-P3D-PREP-01(Tester): P3-d 영상 구성·파일 공격 시험이 쓰는 이름·인자·서명 형식·한도를 한곳에 모은다.
 * 근거: Plan/Claude-Backend-20261120/P3D-BACKEND-01-DESIGN.md + Master 8절 결정(서명 키는 P3-c design_asset_signing 공유, 용도 video_file_*, 크기 상한 50MB)
 *       Backend 구현 claude/p3d-video-backend(migration 20261121008000)의 선언. 바뀌면 이 파일만 고친다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const P3D = {
  migrationTable: "video_plans",
  tables: {
    plans: "video_plans",
    versions: "video_plan_versions",
    files: "video_file_versions",
    uploads: "video_file_uploads",
  },
  bucket: "video-files",
  auditEntity: "video_plan",
  /** 서명 키(P3-c 와 공유)와 용도. 서명 = hex HMAC-SHA256(비밀값, `${purpose}|${message}|${signedAtMs}`) */
  secretName: "design_asset_signing",
  purpose: {
    reserve: "video_file_reserve",
    confirm: "video_file_confirm",
    close: "video_file_close",
  },
  /** P3-c 용도(바꿔치기 시험용) */
  designPurpose: { reserve: "design_reserve", confirm: "design_confirm" },
  rpc: {
    create: "create_video_plan",
    save: "save_video_plan",
    restore: "restore_video_plan_version",
    rebase: "rebase_video_plan",
    archive: "archive_video_plan",
    reserve: "reserve_video_file_upload",
    confirm: "confirm_video_file_upload",
    close: "close_video_file_upload",
    restoreFile: "restore_video_file_version",
  },
  limits: {
    scenes: 30,
    durationMin: 1,
    durationMax: 600,
    planVersions: 100,
    fileVersions: 20,
    activePlans: 5,
    totalPlans: 10,
    pendingUploads: 5,
    assetsPerScene: 10,
    maxBytes: 50 * 1024 * 1024,
  },
  mimes: {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  } as Record<string, string>,
  deliverable: "video_plan",
  err: {
    badSig: /BAD_SIGNATURE/,
    notFound: /NOT_FOUND/,
    invalid: /INVALID_TRANSITION/,
    validation: /VALIDATION/,
    limit: /LIMIT_REACHED/,
    conflict: /CONFLICT/,
    mismatch: /TYPE_MISMATCH/,
    missing: /UPLOAD_MISSING/,
    reserve: /VALIDATION|TOO_LARGE|UNSUPPORTED_TYPE|TYPE_MISMATCH/,
    denied: /permission denied|row-level security|violates row-level/i,
    frozen: /IMMUTABLE_ROW|FROZEN_COLUMN|INVALID_TRANSITION|바꿀 수 없/i,
  },
  /** 앞 바이트 판정 모듈(단위 시험). 없으면 건너뛴다 */
  domainModule: "src/domain/video-plans/index.ts",
} as const;

/** 입력 장면(저장 RPC 가 받는 모양): asset_ids 만 보낸다. 판 번호는 서버가 찍는다 */
export type SceneIn = {
  id: string | null;
  title: string;
  duration_sec: unknown;
  narration: string | null;
  subtitle: string | null;
  asset_ids: string[];
};
export const scene = (i: number, o: Partial<SceneIn> = {}): SceneIn => ({
  id: null,
  title: `장면 ${i}`,
  duration_sec: 10,
  narration: null,
  subtitle: null,
  asset_ids: [],
  ...o,
});
export const scenes = (n: number) =>
  Array.from({ length: n }, (_, i) => scene(i + 1));

export const reserveMessage = (
  planId: string,
  size: number,
  mime: string,
  fileName: string,
) => [planId, String(size), mime, fileName].join("|");
export const confirmMessage = (uploadId: string) => uploadId;
export const closeMessage = (uploadId: string, reason: string) =>
  `${uploadId}|${reason}`;

export const sql = {
  create: (briefId: string, title: string, ratio: string, sc: unknown) => ({
    text: `select ${P3D.rpc.create}($1, $2, $3, $4::jsonb) as r`,
    params: [briefId, title, ratio, JSON.stringify(sc)],
  }),
  save: (
    planId: string,
    rev: number,
    title: string,
    ratio: string,
    status: string,
    sc: unknown,
  ) => ({
    text: `select ${P3D.rpc.save}($1, $2, $3, $4, $5, $6::jsonb) as r`,
    params: [planId, rev, title, ratio, status, JSON.stringify(sc)],
  }),
  restore: (planId: string, rev: number, v: number) => ({
    text: `select ${P3D.rpc.restore}($1, $2, $3) as r`,
    params: [planId, rev, v],
  }),
  rebase: (planId: string, rev: number) => ({
    text: `select ${P3D.rpc.rebase}($1, $2) as r`,
    params: [planId, rev],
  }),
  archive: (planId: string, rev: number) => ({
    text: `select ${P3D.rpc.archive}($1, $2) as r`,
    params: [planId, rev],
  }),
  reserve: (
    planId: string,
    name: string,
    size: number,
    mime: string,
    at: number,
    sig: string | null,
  ) => ({
    text: `select * from ${P3D.rpc.reserve}($1, $2, $3, $4, $5, $6)`,
    params: [planId, name, size, mime, at, sig],
  }),
  confirm: (
    uploadId: string,
    rev: number,
    note: string | null,
    at: number,
    sig: string | null,
  ) => ({
    text: `select ${P3D.rpc.confirm}($1, $2, $3, $4, $5) as r`,
    params: [uploadId, rev, note, at, sig],
  }),
  close: (
    uploadId: string,
    reason: string,
    at: number,
    sig: string | null,
  ) => ({
    text: `select ${P3D.rpc.close}($1, $2, $3, $4)`,
    params: [uploadId, reason, at, sig],
  }),
  restoreFile: (planId: string, rev: number, v: number) => ({
    text: `select ${P3D.rpc.restoreFile}($1, $2, $3) as r`,
    params: [planId, rev, v],
  }),
};

export function p3dMigrationPresent(): boolean {
  const dir = join(import.meta.dirname, "..", "..", "supabase", "migrations");
  const re = new RegExp(
    `create table (if not exists )?public\\.${P3D.migrationTable}\\b`,
    "i",
  );
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .some((f) => re.test(readFileSync(join(dir, f), "utf8")));
}
