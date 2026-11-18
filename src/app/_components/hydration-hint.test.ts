import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// 공용 안내 장치가 먼저 준비된 순간을 흉내 낸다(준비 상태 훅이 '준비됨'을 돌려준다)
vi.mock("./use-hydrated", () => ({ useHydrated: () => true }));

const { HYDRATION_HINT_ID, HYDRATION_HINT_TEXT, HydrationHintProvider } = await import("./hydration-hint");

/**
 * BUNDLE-D-FRONT-02(Tester QA-FINAL-D-01 O1): 공용 안내가 본문 버튼보다 먼저 준비되며 문단을 지우면,
 * 아직 준비 중인 버튼이 0.15~0.23초 동안 없는 id 를 aria-describedby 로 가리켰다.
 * 이제 문단은 준비 상태와 상관없이 늘 있고, 보이기·숨기기는 CSS(:has)만 정한다.
 */
describe("공용 준비 안내는 늘 그려 둔다", () => {
  it("장치가 준비된 뒤에도 안내 문단(id·문장)과 role=status 영역이 남아 있다", () => {
    const html = renderToString(createElement(HydrationHintProvider, null, createElement("button", { type: "submit", disabled: true, "aria-describedby": HYDRATION_HINT_ID }, "저장")));
    expect(html).toMatch(new RegExp(`<div[^>]*role="status"[^>]*><p id="${HYDRATION_HINT_ID}"[^>]*>${HYDRATION_HINT_TEXT}</p></div>`));
    expect(html.match(new RegExp(`id="${HYDRATION_HINT_ID}"`, "g"))).toHaveLength(1);
  });

  it("보이기·숨기기는 CSS 가 정한다: 기본은 숨김, 이 안내를 가리키는 요소가 있을 때만 보임", () => {
    const css = readFileSync(join(__dirname, "hydration-hint.module.css"), "utf8");
    expect(css).toMatch(/\.hint\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/:global\(body:has\(\[aria-describedby~="app-hydration-hint"\]\)\)\s*\.hint\s*\{\s*display:\s*block/);
  });
});
