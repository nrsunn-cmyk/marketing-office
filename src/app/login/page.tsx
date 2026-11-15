import type { Metadata } from "next";
import Link from "next/link";
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
    "링크가 만료되었거나 이미 사용되었거나, 요청한 브라우저와 다른 곳에서 열었습니다. 가입 확인 메일이었다면 인증은 끝났을 수 있으니 로그인해 보세요.",
  not_allowed: "이 계정은 이 업무실에 접근할 수 없습니다.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthShell
      icon="login"
      title="마케팅 업무실 로그인"
      subtitle="1인 운영 워크스페이스에 접속합니다."
      badge="허용된 이메일 전용"
      footer={
        <p>
          아직 계정이 없으신가요?{" "}
          <Link href="/signup" className={s.link}>
            회원가입
          </Link>
        </p>
      }
    >
      <Suspense fallback={null}>
        <LoginStatus searchParams={searchParams} />
      </Suspense>
      <AuthForm action={loginAction} submitLabel="업무실 접속하기" pendingLabel="접속 중…" tone="primary" icon="→">
        <EmailField label="이메일 주소" />
        <PasswordField name="password" label="비밀번호" autoComplete="current-password" placeholder="비밀번호" />
        <div className={s.row}>
          <Link href="/forgot-password" className={s.link}>
            비밀번호를 잊으셨나요?
          </Link>
        </div>
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
    <>
      {params.confirmed === "1" && (
        <p className={s.notice} role="status">
          메일 인증이 끝났습니다. 로그인해 주세요.
        </p>
      )}
      {error && (
        <p className={s.error} role="alert" style={{ marginBottom: "var(--space-4)" }}>
          {error}
        </p>
      )}
    </>
  );
}
