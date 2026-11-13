import { NextResponse, type NextRequest } from "next/server";
import { allowedEmailsFromEnv, isAllowedEmail } from "@/server/auth/allowlist";
import { safeNextPath } from "@/server/auth/redirect";
import { siteUrl } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** 메일의 로그인 링크가 돌아오는 곳. 일회용 코드를 세션으로 바꾼 뒤 허용 계정인지 다시 확인한다. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const to = (path: string) => NextResponse.redirect(new URL(path, siteUrl()));

  if (!code) return to("/login?error=link_invalid");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return to("/login?error=link_invalid");

  if (!isAllowedEmail(data.user.email, allowedEmailsFromEnv())) {
    await supabase.auth.signOut();
    return to("/login?error=not_allowed");
  }
  return to(next);
}
