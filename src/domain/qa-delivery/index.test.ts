import { describe, expect, it } from "vitest";
import { buildDeliveryManifest } from "@/server/export/delivery-md";
import { DEFAULT_QA_ITEMS, bundleLabel, deliveryLogSchema, qaErrorFromDb, qaItemAddSchema, qaItemSetSchema } from ".";

/** P3FG-BACKEND-IMPL-01 순수 모듈·납품 목록 .md */
describe("검수·납품 입력", () => {
  it("판정: 보완 필요는 메모 필수, 공백만 메모는 null, 제어 문자·501자 거절", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(qaItemSetSchema.safeParse({ itemId: id, verdict: "needs_fix", memo: "  " }).success).toBe(false);
    expect(qaItemSetSchema.parse({ itemId: id, verdict: "passed", memo: "  " })).toEqual({ itemId: id, verdict: "passed", memo: null });
    expect(qaItemSetSchema.safeParse({ itemId: id, verdict: "passed", memo: "a\u0001" }).success).toBe(false);
    expect(qaItemSetSchema.safeParse({ itemId: id, verdict: "passed", memo: "가".repeat(501) }).success).toBe(false);
    expect(qaItemSetSchema.safeParse({ itemId: id, verdict: "approved", memo: null }).success).toBe(false);
    expect(qaItemAddSchema.safeParse({ title: "가".repeat(121), isRequired: true }).success).toBe(false);
  });
  it("전달 기록: 방법 4종, ISO 시각, 메모 300", () => {
    expect(deliveryLogSchema.safeParse({ method: "fax", deliveredAt: "2026-11-20T05:00:00+09:00", note: null }).success).toBe(false);
    expect(deliveryLogSchema.safeParse({ method: "email", deliveredAt: "어제", note: null }).success).toBe(false);
    expect(deliveryLogSchema.parse({ method: "email", deliveredAt: "2026-11-20T05:00:00+09:00", note: " 받음 " }).note).toBe("받음");
  });
  it("기본 항목 4종 × 4, 묶음 번호 꼴, 오류 문구", () => {
    for (const k of Object.keys(DEFAULT_QA_ITEMS) as Array<keyof typeof DEFAULT_QA_ITEMS>) expect(DEFAULT_QA_ITEMS[k]).toHaveLength(4);
    expect([1, 2, 11].map(bundleLabel)).toEqual(["v1.0", "v1.1", "v1.10"]);
    expect(qaErrorFromDb("VALIDATION: 보완 필요 또는 미확인 필수 항목이 남아 있어 승인할 수 없습니다")).toEqual({ code: "VALIDATION", message: "보완 필요 또는 미확인 필수 항목이 남아 있어 승인할 수 없습니다." });
    expect(qaErrorFromDb("FROZEN_COLUMN: x").code).toBe("INVALID_TRANSITION");
  });
});

describe("납품 목록 .md", () => {
  it("항목·검수 회차·링크·전달 기록·확인값, 사용자 글 이스케이프", () => {
    const md = buildDeliveryManifest({
      bundleNo: 3,
      status: "reviewed",
      archived: true,
      createdAt: new Date("2026-11-20T03:00:00Z"),
      restoredFromNo: 1,
      items: [
        { kind: "production_brief", title: "봄 [브리프]", versionNo: 2, qaRoundNo: null, approvedAt: null, link: null, sha256: "a".repeat(64) },
        { kind: "ppt_deck", title: "제안서 | 1", versionNo: 4, qaRoundNo: 2, approvedAt: new Date("2026-11-20T04:00:00Z"), link: "/ppt-decks/x/export?format=pptx&version=4", sha256: "b".repeat(64) },
      ],
      logs: [{ method: "email", deliveredAt: new Date("2026-11-20T05:00:00Z"), note: "<b>수신</b>" }],
      exportedAt: new Date("2026-11-20T06:00:00Z"),
    });
    const lines = md.split("\n");
    expect(lines[0]).toBe("# 납품 묶음 v1.2");
    expect(lines).toContain("- 복구 원본: v1.0");
    expect(lines).toContain("| 1 | 공통 제작 브리프 | 봄 \\[브리프\\] | v2 | 검수 대상 아님 | - | - |");
    expect(lines).toContain("| 2 | PPT | 제안서 \\| 1 | v4 | 2회차 통과 | 2026-11-20 13:00 | [열기](/ppt-decks/x/export?format=pptx&version=4) |");
    expect(lines).toContain("- 2026-11-20 14:00 (KST) · 이메일 직접 발송 · \\<b\\>수신\\</b\\>");
    expect(md).toContain(`- 2. \`${"b".repeat(64)}\``);
    expect(md).not.toMatch(/https?:\/\//);
  });
});
