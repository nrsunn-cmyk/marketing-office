"use client";

import { useId, useState } from "react";
import { ActionForm } from "../../_components/action-form";
import type { FormState } from "../../_components/form-state";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import pb from "./production-brief.module.css";
import {
  DELIVERABLE_TYPE_KEYS,
  DELIVERABLE_TYPES,
  EDITABLE_STATUSES,
  FIELD_PLACEHOLDERS,
  PB_COPY,
  PRODUCTION_BRIEF_LIMITS,
  PRODUCTION_BRIEF_STATUSES,
  TEXT_FIELDS,
  charLength,
  checkProductionBrief,
  counterText,
  toProductionBriefPayload,
  toggleDeliverable,
  type EditableStatus,
  type ProductionBriefFormValue,
} from "./production-brief-model";

export type BriefAction = (prev: FormState, fd: FormData) => Promise<FormState>;

/** 서버가 아직 없을 때 쓰는 자리용 동작: 아무것도 보내지 않고 안내만 돌려준다 */
export async function notConnectedAction(): Promise<FormState> {
  return { ok: false, message: PB_COPY.notConnected };
}

/**
 * 공통 제작 브리프 입력 폼(P3A-UI-PREP-01, 시안 Design/p3-production/production-brief.html).
 * - 글자 수는 코드 포인트로 세고 "n / 최대자"로 보인다. 넘으면 빨간색 + 칸 아래 안내(값은 자르지 않음, 저장 판단은 서버)
 * - 값은 숨은 칸 payload(JSON)로 보낸다(리드마그넷 폼과 같은 방식). 서버 계약이 오면 이름을 맞춘다
 * - 보관은 이 폼이 아니라 별도 단추로만 한다(상태 선택에 보관 없음)
 */
export function ProductionBriefEditForm({
  action,
  hidden,
  initial,
  submitLabel = PB_COPY.save,
}: {
  action?: BriefAction;
  hidden: Record<string, string | number>;
  initial: ProductionBriefFormValue;
  submitLabel?: string;
}) {
  const id = useId();
  const [v, setV] = useState<ProductionBriefFormValue>(initial);
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof ProductionBriefFormValue>(k: K, value: ProductionBriefFormValue[K]) => {
    setTouched(true);
    setV((p) => ({ ...p, [k]: value }));
  };
  const issues = checkProductionBrief(v);
  const L = PRODUCTION_BRIEF_LIMITS;
  const nTypes = v.deliverableTypes.length;

  return (
    <ActionForm action={action ?? notConnectedAction} submitLabel={submitLabel} className={`${f.form} ${pb.pbForm}`}>
      {Object.entries(hidden).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={String(val)} />
      ))}
      <input type="hidden" name="payload" value={JSON.stringify(toProductionBriefPayload(v))} />

      {TEXT_FIELDS.map((fd) => {
        const value = v[fd.key];
        const max = L[fd.key];
        const n = charLength(value);
        const over = n > max;
        const fid = `${id}-${fd.key}`;
        // 필수 칸 비어 있음은 손댄 뒤에만 알린다(처음 열 때 빨간 글이 가득하지 않게). 글자 수 넘침은 바로 알린다
        const msg = over || touched ? issues[fd.key] : undefined;
        const common = {
          id: fid,
          value,
          onChange: (e: { target: { value: string } }) => set(fd.key, e.target.value),
          required: fd.required,
          "aria-required": fd.required || undefined,
          "aria-invalid": msg ? true : undefined,
          "aria-describedby": `${fid}-count${msg ? ` ${fid}-msg` : ""}`,
          placeholder: FIELD_PLACEHOLDERS[fd.key],
        };
        return (
          <div key={fd.key} className={styles.field}>
            <div className={pb.pbFieldHead}>
              <label htmlFor={fid}>
                {fd.label} <span className={pb.pbReq}>{fd.required ? "(필수)" : "(선택)"}</span>
              </label>
              <span id={`${fid}-count`} className={over ? `${pb.pbCount} ${pb.pbCountOver}` : pb.pbCount} aria-live="polite">
                {counterText(n, max)}
              </span>
            </div>
            {fd.multiline ? <textarea {...common} rows={fd.rows} /> : <input type="text" {...common} />}
            {msg && (
              <span id={`${fid}-msg`} className={styles.error}>
                {msg}
              </span>
            )}
          </div>
        );
      })}

      <fieldset className={pb.pbChecks} aria-describedby={`${id}-types-hint${issues.deliverableTypes && touched ? ` ${id}-types-msg` : ""}`}>
        <legend>
          포함 산출물 종류 <span className={pb.pbReq}>(필수 · 1개 이상)</span>
          <span className={pb.pbCount}>{` ${nTypes}/${L.deliverableTypesMax}개`}</span>
        </legend>
        <div className={pb.pbCheckGrid}>
          {DELIVERABLE_TYPE_KEYS.map((k) => (
            <label key={k} className={pb.pbCheck}>
              <input type="checkbox" name="deliverableTypes" value={k} checked={v.deliverableTypes.includes(k)} onChange={(e) => set("deliverableTypes", toggleDeliverable(v.deliverableTypes, k, e.target.checked))} />
              <span>{DELIVERABLE_TYPES[k]}</span>
            </label>
          ))}
        </div>
        <span id={`${id}-types-hint`} className={styles.muted}>
          {PB_COPY.deliverableHint}
        </span>
        {issues.deliverableTypes && touched && (
          <span id={`${id}-types-msg`} className={styles.error}>
            {issues.deliverableTypes}
          </span>
        )}
      </fieldset>

      <div className={styles.field}>
        <label htmlFor={`${id}-status`}>진행 상태</label>
        <select id={`${id}-status`} value={v.status} onChange={(e) => set("status", e.target.value as EditableStatus)} aria-describedby={`${id}-status-hint`}>
          {EDITABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "confirmed" ? PB_COPY.confirmedOption : PRODUCTION_BRIEF_STATUSES[s]}
            </option>
          ))}
        </select>
        <span id={`${id}-status-hint`} className={styles.muted}>
          {PB_COPY.statusHint}
        </span>
      </div>
    </ActionForm>
  );
}
