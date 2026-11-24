import { describe, expect, it, vi } from "vitest";

// 서버 전용 모듈은 이 시험에서 쓰지 않는다(표시용 변환만 본다)
vi.mock("@/features/admin/server", () => ({ isAdmin: async () => false, countAdminPublicInquiries: async () => ({ ok: false, code: "ERROR", message: "x" }) }));
const { formatBytes, kstDate, kstDateTime, kstDaysAgo, microUsdToWon, shortId } = await import("./admin-parts");

describe("관리자 화면 표시 변환(ADMIN-UI-01)", () => {
  it("시각은 한국 시각으로, 없으면 '—'", () => {
    expect(kstDateTime("2026-11-18T16:30:00Z")).toBe("2026-11-19 01:30");
    expect(kstDate("2026-11-18T16:30:00Z")).toBe("2026-11-19");
    expect(kstDateTime(null)).toBe("—");
  });

  it("오늘에서 며칠 전(한국 날짜)", () => {
    const now = new Date("2026-11-18T16:30:00Z"); // 한국 11-19 01:30
    expect(kstDaysAgo(0, now)).toBe("2026-11-19");
    expect(kstDaysAgo(6, now)).toBe("2026-11-13");
  });

  it("마이크로달러 → 원 어림(1달러 ≈ 1,450원), 바이트, 짧은 id", () => {
    expect(microUsdToWon(224_000)).toBe("325원");
    expect(microUsdToWon(20_000_000)).toBe("29,000원");
    expect(formatBytes(5_242_880)).toBe("5.0MB");
    expect(shortId("11111111-2222-3333-4444-555555555555")).toBe("11111111…");
    expect(shortId(null)).toBe("—");
  });
});
