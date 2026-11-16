import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionForm } from "./action-form";
import { useHydrated } from "./use-hydrated";

/**
 * BUG-SESSION-HYDRATION-01 회귀: 서버 렌더(= hydration 전) HTML 에서는 서버 동작 폼의 제출 버튼이 비활성이어야 한다.
 * 그래야 hydration 전 기본 폼 전송(개발: cookies InvariantError, 운영: 빈 화면)이 일어나지 않는다.
 */
describe("hydration 전 제출 차단", () => {
  it("useHydrated 는 서버 렌더에서 false", () => {
    function Probe() {
      return createElement("span", null, useHydrated() ? "붙음" : "붙기 전");
    }
    expect(renderToString(createElement(Probe))).toContain("붙기 전");
  });

  it("ActionForm 의 제출 버튼은 서버 렌더 HTML 에서 disabled", () => {
    const html = renderToString(createElement(ActionForm, { action: async () => ({}), submitLabel: "저장" }));
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>저장<\/button>/);
  });
});
