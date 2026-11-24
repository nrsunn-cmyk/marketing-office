/**
 * 로그인 후 돌아갈 주소 검사. 우리 사이트 안의 경로만 허용한다(외부 사이트로 보내는 공격 방지).
 * ADMIN-LOGIN-NEXT-DESIGN-01(F0·R1~R9) 근거: Plan/Claude-Backend-20261124/ADMIN-LOGIN-NEXT-DESIGN-01.md
 */

const BASE = "http://local.invalid";

/**
 * 정규화(new URL) 뒤 경로가 다른 사이트로 읽히는지. "/..//evil.com" 은 풀면 "//evil.com"(프로토콜 상대 주소)이 된다(F0).
 * 브라우저는 백슬래시를 슬래시로 읽으므로 "/\" 도 같이 본다.
 */
function escapesOrigin(pathname: string): boolean {
  return pathname.startsWith("//") || pathname.startsWith("/\\");
}

/**
 * 메일 링크 콜백(/auth/callback?next=…)용. next 값은 코드가 정한 값(/, /reset-password)이라 경로 목록은 걸지 않는다.
 * F0 고침: 원문 검사에 더해 정규화한 결과도 다시 검사한다.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\r\n\t]/.test(next)) return fallback;
  try {
    const u = new URL(next, BASE);
    if (u.origin !== BASE) return fallback;
    if (escapesOrigin(u.pathname)) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}

/** 로그인 뒤 돌아갈 수 있는 화면의 첫 경로 조각(설계 2-1, Master 확정 8경로). 인증 화면·/·/setup·내부 주소는 넣지 않는다 */
export const RETURN_PATH_ROOTS = ["admin", "workspace", "projects", "tasks", "clients", "assets", "results", "settings"] as const;
const ROOTS = new Set<string>(RETURN_PATH_ROOTS);

const MAX_LENGTH = 512;
const MAX_QUERY = 256;
const MAX_SEGMENTS = 6;
/** R2: 원문에 허용하는 글자. 백슬래시·공백·제어문자·@·:·따옴표·<>·한글은 받지 않는다 */
const RAW_CHARS = /^\/[A-Za-z0-9\-._~/?#=&%+]*$/;
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const HASH = /^#[A-Za-z0-9_-]{1,64}$/;
/** 점 조각("." "..")이나 인코딩된 "/" "\" "." */
const DOT_OR_ENCODED = /(^|\/)\.{1,2}(\/|$)|%(2f|5c|2e)/i;

/**
 * 로그인 화면 next(/login?next=…)용 엄격한 검사. 통과하면 정규화한 경로(+쿼리·해시), 아니면 null(부른 쪽이 기본 첫 화면으로).
 * R1 길이 · R2 글자 · R3 "//" · R4 같은 출처 · R5 정규화 뒤 재검사(// · %2f·%5c·%2e · 점 경로) · R6 조각 · R7 첫 조각 목록 · R8 쿼리 · R9 해시
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return null; // R1
  if (!RAW_CHARS.test(raw)) return null; // R2
  if (raw.startsWith("//")) return null; // R3
  // R5(원문): URL 이 점 조각을 먼저 풀어 버리므로 원문 경로 부분에서도 점 조각·인코딩 구분자를 거절한다
  const rawPath = raw.split(/[?#]/, 1)[0]!;
  if (DOT_OR_ENCODED.test(rawPath)) return null;
  let u: URL;
  try {
    u = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (u.origin !== BASE) return null; // R4
  const path = u.pathname;
  if (escapesOrigin(path) || DOT_OR_ENCODED.test(path)) return null; // R5(정규화 뒤)
  const segments = path.slice(1).split("/");
  if (segments.length > MAX_SEGMENTS || !segments.every((s) => SEGMENT.test(s))) return null; // R6(끝의 "/" 로 생긴 빈 조각도 거절)
  if (!ROOTS.has(segments[0]!)) return null; // R7
  if (u.search.length > MAX_QUERY) return null; // R8
  if (u.hash && !HASH.test(u.hash)) return null; // R9
  return path + u.search + u.hash;
}

/** 관리자 화면 경로(/admin 또는 /admin/…) */
export function isAdminReturnPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/") || path.startsWith("/admin?") || path.startsWith("/admin#");
}
