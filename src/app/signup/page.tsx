import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PASSWORD_HELP } from "@/contracts";
import { getSessionUser, getSignedInHome } from "@/server/auth/session";
import { AuthForm, EmailField, NewPasswordFields } from "../_components/auth-form";
import { AuthShell, authStyles as s } from "../_components/auth-shell";
import { signupAction } from "../login/actions";

export const metadata: Metadata = { title: "회원가입 · 마케팅 업무실" };

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <AuthShell
      title="AI 마케팅 업무실"
      subtitle="새로운 업무실 계정을 만드세요. 허용된 이메일만 가입할 수 있습니다."
      tab="signup"
    >
      <Suspense fallback={null}>
        <SignupBody searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function SignupBody({ searchParams }: { searchParams: PageProps<"/signup">["searchParams"] }) {
  if (await getSessionUser()) redirect(await getSignedInHome());
  const params = await searchParams;
  if (params.sent === "1") {
    return (
      <p className={s.notice} role="status">
        확인 메일을 보냈습니다. 메일의 링크를 누르면 가입이 끝나고, 처음 로그인할 때 업무실 이름을 정합니다. 메일이 보이지 않으면
        스팸함도 확인해 주세요.
      </p>
    );
  }
  return (
    <AuthForm action={signupAction} submitLabel="회원가입" pendingLabel="가입 처리 중…">
      <EmailField help="업무실 관리자가 허용한 이메일이어야 합니다." />
      <NewPasswordFields help={PASSWORD_HELP} />
    </AuthForm>
  );
}
