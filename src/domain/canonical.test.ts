import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical";

describe("canonicalJson", () => {
  it("키 순서가 달라도 같은 문자열", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [3, { x: 2, y: 1 }] }, b: 1 }),
    );
  });
  it("배열 순서는 그대로 (순서가 의미 있음)", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it("undefined 값은 빠진다", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
