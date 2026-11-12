import { QUOTE_LIMITS } from "./limits";
import type {
  QuoteCalculation,
  QuoteInput,
  QuoteIssue,
  QuoteItemInput,
  QuoteLineResult,
} from "./types";

const BP_SCALE = 10_000n;
const QTY_SCALE = 100n;

/** 0 이상 정수 n/d 를 사사오입한다. */
function roundHalfUpDiv(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

function checkItem(item: QuoteItemInput): QuoteIssue[] {
  const issues: QuoteIssue[] = [];
  const at = (code: QuoteIssue["code"], message: string) =>
    issues.push({ code, itemId: item.id, message });

  if (item.name.trim() === "") at("ITEM_NAME_REQUIRED", "항목명을 입력해 주세요.");

  const q = item.quantityHundredths;
  if (q === null) at("QUANTITY_REQUIRED", "수량을 입력해 주세요.");
  else if (!Number.isSafeInteger(q)) at("QUANTITY_INVALID", "수량은 소수 둘째 자리까지의 숫자여야 합니다.");
  else if (q <= 0) at("QUANTITY_NOT_POSITIVE", "수량은 0보다 커야 합니다.");
  else if (q > QUOTE_LIMITS.maxQuantityHundredths) at("QUANTITY_TOO_LARGE", "수량이 너무 큽니다.");

  const p = item.unitPriceWon;
  if (p === null) at("UNIT_PRICE_REQUIRED", "단가를 입력해 주세요.");
  else if (!Number.isSafeInteger(p)) at("UNIT_PRICE_INVALID", "단가는 원 단위 정수여야 합니다.");
  else if (p < 0) at("UNIT_PRICE_NEGATIVE", "단가는 0원 이상이어야 합니다.");
  else if (p > QUOTE_LIMITS.maxUnitPriceWon) at("UNIT_PRICE_TOO_LARGE", "단가가 너무 큽니다.");
  else if (p === 0 && !item.freeItemConfirmed)
    at("UNIT_PRICE_ZERO_UNCONFIRMED", "단가 0원은 무료 항목인지 확인이 필요합니다.");

  return issues;
}

/**
 * 견적 금액을 계산한다.
 *
 * - EXCLUSIVE(별도): 행 = round(수량×단가), 공급가 = Σ행, 세액 = round(공급가×세율), 합계 = 공급가+세액
 * - INCLUSIVE(포함): 행 = round(수량×단가), 합계 = Σ행, 공급가 = round(합계/(1+세율)), 세액 = 합계−공급가
 * - NO_TAX(미적용): 공급가 = 합계 = Σ행, 세액 = 0. 면세 적격 여부는 판정하지 않는다.
 *
 * 문제가 있는 행은 금액을 null로 두고 합계에서 뺀다. 초안 미리보기는 가능하지만
 * `isFinalizable`이 false면 확정·PDF 출력을 막아야 한다.
 */
export function calculateQuote(input: QuoteInput): QuoteCalculation {
  const issues: QuoteIssue[] = [];

  if (input.items.length === 0) {
    issues.push({ code: "ITEMS_REQUIRED", message: "견적 항목을 1개 이상 입력해 주세요." });
  }
  if (input.items.length > QUOTE_LIMITS.maxItems) {
    issues.push({ code: "TOO_MANY_ITEMS", message: `견적 항목은 ${QUOTE_LIMITS.maxItems}개까지입니다.` });
  }

  let rateBp = input.taxMode === "NO_TAX" ? 0 : input.taxRateBasisPoints;
  if (
    input.taxMode !== "NO_TAX" &&
    (!Number.isSafeInteger(rateBp) || rateBp < 0 || rateBp > QUOTE_LIMITS.maxTaxRateBasisPoints)
  ) {
    issues.push({ code: "TAX_RATE_INVALID", message: "세율이 올바르지 않습니다." });
    rateBp = 0;
  }

  const issueDate = input.issueDate ?? null;
  const validUntil = input.validUntil ?? null;
  const issueOk = issueDate === null || isValidDate(issueDate);
  const untilOk = validUntil === null || isValidDate(validUntil);
  if (!issueOk || !untilOk) {
    issues.push({ code: "DATE_INVALID", message: "날짜 형식이 올바르지 않습니다." });
  } else if (issueDate && validUntil && validUntil < issueDate) {
    issues.push({
      code: "VALID_UNTIL_BEFORE_ISSUE_DATE",
      message: "유효기간이 작성일보다 앞설 수 없습니다.",
    });
  }

  const lines: QuoteLineResult[] = [];
  let sum = 0n;
  for (const item of input.items) {
    const itemIssues = checkItem(item);
    issues.push(...itemIssues);
    const usable =
      itemIssues.length === 0 ||
      itemIssues.every((i) => i.code === "ITEM_NAME_REQUIRED" || i.code === "UNIT_PRICE_ZERO_UNCONFIRMED");
    if (!usable || item.quantityHundredths === null || item.unitPriceWon === null) {
      lines.push({ id: item.id, amountWon: null });
      continue;
    }
    const amount = roundHalfUpDiv(BigInt(item.quantityHundredths) * BigInt(item.unitPriceWon), QTY_SCALE);
    sum += amount;
    lines.push({ id: item.id, amountWon: Number(amount) });
  }

  const bp = BigInt(rateBp);
  let subtotal: bigint;
  let tax: bigint;
  let total: bigint;
  if (input.taxMode === "INCLUSIVE") {
    total = sum;
    subtotal = roundHalfUpDiv(total * BP_SCALE, BP_SCALE + bp);
    tax = total - subtotal;
  } else {
    subtotal = sum;
    tax = input.taxMode === "EXCLUSIVE" ? roundHalfUpDiv(subtotal * bp, BP_SCALE) : 0n;
    total = subtotal + tax;
  }

  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (total > max || subtotal > max) {
    issues.push({ code: "AMOUNT_TOO_LARGE", message: "합계 금액이 너무 큽니다." });
    return {
      taxMode: input.taxMode,
      taxRateBasisPoints: rateBp,
      lines: lines.map((l) => ({ id: l.id, amountWon: null })),
      subtotalWon: 0,
      taxWon: 0,
      totalWon: 0,
      issues,
      isFinalizable: false,
    };
  }

  return {
    taxMode: input.taxMode,
    taxRateBasisPoints: rateBp,
    lines,
    subtotalWon: Number(subtotal),
    taxWon: Number(tax),
    totalWon: Number(total),
    issues,
    isFinalizable: issues.length === 0,
  };
}
