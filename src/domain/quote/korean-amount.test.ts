import { describe, expect, it } from "vitest";
import { koreanNumber, koreanWonPhrase } from "./korean-amount";

describe("금액 한글 표기", () => {
  it.each([
    [0, "영"],
    [1, "일"],
    [10, "일십"],
    [11, "일십일"],
    [100, "일백"],
    [1_000, "일천"],
    [10_000, "일만"],
    [110_000, "일십일만"],
    [2_200_000, "이백이십만"],
    [109_999, "일십만 구천구백구십구"],
    [10_153_000, "일천일십오만 삼천"],
    [100_000_000, "일억"],
    [1_000_010_000, "일십억 일만"],
    [123_456_789_012, "일천이백삼십사억 오천육백칠십팔만 구천일십이"],
  ])("%s → %s", (n, text) => {
    expect(koreanNumber(n)).toBe(text);
  });

  it("합계금액 문구", () => {
    expect(koreanWonPhrase(110_000)).toBe("일금 일십일만 원정");
    expect(koreanWonPhrase(0)).toBe("일금 영 원정");
  });

  it.each([-1, 1.5, Number.NaN])("잘못된 값 %s 거절", (n) => {
    expect(() => koreanNumber(n)).toThrow();
  });
});
