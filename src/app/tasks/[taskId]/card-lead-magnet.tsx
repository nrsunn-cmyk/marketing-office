import { LEAD_MAGNET_FORMATS } from "@/domain/lead-magnet/constants";
import type { FunnelItemView } from "@/features/funnel/server";
import { setFunnelItemLeadMagnetAction } from "@/features/lead-magnet/actions";
import type { LeadMagnetView } from "@/features/lead-magnet/server";
import { ActionForm } from "../../_components/action-form";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import lmStyles from "./lead-magnet.module.css";

/** 카드의 리드마그넷 연결에 쓰는 목록(P2E-UI-01). null 이면 목록을 못 읽음(카드에는 짧은 안내만) */
export type LeadMagnetCtx = LeadMagnetView[] | null;

/**
 * 카드 → 리드마그넷 연결(P2E-UI-01, 전환 오퍼·리드마그넷 카드만). 고를 수 있는 것은 보관하지 않은 리드마그넷뿐이다
 * (보관한 것에는 새로 연결할 수 없고, 이미 있던 연결은 남는다 — 서버 규칙). 저장하면 카드 revision 이 1 오른다.
 */
export function CardLeadMagnet({ item, leadMagnets, readOnly }: { item: FunnelItemView; leadMagnets: LeadMagnetCtx; readOnly: boolean }) {
  if (leadMagnets === null) {
    return <p className={`${styles.muted} ${lmStyles.lmCardLink}`}>리드마그넷 연결을 불러오지 못했습니다.</p>;
  }
  const current = item.leadMagnetId ? leadMagnets.find((x) => x.id === item.leadMagnetId) : undefined;
  const choices = leadMagnets.filter((x) => !x.archived);
  const selectId = `lm-link-${item.id}`;
  return (
    <div className={lmStyles.lmCardLink}>
      <p className={`${lmStyles.lmCardLink} ${f.keep}`}>
        <span className={styles.muted}>연결 리드마그넷:</span>{" "}
        {current ? (
          <>
            <strong>{current.title}</strong>
            {current.archived ? " (보관됨)" : ""}
          </>
        ) : item.leadMagnetId ? (
          <span className={styles.muted}>알 수 없음</span>
        ) : (
          <span className={styles.muted}>없음</span>
        )}
      </p>
      {!readOnly &&
        (choices.length === 0 && !item.leadMagnetId ? (
          <p className={`${styles.muted} ${f.keep}`}>
            연결할 리드마그넷이 없습니다.{" "}
            <a href="#lead-magnets" className={f.inlineLink}>
              리드마그넷 영역
            </a>
            에서 먼저 만들어 주세요.
          </p>
        ) : (
          <details className={f.inlineDetails}>
            <summary>리드마그넷 {item.leadMagnetId ? "바꾸기·풀기" : "연결"}</summary>
            {/* 저장에 성공하면 카드 revision 이 바뀌어 폼이 새로 그려진다 */}
            <ActionForm key={item.revision} action={setFunnelItemLeadMagnetAction} submitLabel="연결 저장" variant="secondary" className={f.form}>
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="revision" value={item.revision} />
              <div className={styles.field}>
                <label htmlFor={selectId}>이 카드가 안내할 리드마그넷</label>
                <select id={selectId} name="leadMagnetId" defaultValue={current && !current.archived ? current.id : ""} aria-describedby={current?.archived ? `${selectId}-help` : undefined}>
                  <option value="">연결 안 함</option>
                  {choices.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title} · {LEAD_MAGNET_FORMATS[x.format] ?? x.format}
                    </option>
                  ))}
                </select>
                {current?.archived && (
                  <span id={`${selectId}-help`} className={styles.muted}>
                    지금 연결된 리드마그넷은 보관되어 다시 고를 수 없습니다. 저장하면 고른 것으로 바뀝니다.
                  </span>
                )}
              </div>
            </ActionForm>
          </details>
        ))}
    </div>
  );
}
