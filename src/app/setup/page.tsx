import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getWorkspace, requireUser } from "@/server/auth/session";
import { ONBOARDING_COPY } from "../_components/onboarding-copy";
import styles from "../ui.module.css";
import { SetupForm } from "./setup-form";

// UX-SCENARIO-AUDIT-05 C4: /settings 와 탭 제목을 구분한다
export const metadata: Metadata = { title: ONBOARDING_COPY.setupDocTitle };

export default function SetupPage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>업무실 처음 설정</h1>
      <p className={styles.muted}>
        견적서에 들어갈 우리 회사 정보입니다. 나중에 바꾸면 새 버전으로 저장되고, 이미 만든 견적서는 그대로 유지됩니다.
      </p>
      <p className={styles.muted} data-setup-later="">
        {ONBOARDING_COPY.setupLaterNote}
      </p>
      <Suspense fallback={<p className={styles.muted}>불러오는 중…</p>}>
        <SetupGate />
      </Suspense>
    </main>
  );
}

/** 로그인 확인 후, 이미 업무실이 있으면 첫 화면으로 보낸다. */
async function SetupGate() {
  await requireUser();
  if (await getWorkspace()) redirect("/workspace");
  return <SetupForm />;
}
