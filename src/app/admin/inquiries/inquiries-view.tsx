import Link from "next/link";
import type { ReactNode } from "react";
import type { AdminPublicInquiryCursor } from "@/features/admin/server";
import type { AdminPublicInquiry, PublicInquiryStatus } from "@/features/public-inquiries/contract";
import { ActionForm } from "../../_components/action-form";
import type { FormState } from "../../_components/form-state";
import styles from "../../ui.module.css";
import { kstDateTime, TableWrap } from "../admin-parts";
import ad from "../admin.module.css";
import { INQ_COPY as C, INQ_STATUS_LABEL, INQ_STATUS_ORDER } from "./inquiry-copy";

/**
 * NADAUM-BRAND-CONNECT-01 /admin/inquiries 본문(3안 좌우 분할: 목록 1.4fr · 상세 0.6fr, 1100px 이하 세로 쌓기).
 * 데이터를 받아 그리기만 한다(조회는 page.tsx). 사용자가 적은 글자는 모두 <bdi>(unicode-bidi: isolate)로 격리하고,
 * 참고 URL 은 링크로 만들지 않고 글자로만 보인다(피싱 방지, Backend 계약 3-2).
 */
export interface InquiriesViewProps {
  counts: Record<PublicInquiryStatus, number> | null;
  rows: AdminPublicInquiry[] | null;
  /** 다음 쪽 커서 글자(없으면 마지막 쪽) */
  nextCursor: string | null;
  status: PublicInquiryStatus | null;
  /** 지금 쪽 커서 글자(다음 쪽에 있을 때) */
  cursor: string | null;
  selectedId: string | null;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}

/** 커서는 '접수 시각|id' 한 값으로 주소에 싣는다(시각 글자는 받은 그대로 — 마이크로초 유지, Backend 계약 3-2) */
export function parseInquiryCursor(v: unknown): AdminPublicInquiryCursor | undefined {
  if (typeof v !== "string") return undefined;
  const i = v.lastIndexOf("|");
  if (i <= 0) return undefined;
  const beforeCreated = v.slice(0, i);
  const beforeId = v.slice(i + 1);
  return Number.isNaN(Date.parse(beforeCreated)) || !/^[0-9a-f-]{36}$/i.test(beforeId) ? undefined : { beforeCreated, beforeId };
}
export const cursorText = (c: AdminPublicInquiryCursor | null | undefined) => (c ? `${c.beforeCreated}|${c.beforeId}` : null);

/** 주소 만들기(상태·쪽·고른 상담) */
export function inquiriesHref(p: { status?: PublicInquiryStatus | null; before?: string | null; id?: string | null }): string {
  const q = new URLSearchParams();
  if (p.status) q.set("status", p.status);
  if (p.before) q.set("before", p.before);
  if (p.id) q.set("id", p.id);
  const s = q.toString();
  return s ? `/admin/inquiries?${s}` : "/admin/inquiries";
}

/** 사용자가 적은 글자(방향 제어 문자가 있어도 주변 화면을 뒤집지 않게 격리) */
function UserText({ children, block = false }: { children: string; block?: boolean }) {
  return <bdi className={block ? `${ad.userText} ${ad.userBlock}` : ad.userText}>{children}</bdi>;
}

