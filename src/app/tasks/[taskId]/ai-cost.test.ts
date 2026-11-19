import { describe, expect, it } from "vitest";
import { BRIEF_COPY_MODELS } from "@/domain/brief/ai-models";
import { costText, estimateWon, PROVIDER_SHORT_NAMES } from "./ai-cost";

describe("AI 문구 1회 대략 비용(화면 표시용 어림)", () => {
  const m = (id: string) => BRIEF_COPY_MODELS.find((x) => x.id === id)!;

  it("Claude Sonnet 5.5 는 약 80원(AGY 시안 예시와 같음), 3,000·5,000 토큰 × 1,450원", () => {
    expect(estimateWon(m("claude-sonnet-5-5"))).toBeCloseTo(81.2, 1);
    expect(costText(m("claude-sonnet-5-5"))).toBe("약 80원");
  });

  it("가장 비싼 모델과 가장 싼 모델", () => {
    expect(costText(m("gpt-6.2-astra"))).toBe("약 320원");
    expect(costText(m("claude-haiku-5-5"))).toBe("10원 미만");
  });

  it("서버 고정 목록의 모든 모델에 표시가 만들어지고, 1,000원 이상이면 자릿점", () => {
    for (const x of BRIEF_COPY_MODELS) expect(costText(x)).toMatch(/^(약 [\d,]+원|10원 미만)$/);
    expect(costText({ inputUsd: 100, outputUsd: 200 })).toBe("약 1,890원");
  });

  it("공급자 이름은 확정 문구의 세 이름", () => {
    expect(PROVIDER_SHORT_NAMES).toEqual({ anthropic: "Claude", openai: "OpenAI", google: "Gemini" });
  });
});
