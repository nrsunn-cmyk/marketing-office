import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTextAsset } from "@/features/library/server";
import { requireWorkspace } from "@/server/auth/session";
import { AppNav } from "../../_components/app-nav";
import { formatDateTimeIn } from "../../_components/format-time";
import styles from "../../ui.module.css";
import { LIBRARY_TEXT_COPY as C } from "../library-text-copy";

export const metadata: Metadata = { title: C.docTitle };

/**
 * 메모 보기(LIBRARY-TEXT-VIEW-FRONT-01, AUDIT-05 C2). 자료실·자료 칸은 앞 120자만 보여 주므로 전체를 여기서 읽는다.
 * 서버는 Backend getTextAsset(d4d0086): 본인 업무실 + 메모 종류 한 건만, 없거나 남의 것이면 NOT_FOUND.
 * 본문은 글자로만 그린다(HTML 해석 없음).
 */
export default function TextAssetPage({ params }: PageProps<"/assets/[assetId]">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.touchPage}`}>
        <p>
          <Link href="/assets" className={styles.touchLink}>
            {C.back}
          </Link>
        </p>
        <Suspense
          fallback={
            <p className={styles.muted} role="status">
              불러오는 중…
            </p>
          }
        >
          <TextAssetBody params={params} />
        </Suspense>
      </main>
    </>
  );
}

async function TextAssetBody({ params }: { params: PageProps<"/assets/[assetId]">["params"] }) {
  const { assetId } = await params;
  const [res, { workspace }] = await Promise.all([getTextAsset(assetId), requireWorkspace()]);
  if (!res.ok) {
    if (res.code === "NOT_FOUND") notFound();
    return (
      <section className={styles.section} aria-label="메모 상태">
        <p className={styles.error} role="alert">
          {C.loadError}
        </p>
        <p>
          <Link href={`/assets/${assetId}`} className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            {C.retry}
          </Link>
        </p>
      </section>
    );
  }
  const m = res.data;
  return (
    <article className={styles.section} aria-labelledby="text-asset-title" data-text-asset="">
      <h1 id="text-asset-title" className={`${styles.title} ${styles.titleWrap}`}>
        {m.title || C.untitled}
      </h1>
      <p className={styles.muted}>{C.createdAt(formatDateTimeIn(m.created_at, workspace.timezone))}</p>
      {m.text ? <div className={styles.pre}>{m.text}</div> : <p className={styles.muted}>{C.empty}</p>}
    </article>
  );
}
