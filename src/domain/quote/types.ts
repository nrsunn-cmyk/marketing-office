/**
 * 견적 계산 타입.
 *
 * 금액 표현 규칙 (구현 계획 C07):
 * - 금액: 원 단위 정수 (number, safe integer)
 * - 수량: 100배 정수 (1.5개 → 150)
 * - 세율: 만분율 정수 (10% → 1000)
 * 부동소수점으로 금액을 계산하지 않는다.
 */

export type TaxMode = "EXCLUSIVE" | "INCLUSIVE" | "NO_TAX";

export interface QuoteItemInput {
  /** 화면 행 식별자. 오류 위치를 알려 줄 때 쓴다. */
  id: string;
  name: string;
  /** 100배 정수. 입력하지 않았으면 null. */
  quantityHundredths: number | null;
  /** 원 단위 정수. 입력하지 않았으면 null (0과 다르다). */
  unitPriceWon: number | null;
  /** 단가 0원을 '무료 항목'으로 명시 확인했는지. */
  freeItemConfirmed?: boolean;
}

export interface QuoteInput {
  taxMode: TaxMode;
  /** 만분율 정수. NO_TAX면 무시하고 0으로 본다. */
  taxRateBasisPoints: number;
  items: QuoteItemInput[];
  /** YYYY-MM-DD */
  issueDate?: string | null;
  /** YYYY-MM-DD */
  validUntil?: string | null;
}

export type QuoteIssueCode =
  | "ITEMS_REQUIRED"
  | "TOO_MANY_ITEMS"
  | "TAX_RATE_INVALID"
  | "ITEM_NAME_REQUIRED"
  | "QUANTITY_REQUIRED"
  | "QUANTITY_INVALID"
  | "QUANTITY_NOT_POSITIVE"
  | "QUANTITY_TOO_LARGE"
  | "UNIT_PRICE_REQUIRED"
  | "UNIT_PRICE_INVALID"
  | "UNIT_PRICE_NEGATIVE"
  | "UNIT_PRICE_TOO_LARGE"
  | "UNIT_PRICE_ZERO_UNCONFIRMED"
  | "DATE_INVALID"
  | "VALID_UNTIL_BEFORE_ISSUE_DATE"
  | "AMOUNT_TOO_LARGE";

export interface QuoteIssue {
  code: QuoteIssueCode;
  /** 문제가 있는 항목 행 id. 견적 전체 문제면 없음. */
  itemId?: string;
  message: string;
}

export interface QuoteLineResult {
  id: string;
  /** 계산할 수 없는 행이면 null. 합계에서 빠진다. */
  amountWon: number | null;
}

export interface QuoteCalculation {
  taxMode: TaxMode;
  taxRateBasisPoints: number;
  lines: QuoteLineResult[];
  /** 공급가액 */
  subtotalWon: number;
  /** 세액 */
  taxWon: number;
  /** 합계 */
  totalWon: number;
  issues: QuoteIssue[];
  /** 문제가 하나도 없어야 true. 확정·PDF 출력은 true일 때만 허용한다. */
  isFinalizable: boolean;
}
