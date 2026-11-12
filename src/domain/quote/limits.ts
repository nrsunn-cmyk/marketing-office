/** 견적 입력 상한. 운영자 결정(D06) 전 제안값이며 이 파일에서만 바꾼다. */
export const QUOTE_LIMITS = {
  maxItems: 200,
  /** 수량 최대 1,000,000.00 (100배 정수) */
  maxQuantityHundredths: 100_000_000,
  /** 단가 최대 100억 원 */
  maxUnitPriceWon: 10_000_000_000,
  /** 세율 최대 100% (만분율) */
  maxTaxRateBasisPoints: 10_000,
} as const;

/** DB templates.key 와 같아야 한다 (tests/db 에서 확인) */
export const QUOTE_TEMPLATE_VERSION = "quote-template@1";

/** 기본 세율 10% (D06 확정 전 제안값) */
export const DEFAULT_TAX_RATE_BASIS_POINTS = 1000;
