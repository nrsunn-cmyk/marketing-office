import { BadgeBlocked } from "../../_components/p3-icons";
import f from "./funnel.module.css";
import { QA_COPY } from "./qa-checklist-model";

/** 각 단계 화면의 "검수에서 보완 요청됨" 배지(QA_COPY.fixRequestedOnTarget, P3FG-UI-CONNECT-01-R1). 읽기 전용 표시 */
export function QaFixTag({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className={`${f.tag} ${f.tag_warn}`}>
      <BadgeBlocked />
      {QA_COPY.fixRequestedOnTarget}
    </span>
  );
}
