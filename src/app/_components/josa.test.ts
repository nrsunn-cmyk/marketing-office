import { describe, expect, it } from "vitest";
import { eulReul, eunNeun, hasBatchim, iGa, maxLengthMessage, requiredMessage } from "./josa";

describe("조사 고르기(받침)", () => {
  it("받침 있음·없음", () => {
    expect(hasBatchim("이름")).toBe(true);
    expect(hasBatchim("메모")).toBe(false);
    expect(eulReul("자산 이름")).toBe("자산 이름을");
    expect(eunNeun("라이선스·주의 메모")).toBe("라이선스·주의 메모는");
    expect(iGa("장면")).toBe("장면이");
    expect(iGa("슬라이드")).toBe("슬라이드가");
  });
  it("끝이 한글이 아니면 앞의 마지막 한글로, 한글이 없으면 받침 없음", () => {
    expect(eulReul("대사 / 내레이션")).toBe("대사 / 내레이션을");
    expect(eunNeun("발표 자료(PPT) 제목")).toBe("발표 자료(PPT) 제목은");
    expect(eunNeun("CTA")).toBe("CTA는");
  });
  it("AGY 확정 문구(DESIGN-REVIEW-P3C-UI-01 2절 1)와 같다", () => {
    expect(requiredMessage("자산 이름")).toBe("자산 이름을 입력해 주세요.");
    expect(maxLengthMessage("자산 이름", 100)).toBe("자산 이름은 100자까지 쓸 수 있습니다.");
    expect(maxLengthMessage("라이선스·주의 메모", 500)).toBe("라이선스·주의 메모는 500자까지 쓸 수 있습니다.");
    expect(maxLengthMessage("버전 교체 사유", 300)).toBe("버전 교체 사유는 300자까지 쓸 수 있습니다.");
    expect(maxLengthMessage("대사 / 내레이션", 1000)).toBe("대사 / 내레이션은 1,000자까지 쓸 수 있습니다.");
  });
});
