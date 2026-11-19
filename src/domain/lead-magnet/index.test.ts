import { describe, expect, it } from "vitest";
import { isLeadMagnetLinkable, LEAD_MAGNET_LIMITS, leadMagnetErrorFromDb, leadMagnetInputSchema } from "./index";

describe("리드마그넷 입력 계약(DB 규칙과 같음)", () => {
  it("기본값·앞뒤 정리·빈 글은 null", () => {
    const r = leadMagnetInputSchema.parse({ title: "  진단 체크리스트 ", format: "checklist", audience: "  ", promise: " 10분 안에 점검 ", leadFields: [" 이메일 "] });
    expect(r).toEqual({ title: "진단 체크리스트", format: "checklist", audience: null, promise: "10분 안에 점검", delivery: null, leadFields: ["이메일"], outline: [], status: "planned" });
  });

  it("형식·전달 방식·상태 목록 밖, 길이·개수 초과, 모르는 키는 거절(한국어 문구)", () => {
    const base = { title: "x", format: "guide" };
    const bad = [
      { ...base, format: "ebook" },
      { ...base, delivery: "fax" },
      { ...base, status: "published" },
      { ...base, title: " " },
      { ...base, title: "가".repeat(LEAD_MAGNET_LIMITS.title + 1) },
      { ...base, promise: "가".repeat(LEAD_MAGNET_LIMITS.promise + 1) },
      { ...base, leadFields: Array.from({ length: LEAD_MAGNET_LIMITS.leadFields + 1 }, () => "a") },
      { ...base, leadFields: [" "] },
      { ...base, outline: ["가".repeat(LEAD_MAGNET_LIMITS.outlineLine + 1)] },
      { ...base, extra: 1 },
    ];
    for (const b of bad) expect(leadMagnetInputSchema.safeParse(b).success, JSON.stringify(b).slice(0, 60)).toBe(false);
    const e = leadMagnetInputSchema.safeParse({ ...base, format: "ebook" });
    expect(e.success ? "" : e.error.issues[0].message).toMatch(/[가-힣]/);
  });

  it("연결할 수 있는 카드 유형은 전환 오퍼·리드마그넷 카드뿐", () => {
    expect(["cta", "lead_magnet", "content"].map(isLeadMagnetLinkable)).toEqual([true, true, false]);
  });
});

describe("DB 오류 → 안내 문구", () => {
  it("VALIDATION·INVALID_TRANSITION 은 DB 의 한국어 설명, NOT_FOUND 는 리드마그넷 문구, 모르는 오류는 일반 문구", () => {
    expect(leadMagnetErrorFromDb("VALIDATION: 한 퍼널에는 리드마그넷을 20개까지 둘 수 있습니다")).toEqual({
      code: "VALIDATION",
      message: "한 퍼널에는 리드마그넷을 20개까지 둘 수 있습니다",
    });
    expect(leadMagnetErrorFromDb("INVALID_TRANSITION: 보관한 리드마그넷에는 연결할 수 없습니다").code).toBe("INVALID_TRANSITION");
    expect(leadMagnetErrorFromDb("NOT_FOUND: 리드마그넷을 찾을 수 없습니다").message).toMatch(/^리드마그넷이나 퍼널 카드를 찾을 수 없습니다/);
    expect(leadMagnetErrorFromDb("STRATEGY_NOT_APPROVED: x").message).toMatch(/전략 기준을 다시 맞출/);
    expect(leadMagnetErrorFromDb('duplicate key value violates unique constraint "x"')).toEqual({ code: "ERROR", message: expect.stringMatching(/잠시 후/) });
  });
});
