import { recordDeliveryAction } from "@/features/delivery/actions";
import { DELIVERY_METHODS, listDeliveries } from "@/features/delivery/server";
import type { TaskDetail } from "@/features/tasks/server";
import { ActionForm } from "../../_components/action-form";
import styles from "../../ui.module.css";
import { DeliveredAtField } from "./delivery-fields";

/** 수동 전달 기록 (T18). 승인본이 있을 때만 보인다. 앱이 고객에게 보내는 기능이 아니다. */
export async function DeliveryPanel({ detail }: { detail: TaskDetail }) {
  const artifact = detail.artifact;
  if (!artifact?.approved_version_id) return null;
  const approved = detail.versions.find((v) => v.id === artifact.approved_version_id);
  const deliveries = await listDeliveries(artifact.id);

  return (
    <section className={styles.section} aria-labelledby="delivery">
      <h2 id="delivery" className={styles.subtitle}>
        전달 기록
      </h2>
      <p className={styles.muted}>
        이 앱은 고객에게 직접 보내지 않습니다. 승인본({approved?.version}번 버전)을 직접 전달한 뒤 그 사실을 적어 두세요.
      </p>
      {deliveries.length === 0 ? (
        <p className={styles.muted}>아직 전달 기록이 없습니다.</p>
      ) : (
        <ul className={styles.list} aria-label="전달 기록 목록">
          {deliveries.map((d) => (
            <li key={d.id} className={styles.listItem}>
              <span>
                {new Date(d.delivered_at).toLocaleString("ko-KR")} · {DELIVERY_METHODS[d.method]} · {d.version}번 버전
              </span>
              {d.note && <span className={styles.muted}>{d.note}</span>}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>전달 기록 남기기</summary>
        <ActionForm action={recordDeliveryAction} submitLabel="전달 기록 저장">
          <input type="hidden" name="artifactId" value={artifact.id} />
          <div className={styles.field}>
            <label htmlFor="delivery-method">전달 방법</label>
            <select id="delivery-method" name="method" defaultValue="">
              <option value="" disabled>
                골라 주세요
              </option>
              {Object.entries(DELIVERY_METHODS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <DeliveredAtField />
          <div className={styles.field}>
            <label htmlFor="delivery-note">메모 (선택)</label>
            <input id="delivery-note" name="note" placeholder="예: 대표님 메일로 PDF 전달" />
          </div>
        </ActionForm>
      </details>
    </section>
  );
}
