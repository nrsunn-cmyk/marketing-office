import { describe, expect, it } from "vitest";
import { briefCopyRequestSchema } from "./ai-contract";
import { buildBriefCopyRequest, canonicalJson, estimateCostUsdMicro } from "./ai-copy";

const C1 = "11111111-1111-4111-8111-111111111111";
const base = {
  channel: "blog" as const, title: "제목", audience: null, hook: null, coreMessage: null, cta: null, channelSpec: {},
  claims: [{ id: C1, text: "주장", sourceLabels: ["자료 · A", ""] }],
};

describe("DEC08 순수 함수", () => {
  it("요청: 채널 기본 글자 수·변형 2개, 범위 밖 값은 계약 범위로 자른다, 빈 근거 이름 제외, 계약 통과", () => {
    const r = buildBriefCopyRequest(base);
    expect(r.constraints).toEqual({ language: "ko", maxChars: 2000, variants: 2 });
    expect(r.claims).toEqual([{ id: C1, text: "주장", sourceLabels: ["자료 · A"] }]);
    expect(briefCopyRequestSchema.safeParse(r).success).toBe(true);
    expect(buildBriefCopyRequest(base, { variants: 9, maxChars: 10 }).constraints).toEqual({ language: "ko", maxChars: 50, variants: 3 });
    expect(buildBriefCopyRequest({ ...base, channel: "ad_copy" }).constraints.maxChars).toBe(150);
  });

  it("주장 31개 이상이면 30개만, 근거 이름은 300자까지", () => {
    const many = Array.from({ length: 35 }, (_, i) => ({ id: `0000000${i % 10}-0000-4000-8000-${String(i).padStart(12, "0")}`, text: `주장 ${i}`, sourceLabels: ["가".repeat(400)] }));
    const r = buildBriefCopyRequest({ ...base, claims: many });
    expect(r.claims).toHaveLength(30);
    expect(r.claims[0].sourceLabels[0]).toHaveLength(300);
  });

  it("확인값 입력: 키 순서와 상관없이 같다", () => {
    expect(canonicalJson({ b: 1, a: [{ y: 2, x: null }] })).toBe(canonicalJson({ a: [{ x: null, y: 2 }], b: 1 }));
  });

  it("비용: 모델 목록 요금(Sonnet 2·10, Luna 0.1·0.5, Argon 4·20), 목록 밖 모델은 목록 최고가(8·40)", () => {
    expect(estimateCostUsdMicro("claude-sonnet-5-5", { inputTokens: 3000, outputTokens: 5000 })).toBe(56000);
    expect(estimateCostUsdMicro("gpt-6-luna", { inputTokens: 1000, outputTokens: 1000 })).toBe(600);
    expect(estimateCostUsdMicro("gemini-4-argon", { inputTokens: 1000, outputTokens: 1000 })).toBe(24000);
    expect(estimateCostUsdMicro("claude-opus-4-8", { inputTokens: 1000, outputTokens: 1000 })).toBe(48000);
  });
});
