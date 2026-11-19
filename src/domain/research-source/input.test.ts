import { describe, expect, it } from "vitest";
import { RESEARCH_SOURCE_LIMITS, researchSourceErrorFromDb, researchSourceInputSchema, reviewStatusSchema, topicParticle } from "./input";

const NOW = new Date("2026-11-17T09:00:00Z"); // 한국 시각 18:00
const schema = researchSourceInputSchema(() => NOW);
const base = { url: "https://example.com/report", title: "합성 보고서", publisher: "", retrievedAt: "2026-11-17", quotedExcerpt: "" };

function firstMessage(input: Record<string, unknown>) {
  const r = schema.safeParse(input);
  expect(r.success).toBe(false);
  return r.success ? "" : `${String(r.error.issues[0].path[0])}: ${r.error.issues[0].message}`;
}

describe("출처 입력 규칙", () => {
  it("정상: 앞뒤 공백 정리, 빈 선택 칸은 null, 날짜만 오면 한국 시각 0시", () => {
    const r = schema.parse({ ...base, url: "  https://example.com/a  ", title: "  제목 ", publisher: " 발행처 " });
    expect(r).toEqual({
      url: "https://example.com/a",
      title: "제목",
      publisher: "발행처",
      quotedExcerpt: null,
      retrievedAt: "2026-11-16T15:00:00.000Z",
    });
  });

  it("칸이 아예 없어도 선택 칸은 null", () => {
    const r = schema.parse({ url: base.url, title: "t", retrievedAt: "2026-11-01" });
    expect(r.publisher).toBeNull();
    expect(r.quotedExcerpt).toBeNull();
  });

  it("http(s) 가 아닌 주소는 거절(javascript:, ftp:, 주소 아님)", () => {
    for (const url of ["javascript:alert(1)", "ftp://example.com/x", "example.com", "https//x"]) {
      expect(firstMessage({ ...base, url })).toMatch(/^url: http/);
    }
  });

  it("길이 한도: 경계값은 통과, 1자 넘으면 칸별 오류", () => {
    const longUrl = (n: number) => `https://e.com/${"a".repeat(n - "https://e.com/".length)}`;
    expect(schema.safeParse({ ...base, url: longUrl(RESEARCH_SOURCE_LIMITS.url) }).success).toBe(true);
    expect(firstMessage({ ...base, url: longUrl(RESEARCH_SOURCE_LIMITS.url + 1) })).toMatch(/^url:/);
    expect(schema.safeParse({ ...base, title: "가".repeat(300) }).success).toBe(true);
    expect(firstMessage({ ...base, title: "가".repeat(301) })).toMatch(/^title: 제목은 300자/);
    expect(firstMessage({ ...base, publisher: "가".repeat(201) })).toBe("publisher: 발행처는 200자까지 입력할 수 있습니다.");
    expect(schema.safeParse({ ...base, quotedExcerpt: "가".repeat(1000) }).success).toBe(true);
    expect(firstMessage({ ...base, quotedExcerpt: "가".repeat(1001) })).toBe("quotedExcerpt: 인용문은 1000자까지 입력할 수 있습니다.");
  });

  it("빈 제목·공백뿐인 제목은 거절", () => {
    expect(firstMessage({ ...base, title: "   " })).toBe("title: 제목을 입력해 주세요.");
  });

  it("확인 날짜: 미래 거절(5분 여유), 시간대 없는 시각·잘못된 값 거절, 시간대 있는 시각 통과", () => {
    expect(firstMessage({ ...base, retrievedAt: "2026-11-18" })).toMatch(/미래/);
    expect(schema.safeParse({ ...base, retrievedAt: "2026-11-17T09:04:00Z" }).success).toBe(true);
    expect(firstMessage({ ...base, retrievedAt: "2026-11-17T09:06:00Z" })).toMatch(/미래/);
    expect(schema.parse({ ...base, retrievedAt: "2026-11-17T10:00+09:00" }).retrievedAt).toBe("2026-11-17T01:00:00.000Z");
    expect(firstMessage({ ...base, retrievedAt: "2026-11-17T10:00" })).toMatch(/형식/);
    expect(firstMessage({ ...base, retrievedAt: "어제" })).toMatch(/형식/);
    expect(firstMessage({ ...base, retrievedAt: "2026-13-40" })).toMatch(/형식/);
    expect(firstMessage({ ...base, retrievedAt: "" })).toMatch(/입력해 주세요/);
  });

  it("검토 상태는 unverified·verified 만", () => {
    expect(reviewStatusSchema.safeParse("verified").success).toBe(true);
    expect(reviewStatusSchema.safeParse("approved").success).toBe(false);
  });
});

describe("주제 조사(QA-SOURCES-UI-01 O1)", () => {
  it("받침 있으면 은, 없으면 는, 한글이 아니면 은(는)", () => {
    expect(["발행처", "인용문", "제목", "주소", "URL"].map(topicParticle)).toEqual(["발행처는", "인용문은", "제목은", "주소는", "URL은(는)"]);
  });
});

describe("DB 오류 → 화면 문구", () => {
  it("코드·머리말별로 나누고 원문은 내보내지 않는다", () => {
    expect(researchSourceErrorFromDb({ code: "P0002", message: "NOT_FOUND: 프로젝트를 찾을 수 없습니다" }).code).toBe("NOT_FOUND");
    expect(researchSourceErrorFromDb({ code: "P0001", message: "CONFLICT: 다른 곳에서" }).code).toBe("CONFLICT");
    expect(researchSourceErrorFromDb({ code: "22023", message: "VALIDATION: x" }).code).toBe("VALIDATION");
    expect(researchSourceErrorFromDb({ code: "23514", message: 'new row violates check constraint "research_sources_url_check"' })).toEqual({
      code: "VALIDATION",
      message: "입력값이 규칙에 맞지 않습니다.",
    });
    const other = researchSourceErrorFromDb({ code: "42501", message: "NOT_AUTHENTICATED: secret detail" });
    expect(other.code).toBe("ERROR");
    expect(other.message).not.toMatch(/secret/);
  });
});
