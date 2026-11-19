/**
 * P3C-BACKEND-IMPL-01: 디자인 자산(P3-c) 순수 모듈. 입력 계약(camelCase) 검사, DB 오류 → 안내 문구·업로드 실패 코드.
 * 값 범위의 최종 판정은 DB 가 한다. 여기서는 모양과 글 정리만 한다.
 */
import { z } from "zod";
import { briefTrim } from "@/domain/production-brief/constants";
import { DESIGN_ASSET_KIND_KEYS, DESIGN_ASSET_LIMITS as L, DESIGN_ASSET_STATUS_KEYS, DESIGN_MIME_TYPES, DESIGN_UPLOAD_ERROR_COPY_KEY, type DesignUploadErrorCode } from "./constants";

export * from "./constants";
export * from "./file-check";

// 조사는 받침에 맞춰 고정(Front josa.ts 와 같은 확정 문구): obj = "자산 이름을", topic = "자산 이름은"
const text = (max: number, obj: string, topic: string) =>
  z.string().transform(briefTrim).pipe(z.string().min(1, `${obj} 입력해 주세요.`).max(max, `${topic} ${max}자까지입니다.`));
const optionalText = (max: number, topic: string) =>
  z
    .string()
    .nullable()
    .transform((s) => (s === null ? null : briefTrim(s) || null))
    .pipe(z.string().max(max, `${topic} ${max}자까지입니다.`).nullable());

/** 1단계(올리기 준비): 브라우저가 고른 파일의 이름·크기·선언 형식. 실제 형식은 확정 때 서버가 바이트로 다시 본다 */
export const designUploadPrepareSchema = z.strictObject({
  productionBriefId: z.uuid("제작 브리프 id 가 올바르지 않습니다."),
  assetId: z.uuid("자산 id 가 올바르지 않습니다.").nullable(),
  kind: z.enum(DESIGN_ASSET_KIND_KEYS, "알 수 없는 자산 분류입니다."),
  fileName: z.string().transform(briefTrim).pipe(z.string().min(1, "파일 이름이 없습니다.").max(L.fileName, `파일 이름은 ${L.fileName}자까지입니다.`)),
  size: z.number().int().positive(),
  mime: z.enum(DESIGN_MIME_TYPES, "허용되지 않는 파일 형식입니다. 안내된 형식만 올려 주세요."),
});
export type DesignUploadPrepareInput = z.infer<typeof designUploadPrepareSchema>;

/** 2단계(확정·새 자산): Front toAssetPayload 의 title·licenseNote(+ origin 은 지금 external_upload 만) */
export const designAssetCreateSchema = z.strictObject({
  uploadId: z.uuid("업로드 id 가 올바르지 않습니다."),
  title: text(L.title, "자산 이름을", "자산 이름은"),
  licenseNote: optionalText(L.licenseNote, "라이선스·주의 메모는"),
  origin: z.literal("external_upload", "앱 내 생성은 아직 지원하지 않습니다."),
});
export type DesignAssetCreateInput = z.infer<typeof designAssetCreateSchema>;

/** 2단계(확정·교체) */
export const designAssetReplaceSchema = z.strictObject({
  uploadId: z.uuid("업로드 id 가 올바르지 않습니다."),
  changeNote: optionalText(L.changeNote, "바꾼 내용 메모는"),
});

/** 정보 저장: Front toAssetPayload { title, licenseNote, status } 그대로 */
export const designAssetUpdateSchema = z.strictObject({
  title: text(L.title, "자산 이름을", "자산 이름은"),
  licenseNote: optionalText(L.licenseNote, "라이선스·주의 메모는"),
  status: z.enum(DESIGN_ASSET_STATUS_KEYS, "알 수 없는 진행 상태입니다."),
});
export type DesignAssetUpdateInput = z.infer<typeof designAssetUpdateSchema>;

/** 사용처 목록(전체 교체) */
export const designAssetUsagesSchema = z
  .array(z.strictObject({ docId: z.uuid("홈페이지 문서 id 가 올바르지 않습니다."), sectionId: z.uuid("섹션 id 가 올바르지 않습니다.") }))
  .max(L.usagesPerAsset, `사용처는 자산당 ${L.usagesPerAsset}곳까지입니다.`);
export const toDbUsages = (u: z.infer<typeof designAssetUsagesSchema>) => u.map((x) => ({ doc_id: x.docId, section_id: x.sectionId }));

