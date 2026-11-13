import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { calculateQuote } from "@/domain/quote";
import type { QuoteDocument } from "./document";
import { koreanBreakPoints, renderQuotePdf } from "./pdf";

/** T10·V02: 한글 PDF 시제품 검증 */

function docFrom(items: Array<{ name: string; description?: string; qty: number; price: number }>, extra: Partial<QuoteDocument> = {}): QuoteDocument {
  const calc = calculateQuote({
    taxMode: "EXCLUSIVE",
    taxRateBasisPoints: 1000,
    items: items.map((it, i) => ({ id: String(i), name: it.name, quantityHundredths: it.qty, unitPriceWon: it.price })),
  });
  expect(calc.isFinalizable).toBe(true);
  return {
    status: "final",
    quoteNumber: "Q-2026-0001",
    issueDate: "2026-11-13",
    validUntil: "2026-12-13",
    projectTitle: "로고 제작",
    supplier: {
      legalName: "나다움 마케팅",
      representative: "대표자",
      businessNumber: "123-45-67890",
      phone: "010-0000-0000",
      email: "owner@example.test",
      address: "서울특별시 어딘가",
    },
    customer: { name: "가상고객A 베이커리" },
    items: items.map((it, i) => ({
      position: i,
      name: it.name,
      description: it.description ?? null,
      quantityHundredths: it.qty,
      unitPriceWon: it.price,
      lineAmountWon: calc.lines[i].amountWon!,
    })),
    taxMode: "EXCLUSIVE",
    taxRateBasisPoints: 1000,
    subtotalWon: calc.subtotalWon,
    taxWon: calc.taxWon,
    totalWon: calc.totalWon,
    paymentTerms: null,
    notes: null,
    ...extra,
  };
}

async function readPdf(buf: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { totalPages, text: text.replace(/\s+/g, " ") };
}

describe("한글 줄바꿈 지점", () => {
  it.each([
    ["Hello", ["Hello"]],
    ["가나", ["가", "", "나"]],
    ["50%는", ["50%", "", "는"]],
    ["입니다.", ["입", "", "니", "", "다."]],
    ["항목입니다.설명", ["항", "", "목", "", "입", "", "니", "", "다.", "", "설", "", "명"]],
    ["(주)나다움", ["(", "", "주)", "", "나", "", "다", "", "움"]],
  ])("%s", (word, expected) => {
    expect(koreanBreakPoints(word)).toEqual(expected);
  });
  it("조각을 이으면 원래 단어", () => {
    for (const w of ["계약금50%는", "Q-2026-0001번", "끝입니다…!"]) expect(koreanBreakPoints(w).join("")).toBe(w);
  });
  it("문장 부호로 시작하는 조각이 없다", () => {
    const parts = koreanBreakPoints("가.나,다!라%마)바").filter(Boolean);
    expect(parts.slice(1).some((p) => /^[.,!%)]/.test(p))).toBe(false);
  });
});

describe("견적서 PDF", () => {
  it("기본 견적: 한글이 그대로 읽히고 금액이 화면 계산과 같다", async () => {
    const buf = await renderQuotePdf(docFrom([{ name: "로고 기획", qty: 200, price: 50_000 }]));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const { totalPages, text } = await readPdf(buf);
    expect(totalPages).toBe(1);
    for (const t of ["견 적 서", "Q-2026-0001", "가상고객A 베이커리", "나다움 마케팅", "로고 기획", "100,000원", "10,000원", "110,000원", "부가세 별도", "1 / 1"]) {
      expect(text).toContain(t);
    }
  }, 30_000);

  it("T10 긴 회사명·30행·긴 지급 조건: 여러 쪽으로 나뉘고 모든 행과 합계가 들어간다", async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      name: `${i + 1}번째 항목 상세페이지디자인및촬영보정작업포함패키지`,
      description: i % 3 === 0 ? "설명이 긴 항목입니다. ".repeat(4) : undefined,
      qty: 100 + i,
      price: 10_000 * (i + 1),
    }));
    const longTerms = "계약금 50%는 계약 시, 잔금 50%는 납품 후 7일 이내 지급합니다. ".repeat(12);
    const doc = docFrom(items, {
      customer: { name: "주식회사 아주아주긴이름의가상고객사주식회사서울본점마케팅사업부".repeat(2) },
      paymentTerms: longTerms,
      notes: "비고 내용",
    });
    const buf = await renderQuotePdf(doc);
    if (process.env.SAVE_PDF_SAMPLES) writeFileSync(join(process.env.SAVE_PDF_SAMPLES, "quote-30rows.pdf"), buf);
    const { totalPages, text } = await readPdf(buf);
    expect(totalPages).toBeGreaterThan(1);
    for (let i = 1; i <= 30; i += 1) expect(text).toContain(`${i}번째 항목`);
    expect(text).toContain(`합계 ${doc.totalWon.toLocaleString("ko-KR")}원`);
    expect(text).toContain(`1 / ${totalPages}`);
    expect(text).toContain(`${totalPages} / ${totalPages}`);
    // 줄바꿈 때문에 하이픈이 끼어들지 않는다
    expect(text).not.toMatch(/[가-힣]-\s?[가-힣]/);
  }, 30_000);

  it("초안은 번호 없이 '초안' 표시", async () => {
    const buf = await renderQuotePdf(docFrom([{ name: "항목", qty: 100, price: 1_000 }], { status: "draft", quoteNumber: null }));
    const { text } = await readPdf(buf);
    expect(text).toContain("초안 (번호 없음)");
    expect(text).toContain("초안");
  }, 30_000);

  it("같은 입력이면 같은 내용 (재출력해도 금액·문구가 같다, T11)", async () => {
    const doc = docFrom([{ name: "항목", qty: 150, price: 33_333 }]);
    const a = await readPdf(await renderQuotePdf(doc));
    const b = await readPdf(await renderQuotePdf(doc));
    expect(a.text).toBe(b.text);
  }, 30_000);
});
