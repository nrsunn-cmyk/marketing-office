import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { allowedEmailsFromEnv, isAllowedEmail } from "@/server/auth/allowlist";
import { safeNextPath } from "@/server/auth/redirect";
import { siteUrl } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * 메일 링크(가입 확인·비밀번호 재설정)가 돌아오는 곳. 두 가지 링크 모양을 받는다.
 * 1) ?code=…  : Supabase 기본 메일. 요청한 브라우저에 남은 확인값으로 세션을 만든다(PKCE).
 * 2) ?token_hash=…&type=… : 우리 메일 양식(supabase/templates). 다른 기기에서 열어도 된다.
 * 세션을 만든 뒤 허용 계정인지 다시 확인한다.
 */
const OTP_TYPES = new Set<EmailOtpType>(["signup", "email", "recovery", "invite", "email_change"]);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"));
  const to = (path: string) => NextResponse.redirect(new URL(path, siteUrl()));

  const supabase = await createSupabaseServerClient();
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  let email: string | undefined;
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) return to("/login?error=link_invalid");
    email = data.user.email;
  } else if (tokenHash && type && OTP_TYPES.has(type)) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error || !data.user) return to("/login?error=link_invalid");
    email = data.user.email;
  } else {
    return to("/login?error=link_invalid");
  }

  if (!isAllowedEmail(email, allowedEmailsFromEnv())) {
    await supabase.auth.signOut();
    return to("/login?error=not_allowed");
  }
  return to(next);
}
