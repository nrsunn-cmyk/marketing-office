/**
 * 견적 입력 화면의 글자 입력 ↔ 계산용 값.
 * 화면(미리 계산)과 서버(저장·확정)가 같은 함수를 써서 결과가 어긋나지 않게 한다.
 */
import { calculateQuote } from "./calculate";
import { formatQuantity, formatTaxRate, parseQuantity, parseTaxRatePercent, parseWon, type ParseResult } from "./parse";
import type { QuoteCalculation, QuoteInput, TaxMode } from "./types";

export interface QuoteRowText {
  id: string;
  name: string;
  description: string;
  quantity: string;
  unitPrice: string;
  freeItemConfirmed: boolean;
  zeroAmountConfirmed: boolean;
}

export interface QuoteFormText {
  taxMode: TaxMode;
  taxRate: string;
  issueDate: string;
  validUntil: string;
  paymentTerms: string;
  notes: string;
  rows: QuoteRowText[];
}

/** 저장되는 견적 초안 (artifact_versions.content.form) */
export interface QuoteDraft {
  taxMode: TaxMode;
  taxRateBasisPoints: number;
  issueDate: string | null;
  validUntil: string | null;
  paymentTerms: string | null;
  notes: string | null;
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    quantityHundredths: number | null;
    unitPriceWon: number | null;
    freeItemConfirmed: boolean;
    zeroAmountConfirmed: boolean;
  }>;
}

const REASON_TEXT: Record<Exclude<ParseResult, { ok: true }>["reason"], string> = {
  INVALID: "숫자 형식이 아닙니다",
  TOO_PRECISE: "소수 둘째 자리까지 입력할 수 있습니다",
  NEGATIVE: "0보다 작을 수 없습니다",
  TOO_LARGE: "너무 큰 숫자입니다",
};

export type DraftParse = { ok: true; draft: QuoteDraft } | { ok: false; errors: Record<string, string> };

/** 글자 입력을 초안 값으로 바꾼다. 숫자 형식 오류는 칸별로 돌려준다(빈 칸은 오류가 아니라 '미입력'). */
export function parseQuoteForm(form: QuoteFormText): DraftParse {
  const errors: Record<string, string> = {};
  const rate = form.taxMode === "NO_TAX" ? { ok: true as const, value: 0 } : parseTaxRatePercent(form.taxRate);
  if (!rate.ok) errors.taxRate = `세율: ${REASON_TEXT[rate.reason]}`;
  else if (rate.value === null) errors.taxRate = "세율을 입력해 주세요";

  const items = form.rows.map((r, i) => {
    const q = parseQuantity(r.quantity);
    const p = parseWon(r.unitPrice);
    if (!q.ok) errors[`row-${r.id}-quantity`] = `${i + 1}번째 줄 수량: ${REASON_TEXT[q.reason]}`;
    if (!p.ok) errors[`row-${r.id}-unitPrice`] = `${i + 1}번째 줄 단가: ${REASON_TEXT[p.reason]}`;
    return {
      id: r.id,
      name: r.name.trim().slice(0, 200),
      description: r.description.trim().slice(0, 1000) || null,
      quantityHundredths: q.ok ? q.value : null,
      unitPriceWon: p.ok ? p.value : null,
      freeItemConfirmed: r.freeItemConfirmed,
      zeroAmountConfirmed: r.zeroAmountConfirmed,
    };
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    draft: {
      taxMode: form.taxMode,
      taxRateBasisPoints: rate.ok && rate.value !== null ? rate.value : 0,
      issueDate: form.issueDate.trim() || null,
      validUntil: form.validUntil.trim() || null,
      paymentTerms: form.paymentTerms.trim().slice(0, 2000) || null,
      notes: form.notes.trim().slice(0, 4000) || null,
      items,
    },
  };
}

export function draftToCalculationInput(d: QuoteDraft): QuoteInput {
  return {
    taxMode: d.taxMode,
    taxRateBasisPoints: d.taxRateBasisPoints,
    issueDate: d.issueDate,
    validUntil: d.validUntil,
    items: d.items.map((it) => ({
      id: it.id,
      name: it.name,
      quantityHundredths: it.quantityHundredths,
      unitPriceWon: it.unitPriceWon,
      freeItemConfirmed: it.freeItemConfirmed,
      zeroAmountConfirmed: it.zeroAmountConfirmed,
    })),
  };
}

export function calculateDraft(d: QuoteDraft): QuoteCalculation {
  const calc = calculateQuote(draftToCalculationInput(d));
  // 확정에는 작성일이 꼭 필요하다
  if (!d.issueDate) {
    return {
      ...calc,
      issues: [...calc.issues, { code: "DATE_INVALID", message: "작성일을 입력해 주세요." }],
      isFinalizable: false,
    };
  }
  return calc;
}

/** 저장된 초안 → 화면 글자 입력 (다시 열었을 때) */
export function draftToForm(d: QuoteDraft): QuoteFormText {
  return {
    taxMode: d.taxMode,
    taxRate: d.taxMode === "NO_TAX" ? "0" : formatTaxRate(d.taxRateBasisPoints),
    issueDate: d.issueDate ?? "",
    validUntil: d.validUntil ?? "",
    paymentTerms: d.paymentTerms ?? "",
    notes: d.notes ?? "",
    rows: d.items.map((it) => ({
      id: it.id,
      name: it.name,
      description: it.description ?? "",
      quantity: it.quantityHundredths === null ? "" : formatQuantity(it.quantityHundredths),
      unitPrice: it.unitPriceWon === null ? "" : it.unitPriceWon.toLocaleString("ko-KR"),
      freeItemConfirmed: it.freeItemConfirmed,
      zeroAmountConfirmed: it.zeroAmountConfirmed,
    })),
  };
}

export function emptyQuoteForm(today: string, newId: () => string): QuoteFormText {
  return {
    taxMode: "EXCLUSIVE",
    taxRate: "10",
    issueDate: today,
    validUntil: "",
    paymentTerms: "",
    notes: "",
    rows: [{ id: newId(), name: "", description: "", quantity: "1", unitPrice: "", freeItemConfirmed: false, zeroAmountConfirmed: false }],
  };
}
