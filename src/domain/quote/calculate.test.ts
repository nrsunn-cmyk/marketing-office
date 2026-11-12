import { describe, expect, it } from "vitest";
import { calculateQuote } from "./calculate";
import type { QuoteInput, QuoteItemInput, TaxMode } from "./types";

let seq = 0;
function item(qty: number | null, price: number | null, extra: Partial<QuoteItemInput> = {}): QuoteItemInput {
  seq += 1;
  return { id: `row-${seq}`, name: `항목 ${seq}`, quantityHundredths: qty, unitPriceWon: price, ...extra };
}

function quote(taxMode: TaxMode, items: QuoteItemInput[], rateBp = 1000, extra: Partial<QuoteInput> = {}): QuoteInput {
  return { taxMode, taxRateBasisPoints: rateBp, items, ...extra };
}

const codes = (r: ReturnType<typeof calculateQuote>) => r.issues.map((i) => i.code);

describe("T08 고정 예제 (Codex 05 §6)", () => {
  it("별도 10%: 2×50,000 → 공급가 100,000 + 세액 10,000 = 110,000", () => {
    const r = calculateQuote(quote("EXCLUSIVE", [item(200, 50_000)]));
    expect([r.subtotalWon, r.taxWon, r.totalWon]).toEqual([100_000, 10_000, 110_000]);
    expect(r.isFinalizable).toBe(true);
  });

  it("포함 10%: 1×110,000 → 공급가 100,000 + 세액 10,000", () => {
    const r = calculateQuote(quote("INCLUSIVE", [item(100, 110_000)]));
    expect([r.subtotalWon, r.taxWon, r.totalWon]).toEqual([100_000, 10_000, 110_000]);
  });

  it("별도 10%: 3×33,333 → 99,999 + 10,000 = 109,999 (세액 9,999.9 사사오입)", () => {
    const r = calculateQuote(quote("EXCLUSIVE", [item(300, 33_333)]));
    expect([r.subtotalWon, r.taxWon, r.totalWon]).toEqual([99_999, 10_000, 109_999]);
  });
});

describe("T08 경계값 표 (구현 계획 C12)", () => {
  const cases: Array<[string, QuoteInput, [number, number, number]]> = [
    ["미적용: 세액 0, 세율 입력 무시", quote("NO_TAX", [item(200, 50_000)], 1000), [100_000, 0, 100_000]],
    ["별도 세율 0%", quote("EXCLUSIVE", [item(100, 12_345)], 0), [12_345, 0, 12_345]],
    ["소수 수량 1.5×10,001 → 행 15,001.5 사사오입 15,002", quote("EXCLUSIVE", [item(150, 10_001)]), [15_002, 1_500, 16_502]],
    ["최소 수량 0.01×1 → 0.01원은 0원", quote("EXCLUSIVE", [item(1, 1)]), [0, 0, 0]],
    ["0.01×50 → 0.5원 사사오입 1원", quote("EXCLUSIVE", [item(1, 50)]), [1, 0, 1]],
    ["포함 모드 나눗셈: 합계 1,000 → 공급가 909.09… → 909, 세액 91", quote("INCLUSIVE", [item(100, 1_000)]), [909, 91, 1_000]],
    ["포함 모드: 합계 5 → 공급가 4.545… → 5, 세액 0", quote("INCLUSIVE", [item(100, 5)]), [5, 0, 5]],
    ["별도 세율 3.3%(330bp): 100,000 → 3,300", quote("EXCLUSIVE", [item(100, 100_000)], 330), [100_000, 3_300, 103_300]],
  ];
  it.each(cases)("%s", (_name, input, expected) => {
    const r = calculateQuote(input);
    expect([r.subtotalWon, r.taxWon, r.totalWon]).toEqual(expected);
  });

  it("행 30개 합계가 행 금액 합과 같다", () => {
    const items = Array.from({ length: 30 }, (_, i) => item(100 + i * 7, 1_000 * (i + 1) + 333));
    const r = calculateQuote(quote("EXCLUSIVE", items));
    const lineSum = r.lines.reduce((s, l) => s + (l.amountWon ?? 0), 0);
    expect(r.subtotalWon).toBe(lineSum);
    expect(r.totalWon).toBe(r.subtotalWon + r.taxWon);
    expect(r.isFinalizable).toBe(true);
  });

  it("최대 단가 × 최대 수량도 정확한 정수로 계산한다", () => {
    const r = calculateQuote(quote("EXCLUSIVE", [item(100_000_000, 1_000)]));
    expect(r.subtotalWon).toBe(1_000_000_000);
    expect(r.taxWon).toBe(100_000_000);
  });

  it("합계가 안전한 정수 범위를 넘으면 확정을 막는다", () => {
    const items = Array.from({ length: 200 }, () => item(100_000_000, 10_000_000_000));
    const r = calculateQuote(quote("EXCLUSIVE", items));
    expect(codes(r)).toContain("AMOUNT_TOO_LARGE");
    expect(r.isFinalizable).toBe(false);
    expect(r.totalWon).toBe(0);
  });
});

