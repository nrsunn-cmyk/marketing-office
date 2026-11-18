"use client";

import { useState } from "react";
import { STRATEGY_LIMITS, STRATEGY_REQUIRED_SECTIONS, STRATEGY_SECTIONS, type StrategySection } from "@/contracts/p2-strategy";
import type { StrategyFormPayload, StrategyFormSource } from "@/contracts/p2-strategy-form";
import { STRATEGY_SECTION_LABELS } from "@/domain/strategy/build";
import type { FormState } from "../../_components/form-state";
import { ActionForm } from "../../_components/action-form";
import styles from "../../ui.module.css";
import s from "./strategy.module.css";

export interface EditorProfile {
  id: string;
  version: number;
  status: "approved" | "revoked" | "none";
}
export interface EditorAsset {
  id: string;
  label: string;
}

const STATUS_LABEL: Record<EditorProfile["status"], string> = { approved: "승인됨", revoked: "승인 철회됨", none: "승인 안 됨" };

/**
 * 전략 입력 편집기. 영역마다 사실(출처 1개 필수)·추정을 항목 단위로 넣는다.
 * 값은 숨은 칸 payload(JSON)로 보낸다. 길이는 입력 칸에서 자르지 않고(조용한 잘림 방지) 글자 수만 보여 주며,
 * 최종 판단은 서버(계약·DB)가 한다.
 */
