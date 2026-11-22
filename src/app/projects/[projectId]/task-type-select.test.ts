import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskTypeSelect, pickTaskType } from "./task-type-select";

describe("작업 유형 기억(UX-SCENARIO-AUDIT-01 F3)", () => {
  it("남겨 둔 값이 고를 수 있는 유형이면 그것, 아니면 기본값", () => {
    const allowed = ["logo_brief", "quote", "strategy"];
    expect(pickTaskType("quote", allowed, "logo_brief")).toBe("quote");
    expect(pickTaskType(null, allowed, "logo_brief")).toBe("logo_brief");
    expect(pickTaskType("strategy", ["logo_brief", "quote"], "logo_brief")).toBe("logo_brief"); // 내 브랜드 프로젝트엔 전략 없음
    expect(pickTaskType("<script>", allowed, "logo_brief")).toBe("logo_brief");
  });
  it("처음 그림은 서버와 같게 기본값(로고), 이름·id 는 폼 그대로", () => {
    const h = renderToString(createElement(TaskTypeSelect, { fallback: "logo_brief", options: [{ value: "logo_brief", label: "로고" }, { value: "quote", label: "견적" }] }));
    expect(h).toMatch(/<select(?=[^>]*id="task-type")(?=[^>]*name="type")/);
    expect(h).toMatch(/<option value="logo_brief" selected="">/);
  });
});
