import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ setupWorkspace: vi.fn(async () => ({})) }));

const { SetupForm } = await import("./setup-form");
const { ONBOARDING_COPY } = await import("../_components/onboarding-copy");

describe("업무실 처음 설정 폼 (UX-SCENARIO-AUDIT-05 C4)", () => {
  const html = renderToStaticMarkup(createElement(SetupForm));

  it("사업자등록번호 칸에 예시 설명이 붙고 칸이 그 설명을 가리킨다", () => {
    expect(html).toContain(`id="businessNumber-help"`);
    expect(html).toContain(ONBOARDING_COPY.setupBusinessNumberHelp);
    expect(html).toMatch(/id="businessNumber"[^>]*aria-describedby="businessNumber-help"/);
  });

  it("설명이 없는 칸은 aria-describedby 를 달지 않는다", () => {
    expect(html).not.toMatch(/id="representative"[^>]*aria-describedby/);
  });
});
