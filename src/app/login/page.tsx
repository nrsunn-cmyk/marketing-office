import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/server/auth/session";
import styles from "../ui.module.css";
import { requestLoginLink } from "./actions";

export const metadata: Metadata = { title: "로그인 · 마케팅 업무실" };

const ERRORS: Record<string, string> = {
  invalid_email: "이메일 형식이 올바르지 않습니다.",
  link_invalid: "로그인 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요.",
  not_allowed: "이 계정은 이 업무실에 접근할 수 없습니다.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className={styles.page}>
      <Image src="/brand/logo-symbol.svg" alt="" width={48} height={48} unoptimized priority className={styles.loginMark} />
      <h1 className={styles.title}>마케팅 업무실 로그인</h1>
      <Suspense fallback={null}>
        <LoginStatus searchParams={searchParams} />
      </Suspense>
      <form action={requestLoginLink} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="email">이메일</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <button type="submit" className={styles.button}>
          로그인 링크 받기
        </button>
      </form>
      <p className={styles.muted}>비밀번호 없이 이메일로 받은 링크를 눌러 로그인합니다.</p>
    </main>
  );
}

/** 요청마다 달라지는 부분: 이미 로그인했는지, 안내·오류 문구 */
async function LoginStatus({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  if (await getSessionUser()) redirect("/");
  const params = await searchParams;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  return (
    <>
      {params.sent === "1" && (
        <p className={styles.notice} role="status">
          등록된 이메일이면 로그인 링크를 보냈습니다. 메일함을 확인해 주세요.
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
