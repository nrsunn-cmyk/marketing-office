import { describe, expect, it } from "vitest";
import { calculateDraft, draftToForm, emptyQuoteForm, parseQuoteForm, type QuoteFormText } from "./form";

const base = (rows: QuoteFormText["rows"], extra: Partial<QuoteFormText> = {}): QuoteFormText => ({
  taxMode: "EXCLUSIVE",
  taxRate: "10",
  issueDate: "2026-11-13",
  validUntil: "",
  paymentTerms: "",
  notes: "",
  rows,
  ...extra,
});
const row = (id: string, name: string, quantity: string, unitPrice: string) => ({
  id,
  name,
  description: "",
  quantity,
  unitPrice,
  freeItemConfirmed: false,
  zeroAmountConfirmed: false,
});

describe("견적 입력 → 초안", () => {
  it("글자 입력을 정수 값으로 바꾸고 계산한다", () => {
    const r = parseQuoteForm(base([row("a", "로고 기획", "2", "50,000원")]));
    if (!r.ok) throw new Error("parse");
    expect(r.draft.items[0]).toMatchObject({ quantityHundredths: 200, unitPriceWon: 50_000 });
    expect(r.draft.taxRateBasisPoints).toBe(1000);
    const c = calculateDraft(r.draft);
    expect([c.subtotalWon, c.taxWon, c.totalWon, c.isFinalizable]).toEqual([100_000, 10_000, 110_000, true]);
  });

  it("빈 단가는 오류가 아니라 미입력 (초안 저장 가능, 확정은 불가)", () => {
    const r = parseQuoteForm(base([row("a", "x", "1", "")]));
    if (!r.ok) throw new Error("parse");
    expect(r.draft.items[0].unitPriceWon).toBeNull();
    expect(calculateDraft(r.draft).isFinalizable).toBe(false);
  });

  it("잘못된 숫자는 줄·칸별 오류", () => {
    const r = parseQuoteForm(base([row("a", "x", "1 0", "5만"), row("b", "y", "1", "1")], { taxRate: "10원" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({
      taxRate: "세율: 숫자 형식이 아닙니다",
      "row-a-quantity": "1번째 줄 수량: 숫자 형식이 아닙니다",
      "row-a-unitPrice": "1번째 줄 단가: 숫자 형식이 아닙니다",
    });
  });

  it("세액 미적용이면 세율 칸은 보지 않는다", () => {
    const r = parseQuoteForm(base([row("a", "x", "1", "1000")], { taxMode: "NO_TAX", taxRate: "엉망" }));
    expect(r.ok && r.draft.taxRateBasisPoints).toBe(0);
  });

  it("작성일이 없으면 확정 불가", () => {
    const r = parseQuoteForm(base([row("a", "x", "1", "1000")], { issueDate: "" }));
    if (!r.ok) throw new Error("parse");
    const c = calculateDraft(r.draft);
    expect(c.isFinalizable).toBe(false);
    expect(c.issues.map((i) => i.message)).toContain("작성일을 입력해 주세요.");
  });

  it("저장한 초안을 다시 열면 같은 값 (입력 ↔ 저장 왕복)", () => {
    const form = base([row("a", "로고", "1.5", "1,234,567"), row("b", "무료 상담", "1", "0")], {
      taxMode: "INCLUSIVE",
      taxRate: "3.3",
      paymentTerms: "선금 50%",
    });
    form.rows[1].freeItemConfirmed = true;
    const r1 = parseQuoteForm(form);
    if (!r1.ok) throw new Error("parse");
    const r2 = parseQuoteForm(draftToForm(r1.draft));
    expect(r2).toEqual(r1);
  });

  it("빈 양식은 오늘 날짜·세율 10%·한 줄", () => {
    const f = emptyQuoteForm("2026-11-13", () => "id1");
    expect(f).toMatchObject({ taxMode: "EXCLUSIVE", taxRate: "10", issueDate: "2026-11-13" });
    expect(f.rows).toHaveLength(1);
  });
});
