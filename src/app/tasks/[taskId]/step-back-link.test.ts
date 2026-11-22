import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
const { StepBackLink } = await import("./step-back-link");

const dir = join(process.cwd(), "src/app/tasks/[taskId]");
const SECTIONS = ["production-brief", "web-copy", "design-assets", "video-plan", "ppt-deck", "qa-checklist", "delivery-bundle"];

describe("UX F2: 단계 제목 옆 '단계 목록으로'(AGY DESIGN-UX-F245-01 1절)", () => {
  it("링크는 #task-jump 로, 44px 터치 링크", () => {
    const h = renderToString(createElement(StepBackLink));
    expect(h).toBe('<a href="#task-jump" class="touchLink">단계 목록으로</a>');
  });
  it("P3 일곱 단계 제목마다 바로 뒤에 붙고, 위 빠른 이동 막대에 id=task-jump(모바일 sticky 없음)", () => {
    for (const id of SECTIONS) {
      const src = readFileSync(join(dir, `${id}-section.tsx`), "utf8");
      const at = src.indexOf(`<h2 id="${id}"`);
      expect(at, id).toBeGreaterThan(-1);
      const after = src.slice(src.indexOf("</h2>", at), src.indexOf("</h2>", at) + 80);
      expect(after, id).toContain("<StepBackLink />");
    }
    const page = readFileSync(join(dir, "page.tsx"), "utf8");
    expect(page).toContain('<nav id="task-jump"');
    expect(readFileSync(join(dir, "web-copy.module.css"), "utf8")).not.toMatch(/\.wcJump\s*\{[^}]*position:\s*sticky/);
  });
});
