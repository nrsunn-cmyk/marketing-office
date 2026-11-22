import Link from "next/link";
import styles from "../../../ui.module.css";
import s from "./execution.module.css";
import { EX_LABELS, type executionCounts } from "./execution-model";

/** 프로젝트 상세 상단 빠른 이동(AGY P4-ENTRY-HANDOFF 2절 가: 정보 → 작업 → 실행·성과 → 자료 → 외부 출처, 44px 알약) */
export function ProjectJumpBar() {
  const items = [
    ["#project-info", "프로젝트 정보"],
    ["#tasks", "작업"],
    ["#p4-execution", EX_LABELS.entryHeading],
    ["#project-assets", "프로젝트 자료"],
    ["#project-sources", "외부 출처"],
  ] as const;
  return (
    <nav aria-label="프로젝트 바로 가기">
      <ul className={s.exJump}>
        {items.map(([href, label]) => (
          <li key={href}>
            <a href={href}>{label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * 프로젝트 상세의 실행·성과 진입 카드(#p4-execution, entry.html 2번). 상태별 건수만(분수·% 없음) + 전용 화면으로 가는 44px 단추.
 * counts 가 null 이면(읽기 실패) 건수 없이 단추만.
 */
export function ExecutionEntryCard({ projectId, counts }: { projectId: string; counts: ReturnType<typeof executionCounts> | null }) {
  const base = `/projects/${projectId}/execution`;
  return (
    <section className={`${styles.section} ${s.exSection}`} aria-labelledby="p4-execution">
      <h2 id="p4-execution" className={styles.subtitle}>
        {EX_LABELS.entryHeading}
      </h2>
      {counts && (
        <dl className={s.exCount}>
          <div>
            <dt>승인 대기</dt>
            <dd>{`${counts.pending}건`}</dd>
          </div>
          <div>
            <dt>실행 대기 · 진행</dt>
            <dd>{`${counts.queued}건`}</dd>
          </div>
          <div>
            <dt>판 불일치 차단</dt>
            <dd>{`${counts.blocked}건`}</dd>
          </div>
          <div>
            <dt>성과 수동 입력</dt>
            <dd>{`${counts.results}건`}</dd>
          </div>
        </dl>
      )}
      <div className={s.exLinks}>
        <Link href={`${base}#queue`} className={styles.button}>
          {EX_LABELS.entryQueue}
        </Link>
        <Link href={`${base}#results`} className={styles.secondaryButton}>
          {EX_LABELS.entryResults}
        </Link>
      </div>
    </section>
  );
}
