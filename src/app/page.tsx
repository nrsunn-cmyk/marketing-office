import Link from "next/link";
import { Suspense } from "react";
import { GENERATOR_LABELS, PROJECT_STATUS_LABELS, TASK_STATUS_LABELS, TASK_TYPE_LABELS } from "@/domain/state/labels";
import { getDashboard, type DashboardData } from "@/features/dashboard/server";
import { todayIn } from "@/features/quotes/server";
import { requireWorkspace } from "@/server/auth/session";
import { AppNav } from "./_components/app-nav";
import { formatDateTimeIn } from "./_components/format-time";
import styles from "./ui.module.css";

/**
 * 전체 현황 (S02) — 주인님 확정 메인 시안 A(현황 중심, Design/main-site-concepts-20261117/concept-a-status.html R2).
 * 실제 getDashboard 값만 쓴다. 시안의 예시 숫자·설명 배지·% 는 넣지 않는다. 색은 앱 토큰(tokens.css).
 */

/** 처리할 작업은 서버가 최근 수정 순 최대 10개만 가져온다(features/dashboard/server.ts) */
const TODO_LIMIT = 10;

export default function HomePage() {
  return (
    <>
      <AppNav />
      <main className={`${styles.page} ${styles.wide}`}>
        <Suspense
          fallback={
            <p className={styles.muted} role="status">
              현황을 불러오는 중…
            </p>
          }
        >
          <Home />
        </Suspense>
      </main>
    </>
  );
}

async function Home() {
  const { user, workspace } = await requireWorkspace();
  const today = todayIn(workspace.timezone);
  const result = await getDashboard(today);

  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.title}>{workspace.name}</h1>
        <span className={styles.muted}>{user.email}</span>
      </div>

      {!result.ok ? (
        <div className={styles.section}>
          <p className={styles.error} role="alert">
            {result.message}
          </p>
          {/* 같은 주소로 다시 이동한다. 이 화면은 요청마다 서버에서 그리므로(동적, 클라이언트 보관 0초) 새 값을 받아 온다 */}
          <p>
            <Link href="/" className={styles.secondaryButton}>
              다시 불러오기
            </Link>
          </p>
        </div>
      ) : (
        <Dashboard data={result.data} today={today} timeZone={workspace.timezone} />
      )}
    </>
  );
}

/** 날짜(YYYY-MM-DD) 사이의 날 수. 두 값 모두 업무실 시간대 기준 날짜다 */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function dueBadge(due: string, today: string): { text: string; tone: "danger" | "warning" | "neutral" } {
  const d = daysBetween(today, due);
  if (d < 0) return { text: `${-d}일 지남`, tone: "danger" };
  if (d === 0) return { text: "오늘 마감", tone: "warning" };
  return { text: `D-${d}`, tone: "neutral" };
}

/** 작업 상태별 다음 행동 이름과 배지 색(색만으로 뜻을 전하지 않도록 상태 이름을 함께 쓴다) */
const TASK_ACTION: Record<string, { action: string; tone: "info" | "warning" | "danger" | "neutral" }> = {
  draft: { action: "작성하기", tone: "neutral" },
  ready: { action: "작업하기", tone: "info" },
  review: { action: "검토하기", tone: "warning" },
  changes_requested: { action: "수정하기", tone: "danger" },
  failed: { action: "다시 시도", tone: "danger" },
};

const TONE_CLASS = {
  info: styles.pillInfo,
  warning: styles.pillWarning,
  danger: styles.pillDanger,
  neutral: styles.pillNeutral,
} as const;

function SectionHead({ id, title, count, more }: { id: string; title: string; count?: string; more?: { href: string; label: string } }) {
  return (
    <div className={styles.sectionHead}>
      <div className={styles.row}>
        <h2 id={id} className={styles.subtitle}>
          {title}
        </h2>
        {count !== undefined && <span className={styles.countBadge}>{count}</span>}
      </div>
      {more && (
        <Link href={more.href} className={styles.moreLink}>
          {more.label}
          <span aria-hidden="true"> →</span>
        </Link>
      )}
    </div>
  );
}

