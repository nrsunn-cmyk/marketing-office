import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** ADMIN-INQUIRY-BADGE-01: 「공개 상담」 탭 신규 배지(AGY 규격). 건수 함수 결과를 바꿔 가며 본다 */
const counts = vi.fn();
vi.mock("@/features/admin/server", () => ({ isAdmin: async () => true, countAdminPublicInquiries: () => counts() }));
vi.mock("./admin.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
const { InquiryBadge, inquiryBadgeText } = await import("./admin-parts");

const ok = (n: number) => ({ ok: true, data: { new: n, contacted: 1, quoted: 0, closed: 4 } });
const draw = async (active: boolean) => {
  const el = await InquiryBadge({ active });
  return el ? renderToString(el) : "";
};

describe("공개 상담 탭 신규 배지", () => {
  beforeEach(() => counts.mockReset());

  it("글자: 0건은 없음, n건은 '신규 n', 99 초과는 '신규 99+'", () => {
    expect(inquiryBadgeText(0)).toBeNull();
    expect(inquiryBadgeText(-1)).toBeNull();
    expect(inquiryBadgeText(Number.NaN)).toBeNull();
    expect(inquiryBadgeText(1)).toBe("신규 1");
    expect(inquiryBadgeText(99)).toBe("신규 99");
    expect(inquiryBadgeText(100)).toBe("신규 99+");
  });

  it("신규가 있으면 배지, 활성 탭이면 반전 색 클래스", async () => {
    counts.mockResolvedValue(ok(3));
    expect(await draw(false)).toBe('<span class="tabBadge">신규 3</span>');
    expect(await draw(true)).toBe('<span class="tabBadge tabBadgeActive">신규 3</span>');
  });

  it("신규 0건·건수를 못 읽으면 조용히 숨김(오류 글자 없음)", async () => {
    counts.mockResolvedValue(ok(0));
    expect(await draw(false)).toBe("");
    counts.mockResolvedValue({ ok: false, code: "ERROR", message: "x" });
    expect(await draw(false)).toBe("");
  });
});
