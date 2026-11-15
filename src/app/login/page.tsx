import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/server/auth/session";
import { ActionForm } from "../_components/action-form";
import { AuthField, AuthShell } from "../_components/auth-shell";
import styles from "../ui.module.css";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "로그인 · 마케팅 업무실" };

/** 메일 링크(가입 확인·비밀번호 재설정)에서 돌아왔을 때의 안내 */
const ERRORS: Record<string, string> = {
  link_invalid:
    "링크가 만료되었거나 이미 사용되었거나, 요청한 브라우저와 다른 곳에서 열었습니다. 가입 확인 메일이었다면 인증은 끝났을 수 있으니 로그인해 보세요.",
  not_allowed: "이 계정은 이 업무실에 접근할 수 없습니다.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthShell
      title="마케팅 업무실 로그인"
      footer={
        <>
          <Link href="/signup">회원가입</Link>
          <Link href="/forgot-password">비밀번호를 잊으셨나요?</Link>
        </>
      }
    >
      <Suspense fallback={null}>
        <LoginStatus searchParams={searchParams} />
      </Suspense>
      <ActionForm action={loginAction} submitLabel="로그인" pendingLabel="로그인 중…">
        <AuthField name="email" label="이메일" type="email" autoComplete="email" />
        <AuthField name="password" label="비밀번호" type="password" autoComplete="current-password" />
      </ActionForm>
    </AuthShell>
  );
}

/** 요청마다 달라지는 부분: 이미 로그인했는지, 메일 링크에서 돌아온 안내 */
async function LoginStatus({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  if (await getSessionUser()) redirect("/");
  const params = await searchParams;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  return (
    <>
      {params.confirmed === "1" && (
        <p className={styles.notice} role="status">
          메일 인증이 끝났습니다. 로그인해 주세요.
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
