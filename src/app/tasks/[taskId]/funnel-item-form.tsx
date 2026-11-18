"use client";

import { useId, useState } from "react";
import { FUNNEL_ITEM_KINDS, FUNNEL_ITEM_STATUSES, FUNNEL_LIMITS, type FunnelItemKind, type FunnelItemStatus } from "@/domain/funnel/constants";
import { toFunnelPayload, type FunnelItemFormValue } from "./funnel-form";
import { ActionForm } from "../../_components/action-form";
import type { FormState } from "../../_components/form-state";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";

/**
 * 퍼널 카드 추가·고치기 폼(P2D-FRONT-01). 값은 숨은 칸 payload(JSON)로 보낸다.
 * 고치기에서는 단계를 바꿀 수 있다(서버 규칙: 옮긴 단계의 맨 끝으로 간다).
 */
export function FunnelItemForm({
  action,
  hidden,
  initial,
  submitLabel,
  stages,
  stageId,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  hidden: Record<string, string | number>;
  initial: FunnelItemFormValue;
  submitLabel: string;
  /** 고치기에서만: 옮길 수 있는 단계 목록 */
  stages?: Array<{ id: string; label: string }>;
  stageId?: string;
}) {
  const id = useId();
  const [v, setV] = useState<FunnelItemFormValue>(initial);
  const [toStage, setToStage] = useState(stageId ?? "");
  const set = <K extends keyof FunnelItemFormValue>(k: K, value: FunnelItemFormValue[K]) => setV((p) => ({ ...p, [k]: value }));
  const L = FUNNEL_LIMITS;
  const count = (n: number, max: number) => (
    <span className={n > max ? styles.error : styles.muted} aria-live="polite">
      {n}/{max}자
    </span>
  );

  return (
    <ActionForm action={action} submitLabel={submitLabel} className={f.form}>
      {Object.entries(hidden).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={String(val)} />
      ))}
      {stages && <input type="hidden" name="stageId" value={toStage} />}
      <input type="hidden" name="payload" value={JSON.stringify(toFunnelPayload(v))} />

      <div className={f.formGrid}>
        <div className={styles.field}>
          <label htmlFor={`${id}-kind`}>카드 유형</label>
          <select id={`${id}-kind`} value={v.kind} onChange={(e) => set("kind", e.target.value as FunnelItemKind)}>
            {Object.entries(FUNNEL_ITEM_KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-status`}>진행 상태</label>
          <select id={`${id}-status`} value={v.status} onChange={(e) => set("status", e.target.value as FunnelItemStatus)}>
            {Object.entries(FUNNEL_ITEM_STATUSES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {stages && (
          <div className={styles.field}>
            <label htmlFor={`${id}-stage`}>단계</label>
            <select id={`${id}-stage`} value={toStage} onChange={(e) => setToStage(e.target.value)} aria-describedby={`${id}-stage-help`}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <span id={`${id}-stage-help`} className={styles.muted}>
              다른 단계로 옮기면 그 단계의 맨 끝에 놓입니다.
            </span>
          </div>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-title`}>제목 (필수)</label>
        <input id={`${id}-title`} value={v.title} onChange={(e) => set("title", e.target.value)} required aria-required="true" />
        {count(v.title.length, L.title)}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-desc`}>설명</label>
        <textarea id={`${id}-desc`} value={v.description} onChange={(e) => set("description", e.target.value)} rows={3} />
        {count(v.description.length, L.description)}
      </div>
      <div className={f.formGrid}>
        <div className={styles.field}>
          <label htmlFor={`${id}-channel`}>채널</label>
          <input id={`${id}-channel`} value={v.channel} onChange={(e) => set("channel", e.target.value)} placeholder="예: 블로그, 인스타그램" />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-target`}>목표 메모</label>
          <input id={`${id}-target`} value={v.targetNote} onChange={(e) => set("targetNote", e.target.value)} placeholder="예: 상담 신청 10건" />
        </div>
      </div>

      {v.kind === "lead_magnet" && (
        <fieldset className={f.leadBox}>
          <legend>리드마그넷 기획</legend>
          <div className={styles.field}>
            <label htmlFor={`${id}-deliv`}>전달물 형태</label>
            <input id={`${id}-deliv`} value={v.deliverable} onChange={(e) => set("deliverable", e.target.value)} placeholder="예: PDF 체크리스트" />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-fields`}>받을 정보 (한 줄에 하나, {L.leadFields}개까지)</label>
            <textarea id={`${id}-fields`} value={v.leadFields} onChange={(e) => set("leadFields", e.target.value)} rows={3} placeholder={"이메일\n회사명"} />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-outline`}>기획 아웃라인 (한 줄에 하나, {L.outline}줄까지)</label>
            <textarea id={`${id}-outline`} value={v.outline} onChange={(e) => set("outline", e.target.value)} rows={4} />
          </div>
        </fieldset>
      )}
    </ActionForm>
  );
}
