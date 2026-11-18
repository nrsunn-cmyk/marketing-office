"use client";

import { useActionState, useMemo, useState } from "react";
import { calculateDraft, parseQuoteForm, type QuoteFormText, type QuoteRowText } from "@/domain/quote/form";
import { formatWon, parseWon } from "@/domain/quote/parse";
import { QUOTE_LIMITS } from "@/domain/quote/limits";
import { saveQuoteDraftAction } from "@/features/quotes/actions";
import { EMPTY_FORM_STATE } from "../../_components/form-state";
import styles from "../../ui.module.css";
import { useHydrated } from "../../_components/use-hydrated";

let seq = 0;
const newRowId = () => `r${Date.now().toString(36)}${(seq += 1)}`;

const blankRow = (): QuoteRowText => ({
  id: newRowId(),
  name: "",
  description: "",
  quantity: "1",
  unitPrice: "",
  freeItemConfirmed: false,
  zeroAmountConfirmed: false,
});

/**
 * 견적 작성 표 (S08). 입력하는 동안 화면에서 바로 계산해 보여 주고,
 * 저장할 때는 서버가 같은 함수로 다시 계산한다(AI가 계산하지 않는다).
 */
export function QuoteEditor({ taskId, revision, initial }: { taskId: string; revision: number | null; initial: QuoteFormText }) {
  const [form, setForm] = useState<QuoteFormText>(initial);
  const [state, action, pending] = useActionState(saveQuoteDraftAction, EMPTY_FORM_STATE);
  const hydrated = useHydrated(); // hydration 전 제출 차단(BUG-SESSION-HYDRATION-01)

  const parsed = useMemo(() => parseQuoteForm(form), [form]);
  const calc = parsed.ok ? calculateDraft(parsed.draft) : null;
  const lineIssues = new Map<string, string[]>();
  for (const i of calc?.issues ?? []) if (i.itemId) lineIssues.set(i.itemId, [...(lineIssues.get(i.itemId) ?? []), i.message]);
  const parseErrors = parsed.ok ? {} : parsed.errors;
  const serverErrors = state.errors ?? {};

  const set = <K extends keyof QuoteFormText>(k: K, v: QuoteFormText[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setRow = (id: string, patch: Partial<QuoteRowText>) =>
    setForm((f) => ({ ...f, rows: f.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

  return (
    <form action={action} className={styles.form} aria-label="견적 작성">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="revision" value={revision ?? ""} />
      <input type="hidden" name="payload" value={JSON.stringify(form)} />

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="q-issue">작성일</label>
          <input id="q-issue" type="date" value={form.issueDate} onChange={(e) => set("issueDate", e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor="q-valid">유효기간</label>
          <input id="q-valid" type="date" value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor="q-mode">세금 방식</label>
          <select id="q-mode" value={form.taxMode} onChange={(e) => set("taxMode", e.target.value as QuoteFormText["taxMode"])}>
            <option value="EXCLUSIVE">부가세 별도 (단가에 세금 미포함)</option>
            <option value="INCLUSIVE">부가세 포함 (단가에 세금 포함)</option>
            <option value="NO_TAX">세액 미적용</option>
          </select>
        </div>
        {form.taxMode !== "NO_TAX" && (
          <div className={styles.field}>
            <label htmlFor="q-rate">세율 (%)</label>
            <input id="q-rate" inputMode="decimal" value={form.taxRate} onChange={(e) => set("taxRate", e.target.value)} size={6} />
          </div>
        )}
      </div>

      <table className={styles.table}>
        {/* 좁은 화면에서 '자리까/지'처럼 단어 중간에서 끊기지 않게(UI-RESP-04-R1, QA O4) */}
        <caption className={`${styles.muted} ${styles.keepAll}`}>견적 항목 (단가는 원 단위, 수량은 소수 둘째 자리까지)</caption>
        <thead>
          <tr>
            <th scope="col">No</th>
            <th scope="col">항목·설명</th>
            <th scope="col">수량</th>
            <th scope="col">단가</th>
            <th scope="col">금액</th>
            <th scope="col">
              <span className={styles.srOnly}>줄 삭제</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {form.rows.map((r, i) => {
            const amount = calc?.lines.find((l) => l.id === r.id)?.amountWon;
            const issues = [...(lineIssues.get(r.id) ?? [])];
            const qErr = parseErrors[`row-${r.id}-quantity`] ?? serverErrors[`row-${r.id}-quantity`];
            const pErr = parseErrors[`row-${r.id}-unitPrice`] ?? serverErrors[`row-${r.id}-unitPrice`];
            // CR06: 원문이 아니라 해석한 금액으로 판단한다("0", "0원", "0 원" 모두 0원)
            const parsedPrice = parseWon(r.unitPrice);
            const priceZero = parsedPrice.ok && parsedPrice.value === 0;
            const roundsToZero = issues.some((m) => m.includes("1원 미만"));
            return (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td>
                  <input aria-label={`${i + 1}번째 줄 항목명`} value={r.name} onChange={(e) => setRow(r.id, { name: e.target.value })} />
                  <input
                    aria-label={`${i + 1}번째 줄 설명`}
                    placeholder="설명 (선택)"
                    value={r.description}
                    onChange={(e) => setRow(r.id, { description: e.target.value })}
                  />
                  {(priceZero || r.freeItemConfirmed) && (
                    <label className={styles.muted}>
                      <input
                        type="checkbox"
                        checked={r.freeItemConfirmed}
                        onChange={(e) => setRow(r.id, { freeItemConfirmed: e.target.checked })}
                      />{" "}
                      무료 항목이 맞습니다
                    </label>
                  )}
                  {(roundsToZero || r.zeroAmountConfirmed) && (
                    <label className={styles.muted}>
                      <input
                        type="checkbox"
                        checked={r.zeroAmountConfirmed}
                        onChange={(e) => setRow(r.id, { zeroAmountConfirmed: e.target.checked })}
                      />{" "}
                      0원으로 계산되는 것을 확인했습니다
                    </label>
                  )}
                  {[qErr, pErr, ...issues].filter(Boolean).map((m) => (
                    <div key={m} className={styles.fieldError} role="note">
                      {m}
                    </div>
                  ))}
                </td>
                <td data-label="수량">
                  <input
                    aria-label={`${i + 1}번째 줄 수량`}
                    inputMode="decimal"
                    value={r.quantity}
                    aria-invalid={qErr ? true : undefined}
                    onChange={(e) => setRow(r.id, { quantity: e.target.value })}
                    size={6}
                  />
                </td>
                <td data-label="단가 (원)">
                  <input
                    aria-label={`${i + 1}번째 줄 단가`}
                    inputMode="numeric"
                    value={r.unitPrice}
                    aria-invalid={pErr ? true : undefined}
                    onChange={(e) => setRow(r.id, { unitPrice: e.target.value })}
                    size={10}
                  />
                </td>
                <td data-label="금액 (원)" className={styles.num} aria-label={`${i + 1}번째 줄 금액`}>
                  {amount == null ? "—" : formatWon(amount)}
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.linkButton}
                    aria-label={`${i + 1}번째 줄 삭제`}
                    disabled={form.rows.length === 1}
                    onClick={() => setForm((f) => ({ ...f, rows: f.rows.filter((x) => x.id !== r.id) }))}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={form.rows.length >= QUOTE_LIMITS.maxItems}
        onClick={() => setForm((f) => ({ ...f, rows: [...f.rows, blankRow()] }))}
      >
        줄 추가
      </button>

      <dl className={styles.totals} aria-label="합계">
        <dt>공급가액</dt>
        <dd>{calc ? `${formatWon(calc.subtotalWon)}원` : "—"}</dd>
        <dt>세액</dt>
        <dd>{calc ? `${formatWon(calc.taxWon)}원` : "—"}</dd>
        <dt>합계</dt>
        <dd>
          <strong>{calc ? `${formatWon(calc.totalWon)}원` : "—"}</strong>
        </dd>
      </dl>

      <div className={styles.field}>
        <label htmlFor="q-terms">지급 조건</label>
        <textarea id="q-terms" value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor="q-notes">비고</label>
        <textarea id="q-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>

      {Object.keys(parseErrors).length > 0 && (
        <ul className={styles.error} role="alert">
          {Object.values(parseErrors).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {calc && !calc.isFinalizable && (
        <div className={styles.notice} role="note">
          초안으로 저장할 수 있지만, 확정하려면 다음을 해결해야 합니다:{" "}
          {[...new Set(calc.issues.map((i) => i.message))].join(" ")}
        </div>
      )}
      {state.message && (
        <p className={state.ok ? styles.notice : styles.error} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      )}
      <button type="submit" className={styles.button} disabled={pending || !parsed.ok || !hydrated}>
        {pending ? "저장 중…" : "초안 저장"}
      </button>
    </form>
  );
}
