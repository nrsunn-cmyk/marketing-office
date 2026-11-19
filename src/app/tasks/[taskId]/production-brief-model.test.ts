import { describe, expect, it } from "vitest";
import {
  DELIVERABLE_TYPE_KEYS,
  PRODUCTION_BRIEF_LIMITS,
  TEXT_FIELDS,
  charLength,
  checkProductionBrief,
  counterText,
  emptyProductionBrief,
  productionBriefToForm,
  staleText,
  toProductionBriefPayload,
  toggleDeliverable,
  type ProductionBriefFormValue,
  type ProductionBriefView,
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

describe("P3-a 공통 제작 브리프 화면 모델(인계표 P3A-HANDOFF.md)", () => {
  it("한도는 인계표 1절과 같다", () => {
    expect(PRODUCTION_BRIEF_LIMITS).toEqual({
      title: 120,
      targetAudience: 500,
      coreMessage: 1000,
      scopeSummary: 2000,
      brandToneConstraints: 1000,
      referenceNotes: 1000,
      deliverableTypesMin: 1,
      deliverableTypesMax: 4,
    });
    expect(DELIVERABLE_TYPE_KEYS).toEqual(["web_copy", "design_asset", "video_script", "ppt_template"]);
    expect(TEXT_FIELDS.filter((f) => f.required).map((f) => f.key)).toEqual(["title", "targetAudience", "coreMessage", "scopeSummary"]);
  });

  it("글자 수는 코드 포인트 기준(이모지 1자, 한글 1자)", () => {
    expect(charLength("가나다")).toBe(3);
    expect(charLength("😀a")).toBe(2);
    expect("😀a".length).toBe(3); // UTF-16 길이와 다르다
    expect(counterText(1234, 2000)).toBe("1,234 / 2,000자");
    expect(counterText(0, 120)).toBe("0 / 120자");
  });

  it("점검: 다 채우면 문제 없음", () => {
    expect(checkProductionBrief(full())).toEqual({});
  });

  it("점검: 필수 칸은 공백만이면 안 됨, 선택 칸은 비어도 됨", () => {
    const v = { ...full(), title: "   ", coreMessage: "" };
    const issues = checkProductionBrief(v);
    expect(Object.keys(issues).sort()).toEqual(["coreMessage", "title"]);
    expect(issues.title).toBe("제작 브리프 제목을(를) 입력해 주세요.");
    expect(checkProductionBrief(emptyProductionBrief())).toMatchObject({ deliverableTypes: "포함 산출물 종류를 1개 이상 선택해 주세요." });
  });

  it("점검: 한도 넘음(코드 포인트로 셈), 경계값은 통과", () => {
    expect(checkProductionBrief({ ...full(), title: "가".repeat(120) })).toEqual({});
    expect(checkProductionBrief({ ...full(), title: "가".repeat(121) }).title).toBe("제작 브리프 제목은(는) 120자까지 쓸 수 있습니다.");
    // 이모지 120개 = 120자(UTF-16 으로는 240)
    expect(checkProductionBrief({ ...full(), title: "😀".repeat(120) })).toEqual({});
    expect(checkProductionBrief({ ...full(), scopeSummary: "a".repeat(2001) }).scopeSummary).toBe("제작 범위 및 제외 사항은(는) 2,000자까지 쓸 수 있습니다.");
    expect(checkProductionBrief({ ...full(), referenceNotes: "a".repeat(1001) }).referenceNotes).toMatch(/1,000자/);
  });

  it("산출물 종류: 켜고 끄기, 화면 순서 유지, 중복·모르는 값 없음", () => {
    let list = toggleDeliverable([], "ppt_template", true);
    list = toggleDeliverable(list, "web_copy", true);
    list = toggleDeliverable(list, "web_copy", true);
    expect(list).toEqual(["web_copy", "ppt_template"]);
    expect(toggleDeliverable(list, "web_copy", false)).toEqual(["ppt_template"]);
    expect(toggleDeliverable(["x" as never, "design_asset"], "video_script", true)).toEqual(["design_asset", "video_script"]);
  });

  it("보기 → 폼 값 → 보낼 값(자르지 않음, 보관 상태는 폼에 오지 않음)", () => {
    const view: ProductionBriefView = {
      id: "b1",
      title: "가".repeat(130),
      targetAudience: "대상",
      coreMessage: "메시지",
      deliverableTypes: ["ppt_template", "web_copy"],
      scopeSummary: "범위",
      brandToneConstraints: "톤",
      referenceNotes: "",
      status: "confirmed",
      revision: 3,
      strategyVersion: { id: "s", version: 2 },
      stale: false,
    };
    const form = productionBriefToForm(view);
    expect(form.deliverableTypes).toEqual(["web_copy", "ppt_template"]);
    expect(form.status).toBe("confirmed");
    expect(productionBriefToForm({ ...view, status: "archived" }).status).toBe("drafting");
    const payload = toProductionBriefPayload(form);
    expect(payload.title).toHaveLength(130);
    expect(Object.keys(payload)).toEqual(["title", "targetAudience", "coreMessage", "deliverableTypes", "scopeSummary", "brandToneConstraints", "referenceNotes", "status"]);
  });

  it("이전 전략 안내: 시안 문구에 버전 번호를 넣는다", () => {
    expect(staleText(2, 3)).toBe(
      "지금 승인본(3번 버전)보다 앞선 전략(2번 버전)으로 만든 제작 브리프입니다. 대상과 메시지가 지금 전략과 맞는지 확인해 주세요. 맞추지 않아도 고칠 수 있습니다.",
    );
    expect(staleText(null, null)).toMatch(/^지금 승인본보다 앞선 전략으로/);
  });
});
