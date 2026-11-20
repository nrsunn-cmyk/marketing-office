import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { GENERATOR_LABELS, TASK_STATUS_LABELS, TASK_TYPE_LABELS } from "@/domain/state/labels";
import { decideAction, generateLogoAction, saveEditAction } from "@/features/tasks/actions";
import { getTaskDetail, logoDefaults, type TaskDetail, type VersionInfo } from "@/features/tasks/server";
import { requireWorkspace } from "@/server/auth/session";
import { ActionForm } from "../../_components/action-form";
import { AppNav } from "../../_components/app-nav";
import { CopyButton } from "../../_components/copy-button";
import { formatDateTimeIn } from "../../_components/format-time";
import styles from "../../ui.module.css";
import { DeliveryPanel } from "./delivery-panel";
import { FunnelSection } from "./funnel-section";
import { ProductionBriefArea } from "./production-brief-section";
import { WebCopyArea } from "./web-copy-section";
import { DesignAssetArea } from "./design-assets-section";
import { VideoPlanArea } from "./video-plan-section";
import { PptDeckArea } from "./ppt-deck-section";
import { P3Help } from "./p3-help";
import { QaChecklistArea } from "./qa-checklist-section";
import { DeliveryBundleArea } from "./delivery-bundle-section";
import wcStyles from "./web-copy.module.css";
import { QuoteSection } from "./quote-section";
import { StrategySection } from "./strategy-section";

export const metadata: Metadata = { title: "작업 · 마케팅 업무실" };

