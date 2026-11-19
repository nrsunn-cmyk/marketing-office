/**
 * P3C-BACKEND-IMPL-01: 디자인 자산 파일 검사(Q3·Q4·Q5). 이름·브라우저 MIME 은 믿지 않고 앞 바이트(내용)로 판정한다.
 * SVG 는 정제하지 않고, 위험 요소가 하나라도 있으면 거절한다(Master 결정 ②).
 */
import { DESIGN_KIND_MIMES, DESIGN_MIME_EXTENSIONS, designKindMaxBytes, type DesignAssetKind, type DesignMime } from "./constants";

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** UTF-8 글자(제어 문자 없음)면 글자로 돌려준다. 앞 BOM 은 뗀다 */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  for (const c of bytes) if (c === 0x00 || c < 0x09 || (c > 0x0d && c < 0x20 && c !== 0x1b)) return null;
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  } catch {
    return null;
  }
}

/** 앞 바이트로 형식을 판정한다(모르면 null). 글자 형식(SVG·JSON·CSS)은 내용 모양으로 가른다 */
export function detectDesignMime(bytes: Uint8Array): DesignMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("wOF2"))) return "font/woff2";
  if (startsWith(bytes, [0x00, 0x01, 0x00, 0x00]) || startsWith(bytes, ascii("true"))) return "font/ttf";
  if (startsWith(bytes, ascii("OTTO"))) return "font/otf";
  const text = decodeText(bytes);
  if (text === null) return null;
  if (isSvgText(text)) return "image/svg+xml";
  if (isJsonText(text)) return "application/json";
  if (isCssLike(text)) return "text/css";
  return null;
}

/** 앞 공백·<?xml …?>·주석을 지나 첫 태그가 <svg 인지 */
function isSvgText(s: string): boolean {
  let t = s.trimStart();
  for (;;) {
    if (t.startsWith("<?xml")) {
      const e = t.indexOf("?>");
      if (e < 0) return false;
      t = t.slice(e + 2).trimStart();
    } else if (t.startsWith("<!--")) {
      const e = t.indexOf("-->");
      if (e < 0) return false;
      t = t.slice(e + 3).trimStart();
    } else break;
  }
  return /^<svg[\s>/]/i.test(t);
}

function isJsonText(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/** CSS 는 서명이 없어 "HTML·스크립트가 아닌 글자 + 규칙 모양({ })"으로 본다 */
function isCssLike(s: string): boolean {
  if (/<\s*\/?\s*(html|script|body|svg|iframe|!doctype)/i.test(s)) return false;
  return /[{}]/.test(s) || /^\s*(@[a-z-]+|:root|--[a-z0-9-]+\s*:)/im.test(s);
}

/** SVG 위험 요소(Q4) — 하나라도 있으면 거절. 이유 이름을 돌려준다 */
export const SVG_DANGER_RULES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "script 태그", re: /<\s*script\b/i },
  { name: "on… 이벤트 속성", re: /[\s"'/]on[a-z]+\s*=/i },
  { name: "javascript: 주소", re: /j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/i },
  { name: "vbscript: 주소", re: /vbscript\s*:/i },
  { name: "data:text/html", re: /data\s*:\s*text\/html/i },
  { name: "foreignObject", re: /<\s*foreignObject\b/i },
  { name: "DOCTYPE·ENTITY", re: /<!\s*(doctype|entity)/i },
  { name: "iframe·embed·object", re: /<\s*(iframe|embed|object)\b/i },
  { name: "외부 href", re: /(?:xlink:)?href\s*=\s*["']\s*(?!#)[^"']*["']/i },
  { name: "외부 url()", re: /url\s*\(\s*["']?\s*(?!#)[a-z][a-z0-9+.-]*:/i },
  { name: "@import", re: /@import\b/i },
  { name: "set·animate 로 href 바꾸기", re: /<\s*(set|animate)\b[^>]*attributeName\s*=\s*["']?(?:xlink:)?href/i },
  { name: "글자 참조로 숨긴 코드", re: /&#(x0*(6a|4a|3c)|0*(106|74|60));/i },
];

export function svgDanger(text: string): string | null {
  for (const r of SVG_DANGER_RULES) if (r.re.test(text)) return r.name;
  return null;
}

export type DesignFileCheck =
  | { ok: true; mime: DesignMime }
  | { ok: false; code: "TOO_LARGE" | "UNSUPPORTED_TYPE" | "TYPE_MISMATCH" | "UNSAFE_SVG"; detail?: string };

export function extensionOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(fileName.trim());
  return m ? m[1].toLowerCase() : "";
}

/** 파일 이름 글자 규칙(DB app.design_file_name_ok 와 같음): 경로 구분자·'..'·제어 문자·글자 방향 바꾸기 문자 거절 */
const BAD_NAME = /[\\/\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]|\.\./;
// 확장자 앞 이름이 0자인 이름(".png")도 거절한다(Tester QA-P3C-BACKEND-01 O1)
export const designFileNameOk = (name: string) =>
  name.length >= 1 && Array.from(name).length <= 200 && name === name.trim() && !BAD_NAME.test(name) && !/^\.[A-Za-z0-9]+$/.test(name);

/** 예약 전(이름·크기·선언 형식만)과 확정 전(실제 바이트) 검사에 함께 쓴다 */
export function checkDesignDeclared(kind: DesignAssetKind, fileName: string, size: number, mime: string): DesignFileCheck {
  if (!(DESIGN_KIND_MIMES[kind] as readonly string[]).includes(mime)) return { ok: false, code: "UNSUPPORTED_TYPE" };
  if (!Number.isInteger(size) || size < 1 || size > designKindMaxBytes(kind)) return { ok: false, code: "TOO_LARGE" };
  if (!designFileNameOk(fileName) || !DESIGN_MIME_EXTENSIONS[mime as DesignMime].includes(extensionOf(fileName))) return { ok: false, code: "TYPE_MISMATCH" };
  return { ok: true, mime: mime as DesignMime };
}

/** 저장소에서 받은 실제 바이트 검사: 크기 → 내용 형식이 예약 형식과 같은지 → SVG 위험 요소 */
export function checkDesignBytes(kind: DesignAssetKind, expectedMime: DesignMime, bytes: Uint8Array): DesignFileCheck {
  if (bytes.length < 1 || bytes.length > designKindMaxBytes(kind)) return { ok: false, code: "TOO_LARGE" };
  const got = detectDesignMime(bytes);
  if (got === null) return { ok: false, code: "UNSUPPORTED_TYPE" };
  if (got !== expectedMime) return { ok: false, code: "TYPE_MISMATCH", detail: got };
  if (got === "image/svg+xml") {
    const why = svgDanger(decodeText(bytes) ?? "");
    if (why) return { ok: false, code: "UNSAFE_SVG", detail: why };
  }
  return { ok: true, mime: got };
}

/** 색상·토큰(JSON·CSS)은 화면에 적용하지 않고 글자로만 보여 준다(Q5). JSON 은 보기 좋게 정렬 */
export function designTextPreview(mime: DesignMime, bytes: Uint8Array, maxChars = 20_000): string | null {
  if (mime !== "application/json" && mime !== "text/css") return null;
  const s = decodeText(bytes);
  if (s === null) return null;
  let out = s;
  if (mime === "application/json") {
    try {
      out = JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return null;
    }
  }
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n…(이하 생략)` : out;
}
