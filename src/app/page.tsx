import Link from "next/link";
import { Suspense } from "react";
import { GENERATOR_LABELS, PROJECT_STATUS_LABELS, TASK_STATUS_LABELS, TASK_TYPE_LABELS } from "@/domain/state/labels";
import { getDashboard, type DashboardData } from "@/features/dashboard/server";
import { todayIn } from "@/features/quotes/server";
import { requireWorkspace } from "@/server/auth/session";
import { AppNav } from "./_components/app-nav";
import styles from "./ui.module.css";

export default function HomePage() {
  return (
    <main className={`${styles.page} ${styles.wide}`}>
      <AppNav />
      <Suspense fallback={<p className={styles.muted}>불러오는 중…</p>}>
        <Home />
      </Suspense>
    </main>
  );
}

/** 전체 현황 (S02). 로그인 정보를 읽는 부분이라 요청마다 서버에서 그린다. */
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
        <p className={styles.error} role="alert">
          {result.message}
        </p>
      ) : !result.data.hasAnyProject ? (
        <section className={styles.section} aria-labelledby="empty">
          <h2 id="empty" className={styles.subtitle}>
            아직 데이터가 없습니다
          </h2>
          <p>
            <Link href="/clients">고객을 등록</Link>하고 프로젝트를 만들면 이곳에 진행 현황이 나타납니다.
          </p>
        </section>
      ) : (
        <Dashboard data={result.data} today={today} />
      )}
    </>
  );
}

function Dashboard({ data, today }: { data: DashboardData; today: string }) {
  const tiles: Array<[string, number, string]> = [
    ["진행 중 프로젝트", data.counts.openProjects, "접수·자료 대기·진행·검토 중인 프로젝트"],
    ["검토 대기 작업", data.counts.tasksInReview, "결과를 확인하고 승인해야 하는 작업"],
    ["자료 대기 프로젝트", data.counts.waitingMaterial, "고객 자료를 기다리는 프로젝트"],
    ["7일 안 납기", data.counts.dueSoon, `${today}부터 7일 안에 납기가 있는 진행 중 프로젝트`],
  ];
  return (
    <>
      <p className={styles.muted}>기준 시각: {new Date(data.asOf).toLocaleString("ko-KR")} · 실제 저장된 값만 집계합니다.</p>
      <ul className={styles.tiles} aria-label="현황 숫자">
        {tiles.map(([label, n, help]) => (
          <li key={label} className={styles.tile}>
            <span className={styles.tileLabel}>{label}</span>
            <span className={styles.tileValue}>{n}</span>
            <span className={styles.muted}>{help}</span>
          </li>
        ))}
      </ul>

      <section className={styles.section} aria-labelledby="todo">
        <h2 id="todo" className={styles.subtitle}>
          오늘 처리할 작업
        </h2>
        {data.todo.length === 0 ? (
          <p className={styles.muted}>처리할 작업이 없습니다.</p>
        ) : (
          <ul className={styles.list}>
            {data.todo.map((t) => (
              <li key={t.taskId} className={styles.listItem}>
                <span>
                  <Link href={`/tasks/${t.taskId}`}>{TASK_TYPE_LABELS[t.type] ?? t.type}</Link>
                  <span className={styles.muted}> · {t.projectTitle}</span>
                </span>
                <span className={styles.badge}>{TASK_STATUS_LABELS[t.status] ?? t.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="due">
        <h2 id="due" className={styles.subtitle}>
          납기 임박
        </h2>
        {data.dueSoon.length === 0 ? (
          <p className={styles.muted}>7일 안에 납기가 있는 프로젝트가 없습니다.</p>
        ) : (
          <ul className={styles.list}>
            {data.dueSoon.map((p) => (
              <li key={p.id} className={styles.listItem}>
                <Link href={`/projects/${p.id}`}>{p.title}</Link>
                <span>
                  <span className={p.due_at < today ? styles.fieldError : styles.muted}>
                    {p.due_at}
                    {p.due_at < today ? " (지남)" : ""}
                  </span>{" "}
                  <span className={styles.badge}>{PROJECT_STATUS_LABELS[p.status] ?? p.status}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="recent">
        <h2 id="recent" className={styles.subtitle}>
          최근 결과물
        </h2>
        {data.recent.length === 0 ? (
          <p className={styles.muted}>아직 만든 결과물이 없습니다.</p>
        ) : (
          <ul className={styles.list}>
            {data.recent.map((r) => (
              <li key={`${r.taskId}-${r.version}`} className={styles.listItem}>
                <span>
                  <Link href={`/tasks/${r.taskId}`}>
                    {TASK_TYPE_LABELS[r.type] ?? r.type} {r.version}번 버전
                  </Link>
                  <span className={styles.muted}> · {r.projectTitle}</span>
                </span>
                <span className={styles.muted}>
                  {GENERATOR_LABELS[r.generator] ?? r.generator} · {new Date(r.created_at).toLocaleString("ko-KR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
