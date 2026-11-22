/**
 * P3E-BACKEND-IMPL-01: 내보내기 글 처리(순수). XML 이스케이프, 마크다운 이스케이프, 안전한 내려받기 파일 이름, 한국 시각.
 * 사용자 글은 반드시 이 함수들을 거쳐서만 파일에 들어간다(Tester ES1·ES2·ES6).
 */

/** XML 1.0 에 쓸 수 없는 글자: 제어 문자(탭·줄바꿈·CR 제외), U+FFFE·U+FFFF, 짝 없는 서로게이트 */
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** 요소 내용으로 넣을 글. 못 쓰는 글자를 빼고 & < > " ' 를 엔티티로 바꾼다. 속성값·CDATA 에는 사용자 글을 넣지 않는다 */
export function xmlText(s: string): string {
  return s
    .replace(XML_INVALID, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 마크다운에서 링크·이미지·HTML·강조·표·제목으로 해석될 수 있는 글자 앞에 \ 를 붙인다(그대로 보이게). 제어 문자도 뺀다.
 * 부르는 곳은 모두 한 줄 자리(머리글·표 칸·목록 항목)라 줄바꿈 글자(CR·LF)는 공백으로 바꾼다 — .md 는 LF 만, 새 머리글·목록이 생기지 않게
 * (P3DE-BACKEND-FIX-01, Tester QA-P3E-PREP-01 D3)
 */
export function mdText(s: string): string {
  return s.replace(/\r\n?|\n/g, " ").replace(XML_INVALID, "").replace(/[\\`*_{}[\]<>()#+\-.!|~=]/g, (c) => `\\${c}`);
}

/**
 * 안전한 내려받기 파일 이름(P2-g S10 과 같은 규칙, Tester ES6).
 * - 경로·예약 글자(\ / : * ? " < > |)·제어 문자·글자 방향 바꾸기 문자를 _ 로, '..' 도 _ 로
 * - 앞뒤 공백·점을 지우고 코드 포인트 60자로 자른다. 비면 fallback
 * - 확장자는 부르는 쪽이 붙인다(사용자 글이 확장자를 정하지 못하게)
 */
export function safeDownloadName(title: string, fallback: string, max = 60): string {
  const cleaned = title
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .replace(/[\\/:*?"<>|\u0000-\u001F\u007F‎‏‪-‮⁦-⁩]/g, "_")
    .replace(/\.{2,}/g, "_");
  const cut = [...cleaned].slice(0, max).join("").replace(/[\s.]+$/g, "");
  // 바꾼 뒤 _·공백·점만 남으면(의미 있는 글자가 없으면) 대체 이름
  return /^[_\s.]*$/.test(cut) ? fallback : cut;
}

/**
 * RFC 5987 ext-value 인코딩: attr-char(영숫자 ! # $ & + - . ^ _ ` | ~) 밖은 모두 %XX.
 * encodeURIComponent 는 * ' ( ) 를 그대로 두므로 따로 바꾼다(P3DE-BACKEND-FIX-01, Tester QA-P3E-PREP-01 D2)
 */
export function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(/[*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Content-Disposition(RFC 5987). ASCII 대체 이름에는 사용자 글을 넣지 않는다 */
export function attachmentHeader(fileName: string, asciiFallback: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(asciiFallback)) throw new Error("ASCII 대체 이름이 올바르지 않습니다");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${rfc5987(fileName)}`;
}

/** 한국 시각 'YYYY-MM-DD HH:mm' */
export function kstMinute(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}
