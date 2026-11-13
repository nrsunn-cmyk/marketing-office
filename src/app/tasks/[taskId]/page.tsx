import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { GENERATOR_LABELS, TASK_STATUS_LABELS, TASK_TYPE_LABELS } from "@/domain/state/labels";
import { decideAction, generateLogoAction, saveEditAction } from "@/features/tasks/actions";
import { getTaskDetail, logoDefaults, type TaskDetail, type VersionInfo } from "@/features/tasks/server";
import { ActionForm } from "../../_components/action-form";
import { AppNav } from "../../_components/app-nav";
import { CopyButton } from "../../_components/copy-button";
import styles from "../../ui.module.css";
import { DeliveryPanel } from "./delivery-panel";
import { QuoteSection } from "./quote-section";

export const metadata: Metadata = { title: "작업 · 마케팅 업무실" };

export default function TaskPage({ params, searchParams }: PageProps<"/tasks/[taskId]">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide}`}>
      <Suspense fallback={<p className={styles.muted}>불러오는 중…</p>}>
        <TaskView params={params} searchParams={searchParams} />
      </Suspense>
      </main>
    </>
  );
}

async function TaskView({
  params,
  searchParams,
}: {
  params: PageProps<"/tasks/[taskId]">["params"];
  searchParams: PageProps<"/tasks/[taskId]">["searchParams"];
}) {
  const { taskId } = await params;
  if (!z.uuid().safeParse(taskId).success) notFound();
  const detail = await getTaskDetail(taskId);
  if (!detail) notFound();
  const sp = await searchParams;
  const requested = typeof sp.v === "string" ? Number(sp.v) : null;

  const current = detail.versions.find((v) => v.id === detail.artifact?.current_draft_version_id) ?? null;
  const shown = (requested && detail.versions.find((v) => v.version === requested)) || current;

  return (
    <>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{TASK_TYPE_LABELS[detail.task.type]}</h1>
          <p className={styles.muted}>
            <Link href={`/projects/${detail.project.id}`}>{detail.project.title}</Link>
            {detail.client && ` · ${detail.client.name}`}
            {" · "}
            {detail.profile ? `회사 프로필 ${detail.profile.version}번 버전 사용` : "연결된 회사 프로필 없음"}
          </p>
        </div>
        <span className={styles.badge}>{TASK_STATUS_LABELS[detail.task.status] ?? detail.task.status}</span>
      </div>

      {detail.task.type === "logo_brief" ? (
        <div className={styles.grid2}>
          <LogoInput detail={detail} />
          <div className={styles.page} style={{ margin: 0, padding: 0, maxWidth: "none" }}>
            {shown ? <ResultView detail={detail} version={shown} isCurrent={shown.id === current?.id} /> : <EmptyResult />}
          </div>
        </div>
      ) : (
        <QuoteSection detail={detail} />
      )}

      <DeliveryPanel detail={detail} />

      {detail.task.type === "logo_brief" && detail.versions.length > 0 && (
        <VersionHistory detail={detail} shownId={shown?.id ?? null} />
      )}
    </>
  );
}

function EmptyResult() {
  return (
    <section className={styles.section}>
      <h2 className={styles.subtitle}>결과</h2>
      <p className={styles.muted}>아직 만든 결과가 없습니다. 왼쪽 입력을 확인하고 &lsquo;브리프 만들기&rsquo;를 눌러 주세요.</p>
    </section>
  );
}

function LogoInput({ detail }: { detail: TaskDetail }) {
  const d = logoDefaults(detail);
  const list = (v: string[]) => v.join("\n");
  return (
    <section className={styles.section} aria-labelledby="logo-input">
      <h2 id="logo-input" className={styles.subtitle}>
        로고 입력
      </h2>
      <p className={styles.muted}>고객 정보와 회사 프로필에서 미리 채웠습니다. 목록 항목은 한 줄에 하나씩 적습니다.</p>
      <fieldset className={styles.row} aria-label="생성 방식">
        <label>
          <input type="radio" name="mode-display" defaultChecked readOnly /> 입력 조합으로 만들기
        </label>
        <label className={styles.muted}>
          <input type="radio" name="mode-display" disabled /> AI로 만들기 (연결 안 됨)
        </label>
      </fieldset>
      <ActionForm action={generateLogoAction} submitLabel="브리프 만들기" pendingLabel="만드는 중…">
        <input type="hidden" name="taskId" value={detail.task.id} />
        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
        <Field name="companyName" label="회사명 (필수)" value={d.companyName} />
        <Field name="industry" label="업종" value={d.industry ?? ""} />
        <Field name="description" label="회사 설명" value={d.description ?? ""} multiline />
        <Field name="mainCustomers" label="주요 고객" value={d.mainCustomers ?? ""} />
        <Field name="strengths" label="강점" value={list(d.strengths)} multiline />
        <Field name="preferredStyles" label="원하는 분위기" value={list(d.preferredStyles)} multiline />
        <Field name="colors" label="선호 색상" value={list(d.colors)} multiline />
        <Field name="references" label="참고 로고·자료" value={list(d.references)} multiline />
        <Field name="forbidden" label="피해야 할 요소" value={list(d.forbidden)} multiline />
        <Field name="extraNotes" label="추가 요청" value={d.extraNotes ?? ""} multiline />
      </ActionForm>
    </section>
  );
}

function Field({ name, label, value, multiline }: { name: string; label: string; value: string; multiline?: boolean }) {
  return (
    <div className={styles.field}>
      <label htmlFor={`f-${name}`}>{label}</label>
      {multiline ? (
        <textarea id={`f-${name}`} name={name} defaultValue={value} />
      ) : (
        <input id={`f-${name}`} name={name} defaultValue={value} />
      )}
    </div>
  );
}

function ResultView({ detail, version, isCurrent }: { detail: TaskDetail; version: VersionInfo; isCurrent: boolean }) {
  const approved = detail.artifact?.approved_version_id === version.id;
  const c = version.content;
  return (
    <section className={styles.section} aria-labelledby="result">
      <div className={styles.header}>
        <h2 id="result" className={styles.subtitle}>
          결과 {version.version}번 버전
        </h2>
        <span className={styles.row}>
          {approved && <span className={styles.badge}>승인본</span>}
          {isCurrent ? <span className={styles.badge}>현재 초안</span> : <span className={styles.badge}>이전 버전 보기</span>}
        </span>
      </div>
      <p className={styles.muted}>
        {GENERATOR_LABELS[version.generator] ?? version.generator} · {new Date(version.created_at).toLocaleString("ko-KR")}
      </p>

      {c.missingInformation.length > 0 && (
        <div className={styles.notice} role="note">
          <strong>확인이 필요한 정보:</strong> {c.missingInformation.map((m) => m.label).join(", ")}
        </div>
      )}

      <h3>브리프</h3>
      <pre id="result-brief" className={styles.pre}>
        {c.brief}
      </pre>
      <CopyButton targetId="result-brief" label="브리프 복사" />

      <h3>이미지 생성 프롬프트</h3>
      <pre id="result-prompt" className={styles.pre}>
        {c.imagePrompt}
      </pre>
      <CopyButton targetId="result-prompt" label="프롬프트 복사" />
      <p className={styles.muted}>이 프롬프트를 이미지 생성 도구에 붙여 넣어 시안을 만듭니다. 이 앱은 이미지를 만들지 않습니다.</p>

      {isCurrent && detail.artifact && (
        <>
          <details>
            <summary>직접 고치기 (새 버전으로 저장)</summary>
            <ActionForm action={saveEditAction} submitLabel="고친 내용 저장">
              <input type="hidden" name="artifactId" value={detail.artifact.id} />
              <input type="hidden" name="revision" value={detail.artifact.revision} />
              <div className={styles.field}>
                <label htmlFor="edit-brief">브리프</label>
                <textarea id="edit-brief" name="brief" defaultValue={c.brief} rows={10} />
              </div>
              <div className={styles.field}>
                <label htmlFor="edit-prompt">이미지 생성 프롬프트</label>
                <textarea id="edit-prompt" name="imagePrompt" defaultValue={c.imagePrompt} rows={4} />
              </div>
            </ActionForm>
          </details>

          {!approved && (
            <div className={styles.section} aria-label="검토 결정">
              <h3>검토</h3>
              <ActionForm action={decideAction} submitLabel="이 버전 승인">
                <input type="hidden" name="artifactId" value={detail.artifact.id} />
                <input type="hidden" name="versionId" value={version.id} />
                <input type="hidden" name="decision" value="approved" />
              </ActionForm>
              <ActionForm action={decideAction} submitLabel="수정 요청">
                <input type="hidden" name="artifactId" value={detail.artifact.id} />
                <input type="hidden" name="versionId" value={version.id} />
                <input type="hidden" name="decision" value="changes_requested" />
                <div className={styles.field}>
                  <label htmlFor="decide-comment">수정할 점 (선택)</label>
                  <textarea id="decide-comment" name="comment" />
                </div>
              </ActionForm>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function VersionHistory({ detail, shownId }: { detail: TaskDetail; shownId: string | null }) {
  const decisions = new Map<string, string>();
  for (const a of [...detail.approvals].reverse()) decisions.set(a.artifact_version_id, a.decision);
  return (
    <section className={styles.section} aria-labelledby="history">
      <h2 id="history" className={styles.subtitle}>
        버전 기록
      </h2>
      <ul className={styles.list}>
        {detail.versions.map((v) => (
          <li key={v.id} className={styles.listItem}>
            <span>
              {v.id === shownId ? <strong>{v.version}번 버전 (보는 중)</strong> : <Link href={`?v=${v.version}`}>{v.version}번 버전</Link>}
              {" · "}
              <span className={styles.muted}>{GENERATOR_LABELS[v.generator] ?? v.generator}</span>
            </span>
            <span className={styles.row}>
              {detail.artifact?.approved_version_id === v.id && <span className={styles.badge}>승인본</span>}
              {detail.artifact?.current_draft_version_id === v.id && <span className={styles.badge}>현재 초안</span>}
              {decisions.get(v.id) === "changes_requested" && <span className={styles.badge}>수정 요청됨</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
