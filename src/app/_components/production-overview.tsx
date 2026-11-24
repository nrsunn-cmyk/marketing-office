import Link from "next/link";
import type { ReactNode } from "react";
import type {
  OverviewCrmFollowupSummary,
  OverviewWaitingList,
  OverviewWaitingProjects,
  PendingCounts,
  ProjectProductionCounts,
} from "@/features/production-overview/server";
import styles from "../ui.module.css";
import o from "./overview-shortcuts.module.css";

/**
 * UX F4·F5(UX-SCENARIO-AUDIT-01, AGY DESIGN-UX-F245-01 2·3절). 건수는 Backend 8a392f0(보관 제외, 업무실 분리는 서버).
 * 분수·%·진행률 막대 없음 — 개수만. 건수를 못 읽으면 숫자 대신 안내.
 */
export const UX_COUNT_COPY = {
  qaTitle: "P3 검수 대기",
  qaNote: "승인·보완이 필요한 결과물",
  execTitle: "P4 실행 승인 대기",
  execNote: "승인 후 수동 게시할 초안",
  p3Title: "P3 제작 · 납품",
  p3Desc: "전략 작업의 제작 브리프·산출물·검수·납품 현황을 단계별로 확인합니다.",
  p3Briefs: "브리프 확정",
  p3Outputs: "산출물 작성·검토",
  p3QaApproved: "검수 승인",
  p3Bundles: "납품 묶음",
  p3Open: "제작·납품 화면 열기",
  p3BundleLink: "납품 묶음 바로 보기",
  p3NoStrategy: "전략 작업을 열면 제작·납품 단계를 시작할 수 있습니다.",
  loadFail: "건수를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  // UX G1·G4(AGY UX-G1-G4-OVERVIEW-HANDOFF 1·2절 확정 문구)
  qaOpen: "검수 열기",
  qaOpenAria: (name: string) => `${name} 검수 열기`,
  execOpen: "대기열 열기",
  execOpenAria: (name: string) => `${name} 실행 대기열 열기`,
  waitingNone: "대기 중인 항목이 없습니다.",
  moreProjects: (n: number) => `외 ${n}개 프로젝트 더 있음`,
  allProjects: "프로젝트 전체 보기",
  followTitle: "후속 연락 기한 (7일 내)",
  followOverdue: (n: number) => `기한 지남 ${n}건`,
  followOpen: "후속 열기",
  // 명세는 「{이름} 후속 연락 열기」였으나 보이는 글자 「후속 열기」가 이름 안에 그대로 있어야 해서(WCAG 2.5.3 Label in Name, axe) 맞춤
  followOpenAria: (name: string) => `${name} 후속 열기`,
  followNone: "7일 안에 예정된 후속 연락이 없습니다.",
  followFail: "정보를 불러오지 못했습니다.",
} as const;

const n = (v: number) => `${v.toLocaleString("ko-KR")}건`;

