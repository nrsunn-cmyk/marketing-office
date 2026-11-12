import { describe, expect, it } from "vitest";
import { formatWon, parseQuantity, parseTaxRatePercent, parseWon } from "./parse";

describe("parseQuantity", () => {
  it.each([
    ["1", 100],
    ["1.5", 150],
    ["1.50", 150],
    ["0.01", 1],
    ["1,000", 100_000],
    [" 2 ", 200],
    ["1.500", 150],
  ])("%s → %s", (text, value) => {
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
  ])("%s → %s", (text, reason) => {
    expect(parseQuantity(text)).toEqual({ ok: false, reason });
  });
});

describe("parseWon", () => {
  it.each([
    ["50000", 50_000],
    ["50,000", 50_000],
    ["50,000원", 50_000],
    ["0", 0],
  ])("%s → %s", (text, value) => {
    expect(parseWon(text)).toEqual({ ok: true, value });
  });

  it("빈 입력은 null", () => {
    expect(parseWon("")).toEqual({ ok: true, value: null });
  });

  it.each([
    ["10.5", "INVALID"],
    ["-100", "NEGATIVE"],
    ["5만", "INVALID"],
  ])("%s → %s", (text, reason) => {
    expect(parseWon(text)).toEqual({ ok: false, reason });
  });
});

describe("parseTaxRatePercent", () => {
  it.each([
    ["10", 1000],
    ["10%", 1000],
    ["3.3", 330],
    ["0", 0],
  ])("%s → %s bp", (text, value) => {
    expect(parseTaxRatePercent(text)).toEqual({ ok: true, value });
  });
});

describe("formatWon", () => {
  it("천 단위 쉼표", () => {
    expect(formatWon(110_000)).toBe("110,000");
  });
});
