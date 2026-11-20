/**
 * P3D-BACKEND-IMPL-01: 영상 구성·파일 관리(P3-d) 순수 모듈. 입력 계약(camelCase) 검사·정리, 서명 메시지, 영상 형식 표식, DB 오류 → 안내 문구.
 * 값 범위의 최종 판정은 DB(20261121008000_p3d_video_plans)가 한다. 한도 숫자는 DB 와 같아야 한다(시험이 대조).
 */
import { z } from "zod";
import { charLength } from "@/domain/channel-draft/constants";
import { briefTrim } from "@/domain/production-brief/constants";

export const VIDEO_PLAN_LIMITS = {
  scenesMax: 30,
  fileVersionsMax: 20,
  planVersionsMax: 100,
  assetsPerScene: 10,
  activePlansPerBrief: 5,
  plansPerBrief: 10, // 보관 포함
  pendingUploadsPerWorkspace: 5,
  title: 120,
  sceneTitle: 80,
  durationMin: 1,
  durationMax: 600,
  narration: 1000,
  subtitle: 300,
  changeNote: 300,
  fileName: 200,
  /** 영상 파일 하나 상한(Master 결정 ①, 주인님 DEC-22 대기). DB app.video_file_max_bytes()·버킷 한도와 같은 값 */
  maxFileBytes: 50 * 1024 * 1024,
  /** 업무실 영상 총량(Master 결정 ③, 주인님 DEC-22 대기). DB app.video_file_quota_bytes() 와 같은 값 */
  workspaceQuotaBytes: 1024 * 1024 * 1024,
} as const;
const L = VIDEO_PLAN_LIMITS;

export const VIDEO_MIME_EXT = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" } as const;
export type VideoMime = keyof typeof VIDEO_MIME_EXT;
export const VIDEO_MIME_TYPES = Object.keys(VIDEO_MIME_EXT) as [VideoMime, ...VideoMime[]];
export const VIDEO_ASPECT_KEYS = ["16:9", "9:16", "1:1"] as const;
export const VIDEO_PLAN_STATUS_KEYS = ["drafting", "reviewed"] as const;
export const VIDEO_CLOSE_REASONS = ["TOO_LARGE", "UNSUPPORTED_TYPE", "TYPE_MISMATCH", "MISSING", "CANCELLED"] as const;
export type VideoCloseReason = (typeof VIDEO_CLOSE_REASONS)[number];
export const VIDEO_SIGNED_URL_SECONDS = 60;
export const VIDEO_DISABLED_MESSAGE = "영상 파일 첨부가 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요.";

// 글자 수는 코드 포인트(X9). 조사는 받침에 맞춘 확정 문구
const text = (max: number, obj: string, topic: string) =>
  z
    .string()
    .transform(briefTrim)
    .pipe(z.string().min(1, `${obj} 입력해 주세요.`).refine((s) => charLength(s) <= max, `${topic} ${max.toLocaleString("en-US")}자까지입니다.`));
const optionalText = (max: number, topic: string) =>
  z
    .string()
    .nullable()
    .transform((s) => (s === null ? null : briefTrim(s) || null))
    .pipe(z.string().refine((s) => charLength(s) <= max, `${topic} ${max.toLocaleString("en-US")}자까지입니다.`).nullable());

/** 장면 하나(Front VideoSceneView 에서 sortOrder 를 뺀 것. 순서는 배열 순서) */
export const videoSceneInputSchema = z.strictObject({
  id: z.uuid("장면 id 가 올바르지 않습니다.").nullable(),
  sceneTitle: text(L.sceneTitle, "장면 이름을", "장면 이름은"),
  durationSec: z
    .number("장면 길이는 1~600초 사이의 정수로 입력해 주세요.")
    .int("장면 길이는 1~600초 사이의 정수로 입력해 주세요.")
    .min(L.durationMin, "장면 길이는 1~600초 사이의 정수로 입력해 주세요.")
    .max(L.durationMax, "장면 길이는 1~600초 사이의 정수로 입력해 주세요."),
  narration: optionalText(L.narration, "대사 / 내레이션은"),
  subtitle: optionalText(L.subtitle, "화면 자막은"),
  assetIds: z.array(z.uuid("디자인 자산 id 가 올바르지 않습니다.")).max(L.assetsPerScene, `장면 하나에 디자인 자산은 ${L.assetsPerScene}개까지 연결할 수 있습니다.`),
});
const scenes = z
  .array(videoSceneInputSchema)
  .min(1, "장면은 1개 이상이어야 합니다.")
  .max(L.scenesMax, `장면은 ${L.scenesMax}개까지 둘 수 있습니다. 불필요한 장면을 제외한 뒤 추가해 주세요.`);

export const videoPlanCreateSchema = z.strictObject({
  productionBriefId: z.uuid("제작 브리프 id 가 올바르지 않습니다."),
  title: text(L.title, "영상 제목을", "영상 제목은"),
  aspectRatio: z.enum(VIDEO_ASPECT_KEYS, "알 수 없는 화면 비율입니다."),
  scenes,
});
export type VideoPlanCreateInput = z.infer<typeof videoPlanCreateSchema>;

