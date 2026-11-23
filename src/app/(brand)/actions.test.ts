import { beforeEach, describe, expect, it, vi } from "vitest";

/** NADAUM-BRAND-CONNECT-01 공개 상담 서버 동작: Backend 계약 결과 → 화면 결과(저장 확인 때만 성공, 그 밖은 서버 문구·칸 오류) */
const submitMock = vi.fn();
vi.mock("@/features/public-inquiries/server", () => ({ submitPublicInquiryFromRequest: (...a: unknown[]) => submitMock(...a) }));

const { submitNadaumInquiry } = await import("./actions");

const input = {
  company_name: "합성 업체",
  contact_name: "합성 담당자",
  phone: "010-0000-0000",
  services: ["홈페이지 제작" as const],
  other_service: "",
  message: "합성 요청",
  reference_url: "",
  desired_timeline: "",
  budget_range: "",
  privacy_consent: true,
};

describe("공개 상담 서버 동작", () => {
  beforeEach(() => submitMock.mockReset());

  it("계약 함수에 입력·허니팟을 넘기고, 작성 시각은 서버 시계 - 지난 시간(V1), 저장 확인이면 접수 번호와 함께 성공", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T12:00:00Z"));
    submitMock.mockResolvedValue({ ok: true, refCode: "ND-261123-ABCDEF", receivedAt: "2026-11-23T12:00:00Z" });
    const r = await submitNadaumInquiry(input, { honeypot: "", elapsedMs: 5000 });
    expect(submitMock).toHaveBeenCalledWith(input, { honeypot: "", startedAt: Date.parse("2026-11-23T12:00:00Z") - 5000 });
    expect(r).toEqual({ status: "sent", refCode: "ND-261123-ABCDEF" });
    vi.useRealTimers();
  });

  it("지난 시간은 0~하루로 자르고(브라우저 시계와 무관), 숫자가 아니면 시간 검사 건너뜀(null)", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-11-23T12:00:00Z");
    vi.setSystemTime(new Date(now));
    submitMock.mockResolvedValue({ ok: false, reason: "error", message: "m" });
    await submitNadaumInquiry(input, { honeypot: "", elapsedMs: -999 });
    expect(submitMock).toHaveBeenLastCalledWith(input, { honeypot: "", startedAt: now });
    await submitNadaumInquiry(input, { honeypot: "", elapsedMs: 10 * 86_400_000 });
    expect(submitMock).toHaveBeenLastCalledWith(input, { honeypot: "", startedAt: now - 86_400_000 });
    await submitNadaumInquiry(input, { honeypot: "", elapsedMs: "5" as unknown as number });
    expect(submitMock).toHaveBeenLastCalledWith(input, { honeypot: "", startedAt: null });
    vi.useRealTimers();
  });

  it("validation: 칸별 오류를 화면 칸 이름 그대로(선택 칸 포함), 모르는 키는 버림", async () => {
    submitMock.mockResolvedValue({
      ok: false,
      reason: "validation",
      message: "입력 내용을 확인해 주세요.",
      fieldErrors: { phone: "전화", budget_range: "예산", nope: "x" },
    });
    const r = await submitNadaumInquiry(input, { honeypot: "", elapsedMs: null });
    expect(r).toEqual({ status: "failed", reason: "validation", message: "입력 내용을 확인해 주세요.", errors: { phone: "전화", budget_range: "예산" } });
  });

  it("rate_limited·unavailable·error: 성공 없이 서버 문구 그대로", async () => {
    for (const reason of ["rate_limited", "unavailable", "error"] as const) {
      submitMock.mockResolvedValue({ ok: false, reason, message: `문구-${reason}` });
      const r = await submitNadaumInquiry(input, { honeypot: "", elapsedMs: null });
      expect(r).toEqual({ status: "failed", reason, message: `문구-${reason}` });
    }
  });

  it("브라우저가 보낸 사람 확인 값이 이상하면 안전한 값으로 바꿔 넘긴다", async () => {
    submitMock.mockResolvedValue({ ok: false, reason: "error", message: "m" });
    await submitNadaumInquiry(input, { honeypot: 3 as unknown as string, elapsedMs: Number.NaN });
    expect(submitMock).toHaveBeenLastCalledWith(input, { honeypot: "", startedAt: null });
    await submitNadaumInquiry(input, undefined as never);
    expect(submitMock).toHaveBeenLastCalledWith(input, { honeypot: "", startedAt: null });
  });
});