export default function TaskPage({ params, searchParams }: PageProps<"/tasks/[taskId]">) {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide} ${styles.touchPage}`}>
      <Suspense
        fallback={
          <p className={styles.muted} role="status">
            작업을 불러오는 중…
          </p>
        }
      >
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
  // UI-RESP-04: 불러오기 실패는 화면 안에서 알리고 다시 불러오기를 준다. 없음(notFound)·로그인 이동은 그대로 통과
  let loaded: [Awaited<ReturnType<typeof getTaskDetail>>, Awaited<ReturnType<typeof requireWorkspace>>];
  try {
    loaded = await Promise.all([
      getTaskDetail(taskId),
      requireWorkspace(), // 요청마다 캐시됨. 시각을 업무실 시간대로 보이기 위해(UI-TIME-02)
    ]);
  } catch (e) {
    unstable_rethrow(e);
    console.error("[task]", e);
    return (
      <section className={styles.section} aria-label="작업 상태">
        <h1 className={styles.title}>작업</h1>
        <p className={styles.error} role="alert">
          작업을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <p className={styles.row}>
          <Link href={`/tasks/${taskId}`} className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            다시 불러오기
          </Link>
          <Link href="/projects" className={`${styles.secondaryButton} ${styles.touchTarget}`}>
            프로젝트 목록으로
          </Link>
        </p>
      </section>
    );
  }
  const [detail, { workspace }] = loaded;
  if (!detail) notFound();
  const sp = await searchParams;
  const requested = typeof sp.v === "string" ? Number(sp.v) : null;
  // P2F-FRONT-01: 열어 볼 콘텐츠 브리프(형식이 맞을 때만. 이 작업 퍼널의 브리프인지는 서버가 다시 확인한다)
  const briefId = typeof sp.brief === "string" && z.uuid().safeParse(sp.brief).success ? sp.brief : null;

  const current = detail.versions.find((v) => v.id === detail.artifact?.current_draft_version_id) ?? null;
  const shown = (requested && detail.versions.find((v) => v.version === requested)) || current;

  return (
    <>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{TASK_TYPE_LABELS[detail.task.type]}</h1>
          <p className={styles.muted}>
            <Link href={`/projects/${detail.project.id}`} className={styles.touchLink} title={detail.project.title}>
              {detail.project.title}
            </Link>
            {detail.client && ` · ${detail.client.name}`}
            {" · "}
            {detail.task.type === "strategy"
              ? "회사 프로필 버전은 전략을 만들 때 고릅니다"
              : detail.profile
                ? `회사 프로필 ${detail.profile.version}번 버전 사용`
                : "연결된 회사 프로필 없음"}
          </p>
        </div>
        <span className={styles.badge}>{TASK_STATUS_LABELS[detail.task.status] ?? detail.task.status}</span>
      </div>

      {detail.task.type === "logo_brief" ? (
        <div className={styles.grid2}>
          <LogoInput detail={detail} />
          <div className={styles.page} style={{ margin: 0, padding: 0, maxWidth: "none" }}>
            {shown ? <ResultView detail={detail} version={shown} isCurrent={shown.id === current?.id} timeZone={workspace.timezone} /> : <EmptyResult />}
          </div>
        </div>
      ) : detail.task.type === "strategy" ? (
        <>
          {/* P3B-UI-CONNECT-01: P3 단계가 둘이 되어 페이지가 길어졌으므로 상단 빠른 이동(AGY P3I-HANDOFF.md 1절 R1) */}
          <nav className={wcStyles.wcJump} aria-label="제작 단계 바로 가기">
            <a href="#production-brief">공통 제작 브리프</a>
            <a href="#web-copy">홈페이지 구조·문구</a>
            <a href="#design-assets">디자인 자산 관리</a>
            <a href="#video-plan">영상 구성·파일 관리</a>
            <a href="#ppt-deck">PPT 구성·템플릿</a>
            <a href="#qa-checklist">검수 체크리스트</a>
            <a href="#delivery-bundle">납품 묶음</a>
          </nav>
          <StrategySection detail={detail} shown={shown} isCurrent={shown?.id === current?.id} timeZone={workspace.timezone} />
          {/* P2D-FRONT-01: 승인한 전략을 이어받는 퍼널 보드 */}
          <Suspense
            fallback={
              <p className={styles.muted} role="status">
                퍼널 보드를 불러오는 중…
              </p>
            }
          >
            <FunnelSection detail={detail} briefId={briefId} />
          </Suspense>
          {/* P3-HELP-UI-01: P3 영역 위 접힌 사용 안내(AGY P3-HELP-HANDOFF.md). 단계 배지는 p3-help-model.ts P3_CONNECTED_STEPS 한 곳 */}
          <P3Help />
          {/* P3A-UI-CONNECT-01: P3 공통 제작 브리프(FunnelSection 아래·DeliveryPanel 위, AGY P3I-HANDOFF.md 1절) */}
          <Suspense
            fallback={
              <p className={styles.muted} role="status">
                공통 제작 브리프를 불러오는 중…
              </p>
            }
          >
            <ProductionBriefArea detail={detail} />
          </Suspense>
          {/* P3B-UI-CONNECT-01: P3 둘째 단계 홈페이지 구조·문구(제작 브리프 바로 아래) */}
          <Suspense
            fallback={
              <p className={styles.muted} role="status">
                홈페이지 구조·문구를 불러오는 중…
              </p>
            }
          >
            <WebCopyArea detail={detail} />
          </Suspense>
          {/* P3C-UI-CONNECT-01: P3 셋째 단계 디자인 자산(홈페이지 구조·문구 아래) */}
          <Suspense
            fallback={
              <p className={styles.muted} role="status">
                디자인 자산을 불러오는 중…
              </p>
            }
          >
            <DesignAssetArea detail={detail} />
          </Suspense>
          {/* P3D-UI-CONNECT-01: P3 넷째 단계 영상 구성·파일(디자인 자산 아래) */}
          <Suspense
            fallback={
              <p className={styles.muted} role="status">
                영상 구성안을 불러오는 중…
              </p>
            }
          >
            <VideoPlanArea detail={detail} />
          </Suspense>
          {/* P3E-UI-CONNECT-01: P3 다섯째 단계 PPT 구성·템플릿·내보내기(영상 구성 아래) */}
          <Suspense
            fallback={
              <p className={styles.muted} role="status">
                PPT 구성안을 불러오는 중…
              </p>
            }
          >
            <PptDeckArea detail={detail} />
          </Suspense>
          {/* P3FG-UI-CONNECT-01: P3 여섯째 단계 검수 체크리스트(PPT 아래) */}
          <Suspense
            fallback={
              <p className={styles.muted} role="status">
                검수 체크리스트를 불러오는 중…
              </p>
            }
          >
            <QaChecklistArea detail={detail} />
          </Suspense>
          {/* P3FG-UI-CONNECT-01: P3 일곱째 단계 납품 묶음(검수 아래) */}
          <Suspense
            fallback={
              <p className={styles.muted} role="status">
                납품 묶음을 불러오는 중…
              </p>
            }
          >
            <DeliveryBundleArea detail={detail} />
          </Suspense>
        </>
      ) : (
        <QuoteSection detail={detail} />
      )}

      <DeliveryPanel detail={detail} timeZone={workspace.timezone} />

      {(detail.task.type === "logo_brief" || detail.task.type === "strategy") && detail.versions.length > 0 && (
        <VersionHistory detail={detail} shownId={shown?.id ?? null} />
      )}
    </>
  );
}

function EmptyResult() {
  return (
    <section className={styles.section}>
      <h2 className={styles.subtitle}>결과</h2>
      <p className={styles.muted}>아직 만든 결과가 없습니다. &lsquo;로고 입력&rsquo; 칸을 확인하고 &lsquo;브리프 만들기&rsquo;를 눌러 주세요.</p>
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

function ResultView({
  detail,
  version,
  isCurrent,
  timeZone,
}: {
  detail: TaskDetail;
  version: VersionInfo;
  isCurrent: boolean;
  timeZone: string;
}) {
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
        {GENERATOR_LABELS[version.generator] ?? version.generator} · {formatDateTimeIn(version.created_at, timeZone)}
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
  // 버전마다 가장 최근 결정(승인 기록은 최신순으로 오므로 뒤집어 차례로 덮어쓴다)
  const decisions = new Map<string, string>();
  const latestComment = new Map<string, string>();
  for (const a of [...detail.approvals].reverse()) {
    decisions.set(a.artifact_version_id, a.decision);
    latestComment.set(a.artifact_version_id, a.comment?.trim() ?? "");
  }
  return (
    <section className={styles.section} aria-labelledby="history">
      <h2 id="history" className={styles.subtitle}>
        버전 기록
      </h2>
      <ul className={styles.list}>
        {detail.versions.map((v) => (
          <li key={v.id} className={styles.listItem}>
            <span>
              {v.id === shownId ? <strong>{v.version}번 버전 (보는 중)</strong> : <Link href={`?v=${v.version}`} className={styles.touchLink}>{v.version}번 버전</Link>}
              {" · "}
              <span className={styles.muted}>{GENERATOR_LABELS[v.generator] ?? v.generator}</span>
              {/* 수정 요청 때 남긴 메모(BUG-CAND-04). 가장 최근 결정이 수정 요청이고 메모가 있을 때만. 텍스트로만 그린다 */}
              {decisions.get(v.id) === "changes_requested" && latestComment.get(v.id) && (
                <>
                  <br />
                  <span className={styles.muted}>수정할 점: {latestComment.get(v.id)}</span>
                </>
              )}
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
