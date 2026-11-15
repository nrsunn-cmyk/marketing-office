import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PASSWORD_HELP } from "@/contracts";
import { requireUser } from "@/server/auth/session";
import { ActionForm } from "../_components/action-form";
import { AuthField, AuthShell } from "../_components/auth-shell";
import { resetPasswordAction } from "../login/actions";
import styles from "../ui.module.css";

export const metadata: Metadata = { title: "새 비밀번호 · 마케팅 업무실" };

/** 비밀번호 재설정 메일의 링크로 들어오면 로그인된 상태가 된다. 그 상태에서 새 비밀번호를 정한다. */
export default function ResetPasswordPage() {
  return (
    <AuthShell title="새 비밀번호 정하기" footer={<Link href="/">업무실로 가기</Link>}>
      <Suspense fallback={null}>
        <ResetBody />
      </Suspense>
    </AuthShell>
  );
}

async function ResetBody() {
  const user = await requireUser();
  return (
    <>
      <p className={styles.muted}>{user.email} 계정의 새 비밀번호를 정해 주세요.</p>
      <ActionForm action={resetPasswordAction} submitLabel="비밀번호 바꾸기" pendingLabel="바꾸는 중…">
        <AuthField name="password" label="새 비밀번호" type="password" autoComplete="new-password" help={PASSWORD_HELP} />
        <AuthField name="passwordConfirm" label="새 비밀번호 확인" type="password" autoComplete="new-password" />
      </ActionForm>
    </>
  );
}
