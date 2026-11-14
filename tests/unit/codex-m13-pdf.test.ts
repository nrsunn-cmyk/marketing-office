import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { renderQuotePdf } from "@/features/quotes/pdf";
import type { QuoteDocument } from "@/features/quotes/document";

/**
 * CR09 (Codex M13 검수): 허용 길이 안의 긴 특기사항이 잘리거나 겹치지 않고 여러 쪽으로 이어져야 한다.
 * Codex 재현 코드(Plan/Codex-Remaining-Work-20261114/repro/m13-pdf.test.ts)를 바탕으로 경우를 넓혔다.
 */

function base(over: Partial<QuoteDocument> = {}): QuoteDocument {
  return {
    status: "final",
    quoteNumber: "Q-REVIEW-001",
    issueDate: "2026-11-14",
    validUntil: "2026-12-14",
    projectTitle: "검수용 합성 견적",
    supplier: { legalName: "합성 공급자", representative: "검수", businessNumber: null, phone: null, email: null, address: null, bankAccount: "합성 계좌" },
    customer: { name: "합성 고객" },
    items: [{ position: 0, name: "검수 항목", description: null, quantityHundredths: 100, unitPriceWon: 1000, lineAmountWon: 1000 }],
    taxMode: "EXCLUSIVE",
    taxRateBasisPoints: 1000,
    subtotalWon: 1000,
    taxWon: 100,
    totalWon: 1100,
    paymentTerms: null,
    notes: null,
    ...over,
  };
}

const FOOTER_TOP = 34; // 바닥에서 바닥글 위치(pt). 본문은 바닥 여백(52pt) 위에만 있어야 한다.

/** 쪽마다 글자 위치를 모아 종이 밖·바닥글 영역 침범·같은 줄 겹침을 찾는다. */
async function inspect(buffer: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const text = (await extractText(pdf, { mergePages: true })).text.replace(/\s+/g, " ");
  const problems: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const height = page.view[3];
    const items = (await page.getTextContent()).items.flatMap((it) =>
      "transform" in it && it.str.trim() ? [{ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width }] : [],
    );
    for (const it of items) {
      if (it.y < 0 || it.y > height) problems.push(`${n}쪽 종이 밖: ${it.s}`);
      const isFooter = /^\d+ \/ \d+$|쪽|Q-REVIEW|견적번호/.test(it.s) && it.y < FOOTER_TOP + 10;
      if (!isFooter && it.y < FOOTER_TOP + 6) problems.push(`${n}쪽 바닥글 영역 침범(y=${it.y.toFixed(1)}): ${it.s}`);
    }
    // 같은 위치(가로 겹침 + 세로 3pt 이내)에 서로 다른 글자가 찍히면 겹침
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i]!, b = items[j]!;
        if (Math.abs(a.y - b.y) < 3 && a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1) problems.push(`${n}쪽 겹침: "${a.s}" / "${b.s}"`);
      }
    }
  }
  return { pages: pdf.numPages, text, problems };
}

describe("CR09 긴 특기사항", () => {
  it("결제 조건 25줄 + 비고 80줄(Codex 재현)이 마지막 줄까지 쪽 안에 인쇄된다", async () => {
    const doc = base({
      paymentTerms: Array.from({ length: 25 }, (_, i) => `지급 조건 ${i + 1}: 검수용 합성 문구`).join("\n"),
      notes: Array.from({ length: 80 }, (_, i) => `비고 ${i + 1}: 이 문구는 인쇄되어야 합니다`).join("\n"),
    });
    expect(doc.paymentTerms!.length).toBeLessThanOrEqual(2000);
    expect(doc.notes!.length).toBeLessThanOrEqual(4000);
    const buffer = await renderQuotePdf(doc);
    if (process.env.SAVE_PDF_SAMPLES) writeFileSync(join(tmpdir(), "m13-long-notes.pdf"), buffer);
    const r = await inspect(buffer);
    expect(r.pages).toBeGreaterThan(1);
    for (let i = 1; i <= 25; i += 1) expect(r.text).toContain(`지급 조건 ${i}: 검수용 합성 문구`);
    for (let i = 1; i <= 80; i += 1) expect(r.text).toContain(`비고 ${i}: 이 문구는 인쇄되어야 합니다`);
    expect(r.problems).toEqual([]);
  }, 60_000);

  it("줄바꿈 없는 4000자 비고와 2000자 결제 조건도 끝까지 들어간다", async () => {
    const notes = "가나다라마바사아자차".repeat(399) + "끝표시비고";
    const paymentTerms = "결제조건문구".repeat(331) + "끝결제";
    expect(notes.length).toBeLessThanOrEqual(4000);
    expect(paymentTerms.length).toBeLessThanOrEqual(2000);
    const r = await inspect(await renderQuotePdf(base({ notes, paymentTerms })));
    expect(r.text.replace(/ /g, "")).toContain("끝표시비고");
    expect(r.text.replace(/ /g, "")).toContain("끝결제");
    expect(r.problems).toEqual([]);
  }, 60_000);

  it.each([30, 200])("품목 %i개 + 긴 특기사항: 합계·특기사항이 모두 들어가고 겹치지 않는다", async (count) => {
    const items = Array.from({ length: count }, (_, i) => ({
      position: i,
      name: i % 7 === 0 ? `아주 긴 품목 이름 ${i + 1} `.repeat(6) : `품목 ${i + 1}`,
      description: i % 5 === 0 ? "규격 설명 ".repeat(10) : null,
      quantityHundredths: 100,
      unitPriceWon: 1000,
      lineAmountWon: 1000,
    }));
    const doc = base({
      items,
      subtotalWon: count * 1000,
      taxWon: count * 100,
      totalWon: count * 1100,
      paymentTerms: Array.from({ length: 10 }, (_, i) => `지급 ${i + 1}`).join("\n"),
      notes: Array.from({ length: 40 }, (_, i) => `메모 ${i + 1} 마지막확인`).join("\n"),
    });
    const r = await inspect(await renderQuotePdf(doc));
    expect(r.text).toContain(`품목 ${count}`);
    expect(r.text).toContain("메모 40 마지막확인");
    expect(r.text).toContain("합계");
    expect(r.problems).toEqual([]);
  }, 60_000);
});
