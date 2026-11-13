import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("로그인 후 이동 주소", () => {
  it.each([
    ["/", "/"],
    ["/clients?q=a", "/clients?q=a"],
    ["/projects/1#x", "/projects/1#x"],
  ])("%s 허용", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/ok\nSet-Cookie: x",
    "evil",
  ])("%j 는 기본 주소로", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });
});
