"use client";

import { useId, useState } from "react";
import { BRIEF_LIMITS, CLAIM_KINDS, type ClaimKind } from "@/domain/brief/constants";
import { ActionForm } from "../../_components/action-form";
import type { FormState } from "../../_components/form-state";
import styles from "../../ui.module.css";
import { toClaimPayload, toSourcePayload } from "./brief-form";
import f from "./funnel.module.css";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** 주장 추가·고치기(P2F-FRONT-01). payload = {text, kind} */
export function ClaimForm({
  action,
  hidden,
  initialText = "",
  initialKind = "other",
  submitLabel,
}: {
  action: Action;
  hidden: Record<string, string | number>;
  initialText?: string;
  initialKind?: ClaimKind;
  submitLabel: string;
}) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const [kind, setKind] = useState<ClaimKind>(initialKind);
  return (
    <ActionForm action={action} submitLabel={submitLabel} className={f.form}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={String(v)} />
      ))}
      <input type="hidden" name="payload" value={JSON.stringify(toClaimPayload(text, kind))} />
      <div className={styles.field}>
        <label htmlFor={`${id}-text`}>주장 문장 (필수)</label>
        <textarea id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-describedby={`${id}-text-help`} />
        <span id={`${id}-text-help`} className={text.length > BRIEF_LIMITS.claimText ? styles.error : styles.muted}>
          {text.length}/{BRIEF_LIMITS.claimText}자 · 콘텐츠에서 사실처럼 말할 문장 하나
        </span>
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-kind`}>주장 종류</label>
        <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as ClaimKind)}>
          {Object.entries(CLAIM_KINDS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </ActionForm>
  );
}

export interface SourceChoice {
  /** "profile:<versionId>:<field>" · "asset:<id>" · "research:<id>" */
  value: string;
  label: string;
}

/** 근거 연결(P2F-FRONT-01). 후보는 서버가 준 목록(참조 전략의 회사 프로필 항목·프로젝트 자료·외부 출처)만 */
export function SourceLinkForm({ action, claimId, groups }: { action: Action; claimId: string; groups: Array<{ label: string; choices: SourceChoice[] }> }) {
  const id = useId();
  const first = groups.flatMap((g) => g.choices)[0]?.value ?? "";
  const [choice, setChoice] = useState(first);
  const [note, setNote] = useState("");
  if (!first) return <p className={styles.muted}>연결할 수 있는 근거가 없습니다. 이 프로젝트에 자료를 올리거나, 전략이 기준으로 삼은 회사 프로필 버전에 내용을 채워 주세요(고객 공통 자료는 근거로 고를 수 없습니다).</p>;
  return (
    <ActionForm action={action} submitLabel="근거 연결" variant="secondary" className={f.form}>
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="payload" value={JSON.stringify(toSourcePayload(choice, note))} />
      <div className={styles.field}>
        <label htmlFor={`${id}-src`}>근거</label>
        <select id={`${id}-src`} value={choice} onChange={(e) => setChoice(e.target.value)} aria-describedby={`${id}-src-help`}>
          {groups
            .filter((g) => g.choices.length)
            .map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.choices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
        {/* QA-P2F-BACKEND-01 O1: 서버가 허용하는 범위를 미리 알린다(그 밖은 SOURCE_MISMATCH 로 거절) */}
        <span id={`${id}-src-help`} className={styles.muted}>
          고를 수 있는 근거: 이 브리프가 기준으로 삼은 전략의 회사 프로필 항목, 이 프로젝트에 올린 자료·외부 출처. 고객 공통 자료와 다른 프로젝트의 자료는 고를 수 없습니다.
        </span>
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-note`}>근거 메모 (선택)</label>
        <input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 강점 2번째 문장" />
      </div>
    </ActionForm>
  );
}