export const videoPlanSaveSchema = z.strictObject({
  title: text(L.title, "영상 제목을", "영상 제목은"),
  aspectRatio: z.enum(VIDEO_ASPECT_KEYS, "알 수 없는 화면 비율입니다."),
  status: z.enum(VIDEO_PLAN_STATUS_KEYS, "알 수 없는 진행 상태입니다."),
  scenes,
});
export type VideoPlanSaveInput = z.infer<typeof videoPlanSaveSchema>;

export const videoUploadPrepareSchema = z.strictObject({
  planId: z.uuid("영상 구성안 id 가 올바르지 않습니다."),
  fileName: z
    .string()
    .transform(briefTrim)
    .pipe(z.string().min(1, "파일 이름이 없습니다.").refine((s) => charLength(s) <= L.fileName, `파일 이름은 ${L.fileName}자까지입니다.`)),
  size: z.number().int().positive(),
  mime: z.enum(VIDEO_MIME_TYPES, "MP4·MOV·WEBM 영상만 첨부할 수 있습니다."),
});
export type VideoUploadPrepareInput = z.infer<typeof videoUploadPrepareSchema>;

export const videoUploadFinishSchema = z.strictObject({
  uploadId: z.uuid("업로드 id 가 올바르지 않습니다."),
  changeNote: optionalText(L.changeNote, "버전 메모는"),
});

/** DB RPC 로 넘길 장면 JSON(snake_case). DB 가 id·자산 판 번호를 다시 정한다 */
export const toDbScenes = (list: z.infer<typeof scenes>) =>
  list.map((s) => ({ id: s.id, title: s.sceneTitle, duration_sec: s.durationSec, narration: s.narration, subtitle: s.subtitle, asset_ids: s.assetIds }));

/** 서명 메시지(DB app.assert_design_signature 의 메시지 부분과 같은 순서). 서명 = HMAC(키, 용도|메시지|서명시각), 용도는 video_file_* */
export const videoReserveMessage = (i: VideoUploadPrepareInput) => [i.planId, String(i.size), i.mime, i.fileName].join("|");
export const videoCloseMessage = (uploadId: string, reason: VideoCloseReason) => `${uploadId}|${reason}`;

/**
 * 영상 형식 표식(DS5): 앞 몇 바이트로 선언 형식과 맞는지 본다. 영상을 해석하지는 않는다.
 * - MP4: 4~8 바이트가 'ftyp'
 * - MOV: 'ftyp'(최신) 또는 옛 QuickTime 첫 상자 'moov'·'mdat'·'wide'·'free'·'skip'
 * - WEBM: EBML 머리 1A 45 DF A3
 */
export function videoSignatureOk(head: Uint8Array, mime: VideoMime): boolean {
  if (mime === "video/webm") return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  if (head.length < 8) return false;
  const box = String.fromCharCode(head[4], head[5], head[6], head[7]);
  return mime === "video/mp4" ? box === "ftyp" : ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(box);
}

export type VideoErrorCode = "VALIDATION" | "CONFLICT" | "NOT_FOUND" | "INVALID_TRANSITION" | "UPLOAD_FAILED" | "ERROR";
export interface VideoError {
  code: VideoErrorCode;
  message: string;
}
// 화면 문구(VP_COPY)처럼 마침표로 끝낸다
const hangulDetail = (d: string) => (/[가-힣]/.test(d) && d.length <= 200 ? (/[.?!]$/.test(d) ? d : `${d}.`) : null);

/** DB 오류 머리(예: "LIMIT_REACHED: …") → 앱 오류. 자세한 글은 DB 의 한글 문구를 쓴다(영어·긴 글은 버림) */
export function videoErrorFromDb(message: string | null | undefined): VideoError {
  const m = /^\s*([A-Z_]+):\s*(.*)$/s.exec(message ?? "");
  const head = m?.[1] ?? "";
  const detail = m?.[2]?.trim() ?? "";
  switch (head) {
    case "TOO_LARGE":
    case "UNSUPPORTED_TYPE":
    case "TYPE_MISMATCH":
    case "UPLOAD_MISSING":
    case "UPLOAD_EXPIRED":
    case "QUOTA_EXCEEDED":
      return { code: "UPLOAD_FAILED", message: hangulDetail(detail) ?? "영상 파일을 첨부하지 못했습니다." };
    case "LIMIT_REACHED":
    case "VALIDATION":
      return { code: "VALIDATION", message: hangulDetail(detail) ?? "입력값이 규칙에 맞지 않습니다." };
    case "INVALID_TRANSITION":
      return { code: "INVALID_TRANSITION", message: hangulDetail(detail) ?? "지금 상태에서는 할 수 없습니다." };
    case "FROZEN_COLUMN":
      return { code: "INVALID_TRANSITION", message: "보관한 영상 구성안은 고칠 수 없습니다." };
    case "CONFLICT":
      return { code: "CONFLICT", message: "다른 곳에서 먼저 수정되었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요." };
    case "NOT_FOUND":
      return { code: "NOT_FOUND", message: hangulDetail(detail) ?? "찾을 수 없습니다." };
    case "NOT_CONFIGURED":
    case "BAD_SIGNATURE":
      return { code: "ERROR", message: VIDEO_DISABLED_MESSAGE };
    default:
      return { code: "ERROR", message: "영상 구성안을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
