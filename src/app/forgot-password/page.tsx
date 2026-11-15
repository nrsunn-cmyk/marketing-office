import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthForm, EmailField } from "../_components/auth-form";
import { AuthShell, authStyles as s } from "../_components/auth-shell";
import { forgotPasswordAction } from "../login/actions";

export const metadata: Metadata = { title: "비밀번호 찾기 · 마케팅 업무실" };

export default function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  return (
    <AuthShell
      icon="reset"
      title="비밀번호 찾기"
      subtitle="가입한 이메일을 입력하시면 비밀번호를 다시 정할 수 있는 링크를 보내 드립니다."
      footer={
        <Link href="/login" className={s.link}>
          ← 로그인 화면으로 돌아가기
        </Link>
      }
    >
      <Suspense fallback={null}>
        <ForgotBody searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function ForgotBody({ searchParams }: { searchParams: PageProps<"/forgot-password">["searchParams"] }) {
  const params = await searchParams;
  if (params.sent === "1") {
    return (
      <p className={s.notice} role="status">
        가입된 이메일이면 비밀번호 재설정 메일을 보냈습니다. 메일의 링크를 누르면 새 비밀번호를 정할 수 있습니다. 링크는 1시간
        동안 한 번만 쓸 수 있고, 요청한 브라우저에서 열어야 합니다.
      </p>
    );
  }
  return (
    <AuthForm action={forgotPasswordAction} submitLabel="재설정 메일 받기" pendingLabel="보내는 중…" tone="dark" icon="➜">
      <EmailField label="가입한 이메일 주소" />
    </AuthForm>
  );
}
