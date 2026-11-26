import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { renameWorkspaceAction, saveSupplierAction } from "@/features/settings/actions";
import { getSupplier, getWorkspaceSettings, WORKSPACE_NAME_MAX } from "@/features/settings/server";
import { ActionForm } from "../_components/action-form";
import { AppNav } from "../_components/app-nav";
import styles from "../ui.module.css";
import { WORKSPACE_NAME_COPY } from "./workspace-name-copy";

export const metadata: Metadata = { title: "업무실 설정 · 마케팅 업무실" };

const FIELDS: Array<{ name: string; label: string; key: (s: NonNullable<Awaited<ReturnType<typeof getSupplier>>>) => string | null | undefined; type?: string; help?: string; required?: boolean }> = [
  { name: "legalName", label: "상호 (필수)", key: (s) => s.legal_name, required: true },
  { name: "representative", label: "대표자", key: (s) => s.representative },
  { name: "businessNumber", label: "사업자등록번호", key: (s) => s.business_number, help: "예: 123-45-67890" },
  { name: "businessType", label: "업태", key: (s) => s.extra.business_type, help: "예: 서비스" },
  { name: "businessItem", label: "종목", key: (s) => s.extra.business_item, help: "예: 광고대행, 디자인" },
  { name: "address", label: "사업장 주소", key: (s) => s.address },
  { name: "phone", label: "전화번호", key: (s) => s.phone, type: "tel" },
  { name: "email", label: "이메일", key: (s) => s.email, type: "email" },
  { name: "contactPerson", label: "담당자", key: (s) => s.extra.contact_person },
  { name: "bankAccount", label: "입금 계좌", key: (s) => s.extra.bank_account, help: "예: ○○은행 000-000-000000 (예금주 ○○○). 견적서 특기사항에 표시됩니다." },
];

export default function SettingsPage() {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
        <h1 className={styles.title}>업무실 설정</h1>
        {/* AUDIT-05 C3: 처음 설정 뒤에도 업무실 이름을 바꿀 수 있게(Backend 8b48353) */}
        <Suspense
          fallback={
            <p className={styles.muted} role="status">
              업무실 이름을 불러오는 중…
            </p>
          }
        >
          <WorkspaceNameForm />
        </Suspense>
        <Suspense
          fallback={
            <p className={styles.muted} role="status">
              공급자 정보를 불러오는 중…
            </p>
          }
        >
          <SupplierForm />
        </Suspense>
      </main>
    </>
  );
}

/** 업무실 이름. 읽어 온 revision 을 함께 보내 그사이 바뀐 이름을 덮어쓰지 않는다(서버가 CONFLICT) */
async function WorkspaceNameForm() {
  let ws: Awaited<ReturnType<typeof getWorkspaceSettings>>;
  try {
    ws = await getWorkspaceSettings();
  } catch (e) {
    unstable_rethrow(e);
    console.error("[settings workspace]", e);
    ws = null;
  }
  if (!ws) {
    return (
      <section className={styles.section} aria-label="업무실 이름 상태">
        <p className={styles.error} role="alert">
          {WORKSPACE_NAME_COPY.loadError}
        </p>
        <p>
          <Link href="/settings" className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            다시 불러오기
          </Link>
        </p>
      </section>
    );
  }
  return (
    <section className={styles.section} aria-labelledby="workspace-name">
      <h2 id="workspace-name" className={styles.subtitle}>
        {WORKSPACE_NAME_COPY.heading}
      </h2>
      <p className={styles.muted}>{WORKSPACE_NAME_COPY.intro}</p>
      <ActionForm action={renameWorkspaceAction} submitLabel={WORKSPACE_NAME_COPY.submit}>
        <input type="hidden" name="revision" value={ws.revision} />
        <div className={styles.field}>
          <label htmlFor="ws-name">{WORKSPACE_NAME_COPY.label}</label>
          <input id="ws-name" name="workspaceName" defaultValue={ws.name} required aria-required="true" maxLength={WORKSPACE_NAME_MAX} />
        </div>
      </ActionForm>
    </section>
  );
}

/** 공급자 정보 (UI-RESP-04): 불러오는 중·오류·처음(빈 상태)을 다른 화면과 같은 구조로 */
async function SupplierForm() {
  let supplier: Awaited<ReturnType<typeof getSupplier>>;
  try {
    supplier = await getSupplier();
  } catch (e) {
    unstable_rethrow(e); // 로그인·업무실 확인의 이동(redirect)은 그대로 통과시킨다
    console.error("[settings]", e);
    return (
      <section className={styles.section} aria-label="공급자 정보 상태">
        <p className={styles.error} role="alert">
          공급자 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. 지금 저장하면 기존 정보를 덮어쓸 수 있어 입력 칸을 보이지 않습니다.
        </p>
        <p>
          <Link href="/settings" className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            다시 불러오기
          </Link>
        </p>
      </section>
    );
  }
  return (
    <section className={styles.section} aria-labelledby="supplier">
      <h2 id="supplier" className={styles.subtitle}>
        공급자 정보 (견적서에 표시){supplier ? ` · 현재 ${supplier.version}번 버전` : ""}
      </h2>
      {!supplier && (
        <div className={styles.emptyState}>
          <strong>아직 저장한 공급자 정보가 없습니다.</strong>
          <p className={styles.muted}>아래 칸을 채워 저장하면 견적서의 공급자 칸에 표시됩니다. 상호만 필수입니다.</p>
        </div>
      )}
      <p className={styles.muted}>저장하면 새 버전이 생깁니다. 이미 확정한 견적서는 확정할 때의 정보를 그대로 유지합니다.</p>
      <ActionForm action={saveSupplierAction} submitLabel="새 버전으로 저장">
        {/* 이 화면이 읽어 온 버전. 그사이 다른 화면에서 저장했으면 덮어쓰지 않는다(CR10). */}
        <input type="hidden" name="baseVersion" value={supplier?.version ?? 0} />
        {FIELDS.map((f) => (
          <div className={styles.field} key={f.name}>
            <label htmlFor={`s-${f.name}`}>{f.label}</label>
            <input
              id={`s-${f.name}`}
              name={f.name}
              type={f.type ?? "text"}
              defaultValue={(supplier && f.key(supplier)) ?? ""}
              required={f.required}
              aria-required={f.required ? "true" : undefined}
              aria-describedby={f.help ? `s-${f.name}-help` : undefined}
            />
            {f.help && (
              <span id={`s-${f.name}-help`} className={styles.muted}>
                {f.help}
              </span>
            )}
          </div>
        ))}
      </ActionForm>
    </section>
  );
}
