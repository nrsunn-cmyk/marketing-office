"use client";

import { useId, useState } from "react";
import { BRIEF_LIMITS, BRIEF_STATUSES, type BriefChannel, type BriefStatus } from "@/domain/brief/constants";
import { ActionForm } from "../../_components/action-form";
import type { FormState } from "../../_components/form-state";
import styles from "../../ui.module.css";
import { INSTAGRAM_FORMATS, SPEC_FIELDS, toBriefPayload, type BriefFormValue } from "./brief-form";
import f from "./funnel.module.css";

/**
 * 콘텐츠 브리프 고치기 폼(P2F-FRONT-01). 값 전체를 payload(JSON)로 보낸다(서버: 값 전체 교체).
 * 카피 초안을 손으로 고치면 작성 방식을 '직접 작성(manual)'으로 바꾼다. 자동 문구 생성 버튼은 넣지 않는다(미결정).
 */
export function BriefEditForm({
  action,
  briefId,
  revision,
  channel,
  initial,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  briefId: string;
  revision: number;
  channel: BriefChannel;
  initial: BriefFormValue;
}) {
  const id = useId();
  const [v, setV] = useState<BriefFormValue>(initial);
  const set = <K extends keyof BriefFormValue>(k: K, value: BriefFormValue[K]) => setV((p) => ({ ...p, [k]: value }));
  const setSpec = (k: string, value: string) => setV((p) => ({ ...p, spec: { ...p.spec, [k]: value } }));
  const L = BRIEF_LIMITS;
  const count = (n: number, max: number) => (
    <span className={n > max ? styles.error : styles.muted} aria-live="polite">
      {n}/{max}자
    </span>
  );
  const text = (key: "title" | "audience" | "hook" | "coreMessage" | "cta", label: string, max: number, multiline = false, help?: string) => (
    <div className={styles.field}>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      {multiline ? (
        <textarea id={`${id}-${key}`} value={v[key]} onChange={(e) => set(key, e.target.value)} rows={3} aria-describedby={help ? `${id}-${key}-help` : undefined} />
      ) : (
        <input id={`${id}-${key}`} value={v[key]} onChange={(e) => set(key, e.target.value)} aria-describedby={help ? `${id}-${key}-help` : undefined} />
      )}
      {help && (
        <span id={`${id}-${key}-help`} className={styles.muted}>
          {help}
        </span>
      )}
      {count(v[key].length, max)}
    </div>
  );

  return (
    <ActionForm action={action} submitLabel="브리프 저장" className={f.form}>
      <input type="hidden" name="briefId" value={briefId} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="payload" value={JSON.stringify(toBriefPayload(channel, v))} />

      {text("title", "제목 (필수)", L.title)}
      <div className={f.formGrid}>
        {text("audience", "타깃 독자", L.audience, true)}
        {text("hook", "훅 문장", L.hook, true, "첫 문장·첫 화면에서 눈길을 끄는 한마디")}
      </div>
      {text("coreMessage", "핵심 요지", L.coreMessage, true)}
      {text("cta", "CTA(행동 유도)", L.cta, false, "예: 무료 진단 신청하기")}

      <fieldset className={f.leadBox}>
        <legend>채널별 지침</legend>
        {SPEC_FIELDS[channel].map((sf) => (
          <div className={styles.field} key={sf.key}>
            <label htmlFor={`${id}-spec-${sf.key}`}>
              {sf.label}
              {sf.type === "lines" ? ` (한 줄에 하나, ${sf.max}개까지)` : ""}
            </label>
            {sf.type === "format" ? (
              <select id={`${id}-spec-${sf.key}`} value={v.spec[sf.key] ?? ""} onChange={(e) => setSpec(sf.key, e.target.value)}>
                <option value="">고르지 않음</option>
                {Object.entries(INSTAGRAM_FORMATS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            ) : sf.type === "lines" ? (
              <textarea
                id={`${id}-spec-${sf.key}`}
                value={v.spec[sf.key] ?? ""}
                onChange={(e) => setSpec(sf.key, e.target.value)}
                rows={3}
                aria-describedby={sf.help ? `${id}-spec-${sf.key}-help` : undefined}
              />
            ) : (
              <textarea
                id={`${id}-spec-${sf.key}`}
                value={v.spec[sf.key] ?? ""}
                onChange={(e) => setSpec(sf.key, e.target.value)}
                rows={2}
                aria-describedby={sf.help ? `${id}-spec-${sf.key}-help` : undefined}
              />
            )}
            {sf.help && (
              <span id={`${id}-spec-${sf.key}-help`} className={styles.muted}>
                {sf.help}
              </span>
            )}
          </div>
        ))}
      </fieldset>

      <div className={styles.field}>
        <label htmlFor={`${id}-copy`}>카피 초안</label>
        <textarea
          id={`${id}-copy`}
          value={v.copyDraft}
          onChange={(e) => setV((p) => ({ ...p, copyDraft: e.target.value, copyOrigin: "manual" }))}
          rows={6}
          aria-describedby={`${id}-copy-help`}
        />
        <span id={`${id}-copy-help`} className={styles.muted}>
          작성 방식: {v.copyOrigin === "template" ? "틀에서 시작(템플릿)" : "직접 작성"}. 근거가 없는 주장은 카피에 쓰기 전에 아래에서 근거를 연결해 주세요.
        </span>
        {count(v.copyDraft.length, L.copyDraft)}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-image`}>이미지 가이드</label>
        <textarea id={`${id}-image`} value={v.imageGuide} onChange={(e) => set("imageGuide", e.target.value)} rows={3} />
        {count(v.imageGuide.length, L.imageGuide)}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-status`}>진행 상태</label>
        <select id={`${id}-status`} value={v.status} onChange={(e) => set("status", e.target.value as BriefStatus)}>
          {Object.entries(BRIEF_STATUSES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </ActionForm>
  );
}
