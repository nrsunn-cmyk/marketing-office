import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, parsePage } from "./paging";

const ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

describe("페이지 기준(cursor)", () => {
  it("만들고 다시 읽으면 같은 값", () => {
    for (const at of ["2026-11-14T03:04:05.123456+00:00", "2026-11-14T03:04:05Z", "2026-11-14T12:00:00+09:00"]) {
      expect(decodeCursor(encodeCursor({ at, id: ID }))).toEqual({ at, id: ID });
    }
  });

  it.each([
    null,
    "",
    "!!!",
    Buffer.from("not-a-time|" + ID).toString("base64url"),
    Buffer.from("2026-11-14T03:04:05Z|not-uuid").toString("base64url"),
    Buffer.from(`2026-11-14T03:04:05Z|${ID}|extra`).toString("base64url"),
    // 쿼리에 끼어들려는 값
    Buffer.from(`2026-11-14T03:04:05Z),id.gt.(0|${ID}`).toString("base64url"),
    "a".repeat(500),
  ])("잘못된 값 %j 는 무시(null)", (raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});

describe("쪽 번호", () => {
  it.each([
    ["2", 2],
    ["1", 1],
    ["0", 1],
    ["-3", 1],
    ["1.5", 1],
    ["abc", 1],
    [undefined, 1],
  ])("%j → %s", (raw, n) => {
    expect(parsePage(raw)).toBe(n);
  });
});