describe("T09 부적합 입력 차단", () => {
  it("빈 단가는 0으로 확정하지 않는다", () => {
    const r = calculateQuote(quote("EXCLUSIVE", [item(100, null)]));
    expect(codes(r)).toEqual(["UNIT_PRICE_REQUIRED"]);
    expect(r.lines[0].amountWon).toBeNull();
    expect(r.isFinalizable).toBe(false);
  });

  it("단가 0원은 무료 확인 전까지 확정 불가, 확인 후 허용", () => {
    const before = calculateQuote(quote("EXCLUSIVE", [item(100, 0)]));
    expect(codes(before)).toEqual(["UNIT_PRICE_ZERO_UNCONFIRMED"]);
    expect(before.isFinalizable).toBe(false);
    const after = calculateQuote(quote("EXCLUSIVE", [item(100, 0, { freeItemConfirmed: true })]));
    expect(after.issues).toEqual([]);
    expect(after.totalWon).toBe(0);
  });

  it.each([
    ["음수 단가", item(100, -1), "UNIT_PRICE_NEGATIVE"],
    ["소수 단가", item(100, 10.5), "UNIT_PRICE_INVALID"],
    ["NaN 단가", item(100, Number.NaN), "UNIT_PRICE_INVALID"],
    ["무한대 단가", item(100, Number.POSITIVE_INFINITY), "UNIT_PRICE_INVALID"],
    ["단가 상한 초과", item(100, 10_000_000_001), "UNIT_PRICE_TOO_LARGE"],
    ["수량 미입력", item(null, 1_000), "QUANTITY_REQUIRED"],
    ["수량 0", item(0, 1_000), "QUANTITY_NOT_POSITIVE"],
    ["음수 수량", item(-100, 1_000), "QUANTITY_NOT_POSITIVE"],
    ["수량 NaN", item(Number.NaN, 1_000), "QUANTITY_INVALID"],
    ["수량 상한 초과", item(100_000_001, 1_000), "QUANTITY_TOO_LARGE"],
  ])("%s", (_name, it_, code) => {
    const r = calculateQuote(quote("EXCLUSIVE", [it_]));
    expect(codes(r)).toEqual([code]);
    expect(r.lines[0].amountWon).toBeNull();
    expect(r.isFinalizable).toBe(false);
  });

  it("1원 미만이라 0원이 되는 줄은 확인 전까지 확정 불가, 확인 후 허용 (사용자 결정 2026-11-13)", () => {
    const before = calculateQuote(quote("EXCLUSIVE", [item(1, 1)]));
    expect(codes(before)).toEqual(["LINE_ROUNDS_TO_ZERO_UNCONFIRMED"]);
    expect(before.lines[0].amountWon).toBe(0);
    expect(before.isFinalizable).toBe(false);
    const after = calculateQuote(quote("EXCLUSIVE", [item(1, 1, { zeroAmountConfirmed: true })]));
    expect(after.issues).toEqual([]);
    expect(after.isFinalizable).toBe(true);
  });

  it("0.5원 이상이면 1원으로 올라가 경고 없음", () => {
    const r = calculateQuote(quote("EXCLUSIVE", [item(1, 50)]));
    expect(r.issues).toEqual([]);
    expect(r.lines[0].amountWon).toBe(1);
  });

  it("확인된 무료 항목(단가 0원)은 0원 줄 경고 대상이 아니다", () => {
    const r = calculateQuote(quote("EXCLUSIVE", [item(1, 0, { freeItemConfirmed: true })]));
    expect(r.issues).toEqual([]);
  });

  it("문제 있는 행은 합계에서 빠지고 나머지는 미리보기로 계산된다", () => {
    const r = calculateQuote(quote("EXCLUSIVE", [item(100, 10_000), item(100, null)]));
    expect(r.subtotalWon).toBe(10_000);
    expect(r.isFinalizable).toBe(false);
  });

  it("항목명이 비면 금액은 계산하되 확정은 막는다", () => {
    const r = calculateQuote(quote("EXCLUSIVE", [item(100, 10_000, { name: "  " })]));
    expect(codes(r)).toEqual(["ITEM_NAME_REQUIRED"]);
    expect(r.lines[0].amountWon).toBe(10_000);
    expect(r.isFinalizable).toBe(false);
  });

  it("항목이 없으면 확정 불가", () => {
    expect(codes(calculateQuote(quote("EXCLUSIVE", [])))).toEqual(["ITEMS_REQUIRED"]);
  });

  it("항목 201개는 거절", () => {
    const items = Array.from({ length: 201 }, () => item(100, 1));
    expect(codes(calculateQuote(quote("EXCLUSIVE", items)))).toContain("TOO_MANY_ITEMS");
  });

  it.each([-1, 10_001, 10.5, Number.NaN])("잘못된 세율 %s 거절", (bp) => {
    const r = calculateQuote(quote("EXCLUSIVE", [item(100, 1_000)], bp));
    expect(codes(r)).toEqual(["TAX_RATE_INVALID"]);
    expect(r.isFinalizable).toBe(false);
  });

  it("미적용 모드에서는 세율 값을 검사하지 않는다", () => {
    const r = calculateQuote(quote("NO_TAX", [item(100, 1_000)], Number.NaN));
    expect(r.issues).toEqual([]);
    expect(r.taxRateBasisPoints).toBe(0);
  });

  it("유효기간이 작성일보다 앞서면 확정 불가", () => {
    const r = calculateQuote(
      quote("EXCLUSIVE", [item(100, 1_000)], 1000, { issueDate: "2026-11-13", validUntil: "2026-11-12" }),
    );
    expect(codes(r)).toEqual(["VALID_UNTIL_BEFORE_ISSUE_DATE"]);
  });

  it.each(["2026-02-30", "2026-13-01", "26-11-13", "2026/11/13"])("잘못된 날짜 %s 거절", (d) => {
    const r = calculateQuote(quote("EXCLUSIVE", [item(100, 1_000)], 1000, { issueDate: d }));
    expect(codes(r)).toEqual(["DATE_INVALID"]);
  });

  it("오류에는 문제 행 id가 붙는다", () => {
    const bad = item(100, null);
    const r = calculateQuote(quote("EXCLUSIVE", [item(100, 1), bad]));
    expect(r.issues[0].itemId).toBe(bad.id);
  });
});
