/**
 * SOURCE-UPLOAD-FIX-01: 자료 파일 직접 업로드(브라우저 → 저장소)의 순수 규칙. DB migration 20261121005000 과 같은 값이다.
 * 운영 Vercel 함수 요청 본문은 4.5MB 까지라 10MB 파일은 서버 액션으로 받을 수 없다. 그래서 브라우저가 서명 업로드 URL 로 직접 올리고,
 * 예약·확정·닫기는 서버 서명 RPC 로 묶는다(P3C 디자인 자산과 같은 방식).
 */
import { ALLOWED_TYPES, type AllowedMime } from "./file-check";

/** 저장 경로 확장자(DB app.source_mime_ext 와 같음, jpeg 는 jpg) */
export const SOURCE_MIME_EXT: Record<AllowedMime, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "text/plain": "txt",
};

export const isAllowedMime = (m: string): m is AllowedMime => m in ALLOWED_TYPES;

/** 경로(<업무실>/<예약id>/original.<확장자>)에서 형식을 읽는다. 모르는 확장자면 null */
export function sourceMimeOfKey(key: string): AllowedMime | null {
  const ext = /\/original\.([a-z]+)$/.exec(key)?.[1];
  const hit = (Object.entries(SOURCE_MIME_EXT) as [AllowedMime, string][]).find(([, e]) => e === ext);
  return hit ? hit[0] : null;
}

/** 서명 메시지(DB app.assert_source_signature 와 같은 순서). 서명 = HMAC(키, 용도|메시지|서명시각ms) */
export const sourceReserveMessage = (i: { clientId: string | null; projectId: string | null; size: number; mime: string; fileName: string }) =>
  [i.clientId ?? "", i.projectId ?? "", String(i.size), i.mime, i.fileName].join("|");
export const sourceConfirmMessage = (uploadId: string, sha256: string) => `${uploadId}|${sha256}`;
export const sourceRejectMessage = (uploadId: string, reason: string) => `${uploadId}|${reason}`;

export const SOURCE_UPLOAD_DISABLED_MESSAGE = "파일 올리기가 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요.";

/** 업로드 실패 코드 → 안내(기존 file-check 문구와 같은 글) */
export const SOURCE_UPLOAD_ERROR_MESSAGES = {
  EMPTY: "빈 파일은 올릴 수 없습니다.",
  TOO_LARGE: "파일은 10MB까지 올릴 수 있습니다.",
  UNSUPPORTED_TYPE: "PDF, PNG, JPEG, TXT 파일만 올릴 수 있습니다.",
  TYPE_MISMATCH: "파일 이름과 내용의 형식이 다릅니다. 확장자를 확인해 주세요.",
  UPLOAD_MISSING: "파일 올리기를 마치지 못했습니다. 연결을 확인한 뒤 다시 올려 주세요.",
  UPLOAD_EXPIRED: "올리기 유효 시간이 지났습니다. 파일을 다시 올려 주세요.",
  // 업무실당 진행 중 예약 20(DB LIMIT_REACHED). 화면이 글자 대신 코드로 알아보도록(Front SOURCE-UPLOAD-UI-01 제안)
  CONCURRENT_LIMIT: "진행 중인 업로드가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
} as const;
export type SourceUploadErrorCode = keyof typeof SOURCE_UPLOAD_ERROR_MESSAGES;

export interface SourceUploadError {
  code: "NOT_FOUND" | "VALIDATION" | "INVALID_TRANSITION" | "UPLOAD_FAILED" | "ERROR";
  message: string;
  uploadCode?: SourceUploadErrorCode;
}

const hangul = (d: string) => (/[가-힣]/.test(d) && d.length <= 200 ? (/[.다요]$/.test(d) ? d : `${d}.`) : null);

/** DB 오류 머리(예: "TOO_LARGE: …") → 앱 오류 */
export function sourceUploadErrorFromDb(message: string | null | undefined): SourceUploadError {
  const m = /^\s*([A-Z_]+):\s*(.*)$/s.exec(message ?? "");
  const head = m?.[1] ?? "";
  const detail = m?.[2]?.trim() ?? "";
  if (head in SOURCE_UPLOAD_ERROR_MESSAGES) {
    const c = head as SourceUploadErrorCode;
    return { code: "UPLOAD_FAILED", message: SOURCE_UPLOAD_ERROR_MESSAGES[c], uploadCode: c };
  }
  switch (head) {
    case "LIMIT_REACHED":
      return { code: "UPLOAD_FAILED", message: SOURCE_UPLOAD_ERROR_MESSAGES.CONCURRENT_LIMIT, uploadCode: "CONCURRENT_LIMIT" };
    case "NOT_FOUND":
      return { code: "NOT_FOUND", message: hangul(detail) ?? "찾을 수 없습니다." };
    case "VALIDATION":
    case "INVALID_TRANSITION":
      return { code: head, message: hangul(detail) ?? "입력값이 규칙에 맞지 않습니다." };
    case "NOT_CONFIGURED":
      return { code: "ERROR", message: SOURCE_UPLOAD_DISABLED_MESSAGE };
    default:
      return { code: "ERROR", message: "파일을 저장하지 못했습니다. 다시 올려 주세요." };
  }
}