/** 프로젝트 이름 + 건수 배지 + 바로가기(최대 3개, 서버가 고른 순서 그대로). 4개 이상이면 '외 n개' + 프로젝트 목록 */
function ProjectShortcuts({
  projects,
  totalProjectCount,
  label,
  aria,
  extra,
  flush = false,
}: {
  projects: Array<{ projectId: string; projectName: string; count: number; targetHref: string; earliestDueDate?: string }>;
  totalProjectCount: number;
  label: string;
  aria: (name: string) => string;
  extra?: (p: { earliestDueDate?: string }) => ReactNode;
  /** 머리글 밑줄이 이미 있는 구획 안에서는 목록 윗줄을 빼서 두 줄이 겹치지 않게 */
  flush?: boolean;
}) {
  if (projects.length === 0) return null;
  const more = totalProjectCount - projects.length;
  return (
    <>
      <ul className={flush ? `${o.shortcuts} ${o.flush}` : o.shortcuts}>
        {projects.map((p) => (
          <li key={p.projectId} className={o.shortcut}>
            <span className={o.name}>
              <strong className={o.nameText} title={p.projectName}>
                {p.projectName}
              </strong>
              <span className={o.count}>{n(p.count)}</span>
              {extra?.(p)}
            </span>
            <Link href={p.targetHref} className={o.go} aria-label={aria(p.projectName)}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className={o.more}>
          {UX_COUNT_COPY.moreProjects(more)} · <Link href="/projects">{UX_COUNT_COPY.allProjects}</Link>
        </p>
      )}
    </>
  );
}

/**
 * F4 현황 보조 카드 2칸(4대 KPI 아래, 할 일 위).
 * G1(UX-G1-G4-FRONT-01): 1건 이상이면 카드 아래에 대기 프로젝트 최대 3개와 기존 앵커 바로가기(검수 #qa-checklist·대기열 #queue).
 * 0건이면 짧은 안내만. 대기 프로젝트를 못 읽으면(waiting null) 건수만 보인다(목록 없이).
 */
export function PendingCountCards({ counts, waiting = null }: { counts: PendingCounts | null; waiting?: OverviewWaitingProjects | null }) {
  const C = UX_COUNT_COPY;
  const cards: Array<{ title: string; value: number | undefined; note: string; list: OverviewWaitingList | undefined; label: string; aria: (s: string) => string }> = [
    { title: C.qaTitle, value: counts?.qaPending, note: C.qaNote, list: waiting?.qa, label: C.qaOpen, aria: C.qaOpenAria },
    { title: C.execTitle, value: counts?.executionPendingApproval, note: C.execNote, list: waiting?.execution, label: C.execOpen, aria: C.execOpenAria },
  ];
  return (
    <ul className={`${styles.tiles} ${styles.tilesPair}`} aria-label="제작·실행 대기 건수">
      {cards.map((c) => (
        <li key={c.title} className={styles.tile}>
          <span className={styles.tileLabel}>{c.title}</span>
          {c.value === undefined ? (
            <span className={styles.muted} role="status">
              {UX_COUNT_COPY.loadFail}
            </span>
          ) : (
            <span className={styles.tileValue}>{n(c.value)}</span>
          )}
          <small className={styles.tileNote}>{c.note}</small>
          {c.value === 0 && <span className={styles.muted}>{C.waitingNone}</span>}
          {c.value !== undefined && c.value > 0 && c.list && (
            <ProjectShortcuts projects={c.list.projects} totalProjectCount={c.list.totalProjectCount} label={c.label} aria={c.aria} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** YYYY-MM-DD → MM-DD(서버가 업무실 시간대 날짜로 준 값 그대로) */
const mmdd = (iso: string) => iso.slice(5, 10);

/**
 * G4(UX-G1-G4-FRONT-01): 현황 '납기 임박' 바로 아래 '후속 연락 기한 (7일 내)'. 기한 지남 + 오늘~7일 안의 열린 CRM 후속 건수,
 * 지난 건이 있으면 경고 배지, 가장 빠른 기한 순 최대 3개 프로젝트를 #p4b-ops 로 바로 연다. 못 읽으면 카드 안에서만 안내.
 * 문의 고객 원문은 서버가 주지 않는다(건수·프로젝트 이름·기한 날짜만).
 */
export function FollowupDueCard({ summary }: { summary: OverviewCrmFollowupSummary | null }) {
  const C = UX_COUNT_COPY;
  return (
    <section className={styles.section} aria-labelledby="followup-due">
      <div className={styles.sectionHead}>
        <div className={o.headRow}>
          <h2 id="followup-due" className={styles.subtitle}>
            {C.followTitle}
          </h2>
          {summary && <span className={styles.countBadge}>{n(summary.totalDueWithin7Days)}</span>}
          {summary && summary.overdueCount > 0 && <span className={`${styles.pill} ${styles.pillWarning}`}>{C.followOverdue(summary.overdueCount)}</span>}
        </div>
      </div>
      {summary === null ? (
        <p className={styles.muted} role="status">
          {C.followFail}
        </p>
      ) : summary.totalDueWithin7Days === 0 ? (
        <p className={styles.muted}>{C.followNone}</p>
      ) : (
        <ProjectShortcuts
          projects={summary.projects}
          totalProjectCount={summary.totalProjectCount}
          label={C.followOpen}
          aria={C.followOpenAria}
          flush
          extra={(p) =>
            p.earliestDueDate ? (
              <time className={o.due} dateTime={p.earliestDueDate}>
                {mmdd(p.earliestDueDate)}
              </time>
            ) : null
          }
        />
      )}
    </section>
  );
}

/**
 * F5 프로젝트 상세 'P3 제작 · 납품' 진입 카드(#p3-production, #tasks 아래 · #p4-execution 위).
 * 전략 작업이 있으면 그 작업 상세의 기존 앵커로(#production-brief·#delivery-bundle), 없으면 안내만.
 */
export function ProductionEntryCard({ counts }: { counts: ProjectProductionCounts | null }) {
  const C = UX_COUNT_COPY;
  return (
    <section className={styles.section} aria-labelledby="p3-production">
      <h2 id="p3-production" className={styles.subtitle}>
        {C.p3Title}
      </h2>
      <p className={styles.muted}>{C.p3Desc}</p>
      {counts === null ? (
        <p className={styles.muted} role="status">
          {C.loadFail}
        </p>
      ) : (
        <>
          <dl className={styles.tiles}>
            {(
              [
                [C.p3Briefs, counts.briefsReady],
                [C.p3Outputs, counts.outputs.drafting + counts.outputs.reviewed],
                [C.p3QaApproved, counts.qaApproved],
                [C.p3Bundles, counts.deliveryBundles],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className={styles.tile}>
                <dt className={styles.tileLabel}>{label}</dt>
                <dd className={styles.tileValue}>{n(value)}</dd>
              </div>
            ))}
          </dl>
          {counts.strategyTaskId ? (
            <p className={styles.row}>
              <Link href={`/tasks/${counts.strategyTaskId}#production-brief`} className={styles.button}>
                {C.p3Open}
              </Link>
              <Link href={`/tasks/${counts.strategyTaskId}#delivery-bundle`} className={styles.secondaryButton}>
                {C.p3BundleLink}
              </Link>
            </p>
          ) : (
            <p className={styles.muted} role="note">
              {C.p3NoStrategy}
            </p>
          )}
        </>
      )}
    </section>
  );
}
