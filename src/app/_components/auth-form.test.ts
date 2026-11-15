import { describe, expect, it } from "vitest";
import { passwordStrength } from "./auth-form";

describe("비밀번호 강도 막대", () => {
  it.each([
    ["", 0],
    ["abc", 1],
    ["abcdefgh", 1], // 숫자 없음 → 규칙 미달
    ["12345678", 1], // 영문 없음
    ["abcd1234", 2], // 규칙 충족
    ["abcd1234!", 3], // 기호까지
    ["abcdefgh1234", 3], // 12자 이상
  ] as const)("%j → %i", (pw, level) => {
    expect(passwordStrength(pw)).toBe(level);
  });
});
