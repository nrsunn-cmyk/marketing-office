/**
 * 로그인 후 돌아갈 주소. 우리 사이트 안의 경로만 허용한다(외부 사이트로 보내는 공격 방지).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\r\n\t]/.test(next)) return fallback;
  try {
    const u = new URL(next, "http://local.invalid");
    if (u.origin !== "http://local.invalid") return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
