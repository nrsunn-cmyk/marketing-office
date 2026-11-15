import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PASSWORD_HELP } from "@/contracts";
import { getSessionUser } from "@/server/auth/session";
import { AuthForm, EmailField, NewPasswordFields } from "../_components/auth-form";
import { AuthShell, authStyles as s } from "../_components/auth-shell";
import { signupAction } from "../login/actions";

export const metadata: Metadata = { title: "회원가입 · 마케팅 업무실" };

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <AuthShell
      icon="signup"
      title="회원가입"
      subtitle="허용 목록에 등록된 이메일로만 가입할 수 있습니다."
      badge="허용 계정 전용 등록"
      wide
      footer={
        <p>
          이미 계정이 있으신가요?{" "}
          <Link href="/login" className={s.link}>
            로그인으로 돌아가기
          </Link>
        </p>
      }
    >
      <Suspense fallback={null}>
        <SignupBody searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function SignupBody({ searchParams }: { searchParams: PageProps<"/signup">["searchParams"] }) {
  if (await getSessionUser()) redirect("/");
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
    <AuthForm action={signupAction} submitLabel="계정 만들기" pendingLabel="가입 중…" tone="success" icon="✓">
      <EmailField label="이메일 주소" help="업무실 관리자가 허용한 이메일이어야 합니다." />
      <NewPasswordFields help={PASSWORD_HELP} />
    </AuthForm>
  );
}
