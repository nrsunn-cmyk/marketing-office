"use client";

import { useId, useState } from "react";
import { ActionForm } from "../../_components/action-form";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import db from "./delivery-bundle.module.css";
import { notConnectedAction, type BriefAction } from "./production-brief-edit-form";
import { DB_COPY, DB_LABELS, DB_LIMITS, DB_METHODS, DB_METHOD_KEYS, P3_COMMON_COPY, checkLog, countChars, counterText, toLogPayload, type DbLogDraft, type DbMethod } from "./delivery-bundle-model";

/**
 * 고객 전달 기록 남기기(추가 전용, 실제 발송 없음 — 인계표 3절 3). 전달 방식·일시(한국 시간)·메모 300자.
 * 일시가 비면 손댄 뒤 안내, 메모 넘침은 바로 안내. 값은 자르지 않는다. 보낼 값은 숨은 칸 payload 하나.
 */
export function DeliveryLogForm({ bundleId, revision, action }: { bundleId: string; revision: number; action?: BriefAction }) {
  const id = useId();
  const [d, setD] = useState<DbLogDraft>({ method: "email", deliveredAtLocal: "", note: "" });
  const [touched, setTouched] = useState(false);
  const issues = checkLog(d);
  const set = (patch: Partial<DbLogDraft>) => {
    setTouched(true);
    setD({ ...d, ...patch });
  };
  const n = countChars(d.note);
  const atMsg = touched ? issues.deliveredAt : undefined;
  const noteMsg = issues.note;
  return (
    <ActionForm action={action ?? notConnectedAction} submitLabel={DB_COPY.addDelivery} pendingLabel={P3_COMMON_COPY.savePending} className={`${f.form} ${db.dbLogForm}`}>
      <input type="hidden" name="bundleId" value={bundleId} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="payload" value={JSON.stringify(toLogPayload(d))} />
      <div className={db.dbGrid2}>
        <div className={styles.field}>
          <label htmlFor={`${id}-method`}>{DB_LABELS.method}</label>
          <select id={`${id}-method`} value={d.method} onChange={(e) => set({ method: e.target.value as DbMethod })}>
            {DB_METHOD_KEYS.map((k) => (
              <option key={k} value={k}>
                {DB_METHODS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-at`}>{DB_LABELS.deliveredAt}</label>
          <input
            id={`${id}-at`}
            type="datetime-local"
            value={d.deliveredAtLocal}
            onChange={(e) => set({ deliveredAtLocal: e.target.value })}
            required
            aria-required
            aria-invalid={atMsg ? true : undefined}
            aria-describedby={atMsg ? `${id}-at-msg` : undefined}
          />
          {atMsg && (
            <span id={`${id}-at-msg`} className={styles.error}>
              {atMsg}
            </span>
          )}
        </div>
      </div>
      <div className={styles.field}>
        <div className={db.dbFieldHead}>
          <label htmlFor={`${id}-note`}>{DB_LABELS.note}</label>
          <span id={`${id}-note-count`} className={`${db.dbCount} ${n > DB_LIMITS.note ? db.dbCountOver : ""}`}>
            {counterText(n, DB_LIMITS.note)}
          </span>
        </div>
        <input
          id={`${id}-note`}
          type="text"
          value={d.note}
          placeholder={DB_LABELS.notePlaceholder}
          onChange={(e) => set({ note: e.target.value })}
          aria-invalid={noteMsg ? true : undefined}
          aria-describedby={`${id}-note-count${noteMsg ? ` ${id}-note-msg` : ""}`}
        />
        {noteMsg && (
          <span id={`${id}-note-msg`} className={styles.error}>
            {noteMsg}
          </span>
        )}
      </div>
    </ActionForm>
  );
}
