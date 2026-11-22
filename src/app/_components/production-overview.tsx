import Link from "next/link";
import type { PendingCounts, ProjectProductionCounts } from "@/features/production-overview/server";
import styles from "../ui.module.css";

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
} as const;

const n = (v: number) => `${v.toLocaleString("ko-KR")}건`;

/**
 * F4 현황 보조 카드 2칸(4대 KPI 아래, 할 일 위).
 * AGY 링크 단추('검수 화면 보기'·'실행 대기열 보기')는 업무실 전체를 모아 보는 화면이 없어 두지 않는다(목적지 없음 — 라우트를 늘리지 않음).
 */
export function PendingCountCards({ counts }: { counts: PendingCounts | null }) {
  const cards = [
    { title: UX_COUNT_COPY.qaTitle, value: counts?.qaPending, note: UX_COUNT_COPY.qaNote },
    { title: UX_COUNT_COPY.execTitle, value: counts?.executionPendingApproval, note: UX_COUNT_COPY.execNote },
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
        </li>
      ))}
    </ul>
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
