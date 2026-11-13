import { describe, expect, it } from "vitest";
import { isAllowedEmail, parseAllowedEmails } from "./allowlist";

describe("허용 이메일 (C09)", () => {
  it("대소문자·공백을 무시하고 비교한다", () => {
    const allowed = parseAllowedEmails(" Owner@Example.test , second@example.test");
    expect(isAllowedEmail("owner@example.test", allowed)).toBe(true);
    expect(isAllowedEmail(" OWNER@EXAMPLE.TEST ", allowed)).toBe(true);
    expect(isAllowedEmail("second@example.test", allowed)).toBe(true);
  });

  it("목록에 없는 이메일은 거절", () => {
    const allowed = parseAllowedEmails("owner@example.test");
    expect(isAllowedEmail("other@example.test", allowed)).toBe(false);
    expect(isAllowedEmail("owner@example.test.evil", allowed)).toBe(false);
    expect(isAllowedEmail(null, allowed)).toBe(false);
    expect(isAllowedEmail("", allowed)).toBe(false);
  });

  it("설정이 비어 있으면 아무도 허용하지 않는다", () => {
    for (const raw of [undefined, null, "", " , ", "not-an-email"]) {
      expect(parseAllowedEmails(raw).size).toBe(0);
      expect(isAllowedEmail("owner@example.test", parseAllowedEmails(raw))).toBe(false);
    }
  });
});
