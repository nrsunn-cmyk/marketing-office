import styles from "../../ui.module.css";

/** UX F2(AGY DESIGN-UX-F245-01 1절): 각 단계 제목 옆 '단계 목록으로' — 위 빠른 이동 막대(#task-jump)로 1클릭 복귀, 44px. 모바일 sticky 대신 */
export const STEP_BACK_LABEL = "단계 목록으로";
export function StepBackLink() {
  return (
    <a href="#task-jump" className={styles.touchLink}>
      {STEP_BACK_LABEL}
    </a>
  );
}
