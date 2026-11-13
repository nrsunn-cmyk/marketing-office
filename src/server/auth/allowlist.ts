/**
 * 로그인 허용 이메일 (C09). 본인 1명만 허용하는 것이 P1 기본.
 * 환경 변수 ALLOWED_USER_EMAILS 에 쉼표로 구분해 적는다.
 * 비어 있으면 아무도 허용하지 않는다(실수로 전체 공개되는 것을 막는다).
 */

export function parseAllowedEmails(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
}

export function isAllowedEmail(email: string | null | undefined, allowed: Set<string>): boolean {
  if (!email) return false;
  return allowed.has(email.trim().toLowerCase());
}

export function allowedEmailsFromEnv(): Set<string> {
  return parseAllowedEmails(process.env.ALLOWED_USER_EMAILS);
}
