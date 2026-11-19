"use client";

import { useId, useState } from "react";
import { ActionForm } from "../../_components/action-form";
import type { FormState } from "../../_components/form-state";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import pb from "./production-brief.module.css";
import {
  DELIVERABLE_TYPES,
  DELIVERABLE_TYPE_LABELS,
  FIELD_PLACEHOLDERS,
  PB_COPY,
  PRODUCTION_BRIEF_DISPLAY,
  PRODUCTION_BRIEF_LIMITS,
  PRODUCTION_BRIEF_STATUSES,
  TEXT_FIELDS,
  checkProductionBrief,
  countChars,
  counterText,
  nearLimit,
  toCreatePayload,
  toUpdatePayload,
  toggleDeliverable,
  type ProductionBriefFormValue,
  type ProductionBriefStatus,
} from "./production-brief-model";

export type BriefAction = (prev: FormState, fd: FormData) => Promise<FormState>;

/** 서버 동작을 넘기지 않은 화면(다른 P3 부품의 자리)에서 쓰는 동작: 아무것도 보내지 않고 안내만 돌려준다 */
export async function notConnectedAction(): Promise<FormState> {
  return { ok: false, message: "아직 서버와 연결되지 않아 저장할 수 없습니다." };
}

/**
 * 공통 제작 브리프 입력 폼(P3A-UI-CONNECT-01, 시안 Design/p3-production/production-brief.html).
 * - mode "create": 만들기(진행 상태 없음 — 서버가 작성 중으로 만든다), "update": 고치기(작성 중·확정)
 * - 글자 수는 서버처럼 앞뒤 공백·줄바꿈을 정리한 뒤 코드 포인트로 센다(QA-P3A-UI-01 U1). 넘으면 빨간색 + 칸 아래 안내(값은 자르지 않음)
 * - 화면 읽기 프로그램에는 한도의 90% 이상일 때만 글자 수를 알린다(같은 R2, 칠 때마다 읽히지 않게)
 * - 값은 숨은 칸 payload(JSON)로 보낸다. 보관은 별도 단추(확인 단계 있음)
 */
export function ProductionBriefEditForm({
  action,
  hidden,
  initial,
  mode = "update",
  submitLabel = mode === "create" ? PB_COPY.createSubmit : PB_COPY.save,
  strategyOptions = [],
  defaultStrategyId = null,
}: {
  action?: BriefAction;
  hidden: Record<string, string | number>;
  initial: ProductionBriefFormValue;
  mode?: "create" | "update";
  submitLabel?: string;
  /** 만들기: 고를 수 있는 승인 전략(Tester I2). 하나면 숨은 칸으로 자동, 둘 이상이면 고르는 칸 */
  strategyOptions?: Array<{ id: string; label: string }>;
  defaultStrategyId?: string | null;
}) {
  const id = useId();
  const [strategyId, setStrategyId] = useState<string>(defaultStrategyId ?? strategyOptions[0]?.id ?? "");
  const [v, setV] = useState<ProductionBriefFormValue>(initial);
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof ProductionBriefFormValue>(k: K, value: ProductionBriefFormValue[K]) => {
    setTouched(true);
    setV((p) => ({ ...p, [k]: value }));
  };
  const issues = checkProductionBrief(v);
  const L = PRODUCTION_BRIEF_LIMITS;
  const nTypes = v.deliverableTypes.length;
  const payload = mode === "create" ? toCreatePayload(v) : toUpdatePayload(v);

  return (
    <ActionForm action={action ?? notConnectedAction} submitLabel={submitLabel} pendingLabel={mode === "create" ? "만드는 중…" : "저장 중…"} className={`${f.form} ${pb.pbForm}`}>
      {Object.entries(hidden).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={String(val)} />
      ))}
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {mode === "create" && strategyOptions.length === 1 && <input type="hidden" name="strategyArtifactId" value={strategyId} />}
      {mode === "create" && strategyOptions.length > 1 && (
        <div className={styles.field}>
          <label htmlFor={`${id}-strategy`}>
            바탕 전략 <span className={pb.pbReq}>(필수)</span>
          </label>
          <select id={`${id}-strategy`} name="strategyArtifactId" value={strategyId} onChange={(e) => setStrategyId(e.target.value)} aria-describedby={`${id}-strategy-hint`}>
            {strategyOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <span id={`${id}-strategy-hint`} className={styles.muted}>
            이 프로젝트에 승인된 전략이 여럿입니다. 제작 브리프의 바탕이 될 전략을 골라 주세요.
          </span>
        </div>
      )}

      {TEXT_FIELDS.map((fd) => {
        const value = v[fd.key];
        const max = L[fd.key];
        const n = countChars(value);
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
              <span id={`${fid}-count`} className={over ? `${pb.pbCount} ${pb.pbCountOver}` : pb.pbCount}>
                {counterText(n, max)}
              </span>
            </div>
            {fd.multiline ? <textarea {...common} rows={fd.rows} /> : <input type="text" {...common} />}
            {msg && (
              <span id={`${fid}-msg`} className={styles.error}>
                {msg}
              </span>
            )}
            {/* 한도 근처·넘침일 때만 읽어 준다(글자 수 표시 자체는 aria-live 아님) */}
            <span className={pb.pbSrOnly} aria-live="polite">
              {nearLimit(n, max) ? `${fd.label} ${counterText(n, max)}` : ""}
            </span>
          </div>
        );
      })}

      <fieldset className={pb.pbChecks} aria-describedby={`${id}-types-hint${issues.deliverableTypes && touched ? ` ${id}-types-msg` : ""}`}>
        <legend>
          포함 산출물 종류 <span className={pb.pbReq}>(필수 · 1개 이상)</span>
          <span className={pb.pbCount}>{` ${nTypes}/${L.deliverableMax}개`}</span>
        </legend>
        <div className={pb.pbCheckGrid}>
          {DELIVERABLE_TYPES.map((k) => (
            <label key={k} className={pb.pbCheck}>
              <input type="checkbox" name="deliverableTypes" value={k} checked={v.deliverableTypes.includes(k)} onChange={(e) => set("deliverableTypes", toggleDeliverable(v.deliverableTypes, k, e.target.checked))} />
              <span>{DELIVERABLE_TYPE_LABELS[k]}</span>
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

      {mode === "update" && (
        <div className={styles.field}>
          <label htmlFor={`${id}-status`}>진행 상태</label>
          <select id={`${id}-status`} value={v.status} onChange={(e) => set("status", e.target.value as ProductionBriefStatus)} aria-describedby={`${id}-status-hint`}>
            {PRODUCTION_BRIEF_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "ready" ? PB_COPY.readyOption : PRODUCTION_BRIEF_DISPLAY[s]}
              </option>
            ))}
          </select>
          <span id={`${id}-status-hint`} className={styles.muted}>
            {PB_COPY.statusHint}
          </span>
        </div>
      )}
    </ActionForm>
  );
}
