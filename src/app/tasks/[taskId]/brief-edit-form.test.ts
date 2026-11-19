import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BriefEditForm } from "./brief-edit-form";
import type { BriefFormValue } from "./brief-form";

/** DEC08-UI-01: 카피 초안이 AI 초안이면 편집 폼에 'AI 초안' 표시를 한다(직접 고치면 해제는 화면에서 글 비교로 바뀜) */
const initial: BriefFormValue = {
  title: "블로그 글",
  audience: "",
  hook: "",
  coreMessage: "",
  cta: "",
  spec: {},
  copyDraft: "AI가 쓴 카피 초안",
  copyOrigin: "manual",
  imageGuide: "",
  status: "drafting",
};
const render = (copyAi: boolean) =>
  renderToString(createElement(BriefEditForm, { action: async () => ({}), briefId: "b", revision: 1, channel: "blog", copyAi, initial }));

describe("브리프 고치기 폼의 AI 초안 표시", () => {
  it("AI 초안이면 '검토 후 직접 수정' 표시와 작성 방식 'AI 초안'", () => {
    const html = render(true);
    expect(html).toContain("AI 초안 — 검토 후 직접 수정하세요");
    expect(html).toContain("작성 방식: <!-- -->AI 초안");
  });

  it("AI 초안이 아니면 표시가 없고 작성 방식은 그대로", () => {
    const html = render(false);
    expect(html).not.toContain("AI 초안");
    expect(html).toContain("작성 방식: <!-- -->직접 작성");
  });
});
