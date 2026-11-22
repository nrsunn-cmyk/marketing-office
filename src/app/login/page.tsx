import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/server/auth/session";
import { AuthForm, EmailField, PasswordField } from "../_components/auth-form";
import { AuthShell, authStyles as s } from "../_components/auth-shell";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "로그인 · 마케팅 업무실" };

/** 메일 링크(가입 확인·비밀번호 재설정)에서 돌아왔을 때의 안내 */
const ERRORS: Record<string, string> = {
  link_invalid:
    "링크를 쓸 수 없습니다. 만료되었거나 이미 사용된 링크일 수 있고, 메일 종류에 따라 요청한 브라우저에서만 열리는 링크도 있습니다. 비밀번호 재설정이었다면 새 링크를 받아 주세요. 가입 확인 메일이었다면 인증은 끝났을 수 있으니 로그인해 보세요.",
  not_allowed: "이 계정은 이 업무실에 접근할 수 없습니다.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthShell
      title={<>AI 마케팅 <em>업무실</em></>}
      subtitle="업무실 계정(이메일·비밀번호)으로 로그인하세요."
      tab="login"
      footer="허용된 이메일 계정으로 안전하게 로그인합니다."
    >
      <Suspense fallback={null}>
        <LoginStatus searchParams={searchParams} />
      </Suspense>
      <AuthForm action={loginAction} submitLabel="로그인" pendingLabel="로그인 중…">
        <EmailField />
        <PasswordField
          name="password"
          label="비밀번호"
          autoComplete="current-password"
          placeholder="비밀번호"
          labelLink={{ href: "/forgot-password", text: "비밀번호 찾기" }}
        />
      </AuthForm>
    </AuthShell>
  );
}

/** 요청마다 달라지는 부분: 이미 로그인했는지, 메일 링크에서 돌아온 안내 */
async function LoginStatus({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  if (await getSessionUser()) redirect("/");
  const params = await searchParams;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  return (
    <div className={s.statusArea}>
      {params.confirmed === "1" && (
        <p className={s.notice} role="status">
          메일 인증이 끝났습니다. 로그인해 주세요.
        </p>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