/** 업로드 실패 문구(AGY P3-COPY-FINAL DA_COPY upload* 확정 문구와 같은 글) */
export const DESIGN_UPLOAD_ERROR_MESSAGES: Record<DesignUploadErrorCode, string> = {
  TOO_LARGE: "파일 크기가 한도(10MB)를 넘어 올릴 수 없습니다.",
  UNSUPPORTED_TYPE: "허용되지 않는 파일 형식입니다. 안내된 형식만 올려 주세요.",
  UNSAFE_SVG: "보안상 위험한 요소(스크립트·외부 연결 등)가 들어 있는 SVG 파일은 올릴 수 없습니다. 위험 요소를 빼고 다시 저장하거나 PNG 파일로 올려 주세요.",
  TYPE_MISMATCH: "파일 실제 내용이 확장자와 달라 올릴 수 없습니다.",
  UPLOAD_MISSING: "네트워크 연결이 끊겨 올리기를 마칠 수 없습니다. 잠시 후 다시 시도해 주세요.",
  NETWORK: "네트워크 연결이 끊겨 올리기를 마칠 수 없습니다. 잠시 후 다시 시도해 주세요.",
  UPLOAD_EXPIRED: "올리기 링크 유효 시간이 지났습니다. 다시 시도를 누르면 새 링크로 올립니다.",
};
export const DESIGN_LIMIT_REACHED_MESSAGE = "디자인 자산이 50개라 더 올릴 수 없습니다. 쓰지 않는 자산을 보관한 뒤 다시 올려 주세요.";
export const DESIGN_DISABLED_MESSAGE = "디자인 자산 올리기가 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요.";

export type DesignErrorCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "INVALID_TRANSITION" | "UPLOAD_FAILED" | "ERROR";
export interface DesignError {
  code: DesignErrorCode;
  message: string;
  /** 업로드 실패일 때만: 화면이 DA_COPY 문구 키를 고를 수 있게 */
  uploadCode?: DesignUploadErrorCode;
  copyKey?: (typeof DESIGN_UPLOAD_ERROR_COPY_KEY)[DesignUploadErrorCode];
}

export const designUploadError = (c: DesignUploadErrorCode): DesignError => ({
  code: "UPLOAD_FAILED",
  message: DESIGN_UPLOAD_ERROR_MESSAGES[c],
  uploadCode: c,
  copyKey: DESIGN_UPLOAD_ERROR_COPY_KEY[c],
});

const hangulDetail = (d: string) => (/[가-힣]/.test(d) && d.length <= 200 ? (/[.다요]$/.test(d) ? d : `${d}.`) : null);

/** DB 오류 머리(예: "TYPE_MISMATCH: …") → 앱 오류 */
export function designErrorFromDb(message: string | null | undefined): DesignError {
  const m = /^\s*([A-Z_]+):\s*(.*)$/s.exec(message ?? "");
  const head = m?.[1] ?? "";
  const detail = m?.[2]?.trim() ?? "";
  if (head in DESIGN_UPLOAD_ERROR_COPY_KEY) return designUploadError(head as DesignUploadErrorCode);
  switch (head) {
    case "QUOTA_EXCEEDED":
      return { code: "UPLOAD_FAILED", message: hangulDetail(detail) ?? "업무실 저장 용량을 넘습니다." };
    case "LIMIT_REACHED":
      return { code: "VALIDATION", message: /프로젝트당 50개/.test(detail) ? DESIGN_LIMIT_REACHED_MESSAGE : (hangulDetail(detail) ?? "한도에 도달했습니다.") };
    case "CONFLICT":
      return { code: "CONFLICT", message: "다른 곳에서 먼저 수정되었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요." };
    case "NOT_FOUND":
      return { code: "NOT_FOUND", message: hangulDetail(detail) ?? "찾을 수 없습니다." };
    case "VALIDATION":
    case "INVALID_TRANSITION":
      return { code: head, message: hangulDetail(detail) ?? "입력값이 규칙에 맞지 않습니다." };
    case "FROZEN_COLUMN":
      return { code: "INVALID_TRANSITION", message: "보관한 디자인 자산은 고칠 수 없습니다." };
    case "NOT_CONFIGURED":
      return { code: "ERROR", message: DESIGN_DISABLED_MESSAGE };
    default:
      return { code: "ERROR", message: "디자인 자산을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/** 서명 메시지(DB app.assert_design_signature 와 같은 순서). 서명 = HMAC(키, 용도|메시지|서명시각) */
export const designReserveMessage = (i: DesignUploadPrepareInput) =>
  [i.productionBriefId, i.assetId ?? "", i.kind, String(i.size), i.mime, i.fileName].join("|");
export const designConfirmMessage = (uploadId: string, sha256: string) => `${uploadId}|${sha256}`;
export const designRejectMessage = (uploadId: string, reason: string) => `${uploadId}|${reason}`;

/** 판 JSON 에서 섹션 이름표(사용처 표시용). 섹션이 지금 판에 없으면 null(= 사라진 섹션) */
export function sectionLabel(content: unknown, sectionId: string): string | null {
  const pages = (content as { pages?: Array<{ title?: string; sections?: Array<{ id?: string; section_name?: string }> }> } | null)?.pages ?? [];
  for (const p of pages) for (const s of p.sections ?? []) if (s.id === sectionId) return `${p.title ?? "페이지"} · ${s.section_name ?? "섹션"}`;
  return null;
}
