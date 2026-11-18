import { describe, expect, it } from "vitest";
import {
  FUNNEL_STAGES,
  funnelErrorFromDb,
  funnelIssueMessage,
  funnelItemInputSchema,
  funnelStageFocusSchema,
  funnelWarnings,
  strategyBasisOf,
} from ".";

describe("퍼널 단계", () => {
  it("5단계 순서와 위치가 DB CHECK 와 같다", () => {
    expect(FUNNEL_STAGES.map((s) => [s.key, s.position])).toEqual([
      ["inflow", 1], ["awareness", 2], ["consideration", 3], ["conversion", 4], ["retention", 5],
    ]);
  });
});

describe("카드 입력 계약", () => {
  it("공백 정리, 빈 선택 값은 null, 상태 기본값 planned", () => {
    const r = funnelItemInputSchema.parse({ kind: "content", title: "  숏폼  ", channel: "  ", description: "" });
    expect(r).toEqual({ kind: "content", title: "숏폼", description: null, channel: null, status: "planned", targetNote: null, details: null });
  });
  it("리드마그넷 상세는 리드마그넷에만", () => {
    expect(funnelItemInputSchema.safeParse({ kind: "lead_magnet", title: "체크리스트", details: { deliverable: "PDF", leadFields: ["회사 이메일"] } }).success).toBe(true);
    const bad = funnelItemInputSchema.safeParse({ kind: "cta", title: "PoC", details: { deliverable: "PDF" } });
    expect(bad.success).toBe(false);
    expect(funnelIssueMessage(bad.error?.issues[0])).toBe("리드마그넷 카드에만 기획 내용을 넣을 수 있습니다.");
  });
  it("모르는 키·긴 값·잘못된 유형 거절(한국어 안내)", () => {
    expect(funnelItemInputSchema.safeParse({ kind: "content", title: "x", score: 3 }).success).toBe(false);
    expect(funnelItemInputSchema.safeParse({ kind: "lead_magnet", title: "x", details: { price: 1 } }).success).toBe(false);
    const long = funnelItemInputSchema.safeParse({ kind: "content", title: "가".repeat(201) });
    expect(funnelIssueMessage(long.error?.issues[0])).toBe("제목은 200자 이하여야 합니다.");
    const kind = funnelItemInputSchema.safeParse({ kind: "poll", title: "x" });
    expect(funnelIssueMessage(kind.error?.issues[0])).toBe("카드 유형을 골라 주세요.");
    expect(funnelItemInputSchema.safeParse({ kind: "lead_magnet", title: "x", details: { leadFields: Array(11).fill("a") } }).success).toBe(false);
  });
  it("단계 타깃 문구: 빈 값은 null, 300자 초과 거절", () => {
    expect(funnelStageFocusSchema.parse("  ")).toBeNull();
    expect(funnelStageFocusSchema.safeParse("가".repeat(301)).success).toBe(false);
  });
});

describe("보드 경고", () => {
  it("전부 비면 빈 보드", () => {
    expect(funnelWarnings({})).toEqual([{ kind: "empty" }]);
  });
  it("고려·전환이 비면 병목", () => {
    expect(funnelWarnings({ inflow: 2, awareness: 1 })).toEqual([{ kind: "bottleneck", stages: ["consideration", "conversion"] }]);
    expect(funnelWarnings({ inflow: 1, consideration: 1 })).toEqual([{ kind: "bottleneck", stages: ["conversion"] }]);
  });
  it("고려·전환이 있으면 경고 없음", () => {
    expect(funnelWarnings({ consideration: 1, conversion: 1 })).toEqual([]);
  });
});

describe("전략 승인본에서 이어받는 문장", () => {
  it("목표·제안·타깃의 사실·추정 문장만 뽑는다", () => {
    const content = {
      facts: [
        { section: "goals", text: " 목표1 ", sources: [] },
        { section: "positioning", text: "제외", sources: [] },
        { section: "audiences", text: "타깃1", sources: [] },
      ],
      inferences: [{ section: "offers", text: "제안 추정", rationale: "" }, { section: "goals", text: "  " }],
    };
    expect(strategyBasisOf(content)).toEqual({ goals: ["목표1"], offers: ["제안 추정"], audiences: ["타깃1"] });
  });
  it("모양이 이상하면 빈 목록", () => {
    expect(strategyBasisOf(null)).toEqual({ goals: [], offers: [], audiences: [] });
    expect(strategyBasisOf({ facts: "x" })).toEqual({ goals: [], offers: [], audiences: [] });
  });
});

describe("DB 오류 문구", () => {
  it("VALIDATION 은 DB의 한국어 설명을 그대로", () => {
    expect(funnelErrorFromDb("VALIDATION: 한 단계에는 카드를 50개까지 둘 수 있습니다")).toEqual({ code: "VALIDATION", message: "한 단계에는 카드를 50개까지 둘 수 있습니다" });
  });
  it("나머지 코드는 고정 문구, 모르는 오류는 일반 문구", () => {
    expect(funnelErrorFromDb("STRATEGY_NOT_APPROVED: x").code).toBe("STRATEGY_NOT_APPROVED");
    expect(funnelErrorFromDb("NOT_FOUND: 카드를 찾을 수 없습니다").message).toBe("퍼널이나 카드를 찾을 수 없습니다. 화면을 새로 고쳐 주세요.");
    expect(funnelErrorFromDb('duplicate key value violates unique constraint "x"')).toEqual({ code: "ERROR", message: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    expect(funnelErrorFromDb("VALIDATION: internal path /x")).toEqual({ code: "VALIDATION", message: "입력값이 규칙에 맞지 않습니다." });
  });
});
