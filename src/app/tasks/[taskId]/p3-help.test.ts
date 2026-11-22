import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
// 화면 점검이 실제 CSS 를 입히도록 클래스 이름을 그대로(다른 화면 시험과 같은 방식)
vi.mock("./p3-help.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
import { P3Help } from "./p3-help";
import { HELP_COPY, helpSteps, P3_CONNECTED_STEPS, P3_STEPS } from "./p3-help-model";

/** P3-HELP-UI-01: AGY P3-HELP-HANDOFF.md 2절 HELP_COPY 26키·배치 규칙 */
describe("P3 사용 안내", () => {
  it("HELP_COPY 는 인계표 26키 그대로(글자 수 대조)", () => {
    expect(Object.keys(HELP_COPY)).toHaveLength(26);
    expect(HELP_COPY.toggleSummary.length).toBe(31);
    expect(HELP_COPY.intro.length).toBe(80);
    expect(HELP_COPY.stepBriefDesc.length).toBe(87);
    expect(HELP_COPY.termRestoreDesc.length).toBe(83);
  });

  it("연결 단계는 상수 한 곳: 이 브랜치(P3FG 연결)는 7단계 모두 사용 가능", () => {
    expect(P3_CONNECTED_STEPS).toEqual([...P3_STEPS]);
    expect(helpSteps().every((s) => s.status === HELP_COPY.statusAvailable)).toBe(true);
    // 묶음마다 상수만 바꾸면 배지가 따라간다
    expect(helpSteps(P3_STEPS).every((s) => s.available)).toBe(true);
    expect(helpSteps([]).every((s) => !s.available)).toBe(true);
  });

  it("기본 접힘·7단계·용어 4개·진행률 막대 없음", () => {
    const html = renderToStaticMarkup(createElement(P3Help));
    expect(html).toMatch(/^<details[^>]*id="p3-help"/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain(HELP_COPY.toggleSummary);
    for (const s of helpSteps()) expect(html).toContain(s.title);
    expect(html.match(/지금 사용 가능/g)).toHaveLength(7);
    expect(html).not.toMatch(/>준비 중</);
    for (const k of ["termStaleTitle", "termRebaseTitle", "termArchiveTitle", "termRestoreTitle"] as const) expect(html).toContain(HELP_COPY[k]);
    expect(html).not.toMatch(/<progress|role="progressbar"|%|\/7단계/);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(7);
  });
});

// 화면 점검용 HTML(4폭·테마 점검은 별도 스크립트). HELP_HARNESS 가 있을 때만 쓴다
it.runIf(Boolean(process.env.HELP_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.HELP_HARNESS!;
  mkdirSync(out, { recursive: true });
  const html = renderToStaticMarkup(createElement(P3Help));
  writeFileSync(join(out, "접힘.html"), html);
  writeFileSync(join(out, "펼침.html"), html.replace("<details ", "<details open "));
});