export function InquiriesView({ counts, rows, nextCursor, status, cursor, selectedId, action }: InquiriesViewProps) {
  const total = counts ? INQ_STATUS_ORDER.reduce((n, s) => n + counts[s], 0) : null;
  const selected = selectedId && rows ? (rows.find((r) => r.id === selectedId) ?? null) : null;
  const tabs: { key: PublicInquiryStatus | null; label: string; n: number | null }[] = [
    { key: null, label: C.all, n: total },
    ...INQ_STATUS_ORDER.map((s) => ({ key: s, label: INQ_STATUS_LABEL[s], n: counts ? counts[s] : null })),
  ];

  return (
    <>
      <nav aria-label="처리 상태로 거르기">
        <ul className={ad.tabs}>
          {tabs.map((t) => {
            const on = t.key === status;
            return (
              <li key={t.label}>
                <Link href={inquiriesHref({ status: t.key })} className={`${ad.tab} ${on ? ad.tabActive : ""}`} aria-current={on ? "page" : undefined}>
                  {t.label}
                  {t.n !== null ? ` ${t.n.toLocaleString("ko-KR")}건` : ""}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={ad.inqSplit}>
        <section className={styles.section} aria-labelledby="inq-list">
          <h2 id="inq-list" className={styles.subtitle}>
            {C.listHeading}
          </h2>
          {rows === null ? (
            <p className={styles.error} role="alert">
              {C.loadError}
            </p>
          ) : rows.length === 0 ? (
            <p className={styles.muted}>{status ? C.emptyFiltered : C.empty}</p>
          ) : (
            <TableWrap label={C.listHeading}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">접수 번호 · 시각</th>
                    <th scope="col">업체명 · 담당자</th>
                    <th scope="col">서비스</th>
                    <th scope="col">상태</th>
                    <th scope="col">
                      <span className={ad.srOnly}>자세히</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const on = r.id === selectedId;
                    return (
                      <tr key={r.id} className={on ? ad.rowSelected : undefined} aria-current={on ? "true" : undefined}>
                        {/* 좌우 분할의 왼쪽 칸에 맞게 두 값씩 한 칸에(열 5개) */}
                        <td data-label="접수 번호 · 시각">
                          {r.refCode}
                          <span className={ad.subLine}>{kstDateTime(r.createdAt)}</span>
                        </td>
                        <td data-label="업체명 · 담당자" className={ad.wrapCell}>
                          <UserText>{r.companyName}</UserText>
                          <span className={ad.subLine}>
                            <UserText>{r.contactName}</UserText>
                          </span>
                        </td>
                        <td data-label="서비스" className={ad.wrapCell}>
                          {r.serviceLabels.join(", ")}
                        </td>
                        <td data-label="상태">
                          <span className={ad.statusPill} data-status={r.status}>
                            {INQ_STATUS_LABEL[r.status]}
                          </span>
                        </td>
                        <td data-label="자세히">
                          <Link href={inquiriesHref({ status, before: cursor, id: r.id })} className={styles.secondaryButton} aria-label={`${r.refCode} 상담 보기`}>
                            {C.view}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          {(cursor || nextCursor) && (
            <p className={ad.pager}>
              {cursor && (
                <Link href={inquiriesHref({ status })} className={styles.secondaryButton}>
                  {C.first}
                </Link>
              )}
              {nextCursor && (
                <Link href={inquiriesHref({ status, before: nextCursor })} className={styles.secondaryButton}>
                  {C.next}
                </Link>
              )}
            </p>
          )}
        </section>

        <section className={`${styles.section} ${ad.inqDetail}`} aria-labelledby="inq-detail">
          <h2 id="inq-detail" className={styles.subtitle}>
            {C.detailHeading}
          </h2>
          {!selectedId ? (
            <p className={styles.muted}>{C.pickOne}</p>
          ) : !selected ? (
            <p className={styles.muted}>{C.notInPage}</p>
          ) : (
            <Detail r={selected} action={action} />
          )}
        </section>
      </div>
    </>
  );
}

function Detail({ r, action }: { r: AdminPublicInquiry; action: InquiriesViewProps["action"] }) {
  const rows: [string, ReactNode][] = [
    ["접수 번호", r.refCode],
    ["접수 시각", kstDateTime(r.createdAt)],
    ["업체명", <UserText key="c">{r.companyName}</UserText>],
    ["담당자", <UserText key="n">{r.contactName}</UserText>],
    ["연락처", <UserText key="p">{r.phone}</UserText>],
    ["서비스", r.serviceLabels.join(", ")],
  ];
  if (r.otherService) rows.push(["기타 서비스", <UserText key="o">{r.otherService}</UserText>]);
  rows.push(["요청 내용", <UserText key="m" block>{r.message}</UserText>]);
  if (r.desiredTimeline) rows.push(["희망 일정", <UserText key="t">{r.desiredTimeline}</UserText>]);
  if (r.budgetRange) rows.push(["예산", <UserText key="b">{r.budgetRange}</UserText>]);
  if (r.referenceUrl)
    rows.push([
      "참고 URL",
      <span key="u">
        <UserText>{r.referenceUrl}</UserText>
        <span className={`${styles.muted} ${ad.urlNote}`}>{C.urlNote}</span>
      </span>,
    ]);
  rows.push(["개인정보 동의", `${kstDateTime(r.privacyConsentAt)} (${r.consentVersion})`]);
  if (r.statusChangedAt) rows.push(["상태 바꾼 시각", kstDateTime(r.statusChangedAt)]);

  return (
    <div className={ad.detailBox}>
      <dl className={ad.detailList}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {/* 상태가 바뀌면 새 폼으로(화면이 보던 상태 expectedStatus 가 새 값이 되게) */}
      <ActionForm key={`${r.id}-${r.status}`} action={action} submitLabel={C.statusSubmit} pendingLabel={C.statusPending}>
        <input type="hidden" name="id" value={r.id} />
        <input type="hidden" name="expectedStatus" value={r.status} />
        <div className={styles.field}>
          <label htmlFor="inq-status">{C.statusLabel}</label>
          <select id="inq-status" name="status" defaultValue={r.status}>
            {INQ_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {INQ_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </ActionForm>
    </div>
  );
}
