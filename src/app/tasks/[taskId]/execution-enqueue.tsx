import Link from "next/link";
import { enqueueExecutionAction } from "@/features/execution/actions";
import { ActionForm } from "../../_components/action-form";
import styles from "../../ui.module.css";
import { EX_COPY, EX_LABELS } from "../../projects/[projectId]/execution/execution-model";

/**
 * P4A-UI-01 티스토리 초안 → 실행 대기열 올리기(AGY P4-ENTRY-HANDOFF 1절 ①, entry.html 1번).
 * 검토 완료 초안이면 '+ 실행 대기열에 올리기' 단추와 대기열 보기 링크, 작성 중이면 안내만.
 * 같은 초안의 끝나지 않은 건이 이미 있으면 서버가 거절하고 그 문구를 보인다(한 원본·채널에 하나).
 */
export function ExecutionEnqueue({ projectId, draftId, reviewed }: { projectId: string; draftId: string; reviewed: boolean }) {
  const queue = `/projects/${projectId}/execution#queue`;
  if (!reviewed)
    return (
      <p className={styles.muted} role="note">
        {EX_LABELS.draftNotReviewed}
      </p>
    );
  return (
    <div>
      <ActionForm action={enqueueExecutionAction} submitLabel={EX_COPY.enqueueBtn} variant="secondary">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="draftId" value={draftId} />
      </ActionForm>
      <p>
        <Link href={queue} className={styles.touchLink}>
          {EX_LABELS.viewQueue}
        </Link>
      </p>
    </div>
  );
}
