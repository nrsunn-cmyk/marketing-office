import { randomUUID } from "node:crypto";
import { draftToForm, emptyQuoteForm } from "@/domain/quote/form";
import { formatWon } from "@/domain/quote/parse";
import { finalizeQuoteAction } from "@/features/quotes/actions";
import { listFinalQuotes, todayIn, type QuoteContent } from "@/features/quotes/server";
import type { TaskDetail } from "@/features/tasks/server";
import { requireWorkspace } from "@/server/auth/session";
import { ActionForm } from "../../_components/action-form";
import styles from "../../ui.module.css";
import { QuoteEditor } from "./quote-editor";

/** 견적 작업 화면 (S08·S09): 작성 → 초안 저장 → 확정(번호·금액 고정) → PDF */
export async function QuoteSection({ detail }: { detail: TaskDetail }) {
  const { workspace } = await requireWorkspace();
  const current = detail.versions.find((v) => v.id === detail.artifact?.current_draft_version_id) ?? null;
  const content = current?.content as unknown as QuoteContent | undefined;
  const initial = content?.form ? draftToForm(content.form) : emptyQuoteForm(todayIn(workspace.timezone), randomUUID);
  const finals = detail.artifact ? await listFinalQuotes(detail.artifact.id) : [];
  const currentFinal = finals.find((q) => q.artifact_version_id === current?.id);

  return (
    <>
      <section className={styles.section} aria-labelledby="quote-edit">
        <h2 id="quote-edit" className={styles.subtitle}>
          견적 작성
        </h2>
        <p className={styles.muted}>
          받는 분: {detail.client?.name ?? detail.project.title}. 금액은 입력하는 동안 바로 계산되고, 저장·확정할 때 서버와 DB가 다시
          계산합니다.
        </p>
        <QuoteEditor taskId={detail.task.id} revision={detail.artifact?.revision ?? null} initial={initial} />
      </section>

      {current && content && (
        <section className={styles.section} aria-labelledby="quote-final">
          <h2 id="quote-final" className={styles.subtitle}>
            확정
          </h2>
          <p>
            저장된 초안 {current.version}번 버전 · 합계 <strong>{formatWon(content.totals.totalWon)}원</strong>
            {" · "}
            {content.totals.isFinalizable ? "확정할 수 있습니다" : "아직 확정할 수 없습니다"}
          </p>
          <p className={styles.muted}>확정은 마지막으로 저장한 초안 기준입니다. 고친 내용이 있으면 먼저 저장해 주세요.</p>
          {currentFinal ? (
            <p className={styles.notice} role="status">
              이 초안은 견적 번호 <strong>{currentFinal.quote_number}</strong>(으)로 확정했습니다. 아래에서 PDF를 받을 수 있습니다.
            </p>
          ) : (
            <ActionForm action={finalizeQuoteAction} submitLabel="확정하고 견적 번호 받기" pendingLabel="확정 중…">
              <input type="hidden" name="taskId" value={detail.task.id} />
              <input type="hidden" name="versionId" value={current.id} />
            </ActionForm>
          )}
        </section>
      )}

      {finals.length > 0 && (
        <section className={styles.section} aria-labelledby="quote-pdf">
          <h2 id="quote-pdf" className={styles.subtitle}>
            확정 견적서
          </h2>
          <ul className={styles.list} aria-label="확정 견적서 목록">
            {finals.map((q, i) => (
              <li key={q.id} className={styles.listItem}>
                <span>
                  <strong>{q.quote_number}</strong>
                  {i === 0 ? " (최신)" : ""} · {formatWon(q.total_won)}원 · 작성일 {q.issue_date}
                </span>
                <a href={`/quote-versions/${q.id}/pdf`}>PDF 내려받기</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
