import { describe, expect, it } from "vitest";
import { funnelItemInputSchema } from "@/domain/funnel";
import { EMPTY_FUNNEL_ITEM, toFunnelPayload } from "./funnel-form";

/** P2D-FRONT-01: 화면 폼이 만드는 payload 가 서버 계약을 그대로 통과하는지 */
describe("퍼널 카드 폼 → 서버 계약", () => {
  it("콘텐츠 카드: details 는 null, 빈 칸은 null 로 정리", () => {
    const p = toFunnelPayload({ ...EMPTY_FUNNEL_ITEM, title: "  블로그 글  ", channel: "   " });
    expect(p.details).toBeNull();
    const r = funnelItemInputSchema.safeParse(p);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ kind: "content", title: "블로그 글", channel: null, status: "planned", details: null });
  });

  it("리드마그넷: 줄마다 나눈 받을 정보·아웃라인, 빈 줄은 뺀다", () => {
    const p = toFunnelPayload({ ...EMPTY_FUNNEL_ITEM, kind: "lead_magnet", title: "체크리스트", deliverable: " PDF ", leadFields: "이메일\n\n 회사명 \n", outline: "1장\n2장" });
    const r = funnelItemInputSchema.safeParse(p);
    expect(r.success).toBe(true);
    expect(r.data?.details).toEqual({ deliverable: "PDF", leadFields: ["이메일", "회사명"], outline: ["1장", "2장"] });
  });

  it("리드마그넷 기획을 비워 두면 details 는 null", () => {
    const p = toFunnelPayload({ ...EMPTY_FUNNEL_ITEM, kind: "lead_magnet", title: "제목" });
    expect(p.details).toBeNull();
    expect(funnelItemInputSchema.safeParse(p).success).toBe(true);
  });

  it("다른 유형으로 바꾸면 남아 있던 리드마그넷 값은 보내지 않는다(계약: 리드마그넷에만 details)", () => {
    const p = toFunnelPayload({ ...EMPTY_FUNNEL_ITEM, kind: "cta", title: "상담 신청", leadFields: "이메일" });
    expect(p.details).toBeNull();
    expect(funnelItemInputSchema.safeParse(p).success).toBe(true);
  });

  it("제목이 비면 서버 계약이 한국어 문구로 거절한다(폼은 자르거나 막지 않는다)", () => {
    const r = funnelItemInputSchema.safeParse(toFunnelPayload({ ...EMPTY_FUNNEL_ITEM, title: "   " }));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("제목을 입력해 주세요.");
  });
});
