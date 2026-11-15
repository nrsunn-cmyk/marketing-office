import { describe, expect, it } from "vitest";
import { loginInputSchema, newPasswordSchema, passwordPairSchema, signupInputSchema } from "./index";

describe("비밀번호 규칙", () => {
  it.each(["abcd1234", "Password1", "한글도ok12a", "a1" + "x".repeat(70)])("%j 는 통과", (pw) => {
    expect(newPasswordSchema.safeParse(pw).success).toBe(true);
  });

  it.each([
    ["abc123", "8자 이상"],
    ["abcdefgh", "영문과 숫자"],
    ["12345678", "영문과 숫자"],
    ["a1" + "x".repeat(71), "너무 깁니다"],
  ])("%j 는 거절(%s)", (pw, msg) => {
    const r = newPasswordSchema.safeParse(pw);
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message).join(" ")).toContain(msg);
  });

  it("한글은 한 글자가 3바이트라 24자(72바이트)를 넘으면 거절", () => {
    expect(newPasswordSchema.safeParse("a1" + "가".repeat(23)).success).toBe(true); // 2+69=71
    expect(newPasswordSchema.safeParse("a1" + "가".repeat(24)).success).toBe(false); // 2+72=74
  });

  it("확인 칸이 다르면 확인 칸에 오류", () => {
    const r = passwordPairSchema.safeParse({ password: "abcd1234", passwordConfirm: "abcd1235" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(["passwordConfirm"]);
  });

  it("가입 입력: 이메일·비밀번호·확인", () => {
    expect(signupInputSchema.safeParse({ email: "a@b.co", password: "abcd1234", passwordConfirm: "abcd1234" }).success).toBe(true);
    expect(signupInputSchema.safeParse({ email: "nope", password: "abcd1234", passwordConfirm: "abcd1234" }).success).toBe(false);
  });

  it("로그인 입력: 비밀번호는 비어 있지만 않으면 된다(옛 규칙 비밀번호도 로그인 가능)", () => {
    expect(loginInputSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(loginInputSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});
