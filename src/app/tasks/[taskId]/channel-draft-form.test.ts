import { describe, expect, it } from "vitest";
import type { ChannelPublicationView } from "@/features/channel-draft/server";
import { activePublicationCount, checkTags, draftToForm, formatKst, formTags, kstLocalNow, publicationRows } from "./channel-draft-form";

/** P2G-UI-01 채널 초안 화면 도우미 */

describe("태그", () => {
  it("쉼표·줄바꿈으로 나누고 빈 칸을 뺀다(서버 splitTags 와 같은 규칙)", () => {
    expect(formTags(" 커피, 정기배송 ,\n출근길,, ")).toEqual(["커피", "정기배송", "출근길"]);
  });
  it("개수·긴 태그·대소문자 무시 중복을 알려 준다", () => {
    expect(checkTags("a, B, b, " + "가".repeat(31))).toEqual({ count: 4, tooMany: false, tooLong: ["가".repeat(31)], duplicate: ["b"] });
    expect(checkTags(Array.from({ length: 11 }, (_, i) => `t${i}`).join(",")).tooMany).toBe(true);
    // 이모지 하나는 1자(코드 포인트)
    expect(checkTags("☕".repeat(30)).tooLong).toEqual([]);
  });
});

it("draftToForm: 태그는 쉼표 글, 빈 값은 빈 글", () => {
  expect(draftToForm({ title: "t", body: "b", tags: ["a", "b"], imageNote: null, metaDescription: null, status: "reviewed" })).toEqual({
    title: "t",
    body: "b",
    tags: "a, b",
    imageNote: "",
    metaDescription: "",
    status: "reviewed",
  });
});

describe("게시 기록", () => {
  const p = (n: string, over: Partial<ChannelPublicationView>): ChannelPublicationView => ({
    id: n,
    kind: "record",
    url: `https://a.tistory.com/${n}`,
    nonTistoryHost: false,
    publishedAt: "2026-11-19T00:00:00Z",
    note: null,
    voided: false,
    voidsId: null,
    createdAt: "2026-11-19T00:00:00Z",
    ...over,
  });
  const list = [p("1", { voided: true }), p("2", {}), p("v", { kind: "void", url: null, note: "잘못 적음", voidsId: "1" })];
  it("record 만, 최근 것이 위, 취소 이유를 붙인다", () => {
    expect(publicationRows(list).map((r) => [r.id, r.voided, r.voidReason])).toEqual([
      ["2", false, null],
      ["1", true, "잘못 적음"],
    ]);
  });
  it("한도는 취소 안 된 기록 수로 센다", () => {
    expect(activePublicationCount(list)).toBe(1);
  });
});

describe("시각", () => {
  it("kstLocalNow: 한국 시간 datetime-local 모양", () => {
    expect(kstLocalNow(new Date("2026-11-19T15:30:45Z"))).toBe("2026-11-20T00:30");
  });
  it("formatKst: 한국 시간으로 보이고, 없으면 '시각 없음'", () => {
    expect(formatKst("2026-11-19T15:30:00Z")).toMatch(/2026\. 11\. 20\. 오전 12:30|2026\. 11\. 20\. 오전 00:30/);
    expect(formatKst(null)).toBe("시각 없음");
  });
});
