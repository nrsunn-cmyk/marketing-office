import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatDateTimeIn } from "./format-time";

vi.mock("server-only", () => ({}));
const { todayIn } = await import("@/features/quotes/server");

/**
 * UI-TIME-01: 서버 시간대가 UTC(Vercel)여도 현황의 시각은 업무실 시간대(Asia/Seoul)로 보여야 한다.
 * 운영에서 본 값: 2026-11-16 01:19 KST 에 "2026. 11. 15. 오후 4:19:00" 으로 표시됨.
 */
describe("업무실 시간대 기준 시각 표시", () => {
  const savedTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "UTC"; // Vercel 서버와 같은 조건
  });
  afterAll(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("재현: 시간대 없이 그리면 UTC 기준이라 9시간 이른 전날 오후로 보인다", () => {
    expect(new Date("2026-11-15T16:19:00.000Z").toLocaleString("ko-KR")).toBe("2026. 11. 15. 오후 4:19:00");
  });

  it("운영에서 본 시각을 서울 시각으로 보여 준다", () => {
    expect(formatDateTimeIn("2026-11-15T16:19:00.000Z", "Asia/Seoul")).toBe("2026. 11. 16. 오전 1:19:00");
  });

  it.each([
    ["서울 자정 1초 전", "2026-11-15T14:59:59.000Z", "2026. 11. 15. 오후 11:59:59", "2026-11-15"],
    ["서울 자정", "2026-11-15T15:00:00.000Z", "2026. 11. 16. 오전 12:00:00", "2026-11-16"],
    ["UTC 자정(서울 오전 9시)", "2026-11-16T00:00:00.000Z", "2026. 11. 16. 오전 9:00:00", "2026-11-16"],
  ])("날짜 경계 — %s: 표시 날짜가 납기 기준일(todayIn)과 같다", (_name, iso, shown, day) => {
    expect(formatDateTimeIn(iso, "Asia/Seoul")).toBe(shown);
    // 기준 시각의 날짜와 납기 계산의 '오늘'이 같은 시간대를 쓰는지 같은 순간으로 확인
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
    try {
      expect(todayIn("Asia/Seoul")).toBe(day);
    } finally {
      vi.useRealTimers();
    }
  });

  // UI-TIME-02: 고객 프로필 버전·결과물·결과 버전·전달 기록 시각은 DB(PostgREST)가 "+00:00" 꼴로 돌려준다.
  it.each([
    ["서울 자정 1초 전", "2026-11-15T14:59:59+00:00", "2026. 11. 15. 오후 11:59:59"],
    ["서울 자정", "2026-11-15T15:00:00+00:00", "2026. 11. 16. 오전 12:00:00"],
    ["소수 초가 붙은 값", "2026-11-15T16:19:00.123456+00:00", "2026. 11. 16. 오전 1:19:00"],
  ])("DB 시각 형식(%s)도 서울 날짜로 보여 준다", (_name, dbValue, shown) => {
    expect(new Date(dbValue).toLocaleString("ko-KR").startsWith("2026. 11. 15.")).toBe(true); // 고치기 전: UTC 날짜
    expect(formatDateTimeIn(dbValue, "Asia/Seoul")).toBe(shown);
  });

  it("서버 시간대가 달라도 결과가 같다", () => {
    const iso = "2026-11-15T15:00:00.000Z";
    const inUtc = formatDateTimeIn(iso, "Asia/Seoul");
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(formatDateTimeIn(iso, "Asia/Seoul")).toBe(inUtc);
    } finally {
      process.env.TZ = "UTC";
    }
  });
});
