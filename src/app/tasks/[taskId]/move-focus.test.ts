import { describe, expect, it } from "vitest";
import { focusSideAfterMove } from "./move-focus";

describe("순서 옮긴 뒤 초점(O1)", () => {
  it("옮긴 항목의 새 자리, 같은 쪽 단추 — 끝에 닿으면 반대쪽", () => {
    expect(focusSideAfterMove(0, 1, 3)).toEqual({ index: 1, side: "down" }); // 장면 1을 아래로 → 2번 자리 '아래로'
    expect(focusSideAfterMove(1, 1, 3)).toEqual({ index: 2, side: "up" }); // 맨 아래로 가면 '아래로'가 꺼지므로 '위로'
    expect(focusSideAfterMove(2, -1, 3)).toEqual({ index: 1, side: "up" });
    expect(focusSideAfterMove(1, -1, 3)).toEqual({ index: 0, side: "down" }); // 맨 위로 가면 '아래로'
    expect(focusSideAfterMove(0, 1, 2)).toEqual({ index: 1, side: "up" });
  });
});
