"use client";

import { useId, useState } from "react";
import { LEAD_MAGNET_DELIVERIES, LEAD_MAGNET_FORMATS, LEAD_MAGNET_LIMITS, LEAD_MAGNET_STATUSES, type LeadMagnetDelivery, type LeadMagnetFormat, type LeadMagnetStatus } from "@/domain/lead-magnet/constants";
import { ActionForm } from "../../_components/action-form";
import type { FormState } from "../../_components/form-state";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import lm from "./lead-magnet.module.css";
import { formLines, toLeadMagnetPayload, type LeadMagnetFormValue } from "./lead-magnet-form";

/**
 * 리드마그넷 추가·고치기 폼(P2E-UI-01, 시안 Design/P2-next-concepts/lead-magnet.html R1).
 * 값은 숨은 칸 payload(JSON), 연결 단계는 stageId 칸으로 보낸다. 길이·개수는 자르지 않고 표시만 한다(서버가 판단).
 */
export function LeadMagnetEditForm({
  action,
  hidden,
  initial,
  stages,
  submitLabel,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  hidden: Record<string, string | number>;
  initial: LeadMagnetFormValue;
  stages: Array<{ id: string; label: string }>;
  submitLabel: string;
}) {
  const id = useId();
  const [v, setV] = useState<LeadMagnetFormValue>(initial);
  const set = <K extends keyof LeadMagnetFormValue>(k: K, value: LeadMagnetFormValue[K]) => setV((p) => ({ ...p, [k]: value }));
  const L = LEAD_MAGNET_LIMITS;
  const chars = (n: number, max: number) => (
    <span className={n > max ? styles.error : styles.muted} aria-live="polite">
      {n}/{max}자
    </span>
  );
  const items = (n: number, max: number, unit: string, longest: number, lineMax: number) => (
    <span className={n > max || longest > lineMax ? styles.error : styles.muted} aria-live="polite">
      {n}/{max}
      {unit}
      {longest > lineMax ? ` · ${lineMax}자를 넘는 줄이 있습니다` : ""}
    </span>
  );
  const fields = formLines(v.leadFields);
  const outline = formLines(v.outline);
  const longest = (list: string[]) => list.reduce((m, s) => Math.max(m, s.length), 0);

  return (
    <ActionForm action={action} submitLabel={submitLabel} className={f.form}>
      {Object.entries(hidden).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={String(val)} />
      ))}
      <input type="hidden" name="stageId" value={v.stageId} />
      <input type="hidden" name="payload" value={JSON.stringify(toLeadMagnetPayload(v))} />

      <div className={styles.field}>
        <label htmlFor={`${id}-title`}>제목 (필수)</label>
        <input id={`${id}-title`} value={v.title} onChange={(e) => set("title", e.target.value)} required aria-required="true" placeholder="예: 원두 고르는 법 체크리스트 10선" />
        {chars(v.title.length, L.title)}
      </div>
      <div className={lm.lmFormGrid}>
        <div className={styles.field}>
          <label htmlFor={`${id}-format`}>형식 (필수)</label>
          <select id={`${id}-format`} value={v.format} onChange={(e) => set("format", e.target.value as LeadMagnetFormat)}>
            {Object.entries(LEAD_MAGNET_FORMATS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-stage`}>연결 퍼널 단계 (필수)</label>
          <select id={`${id}-stage`} value={v.stageId} onChange={(e) => set("stageId", e.target.value)} required aria-required="true">
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-delivery`}>전달 방식</label>
          <select id={`${id}-delivery`} value={v.delivery} onChange={(e) => set("delivery", e.target.value as LeadMagnetDelivery | "")}>
            <option value="">선택 안 함</option>
            {Object.entries(LEAD_MAGNET_DELIVERIES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-status`}>진행 상태</label>
          <select id={`${id}-status`} value={v.status} onChange={(e) => set("status", e.target.value as LeadMagnetStatus)}>
            {Object.entries(LEAD_MAGNET_STATUSES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-audience`}>대상</label>
        <input id={`${id}-audience`} value={v.audience} onChange={(e) => set("audience", e.target.value)} placeholder="예: 출근길에 커피를 사는 동네 직장인" />
        {chars(v.audience.length, L.audience)}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-promise`}>약속하는 가치</label>
        <textarea id={`${id}-promise`} value={v.promise} onChange={(e) => set("promise", e.target.value)} rows={3} aria-describedby={`${id}-promise-help`} placeholder="예: 5분 안에 내 입맛에 맞는 원두를 고르는 기준을 알려 드립니다." />
        <span id={`${id}-promise-help`} className={styles.muted}>
          확인되지 않은 성과 보장(예: &lsquo;매출 100% 증가&rsquo;)은 쓰지 마세요.
        </span>
        {chars(v.promise.length, L.promise)}
      </div>
      <div className={lm.lmFormGrid}>
        <div className={styles.field}>
          <label htmlFor={`${id}-fields`}>수집할 정보 (한 줄에 하나)</label>
          <textarea id={`${id}-fields`} value={v.leadFields} onChange={(e) => set("leadFields", e.target.value)} rows={3} placeholder={"이메일\n회사명"} />
          {items(fields.length, L.leadFields, "개", longest(fields), L.leadField)}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-outline`}>구성·목차 (한 줄에 하나)</label>
          <textarea id={`${id}-outline`} value={v.outline} onChange={(e) => set("outline", e.target.value)} rows={4} placeholder={"1. 원두 산지별 맛\n2. 로스팅 정도 고르기"} />
          {items(outline.length, L.outline, "줄", longest(outline), L.outlineLine)}
        </div>
      </div>
    </ActionForm>
  );
}
