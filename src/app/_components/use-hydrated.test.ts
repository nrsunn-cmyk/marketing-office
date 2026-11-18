import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionForm } from "./action-form";
import { MobileActionSheet } from "./mobile-action-sheet";
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

  it("BUG-MOBILE-NEWTASK-01: 준비 전에는 비활성 버튼 옆에 이유를 글로 보이고 버튼과 연결한다", () => {
    const html = renderToString(createElement(ActionForm, { action: async () => ({}), submitLabel: "저장" }));
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toMatch(/화면을 준비하는 중…/);
  });

  it("BUG-MOBILE-NEWTASK-01: 휴대폰 대화상자는 서버에서도 '열기 버튼(비활성)+안내+폼이 든 대화상자' 구조(준비 뒤 구조가 바뀌지 않음)", () => {
    const html = renderToString(
      createElement(MobileActionSheet as ComponentType<{ title: string; children?: ReactNode }>, { title: "새 작업" }, createElement("select", { id: "task-type", "aria-label": "종류" })),
    );
    expect(html).toMatch(/<button[^>]*type="button"[^>]*disabled=""[^>]*>새 작업<!-- --> 열기<\/button>/);
    expect(html).toContain("화면을 준비하는 중…");
    // 폼은 대화상자 안에 한 번만 있다(넓은 화면은 CSS 로 펼친다). 서버는 화면 폭을 모르므로 대화상자 역할·이름은 붙이지 않는다
    expect(html.match(/id="task-type"/g)).toHaveLength(1);
    expect(html).toMatch(/<dialog[^>]*role="none"[^>]*>[\s\S]*id="task-type"[\s\S]*<\/dialog>/);
    expect(html).not.toMatch(/<dialog[^>]*aria-labelledby/);
  });
});
