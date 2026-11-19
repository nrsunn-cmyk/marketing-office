import { describe, expect, it } from "vitest";
import { leadMagnetInputSchema } from "@/domain/lead-magnet";
import { emptyLeadMagnet, formLines, leadMagnetToForm, toLeadMagnetPayload } from "./lead-magnet-form";

describe("리드마그넷 폼 값 ↔ 서버 계약(P2E-UI-01)", () => {
  it("빈 폼에 제목만 넣으면 계약을 통과하고 기본값(체크리스트·기획·전달 방식 없음)이 된다", () => {
    const p = toLeadMagnetPayload({ ...emptyLeadMagnet("s1"), title: "  원두 고르는 법  " });
    const r = leadMagnetInputSchema.safeParse(p);
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ title: "원두 고르는 법", format: "checklist", audience: null, promise: null, delivery: null, leadFields: [], outline: [], status: "planned" });
  });

  it("여러 줄 칸은 빈 줄을 빼고 줄마다 공백을 지운다(CRLF 포함)", () => {
    expect(formLines(" 이메일 \r\n\r\n회사명\n  \n직책")).toEqual(["이메일", "회사명", "직책"]);
  });

  it("개수·길이를 넘겨도 자르지 않고 그대로 보내 서버가 안내한다(조용한 잘림 방지)", () => {
    const many = Array.from({ length: 11 }, (_, i) => `항목${i + 1}`).join("\n");
    const p = toLeadMagnetPayload({ ...emptyLeadMagnet("s1"), title: "가", leadFields: many, outline: "가".repeat(301) });
    expect(p.leadFields).toHaveLength(11);
    expect(p.outline[0]).toHaveLength(301);
    const r = leadMagnetInputSchema.safeParse(p);
    expect(r.success).toBe(false);
  });

  it("서버 보기 → 폼 → payload 가 값을 그대로 돌려준다", () => {
    const view = {
      title: "가이드",
      format: "guide" as const,
      stageId: "s2",
      delivery: "email" as const,
      status: "ready" as const,
      audience: "1인 마케터",
      promise: null,
      leadFields: ["이메일", "업종"],
      outline: ["1장", "2장"],
    };
    const form = leadMagnetToForm(view);
    expect(form).toMatchObject({ delivery: "email", promise: "", leadFields: "이메일\n업종", stageId: "s2" });
    expect(leadMagnetInputSchema.parse(toLeadMagnetPayload(form))).toEqual({
      title: "가이드",
      format: "guide",
      audience: "1인 마케터",
      promise: null,
      delivery: "email",
      leadFields: ["이메일", "업종"],
      outline: ["1장", "2장"],
      status: "ready",
    });
  });
});
