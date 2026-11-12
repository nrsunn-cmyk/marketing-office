import { describe, expect, it } from "vitest";
import { calculateQuote } from "@/domain/quote";
import { buildLogoBrief } from "@/domain/logo";
import {
  clientInputSchema,
  companyProfileInputSchema,
  logoBriefInputSchema,
  projectInputSchema,
  quoteInputSchema,
  taskCreateSchema,
} from "./index";

const UUID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

describe("고객 입력", () => {
  it("이름 앞뒤 공백을 정리하고 빈 선택 항목은 null", () => {
    expect(clientInputSchema.parse({ name: "  가상고객A  ", industry: "" })).toEqual({
      name: "가상고객A",
      industry: null,
      description: null,
    });
  });
  it("이름이 비면 거절", () => {
    const r = clientInputSchema.safeParse({ name: "   " });
    expect(r.success).toBe(false);
  });
});

describe("회사 프로필", () => {
  it("http(s) 주소만 허용한다", () => {
    expect(companyProfileInputSchema.safeParse({ channelUrls: ["https://example.com/blog"] }).success).toBe(true);
    expect(companyProfileInputSchema.safeParse({ channelUrls: ["javascript:alert(1)"] }).success).toBe(false);
    expect(companyProfileInputSchema.safeParse({ channelUrls: ["file:///C:/secret"] }).success).toBe(false);
  });
  it("강점 목록의 빈 값·중복 제거", () => {
    expect(companyProfileInputSchema.parse({ strengths: ["빠름", " 빠름 ", ""] }).strengths).toEqual(["빠름"]);
  });
});

describe("프로젝트 (R07 고객 구분)", () => {
  it("client 유형은 고객 지정 필수", () => {
    expect(projectInputSchema.safeParse({ kind: "client", title: "로고" }).success).toBe(false);
    expect(projectInputSchema.safeParse({ kind: "client", clientId: UUID, title: "로고" }).success).toBe(true);
  });
  it("자체 브랜드·개인 프로젝트에는 고객을 지정할 수 없다", () => {
    expect(projectInputSchema.safeParse({ kind: "internal_brand", clientId: UUID, title: "블로그" }).success).toBe(false);
    expect(projectInputSchema.parse({ kind: "personal", title: "건강 채널" }).clientId).toBeNull();
  });
  it("예산은 0 이상 정수", () => {
    expect(projectInputSchema.safeParse({ kind: "personal", title: "x", budgetWon: -1 }).success).toBe(false);
    expect(projectInputSchema.safeParse({ kind: "personal", title: "x", budgetWon: 1.5 }).success).toBe(false);
  });
  it("납기는 YYYY-MM-DD", () => {
    expect(projectInputSchema.safeParse({ kind: "personal", title: "x", dueAt: "2026-11-30" }).success).toBe(true);
    expect(projectInputSchema.safeParse({ kind: "personal", title: "x", dueAt: "11/30" }).success).toBe(false);
  });
});

describe("작업 생성", () => {
  it("중복 방지 키 필수, 미구현 작업 유형 거절", () => {
    expect(taskCreateSchema.safeParse({ projectId: UUID, type: "logo_brief", idempotencyKey: "abcdefgh" }).success).toBe(true);
    expect(taskCreateSchema.safeParse({ projectId: UUID, type: "logo_brief" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ projectId: UUID, type: "video", idempotencyKey: "abcdefgh" }).success).toBe(false);
  });
});

describe("스키마 → 도메인 연결", () => {
  it("로고 폼 입력을 그대로 브리프 생성에 쓸 수 있다", () => {
    const form = logoBriefInputSchema.parse({ companyName: "가상고객A", colors: ["파랑", "파랑"] });
    const r = buildLogoBrief(form);
    expect(r.ok && r.result.imagePrompt).toBe("'가상고객A' 로고 디자인. 색상: 파랑.");
  });

  it("견적 폼 입력을 그대로 계산에 쓸 수 있다", () => {
    const form = quoteInputSchema.parse({
      taxMode: "EXCLUSIVE",
      taxRateBasisPoints: 1000,
      items: [{ id: "r1", name: "로고 기획", quantityHundredths: 200, unitPriceWon: 50_000 }],
    });
    expect(calculateQuote(form).totalWon).toBe(110_000);
  });
});
