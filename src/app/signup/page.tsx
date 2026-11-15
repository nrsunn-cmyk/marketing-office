import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PASSWORD_HELP } from "@/contracts";
import { getSessionUser } from "@/server/auth/session";
import { ActionForm } from "../_components/action-form";
import { AuthField, AuthShell } from "../_components/auth-shell";
import { signupAction } from "../login/actions";
import styles from "../ui.module.css";

export const metadata: Metadata = { title: "회원가입 · 마케팅 업무실" };

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <AuthShell title="회원가입" footer={<Link href="/login">이미 가입했다면 로그인</Link>}>
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
      <p className={styles.notice} role="status">
        확인 메일을 보냈습니다. 메일의 링크를 누르면 가입이 끝납니다. 메일이 보이지 않으면 스팸함도 확인해 주세요.
      </p>
    );
  }
  return (
    <>
      <p className={styles.muted}>허용된 이메일만 가입할 수 있습니다.</p>
      <ActionForm action={signupAction} submitLabel="가입하기" pendingLabel="가입 중…">
        <AuthField name="email" label="이메일" type="email" autoComplete="email" />
        <AuthField name="password" label="비밀번호" type="password" autoComplete="new-password" help={PASSWORD_HELP} />
        <AuthField name="passwordConfirm" label="비밀번호 확인" type="password" autoComplete="new-password" />
      </ActionForm>
    </>
  );
}
