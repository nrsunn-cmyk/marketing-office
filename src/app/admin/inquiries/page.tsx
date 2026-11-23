import { notFound } from "next/navigation";
import { Suspense } from "react";
import { countAdminPublicInquiries, listAdminPublicInquiries } from "@/features/admin/server";
import { isPublicInquiryStatus } from "@/features/public-inquiries/contract";
import { AppNav } from "../../_components/app-nav";
import styles from "../../ui.module.css";
import { AdminHeader, adminMetadata, requireAdminOr404 } from "../admin-parts";
import { setInquiryStatusAction } from "./actions";
import { cursorText, InquiriesView, parseInquiryCursor } from "./inquiries-view";
import { INQ_COPY } from "./inquiry-copy";

export const generateMetadata = () => adminMetadata(INQ_COPY.title);

const PAGE = 50;

/** NADAUM-BRAND-CONNECT-01 관리자 ⑥ 공개 상담(나다움 홈페이지 상담 폼 접수). 관리자가 아니면 404 */
export default function AdminInquiriesPage({ searchParams }: PageProps<"/admin/inquiries">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
        <Suspense
          fallback={
            <p className={styles.muted} role="status">
              불러오는 중…
            </p>
          }
        >
          <Inquiries searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function Inquiries({ searchParams }: { searchParams: PageProps<"/admin/inquiries">["searchParams"] }) {
  await requireAdminOr404();
  const sp = await searchParams;
  const status = isPublicInquiryStatus(sp.status) ? sp.status : null;
  const before = parseInquiryCursor(sp.before);
  const id = typeof sp.id === "string" && /^[0-9a-f-]{36}$/i.test(sp.id) ? sp.id : null;
  const [list, counts] = await Promise.all([listAdminPublicInquiries({ status: status ?? undefined, limit: PAGE, before }), countAdminPublicInquiries()]);
  if ((!list.ok && list.code === "NOT_FOUND") || (!counts.ok && counts.code === "NOT_FOUND")) notFound();

  return (
    <>
      <AdminHeader current="/admin/inquiries" title={INQ_COPY.title} lead={INQ_COPY.lead} notice={INQ_COPY.notice} />
      <InquiriesView
        counts={counts.ok ? counts.data : null}
        rows={list.ok ? list.data.rows : null}
        nextCursor={list.ok ? cursorText(list.data.next) : null}
        status={status}
        cursor={cursorText(before)}
        selectedId={id}
        action={setInquiryStatusAction}
      />
    </>
  );
}