export function StrategyEditor({
  mode,
  action,
  hidden,
  initial,
  profiles,
  assets,
}: {
  mode: "generate" | "edit";
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  hidden: Record<string, string | number>;
  initial: StrategyFormPayload;
  profiles: EditorProfile[];
  assets: EditorAsset[];
}) {
  const [form, setForm] = useState<StrategyFormPayload>(initial);
  const approved = profiles.filter((p) => p.status === "approved");
  const editSection = (key: StrategySection, fn: (sec: StrategyFormPayload["sections"][StrategySection]) => void) =>
    setForm((prev) => {
      const next = structuredClone(prev);
      fn(next.sections[key]);
      return next;
    });

  return (
    <ActionForm
      action={action}
      submitLabel={mode === "generate" ? "전략 초안 만들기" : "고친 내용 저장"}
      pendingLabel={mode === "generate" ? "만드는 중…" : "저장 중…"}
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={String(v)} />
      ))}
      <input type="hidden" name="payload" value={JSON.stringify(form)} />

      <div className={styles.field}>
        <label htmlFor={`${mode}-profile`}>기준 회사 프로필 버전 (필수)</label>
        {mode === "edit" ? (
          <p id={`${mode}-profile`} className={styles.muted}>
            {profiles.find((p) => p.id === form.profileVersionId)?.version ?? "?"}번 버전 (직접 고치기에서는 바꿀 수 없습니다)
          </p>
        ) : (
          <select
            id={`${mode}-profile`}
            value={form.profileVersionId}
            onChange={(e) => setForm((f) => ({ ...f, profileVersionId: e.target.value }))}
          >
            <option value="">골라 주세요</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id} disabled={p.status !== "approved"}>
                {p.version}번 버전 · {STATUS_LABEL[p.status]}
              </option>
            ))}
          </select>
        )}
        {mode === "generate" && approved.length === 0 && (
          <p className={styles.error} role="alert">
            승인된 회사 프로필 버전이 없습니다. 고객 화면의 &lsquo;프로필 버전 검토·승인&rsquo;에서 프로필 버전을 승인하면 전략을 만들 수 있습니다.
          </p>
        )}
      </div>

      {STRATEGY_SECTIONS.map((key) => {
        const sec = form.sections[key];
        const required = STRATEGY_REQUIRED_SECTIONS.includes(key);
        return (
          <fieldset key={key} className={s.sectionBox}>
            <legend className={s.legend}>
              {STRATEGY_SECTION_LABELS[key]}
              {required && <span className={s.requiredMark}> (필수 영역)</span>}
            </legend>

            {sec.facts.map((f, i) => (
              <div key={`f${i}`} className={s.itemRow}>
                <TextBox
                  label={`${STRATEGY_SECTION_LABELS[key]} 사실 ${i + 1}`}
                  value={f.text}
                  max={STRATEGY_LIMITS.textMax}
                  onChange={(v) => editSection(key, (x) => (x.facts[i]!.text = v))}
                />
                <SourcePicker
                  label={`${STRATEGY_SECTION_LABELS[key]} 사실 ${i + 1} 출처`}
                  source={f.source}
                  assets={assets}
                  onChange={(src) => editSection(key, (x) => (x.facts[i]!.source = src))}
                />
                <button type="button" className={styles.secondaryButton} onClick={() => editSection(key, (x) => void x.facts.splice(i, 1))}>
                  사실 {i + 1} 빼기
                </button>
              </div>
            ))}
            {sec.inferences.map((inf, i) => (
              <div key={`i${i}`} className={s.itemRow}>
                <TextBox
                  label={`${STRATEGY_SECTION_LABELS[key]} 추정 ${i + 1}`}
                  value={inf.text}
                  max={STRATEGY_LIMITS.textMax}
                  onChange={(v) => editSection(key, (x) => (x.inferences[i]!.text = v))}
                />
                <TextBox
                  label={`추정 ${i + 1} 근거 (선택)`}
                  value={inf.rationale ?? ""}
                  max={STRATEGY_LIMITS.textMax}
                  onChange={(v) => editSection(key, (x) => (x.inferences[i]!.rationale = v || undefined))}
                />
                <button type="button" className={styles.secondaryButton} onClick={() => editSection(key, (x) => void x.inferences.splice(i, 1))}>
                  추정 {i + 1} 빼기
                </button>
              </div>
            ))}
            <div className={styles.row}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={sec.facts.length >= STRATEGY_LIMITS.itemsPerKind}
                onClick={() => editSection(key, (x) => void x.facts.push({ text: "", source: { kind: "profile" } }))}
              >
                + 사실 (출처 필수)
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={sec.inferences.length >= STRATEGY_LIMITS.itemsPerKind}
                onClick={() => editSection(key, (x) => void x.inferences.push({ text: "" }))}
              >
                + 추정 (가설)
              </button>
            </div>
          </fieldset>
        );
      })}

      <fieldset className={s.sectionBox}>
        <legend className={s.legend}>아직 모르는 것 (확인할 질문)</legend>
        {form.unknowns.map((u, i) => (
          <div key={`u${i}`} className={s.itemRow}>
            <TextBox label={`미확인 ${i + 1} 주제`} value={u.topic} max={STRATEGY_LIMITS.topicMax} onChange={(v) => setForm((f) => ({ ...f, unknowns: f.unknowns.map((x, j) => (j === i ? { ...x, topic: v } : x)) }))} />
            <TextBox
              label={`미확인 ${i + 1} 질문 (선택)`}
              value={u.question ?? ""}
              max={STRATEGY_LIMITS.questionMax}
              onChange={(v) => setForm((f) => ({ ...f, unknowns: f.unknowns.map((x, j) => (j === i ? { ...x, question: v || undefined } : x)) }))}
            />
            <button type="button" className={styles.secondaryButton} onClick={() => setForm((f) => ({ ...f, unknowns: f.unknowns.filter((_, j) => j !== i) }))}>
              미확인 {i + 1} 빼기
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={form.unknowns.length >= STRATEGY_LIMITS.unknownsMax}
          onClick={() => setForm((f) => ({ ...f, unknowns: [...f.unknowns, { topic: "" }] }))}
        >
          + 미확인 항목
        </button>
      </fieldset>
    </ActionForm>
  );
}

function TextBox({ label, value, max, onChange }: { label: string; value: string; max: number; onChange: (v: string) => void }) {
  const over = value.trim().length > max;
  return (
    <label className={s.textBox}>
      <span className={s.smallLabel}>{label}</span>
      <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={over || undefined} />
      <span className={over ? styles.error : styles.muted}>
        {value.trim().length}/{max}자{over && " · 너무 깁니다"}
      </span>
    </label>
  );
}

function SourcePicker({
  label,
  source,
  assets,
  onChange,
}: {
  label: string;
  source: StrategyFormSource;
  assets: EditorAsset[];
  onChange: (s: StrategyFormSource) => void;
}) {
  return (
    <div className={s.sourceBox} role="group" aria-label={label}>
      <label className={`${s.smallLabel} ${styles.field}`}>
        출처 종류
        <select
          value={source.kind}
          onChange={(e) => {
            const k = e.target.value;
            onChange(k === "asset" ? { kind: "asset", assetId: assets[0]?.id ?? "" } : k === "url" ? { kind: "url", url: "https://" } : { kind: "profile" });
          }}
        >
          <option value="profile">선택한 회사 프로필</option>
          <option value="asset" disabled={assets.length === 0}>
            프로젝트 자료{assets.length === 0 ? " (자료 없음)" : ""}
          </option>
          <option value="url">외부 주소</option>
        </select>
      </label>
      {source.kind === "asset" && (
        <label className={`${s.smallLabel} ${styles.field}`}>
          자료
          <select value={source.assetId} onChange={(e) => onChange({ kind: "asset", assetId: e.target.value })}>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {source.kind === "url" && (
        <label className={`${s.smallLabel} ${styles.field}`}>
          주소 (http/https)
          <input type="url" value={source.url} onChange={(e) => onChange({ kind: "url", url: e.target.value })} />
        </label>
      )}
    </div>
  );
}
