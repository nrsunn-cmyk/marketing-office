"use server";

import { redirect } from "next/navigation";
import { fieldErrors, type FormState } from "@/app/_components/form-state";
import { loginEmailSchema, loginInputSchema, passwordPairSchema, signupInputSchema } from "@/contracts";
import { allowedEmailsFromEnv, isAllowedEmail } from "@/server/auth/allowlist";
import { getSignedInHome, requireUser } from "@/server/auth/session";
import { siteUrl } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * 회원가입·이메일+비밀번호 로그인·비밀번호 찾기 (D03 변경, 2026-11-15 사용자 지시).
 * - 가입은 허용한 이메일만: 앱이 ALLOWED_USER_EMAILS 를 먼저 보고, DB도 signup_allowlist 로 다시 막는다.
 * - 가입하면 확인 메일의 링크를 눌러야 로그인할 수 있다.
 * - 로그인 실패 이유(계정 없음·비밀번호 틀림·허용 안 됨)는 같은 문구로 알려 준다(정보 누출 방지).
 */

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const normEmail = (fd: FormData) => text(fd, "email").trim().toLowerCase();

const LOGIN_FAILED = "이메일 또는 비밀번호가 올바르지 않습니다.";
const TRY_LATER = "잠시 후 다시 시도해 주세요.";

export async function loginAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = loginInputSchema.safeParse({ email: normEmail(fd), password: text(fd, "password") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error.issues) };
  const { email, password } = parsed.data;
  if (!isAllowedEmail(email, allowedEmailsFromEnv())) return { message: LOGIN_FAILED };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { message: "메일 인증이 아직 끝나지 않았습니다. 가입할 때 받은 메일의 링크를 눌러 주세요." };
    }
    if (error.code === "invalid_credentials") return { message: LOGIN_FAILED };
    console.error("[login] 로그인 실패:", error.status, error.code);
    return { message: error.status === 429 ? `요청이 너무 많습니다. ${TRY_LATER}` : `로그인하지 못했습니다. ${TRY_LATER}` };
  }
  redirect(await getSignedInHome());
}

export async function signupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = signupInputSchema.safeParse({
    email: normEmail(fd),
    password: text(fd, "password"),
    passwordConfirm: text(fd, "passwordConfirm"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error.issues) };
  const { email, password } = parsed.data;
  if (!isAllowedEmail(email, allowedEmailsFromEnv())) {
    return { message: "가입이 허용되지 않은 이메일입니다. 업무실 관리자에게 문의해 주세요." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${siteUrl()}/auth/callback?next=/` },
  });
  // 이미 가입된 이메일: 가입 여부를 알려 주지 않도록 새 가입과 같은 안내로 보낸다(메일은 가지 않는다).
  if (error?.code === "user_already_exists") redirect("/signup?sent=1");
  if (error) {
    // DB 허용 목록에 없으면 Supabase가 500(Database error saving new user)으로 거절한다
    console.error("[signup] 가입 실패:", error.status, error.code);
    if (error.code === "weak_password") return { errors: { password: "비밀번호가 너무 쉽습니다. 영문과 숫자를 섞어 8자 이상으로 정해 주세요." } };
    if (error.status === 429) return { message: `메일 발송 한도에 걸렸습니다. ${TRY_LATER}` };
    return { message: `가입하지 못했습니다. ${TRY_LATER}` };
  }
  // 이미 가입된 이메일이어도 같은 안내를 보낸다(Supabase도 이 경우 메일을 보내지 않고 성공처럼 응답한다).
  redirect("/signup?sent=1");
}

export async function forgotPasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = loginEmailSchema.safeParse(normEmail(fd));
  if (!parsed.success) return { errors: { email: parsed.error.issues[0]!.message } };
  const email = parsed.data;
  if (isAllowedEmail(email, allowedEmailsFromEnv())) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
    });
    if (error) console.error("[forgot] 재설정 메일 전송 실패:", error.status, error.code);
  }
  // 등록 여부를 알려 주지 않는다
  redirect("/forgot-password?sent=1");
}

export async function resetPasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = passwordPairSchema.safeParse({ password: text(fd, "password"), passwordConfirm: text(fd, "passwordConfirm") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error.issues) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { errors: { password: "지금 쓰는 비밀번호와 다른 비밀번호로 정해 주세요." } };
    if (error.code === "weak_password") return { errors: { password: "비밀번호가 너무 쉽습니다. 영문과 숫자를 섞어 8자 이상으로 정해 주세요." } };
    console.error("[reset] 비밀번호 변경 실패:", error.status, error.code);
    return { message: `비밀번호를 바꾸지 못했습니다. ${TRY_LATER}` };
  }
  return { ok: true, message: "비밀번호를 바꿨습니다. 다음부터 새 비밀번호로 로그인해 주세요." };
}
