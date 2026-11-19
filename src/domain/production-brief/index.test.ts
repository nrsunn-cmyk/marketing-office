import { describe, expect, it } from "vitest";
import {
  DELIVERABLE_TYPES,
  PRODUCTION_BRIEF_DISPLAY,
  PRODUCTION_BRIEF_LIMITS,
  isStaleStrategy,
  productionBriefCreateSchema,
  productionBriefDisplayStatus,
  productionBriefErrorFromDb,
  productionBriefIssueMessage,
  productionBriefUpdateSchema,
} from ".";

const base = { title: "  봄 캠페인  ", targetAudience: "30대", coreMessage: "쉽게", deliverableTypes: ["web_copy"], scopeSummary: "홈페이지 3쪽" };
const msg = (raw: unknown) => {
  const r = productionBriefCreateSchema.safeParse(raw);
  return r.success ? null : productionBriefIssueMessage(r.error.issues[0]);
};

describe("입력 계약(DB CHECK 와 같은 경계, 코드 포인트)", () => {
  it("정리된 값, 빈 선택 칸은 null", () => {
    const r = productionBriefCreateSchema.parse({ ...base, brandToneConstraints: "   ", referenceNotes: " 참고 " });
    expect(r).toEqual({ ...base, title: "봄 캠페인", brandToneConstraints: null, referenceNotes: "참고" });
    expect(productionBriefCreateSchema.parse(base).brandToneConstraints).toBeNull();
  });

  it("상한은 코드 포인트로 센다(이모지 120개는 통과, 121개는 거절)", () => {
    expect(msg({ ...base, title: "😀".repeat(PRODUCTION_BRIEF_LIMITS.title) })).toBeNull();
    expect(msg({ ...base, title: "😀".repeat(121) })).toBe("제목은(는) 120자 이하여야 합니다.");
    expect(msg({ ...base, title: "  " })).toBe("제목을(를) 입력해 주세요.");
    expect(msg({ ...base, targetAudience: "가".repeat(501) })).toMatch(/핵심 대상은\(는\) 500자/);
    expect(msg({ ...base, coreMessage: "가".repeat(1001) })).toMatch(/1000자/);
    expect(msg({ ...base, scopeSummary: "가".repeat(2001) })).toMatch(/2000자/);
    expect(msg({ ...base, brandToneConstraints: "가".repeat(1001) })).toMatch(/브랜드 톤·금기 사항은\(는\) 1000자/);
    expect(msg({ ...base, referenceNotes: "가".repeat(1000) })).toBeNull();
  });

  it("포함 산출물: 넷 중 1~4개, 중복·모르는 값 거절", () => {
    expect(msg({ ...base, deliverableTypes: [...DELIVERABLE_TYPES] })).toBeNull();
    expect(msg({ ...base, deliverableTypes: [] })).toBe("포함 산출물을 1개 이상 골라 주세요.");
    expect(msg({ ...base, deliverableTypes: ["web_copy", "web_copy"] })).toBe("같은 산출물을 두 번 고를 수 없습니다.");
    expect(msg({ ...base, deliverableTypes: ["video_script"] })).toBe("알 수 없는 산출물 종류입니다.");
    expect(msg({ ...base, deliverableTypes: [...DELIVERABLE_TYPES, "web_copy"] })).toMatch(/4개까지|두 번/);
  });

  it("모르는 칸은 거절, 수정은 상태 필수(drafting·ready)", () => {
    expect(msg({ ...base, status: "ready" })).not.toBeNull();
    expect(productionBriefUpdateSchema.safeParse({ ...base, status: "ready" }).success).toBe(true);
    const r = productionBriefUpdateSchema.safeParse({ ...base, status: "approved" });
    expect(r.success).toBe(false);
    if (!r.success) expect(productionBriefIssueMessage(r.error.issues[0])).toBe("알 수 없는 진행 상태입니다.");
  });
});

describe("표시·이전 전략·오류 문구", () => {
  it("표시 상태: 보관이 먼저, 화면 문구는 작성 중·확정·보관", () => {
    expect(productionBriefDisplayStatus({ archived: false, status: "ready" })).toBe("ready");
    expect(productionBriefDisplayStatus({ archived: true, status: "ready" })).toBe("archived");
    expect(PRODUCTION_BRIEF_DISPLAY).toEqual({ drafting: "작성 중", ready: "확정", archived: "보관" });
  });

  it("이전 전략 기준: 판이 다르거나 승인본이 없으면 경고(is distinct from, R-Q3)", () => {
    expect(isStaleStrategy("v1", "v1")).toBe(false);
    expect(isStaleStrategy("v1", "v2")).toBe(true);
    expect(isStaleStrategy("v1", null)).toBe(true);
  });

  it("DB 오류 → 안내: 한도·찾을 수 없음·승인 없음·DB 한글 VALIDATION 그대로, 모르는 오류는 일반 문구", () => {
    expect(productionBriefErrorFromDb("LIMIT_REACHED: 한 프로젝트에는 제작 브리프를 10개까지")).toEqual({
      code: "VALIDATION",
      message: "한 프로젝트에는 제작 브리프를 10개까지 둘 수 있습니다. 쓰지 않는 것을 보관해 주세요.",
    });
    expect(productionBriefErrorFromDb("NOT_FOUND: 제작 브리프를 찾을 수 없습니다").code).toBe("NOT_FOUND");
    expect(productionBriefErrorFromDb("STRATEGY_NOT_APPROVED: 승인된 전략이 없습니다").message).toMatch(/전략을 먼저 승인/);
    expect(productionBriefErrorFromDb("VALIDATION: 같은 산출물을 두 번 고를 수 없습니다")).toEqual({ code: "VALIDATION", message: "같은 산출물을 두 번 고를 수 없습니다" });
    expect(productionBriefErrorFromDb("CONFLICT: 다른 곳에서 먼저 수정되었습니다").code).toBe("CONFLICT");
    const e = productionBriefErrorFromDb('duplicate key value violates unique constraint "x"');
    expect(e.code).toBe("ERROR");
    expect(e.message).not.toMatch(/duplicate|constraint/);
  });
});
