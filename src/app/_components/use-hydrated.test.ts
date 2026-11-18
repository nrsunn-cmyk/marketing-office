import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionForm } from "./action-form";
import { HYDRATION_HINT_ID, HydrationHintProvider } from "./hydration-hint";
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

  it("BUNDLE-D-FRONT-01: 공용 안내가 있으면 폼이 여러 개여도 준비 안내 문장은 화면에 한 번, 모든 비활성 버튼이 그 하나를 가리킨다", () => {
    const form = (label: string) => createElement(ActionForm, { key: label, action: async () => ({}), submitLabel: label });
    const sheet = createElement(MobileActionSheet as ComponentType<{ title: string; children?: ReactNode }>, { key: "s", title: "새 작업" }, form("작업 시작"));
    const html = renderToString(createElement(HydrationHintProvider, null, [form("저장"), form("보관"), form("승인"), sheet]));
    expect(html.match(/화면을 준비하는 중…/g)).toHaveLength(1);
    const ids = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(5); // 폼 4개의 제출 버튼 + 열기 버튼 1개
    expect(new Set(ids)).toEqual(new Set([HYDRATION_HINT_ID]));
    expect(html.match(new RegExp(`id="${HYDRATION_HINT_ID}"`, "g"))).toHaveLength(1);
    // 안내를 담는 role=status 영역은 늘 있다
    expect(html).toMatch(new RegExp(`<div[^>]*role="status"[^>]*><p id="${HYDRATION_HINT_ID}"`));
  });
});
