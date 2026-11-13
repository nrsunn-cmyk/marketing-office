"use server";

import { redirect } from "next/navigation";
import { loginEmailSchema } from "@/contracts";
import { allowedEmailsFromEnv, isAllowedEmail } from "@/server/auth/allowlist";
import { siteUrl } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * 로그인 링크 요청. 허용된 이메일에만 메일을 보낸다.
 * 허용 여부·계정 존재 여부를 화면으로 알려 주지 않는다(F00: 정보 누출 방지).
 */
export async function requestLoginLink(formData: FormData): Promise<void> {
  const parsed = loginEmailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) redirect("/login?error=invalid_email");

  const email = parsed.data;
  if (isAllowedEmail(email, allowedEmailsFromEnv())) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${siteUrl()}/auth/callback` },
    });
    if (error) console.error("[login] 로그인 링크 전송 실패:", error.status, error.code);
  }
  redirect("/login?sent=1");
}
