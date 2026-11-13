import { describe, expect, it } from "vitest";
import { formatQuantity, formatTaxRate, formatWon, parseQuantity, parseTaxRatePercent, parseWon } from "./parse";

describe("parseQuantity", () => {
  it.each([
    ["1", 100],
    ["1.5", 150],
    ["1.50", 150],
    ["0.01", 1],
    ["1,000", 100_000],
    [" 2 ", 200],
    ["\t3\n", 300],
    ["1.500", 150],
  ])("%j → %s", (text, value) => {
    expect(parseQuantity(text)).toEqual({ ok: true, value });
  });

  it("빈 입력은 0이 아니라 null", () => {
    expect(parseQuantity("")).toEqual({ ok: true, value: null });
    expect(parseQuantity("   ")).toEqual({ ok: true, value: null });
  });

  it.each([
    ["1.234", "TOO_PRECISE"],
    ["-1", "NEGATIVE"],
    ["abc", "INVALID"],
    ["1,00", "INVALID"],
    ["1e3", "INVALID"],
    ["99999999999999999999", "TOO_LARGE"],
    // CR01: 숫자 안의 공백·줄바꿈·탭은 이어 붙이지 않는다
    ["1\n2", "INVALID"],
    ["1 2", "INVALID"],
    ["1\t2", "INVALID"],
    ["1. 5", "INVALID"],
    // CR01: 수량에는 단위를 받지 않는다
    ["2원", "INVALID"],
    ["2%", "INVALID"],
    ["2개", "INVALID"],
  ])("%j → %s", (text, reason) => {
    expect(parseQuantity(text)).toEqual({ ok: false, reason });
  });
});

describe("parseWon", () => {
  it.each([
    ["50000", 50_000],
    ["50,000", 50_000],
    ["50,000원", 50_000],
    ["50,000 원", 50_000],
    [" 50,000원\n", 50_000],
    ["0", 0],
  ])("%j → %s", (text, value) => {
    expect(parseWon(text)).toEqual({ ok: true, value });
  });

  it("빈 입력은 null", () => {
    expect(parseWon("")).toEqual({ ok: true, value: null });
  });

  it.each([
    ["10.5", "INVALID"],
    ["-100", "NEGATIVE"],
    ["5만", "INVALID"],
    // CR01 재현
    ["1 0", "INVALID"],
    ["1\n0", "INVALID"],
    ["50,000  원", "INVALID"],
    ["50,000원원", "INVALID"],
    ["50,000%", "INVALID"],
    ["원50,000", "INVALID"],
    ["50,00", "INVALID"],
    ["5,0000", "INVALID"],
    [",000", "INVALID"],
  ])("%j → %s", (text, reason) => {
    expect(parseWon(text)).toEqual({ ok: false, reason });
  });
});

describe("parseTaxRatePercent", () => {
  it.each([
    ["10", 1000],
    ["10%", 1000],
    ["10 %", 1000],
    ["3.3", 330],
    ["3.3%", 330],
    ["0", 0],
  ])("%j → %s bp", (text, value) => {
    expect(parseTaxRatePercent(text)).toEqual({ ok: true, value });
  });

  it("빈 입력은 null", () => {
    expect(parseTaxRatePercent(" ")).toEqual({ ok: true, value: null });
  });

  it.each([
    // CR01 재현: 세율 칸의 '원'은 오류
    ["10원", "INVALID"],
    ["1 0", "INVALID"],
    ["10%%", "INVALID"],
    ["%10", "INVALID"],
    ["-10", "NEGATIVE"],
    ["3.333", "TOO_PRECISE"],
  ])("%j → %s", (text, reason) => {
    expect(parseTaxRatePercent(text)).toEqual({ ok: false, reason });
  });
});

describe("formatQuantity / formatTaxRate", () => {
  it.each([
    [100, "1"],
    [150, "1.5"],
    [105, "1.05"],
    [1, "0.01"],
    [100_000, "1,000"],
    [123_456_78, "123,456.78"],
  ])("%s → %s", (h, text) => {
    expect(formatQuantity(h)).toBe(text);
    // 다시 읽으면 같은 값 (표시 ↔ 입력이 어긋나지 않는다)
    expect(parseQuantity(text)).toEqual({ ok: true, value: h });
  });
  it("세율", () => {
    expect(formatTaxRate(1000)).toBe("10");
    expect(formatTaxRate(330)).toBe("3.3");
    expect(formatTaxRate(0)).toBe("0");
  });
});

describe("formatWon", () => {
  it("천 단위 쉼표", () => {
    expect(formatWon(110_000)).toBe("110,000");
  });
});