function Dashboard({ data, today, timeZone }: { data: DashboardData; today: string; timeZone: string }) {
  // 카드 안 span 순서(0 = 이름, 1 = 숫자)는 E2E 계약이다. 짧은 뜻 설명(note)은 span 이 아닌 small 로 둔다.
  const tiles: Array<{ label: string; n: number; note: string; help: string; tone: string }> = [
    { label: "진행 중 프로젝트", n: data.counts.openProjects, note: "열린 상태 합계", help: "접수·자료 대기·진행 중·검토 중 프로젝트를 모두 더한 수", tone: styles.toneInfo },
    { label: "검토 대기 작업", n: data.counts.tasksInReview, note: "승인 필요", help: "결과를 확인하고 승인하거나 수정 요청할 작업", tone: styles.toneWarning },
    { label: "자료 대기 프로젝트", n: data.counts.waitingMaterial, note: "고객 자료", help: "고객 자료를 기다리는 프로젝트", tone: "" },
    { label: "7일 안 납기", n: data.counts.dueSoon, note: "지난 납기 포함", help: `${today}부터 7일 안(지난 것 포함)에 납기가 있는 열린 프로젝트`, tone: styles.toneDanger },
  ];
  const todoCount = data.todo.length >= TODO_LIMIT ? `${TODO_LIMIT}건+` : `${data.todo.length}건`;

  return (
    <>
      <ul className={styles.tiles} aria-label="현황 숫자">
        {tiles.map((t) => (
          <li key={t.label} className={styles.tile}>
            <span className={styles.tileLabel}>{t.label}</span>
            <span className={`${styles.tileValue} ${t.tone}`}>{t.n}</span>
            <small className={styles.tileNote}>{t.note}</small>
            <span className={styles.muted}>{t.help}</span>
          </li>
        ))}
      </ul>

      {!data.hasAnyProject ? (
        <section className={styles.section} aria-labelledby="empty">
          <h2 id="empty" className={styles.subtitle}>
            아직 데이터가 없습니다
          </h2>
          <p className={styles.muted}>등록된 프로젝트가 없습니다. 아래 순서로 시작해 보세요.</p>
          <ol className={styles.steps}>
            <li>
              <strong>고객 등록</strong>
              <span className={styles.muted}>고객사 이름만 있으면 됩니다.</span>
            </li>
            <li>
              <strong>프로젝트 만들기</strong>
              <span className={styles.muted}>고객 화면에서 프로젝트 제목과 납기를 정합니다.</span>
            </li>
            <li>
              <strong>작업 시작</strong>
              <span className={styles.muted}>프로젝트에서 로고 브리프·견적·마케팅 전략 작업을 엽니다.</span>
            </li>
          </ol>
          <p className={styles.row}>
            <Link href="/clients#new-client" className={styles.button}>
              + 첫 고객 등록하기
            </Link>
            <Link href="/projects#new-own-project" className={styles.secondaryButton}>
              자체 프로젝트 만들기
            </Link>
          </p>
        </section>
      ) : (
        <div className={styles.dashGrid}>
          <section className={styles.section} aria-labelledby="todo">
            <SectionHead id="todo" title="오늘 처리할 작업" count={todoCount} more={{ href: "/projects", label: "프로젝트 전체 보기" }} />
            <p className={styles.muted}>
              날짜와 상관없이 손이 필요한 작업(작성 전·준비됨·검토 중·수정 요청·실패)을 최근 수정 순으로 최대 {TODO_LIMIT}개 보여 줍니다. 끝난 프로젝트의 작업도 들어갑니다.
            </p>
            {data.todo.length === 0 ? (
              <p className={styles.muted}>
                처리할 작업이 없습니다. 새 작업은 <Link href="/projects">프로젝트 화면</Link>에서 시작할 수 있습니다.
              </p>
            ) : (
              <ul className={styles.list}>
                {data.todo.map((t) => {
                  const a = TASK_ACTION[t.status] ?? { action: "열기", tone: "neutral" as const };
                  return (
                    <li key={t.taskId}>
                      <Link href={`/tasks/${t.taskId}`} className={styles.taskCard}>
                        <span className={styles.taskMain}>
                          <span className={styles.row}>
                            <span className={`${styles.pill} ${TONE_CLASS[a.tone]}`}>{TASK_STATUS_LABELS[t.status] ?? t.status}</span>
                            <strong className={styles.taskType}>{TASK_TYPE_LABELS[t.type] ?? t.type}</strong>
                          </span>
                          <span className={styles.taskProject}>{t.projectTitle}</span>
                        </span>
                        <span className={styles.taskAction}>{a.action}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className={styles.dashColumn}>
            <section className={styles.section} aria-labelledby="due">
              <SectionHead id="due" title="납기 임박" count={`${data.dueSoon.length}건`} />
              {data.dueSoon.length === 0 ? (
                <p className={styles.muted}>7일 안에 납기가 있는 프로젝트가 없습니다.</p>
              ) : (
                <ul className={styles.list}>
                  {data.dueSoon.map((p) => {
                    const b = dueBadge(p.due_at, today);
                    return (
                      <li key={p.id} className={`${styles.dueItem} ${b.tone === "danger" ? styles.dueOverdue : b.tone === "warning" ? styles.dueToday : ""}`}>
                        <span className={styles.taskMain}>
                          <Link href={`/projects/${p.id}`}>{p.title}</Link>
                          <span className={styles.muted}>
                            {p.due_at} · {PROJECT_STATUS_LABELS[p.status] ?? p.status}
                          </span>
                        </span>
                        <span className={`${styles.pill} ${TONE_CLASS[b.tone]}`}>{b.text}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className={styles.muted}>프로젝트 납기 기준입니다(작업별 마감 아님).</p>
            </section>

            <section className={styles.section} aria-labelledby="recent">
              <SectionHead id="recent" title="최근 결과물" more={{ href: "/results", label: "결과물 전체 보기" }} />
              {data.recent.length === 0 ? (
                <p className={styles.muted}>아직 만든 결과물이 없습니다.</p>
              ) : (
                <ul className={styles.list}>
                  {data.recent.map((r) => (
                    <li key={`${r.taskId}-${r.version}`} className={styles.listItem}>
                      <span className={styles.taskMain}>
                        <Link href={`/tasks/${r.taskId}`}>
                          {TASK_TYPE_LABELS[r.type] ?? r.type} {r.version}번 버전
                        </Link>
                        <span className={styles.muted}>{r.projectTitle}</span>
                      </span>
                      <span className={styles.recentMeta}>
                        <span className={`${styles.pill} ${styles.pillNeutral}`}>{GENERATOR_LABELS[r.generator] ?? r.generator}</span>
                        <span className={styles.muted}>{formatDateTimeIn(r.created_at, timeZone)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      <p className={`${styles.muted} ${styles.asOf}`}>기준 시각: {formatDateTimeIn(data.asOf, timeZone)} · 실제 저장된 값만 집계합니다.</p>
    </>
  );
}
