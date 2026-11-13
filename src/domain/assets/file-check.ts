/**
 * 업로드 파일 검사 (D05 제안: PDF·PNG·JPEG·TXT, 10MB).
 * 이름(확장자)만 믿지 않고 파일 앞부분의 실제 내용(시그니처)으로 형식을 확인한다 (T04 형식 위장).
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ALLOWED_TYPES = {
  "application/pdf": { extensions: ["pdf"], label: "PDF" },
  "image/png": { extensions: ["png"], label: "PNG" },
  "image/jpeg": { extensions: ["jpg", "jpeg"], label: "JPEG" },
  "text/plain": { extensions: ["txt"], label: "텍스트" },
} as const;

export type AllowedMime = keyof typeof ALLOWED_TYPES;

export type FileCheckResult =
  | { ok: true; mime: AllowedMime; extension: string }
  | { ok: false; code: "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "TYPE_MISMATCH"; message: string };

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

/** 내용으로 형식을 판정한다. 모르는 형식이면 null. */
export function detectMime(bytes: Uint8Array): AllowedMime | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (isPlainText(bytes)) return "text/plain";
  return null;
}

/** NUL·제어 문자 없이 올바른 UTF-8이면 텍스트로 본다. */
function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  for (const b of bytes) {
    if (b === 0x00) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b)) return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function extensionOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(fileName.trim());
  return m ? m[1].toLowerCase() : "";
}

export function checkUploadFile(fileName: string, bytes: Uint8Array): FileCheckResult {
  if (bytes.length === 0) return { ok: false, code: "EMPTY", message: "빈 파일은 올릴 수 없습니다." };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, code: "TOO_LARGE", message: "파일은 10MB까지 올릴 수 있습니다." };
  }
  const ext = extensionOf(fileName);
  const declared = (Object.keys(ALLOWED_TYPES) as AllowedMime[]).find((m) =>
    (ALLOWED_TYPES[m].extensions as readonly string[]).includes(ext),
  );
  if (!declared) {
    return { ok: false, code: "UNSUPPORTED_TYPE", message: "PDF, PNG, JPEG, TXT 파일만 올릴 수 있습니다." };
  }
  const actual = detectMime(bytes);
  if (actual !== declared) {
    return {
      ok: false,
      code: "TYPE_MISMATCH",
      message: `파일 이름은 ${ALLOWED_TYPES[declared].label}인데 내용이 다른 형식입니다.`,
    };
  }
  return { ok: true, mime: actual, extension: ext === "jpeg" ? "jpg" : ext };
}

/** 화면 표시용 파일 이름 정리 (경로 구분자·제어 문자 제거, 길이 제한). 저장소 경로에는 쓰지 않는다. */
export function displayFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "파일").slice(0, 200);
}
