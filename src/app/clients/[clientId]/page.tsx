import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { PROJECT_STATUS_LABELS } from "@/domain/state/labels";
import {
  addProfileVersionAction,
  archiveClientAction,
  createProjectAction,
  updateClientAction,
} from "@/features/clients/actions";
import { getClient, listProfileVersions } from "@/features/clients/server";
import { listProfileDecisions } from "@/features/profiles/server";
import { listProjects } from "@/features/projects/server";
import { requireWorkspace } from "@/server/auth/session";
import { ActionForm } from "../../_components/action-form";
import { AppNav } from "../../_components/app-nav";
import { AssetsPanel } from "../../_components/assets-panel";
import { formatDateTimeIn } from "../../_components/format-time";
import styles from "../../ui.module.css";
import { ProfileReview } from "./profile-review";

export const metadata: Metadata = { title: "고객 작업실 · 마케팅 업무실" };

export default function ClientPage({ params, searchParams }: PageProps<"/clients/[clientId]">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
      <Suspense
        fallback={
          <p className={styles.muted} role="status">
            고객 정보를 불러오는 중…
          </p>
        }
      >
        <ClientWorkspace params={params} searchParams={searchParams} />
      </Suspense>
      </main>
    </>
  );
}

async function ClientWorkspace({
  params,
  searchParams,
}: {
  params: PageProps<"/clients/[clientId]">["params"];
  searchParams: PageProps<"/clients/[clientId]">["searchParams"];
}) {
  const { clientId } = await params;
  if (!z.uuid().safeParse(clientId).success) notFound();
  // UI-RESP-04: 불러오기 실패는 화면 안에서 알리고 다시 불러오기를 준다. 없음(notFound)·로그인 이동은 그대로 통과
  let loaded;
  try {
    const client = await getClient(clientId);
    if (!client) notFound();
    loaded = [
      client,
      ...(await Promise.all([
        listProfileVersions(clientId),
        listProjects({ clientId }),
        requireWorkspace(), // 요청마다 캐시됨. 시각을 업무실 시간대로 보이기 위해(UI-TIME-02)
        listProfileDecisions(clientId),
        searchParams,
      ])),
    ] as const;
  } catch (e) {
    unstable_rethrow(e);
    console.error("[client]", e);
    return (
      <section className={styles.section} aria-label="고객 정보 상태">
        <h1 className={styles.title}>고객 작업실</h1>
        <p className={styles.error} role="alert">
          고객 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <p className={styles.row}>
          <Link href={`/clients/${clientId}`} className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            다시 불러오기
          </Link>
          <Link href="/clients" className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            고객 목록으로
          </Link>
        </p>
      </section>
    );
  }
  const [client, versions, projects, { workspace, user }, decisions, sp] = loaded;
  const pv = typeof sp.pv === "string" && /^\d{1,6}$/.test(sp.pv) ? Number(sp.pv) : null;
  const current = versions[0];

  return (
    <>
      <div className={styles.header}>
        <h1 className={`${styles.title} ${styles.titleWrap}`}>{client.name}</h1>
        {client.archived_at && <span className={styles.badge}>보관한 고객</span>}
      </div>

      <section className={styles.section} aria-labelledby="client-info">
        <h2 id="client-info" className={styles.subtitle}>
          기본 정보
        </h2>
        <ActionForm action={updateClientAction} submitLabel="기본 정보 저장">
          <input type="hidden" name="id" value={client.id} />
          <input type="hidden" name="revision" value={client.revision} />
          <div className={styles.field}>
            <label htmlFor="name">고객명 (필수)</label>
            <input id="name" name="name" defaultValue={client.name} required />
          </div>
          <div className={styles.field}>
            <label htmlFor="industry">업종</label>
            <input id="industry" name="industry" defaultValue={client.industry ?? ""} />
          </div>
          <div className={styles.field}>
            <label htmlFor="description">설명</label>
            <textarea id="description" name="description" defaultValue={client.description ?? ""} />
          </div>
        </ActionForm>
        <ActionForm
          action={archiveClientAction}
          submitLabel={client.archived_at ? "보관 해제" : "고객 보관하기"}
          className={styles.row}
          variant="secondary"
        >
          <input type="hidden" name="id" value={client.id} />
          <input type="hidden" name="revision" value={client.revision} />
          <input type="hidden" name="archived" value={client.archived_at ? "0" : "1"} />
        </ActionForm>
      </section>

      <section className={styles.section} aria-labelledby="profile">
        <h2 id="profile" className={styles.subtitle}>
          회사 프로필 {current ? `(현재 ${current.version}번 버전)` : "(아직 없음)"}
        </h2>
        <p className={styles.muted}>저장할 때마다 새 버전이 생깁니다. 이미 만든 결과물은 만들 때의 버전을 그대로 씁니다.</p>
        <ActionForm action={addProfileVersionAction} submitLabel="새 버전으로 저장">
          <input type="hidden" name="clientId" value={client.id} />
          <div className={styles.field}>
            <label htmlFor="products">상품·서비스</label>
            <textarea id="products" name="products" defaultValue={current?.products ?? ""} />
          </div>
          <div className={styles.field}>
            <label htmlFor="audience">주요 고객(타깃)</label>
            <textarea id="audience" name="audience" defaultValue={current?.audience ?? ""} />
          </div>
          <div className={styles.field}>
            <label htmlFor="strengths">강점 (한 줄에 하나)</label>
            <textarea id="strengths" name="strengths" defaultValue={current?.strengths.join("\n") ?? ""} />
          </div>
          <div className={styles.field}>
            <label htmlFor="brandRules">브랜드 규칙·금지 표현</label>
            <textarea id="brandRules" name="brandRules" defaultValue={current?.brand_rules ?? ""} />
          </div>
          <div className={styles.field}>
            <label htmlFor="channelUrls">채널 주소 (한 줄에 하나)</label>
            <textarea id="channelUrls" name="channelUrls" defaultValue={current?.channel_urls.join("\n") ?? ""} />
          </div>
        </ActionForm>
        {versions.length > 1 && (
          <details>
            <summary>이전 버전 {versions.length - 1}개</summary>
            <ul className={styles.list}>
              {versions.slice(1).map((v) => (
                <li key={v.id} className={styles.listItem}>
                  <span>{v.version}번 버전</span>
                  <span className={styles.muted}>{formatDateTimeIn(v.created_at, workspace.timezone)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <ProfileReview
        clientId={client.id}
        versions={versions}
        decisions={decisions}
        selectedVersion={pv}
        userId={user.userId}
        timeZone={workspace.timezone}
      />

      <section className={styles.section} aria-labelledby="projects">
        <h2 id="projects" className={styles.subtitle}>
          프로젝트
        </h2>
        {projects.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>이 고객의 프로젝트가 아직 없습니다.</strong>
            <p className={styles.muted}>아래 &lsquo;새 프로젝트&rsquo;를 펼쳐 제목만 적으면 바로 만들 수 있습니다.</p>
          </div>
        ) : (
          <ul className={styles.list} aria-label="이 고객의 프로젝트 목록">
            {projects.map((p) => (
              <li key={p.id} className={`${styles.listItem} ${styles.rowItem}`}>
                <span className={styles.rowMain}>
                  <Link href={`/projects/${p.id}`} className={styles.rowLink} title={p.title}>
                    {p.title}
                  </Link>
                  {p.due_at && <span className={`${styles.muted} ${styles.rowSub}`}>납기 {p.due_at}</span>}
                </span>
                <span className={styles.badge}>{PROJECT_STATUS_LABELS[p.status] ?? p.status}</span>
              </li>
            ))}
          </ul>
        )}
        <details>
          <summary>새 프로젝트</summary>
          <ActionForm action={createProjectAction} submitLabel="프로젝트 만들기">
            <input type="hidden" name="kind" value="client" />
            <input type="hidden" name="clientId" value={client.id} />
            <div className={styles.field}>
              <label htmlFor="title">프로젝트 제목 (필수)</label>
              <input id="title" name="title" required />
            </div>
            <div className={styles.field}>
              <label htmlFor="budget">예산 (원)</label>
              <input id="budget" name="budget" inputMode="numeric" />
            </div>
            <div className={styles.field}>
              <label htmlFor="dueAt">납기</label>
              <input id="dueAt" name="dueAt" type="date" />
            </div>
          </ActionForm>
        </details>
      </section>

      <AssetsPanel owner={{ clientId: client.id }} heading="고객 공통 자료" />
    </>
  );
}
