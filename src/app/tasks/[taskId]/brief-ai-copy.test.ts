import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefCopyFormState } from "@/features/brief/actions";

/**
 * DEC08-UI-01: 브리프 AI 문구 초안 영역의 상태별 화면(AGY 시안 BRIEF-AI-UI-01 6상태 중 화면에 그리는 5상태).
 * '키 없음'은 부르는 쪽(brief-panel)이 isBriefCopyAiEnabled() 로 영역을 그리지 않는다.
 * useActionState 만 바꿔 끼워 상태를 만든다. 서버 동작·하위 폼은 가짜로 둔다(외부 호출 없음).
 */
const ctl: { state: BriefCopyFormState; pending: boolean } = { state: {}, pending: false };

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return { ...real, useActionState: () => [ctl.state, () => {}, ctl.pending] };
});
vi.mock("@/features/brief/actions", () => ({ generateBriefCopyAction: async () => ({}), acceptBriefCopyAction: async () => ({}) }));
vi.mock("../../_components/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className }: { submitLabel: string; children?: unknown; className?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: "secondaryButton" }, submitLabel)),
  };
});
// CSS 모듈은 원래 클래스 이름 그대로(화면 점검용 HTML 에 원래 CSS 를 붙이기 위해)
vi.mock("./brief-ai.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { BriefAiCopy } = await import("./brief-ai-copy");
const T = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const render = () => renderToString(createElement(BriefAiCopy, { taskId: T, briefId: B, revision: 7 }));
const button = (html: string) => /<button type="submit" class="button"([^>]*)>([^<]*)<\/button>/.exec(html);

const STATES: Record<string, { state: BriefCopyFormState; pending: boolean }> = {
  기본: { state: {}, pending: false },
  "생성 중": { state: {}, pending: true },
  실패: { state: { message: "AI 응답이 늦어 초안을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." }, pending: false },
  한도: { state: { message: "오늘 AI 문구 생성 횟수(30번)를 다 썼습니다. 내일 다시 쓸 수 있고, 카피는 직접 쓸 수 있습니다." }, pending: false },
  완료: {
    state: {
      ok: true,
      message: "AI 초안을 만들었습니다. 마음에 드는 것을 골라 카피 초안으로 쓰세요.",
      runId: "33333333-3333-4333-8333-333333333333",
      variants: [
        { text: "주당 15시간을 쓰는 수동 정리, 이제 줄일 때입니다.\n근거 자료를 바탕으로 실무 흐름을 정리했습니다.", usedClaimIds: [] },
        { text: "긴글".repeat(300), usedClaimIds: [] },
      ],
    },
    pending: false,
  },
};
const use = (k: string) => Object.assign(ctl, STATES[k]);

describe("브리프 AI 문구 초안 영역(BriefAiCopy)", () => {
  beforeEach(() => use("기본"));

  it("기본: 'AI 문구 생성' 단추와 전송 범위 안내(단추가 안내를 가리킴), 필수 숨은 칸", () => {
    const html = render();
    const b = button(html)!;
    expect(b[2]).toBe("AI 문구 생성");
    expect(b[1]).not.toMatch(/disabled/);
    const noteId = /aria-describedby="([^"]+)"/.exec(b[1])![1];
    expect(html).toMatch(new RegExp(`<p id="${noteId}"[^>]*>[^<]*외부 AI\\(Anthropic\\)로 전송됩니다`));
    for (const [n, v] of [["taskId", T], ["briefId", B], ["revision", "7"]]) expect(html).toContain(`name="${n}" value="${v}"`);
    expect(html).not.toContain('role="alert"');
  });

  it("생성 중: 단추가 꺼지고 '생성 중…', 늘 있는 status 영역에 안내", () => {
    use("생성 중");
    const html = render();
    const b = button(html)!;
    expect(b[1]).toMatch(/disabled/);
    expect(b[2]).toBe("생성 중…");
    expect(html).toMatch(/role="status"[^>]*>AI가 카피 초안을 쓰고 있습니다…/);
  });

  it("실패·한도: 서버 문구를 alert 로, 입력은 그대로라는 안내, 단추는 '다시 시도'", () => {
    for (const k of ["실패", "한도"]) {
      use(k);
      const html = render();
      expect(html).toMatch(new RegExp(`role="alert"[^>]*>${STATES[k].state.message!.slice(0, 10)}`));
      expect(html).toContain("지금까지 입력한 브리프 내용은 그대로입니다.");
      expect(button(html)![2]).toBe("다시 시도");
    }
  });

  it("완료: 변형마다 '초안' 표시와 채택 단추(runId·변형 번호·revision), 상자는 점선 강조", () => {
    use("완료");
    const html = render();
    expect(html.match(/초안 — 검토 후 직접 수정하세요/g)).toHaveLength(2);
    expect(html).toContain('name="runId" value="33333333-3333-4333-8333-333333333333"');
    expect(html).toContain('name="variant" value="1"');
    expect(html).toContain('name="variant" value="2"');
    expect(html).toMatch(/class="box boxDraft"/);
    expect(button(html)![2]).toBe("다시 만들기");
    expect(html).toMatch(/role="status"[^>]*>AI 초안을 만들었습니다/);
  });

  // 화면 점검용 HTML(4폭·2테마 브라우저 점검은 별도 스크립트). BRIEF_AI_HARNESS 가 있을 때만 파일을 쓴다
  it.runIf(Boolean(process.env.BRIEF_AI_HARNESS))("화면 점검용 HTML 쓰기", () => {
    const out = process.env.BRIEF_AI_HARNESS!;
    mkdirSync(out, { recursive: true });
    for (const k of Object.keys(STATES)) {
      use(k);
      writeFileSync(join(out, `${k}.html`), render());
    }
  });
});
