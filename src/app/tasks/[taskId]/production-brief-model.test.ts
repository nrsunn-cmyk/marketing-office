import { describe, expect, it } from "vitest";
import { briefTrim as serverTrim, productionBriefCreateSchema, productionBriefUpdateSchema } from "@/domain/production-brief";
import type { ProductionBriefView } from "@/features/production-brief/server";
import {
  DELIVERABLE_TYPES,
  TEXT_FIELDS,
  briefTrim,
  checkProductionBrief,
  countChars,
  counterText,
  deliverableText,
  emptyProductionBrief,
  nearLimit,
  productionBriefToForm,
  staleText,
  toCreatePayload,
  toUpdatePayload,
  toggleDeliverable,
  type ProductionBriefFormValue,
} from "./production-brief-model";

const full = (): ProductionBriefFormValue => ({
  title: "카페 홈페이지·로고 제작 기준",
  targetAudience: "동네 직장인",
  coreMessage: "출근길 5분 안에 고르는 원두",
  deliverableTypes: ["web_copy"],
  scopeSummary: "포함: 홈페이지 5개 섹션",
  brandToneConstraints: "",
  referenceNotes: "",
  status: "drafting",
});

describe("P3-a 공통 제작 브리프 화면 모델(서버 계약 P3A-BACKEND-01)", () => {
  it("산출물 코드 4종·필수 칸은 서버 도메인과 같다", () => {
    expect(DELIVERABLE_TYPES).toEqual(["web_copy", "design_assets", "video_plan", "ppt_deck"]);
    expect(TEXT_FIELDS.filter((f) => f.required).map((f) => f.key)).toEqual(["title", "targetAudience", "coreMessage", "scopeSummary"]);
  });

  it("U1: 서버처럼 앞뒤 공백·줄바꿈·NBSP·BOM 을 정리한 뒤 센다", () => {
    for (const s of ["  가나  ", "\n\n가나\n", " 가나﻿", "　가나\t"]) {
      expect(briefTrim(s)).toBe(serverTrim(s));
      expect(countChars(s)).toBe(2);
    }
    // 「␠␠ + 가×120 + ␠」은 서버가 받는 값이므로 넘침이 아니다(QA-P3A-UI-01 U1 재현)
    expect(checkProductionBrief({ ...full(), title: `  ${"가".repeat(120)} ` })).toEqual({});
    expect(checkProductionBrief({ ...full(), scopeSummary: `${"a".repeat(2000)}\n` })).toEqual({});
    expect(checkProductionBrief({ ...full(), title: "가".repeat(121) }).title).toBe("제작 브리프 제목은(는) 120자까지 쓸 수 있습니다.");
    expect(countChars("😀a")).toBe(2);
    expect(counterText(1234, 2000)).toBe("1,234 / 2,000자");
  });

  it("글자 수 읽기: 한도 90% 이상·넘침일 때만", () => {
    expect(nearLimit(107, 120)).toBe(false);
    expect(nearLimit(108, 120)).toBe(true);
    expect(nearLimit(130, 120)).toBe(true);
  });

  it("점검: 필수는 정리 뒤 1자 이상, 산출물 1~4개", () => {
    expect(checkProductionBrief(full())).toEqual({});
    const issues = checkProductionBrief({ ...full(), title: " \n ", coreMessage: "" });
    expect(Object.keys(issues).sort()).toEqual(["coreMessage", "title"]);
    expect(checkProductionBrief(emptyProductionBrief())).toMatchObject({ deliverableTypes: "포함 산출물 종류를 1개 이상 선택해 주세요." });
  });

  it("산출물: 켜고 끄기, 화면 순서 유지, 모르는 값 없음", () => {
    let list = toggleDeliverable([], "ppt_deck", true);
    list = toggleDeliverable(list, "web_copy", true);
    expect(list).toEqual(["web_copy", "ppt_deck"]);
    expect(toggleDeliverable(["design_asset" as never, "video_plan"], "web_copy", true)).toEqual(["web_copy", "video_plan"]);
    expect(deliverableText(["web_copy", "design_assets"])).toBe("홈페이지 구조·문구, 디자인 자산");
  });

  it("보낼 값이 서버 zod 계약을 그대로 통과한다(만들기는 status 없음, 빈 선택 칸은 null)", () => {
    const c = toCreatePayload(full());
    expect(Object.keys(c)).not.toContain("status");
    const pc = productionBriefCreateSchema.safeParse(c);
    expect(pc.success).toBe(true);
    expect(pc.success && pc.data.brandToneConstraints).toBeNull();
    const pu = productionBriefUpdateSchema.safeParse(toUpdatePayload({ ...full(), status: "ready", title: "  제목  " }));
    expect(pu.success).toBe(true);
    expect(pu.success && pu.data).toMatchObject({ status: "ready", title: "제목" });
  });

  it("서버 보기 → 폼 값(선택 칸 null 은 빈 글)", () => {
    const view = {
      title: "t",
      targetAudience: "a",
      coreMessage: "m",
      deliverableTypes: ["ppt_deck", "web_copy"],
      scopeSummary: "s",
      brandToneConstraints: null,
      referenceNotes: "r",
      status: "ready",
    } as unknown as ProductionBriefView;
    expect(productionBriefToForm(view)).toEqual({ title: "t", targetAudience: "a", coreMessage: "m", deliverableTypes: ["web_copy", "ppt_deck"], scopeSummary: "s", brandToneConstraints: "", referenceNotes: "r", status: "ready" });
  });

  it("이전 전략 안내: 고칠 수 없으면 '맞추지 않아도 고칠 수 있습니다'를 뺀다(U2), 승인본이 없으면 그렇게 알린다", () => {
    expect(staleText(2, 3)).toBe("지금 승인본(3번 버전)보다 앞선 전략(2번 버전)으로 만든 제작 브리프입니다. 대상과 메시지가 지금 전략과 맞는지 확인해 주세요. 맞추지 않아도 고칠 수 있습니다.");
    expect(staleText(2, 3, false)).toBe("지금 승인본(3번 버전)보다 앞선 전략(2번 버전)으로 만든 제작 브리프입니다. 대상과 메시지가 지금 전략과 맞는지 확인해 주세요.");
    expect(staleText(2, null)).toMatch(/^바탕 전략의 승인본이 지금 없습니다/);
  });
});
