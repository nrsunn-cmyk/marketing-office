import type { TaxMode } from "@/domain/quote";

/** 견적서 한 장에 들어가는 내용. 확정본은 DB의 고정값(quote_versions·quote_items)에서 만든다. */
export interface QuoteDocument {
  status: "draft" | "final";
  quoteNumber: string | null;
  issueDate: string | null;
  validUntil: string | null;
  projectTitle: string;
  supplier: {
    legalName: string;
    representative: string | null;
    businessNumber: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  customer: { name: string };
  items: Array<{
    position: number;
    name: string;
    description: string | null;
    quantityHundredths: number;
    unitPriceWon: number;
    lineAmountWon: number;
  }>;
  taxMode: TaxMode;
  taxRateBasisPoints: number;
  subtotalWon: number;
  taxWon: number;
  totalWon: number;
  paymentTerms: string | null;
  notes: string | null;
}

export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  EXCLUSIVE: "부가세 별도",
  INCLUSIVE: "부가세 포함",
  NO_TAX: "세액 미적용",
};
