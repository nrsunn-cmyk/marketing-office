import Link from "next/link";
import { P3QaIcon } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import qa from "./qa-checklist.module.css";
import { QaChecklistBoard, type QaChecklistActions } from "./qa-checklist-editor";
import { P3_COMMON_COPY, QA_COPY, type QaChecklistData } from "./qa-checklist-model";

export type { QaChecklistActions };

/**
 * P3F-UI-PREP-01 결과물 검수 체크리스트 영역(서버 연결 전, 가짜 데이터로 그리는 부품).
 * 시안 Design/p3-production/qa-checklist.html, 인계표 P3F-HANDOFF.md 상태:
 *   작성 중 · 보완 요청됨 · 검토 완료 · 이전 기준(재검수) · 보관(archived_at 따로) · 읽기 전용
 *   + 빈 상태 · 바탕 보관 · 확정 전 · 권한 없음 · 회차 한도(30) · 불러오기 실패(data = null).
 * 진행률 막대는 그리지 않는다(P3I-HANDOFF 2절) — 필수 항목 통과 수만. 승인 판단은 서버 RPC 몫.
 */
export function QaChecklistSection({ data, readOnly, taskId, actions = {} }: { data: QaChecklistData | null; readOnly: boolean; taskId: string; actions?: QaChecklistActions }) {
  return (
    <section className={`${styles.section} ${f.funnel} ${qa.qaSection}`} aria-labelledby="qa-checklist">
      <div className={qa.qaHead}>
        <h2 id="qa-checklist" className={`${styles.subtitle} ${qa.qaTitle}`}>
          <P3QaIcon className={qa.qaIcon} />
          {QA_COPY.heading}
        </h2>
        <p className={`${styles.muted} ${f.keep}`}>{QA_COPY.intro}</p>
      </div>
      {data === null ? (
        <>
          <p className={styles.error} role="alert">
            {QA_COPY.loadError}
          </p>
          <p>
            <Link href={`/tasks/${taskId}#qa-checklist`} className={`${styles.secondaryButton} ${f.touch}`}>
              {P3_COMMON_COPY.reload}
            </Link>
          </p>
        </>
      ) : (
        <>
          {readOnly && (
            <div className={`${styles.notice} ${qa.qaBanner}`} role="note">
              <p className={f.keep}>{P3_COMMON_COPY.projectReadOnly}</p>
            </div>
          )}
          <QaChecklistBoard data={data} readOnly={readOnly} actions={actions} />
        </>
      )}
    </section>
  );
}
