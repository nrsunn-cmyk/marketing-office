import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, isValidTimestamp, parsePage } from "./paging";

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

describe("CR11 실제로 있는 날짜·시각만 기준값으로 받는다", () => {
  it.each([
    "2026-11-14T03:04:05Z",
    "2026-11-14T03:04:05.123456+00:00",
    "2024-02-29T00:00:00Z", // 윤년
    "2000-02-29T23:59:59.9+09:00", // 400으로 나뉘는 해는 윤년
    "2026-12-31T23:59:59-12:00",
    "2026-01-31T00:00:00+14:00",
    "2026-04-30T12:00:00+05:45",
  ])("%s 는 받는다", (at) => {
    expect(isValidTimestamp(at)).toBe(true);
    expect(decodeCursor(encodeCursor({ at, id: ID }))).toEqual({ at, id: ID });
  });

  it.each([
    "2026-99-99T25:00:00Z", // Codex 재현
    "2026-13-01T00:00:00Z",
    "2026-00-10T00:00:00Z",
    "2026-02-29T00:00:00Z", // 윤년 아님
    "1900-02-29T00:00:00Z", // 100으로 나뉘고 400으로 안 나뉨
    "2026-04-31T00:00:00Z",
    "2026-11-00T00:00:00Z",
    "2026-11-14T24:00:00Z",
    "2026-11-14T23:60:00Z",
    "2026-11-14T23:59:60Z",
    "2026-11-14T03:04:05+15:00",
    "2026-11-14T03:04:05+14:30",
    "2026-11-14T03:04:05+09:60",
    "0000-01-01T00:00:00Z",
    "2026-11-14T03:04:05.1234567Z", // 마이크로초보다 정밀
  ])("%s 는 무시(null)", (at) => {
    expect(isValidTimestamp(at)).toBe(false);
    expect(decodeCursor(encodeCursor({ at, id: ID }))).toBeNull();
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
