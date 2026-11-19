import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BRIEF_COPY_MODELS, BRIEF_COPY_PROVIDERS, type BriefCopyProvider } from "@/domain/brief/ai-models";
import type { BriefCopyChoice } from "@/features/brief/ai-copy";
import type { BriefCopyFormState } from "@/features/brief/actions";

/**
 * DEC08-UI-01: 브리프 AI 문구 초안 영역의 상태별 화면(AGY 시안 BRIEF-AI-UI-01 6상태 중 화면에 그리는 5상태)과
 * DEC-08-R1 공급자·모델 고르기. '키 없음'은 부르는 쪽(brief-panel)이 선택지 0개면 영역을 그리지 않는다.
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

/** 서버 listBriefCopyChoices 와 같은 모양(서버 고정 목록에서 만든다) */
const choicesFor = (...providers: BriefCopyProvider[]): BriefCopyChoice[] =>
  providers.map((provider) => ({
    provider,
    label: BRIEF_COPY_PROVIDERS[provider].label,
    models: BRIEF_COPY_MODELS.filter((m) => m.provider === provider).map(({ id, label, note, inputUsd, outputUsd, isDefault }) => ({
      id, label, note, inputUsd, outputUsd, ...(isDefault ? { isDefault } : {}),
    })),
  }));
const ONE = choicesFor("anthropic");
const THREE = choicesFor("openai", "anthropic", "google");

const T = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const render = (choices = ONE) => renderToString(createElement(BriefAiCopy, { taskId: T, briefId: B, revision: 7, choices }));
const button = (html: string) => /<button type="submit" class="button"([^>]*)>([^<]*)<\/button>/.exec(html);
const NOTE = (p: string) =>
  `외부 AI(${p})로 이 브리프의 입력 내용(채널·제목·대상·훅·핵심 메시지·CTA·채널 항목)과 근거가 연결된 주장 문장·근거 이름이 전송됩니다. 근거 메모·자료 원문·고객 연락처·회사 프로필 원문은 보내지 않습니다.`;
const CAUTION = "※ 제목·본문·주장에 고객명을 직접 쓰면 그대로 전송되니 주의하세요.";

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
      model: "claude-sonnet-5-5",
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

  it("기본: 'AI 문구 생성' 단추, 전송 안내·주의(AGY 확정 COPY-DEC08-01 최종판)를 단추가 가리킴, 필수 숨은 칸", () => {
    const html = render();
    const b = button(html)!;
    expect(b[2]).toBe("AI 문구 생성");
    expect(b[1]).not.toMatch(/disabled/);
    const noteId = /aria-describedby="([^"]+)"/.exec(b[1])![1];
    const note = new RegExp(`<div id="${noteId}"[^>]*>(.*?)</div>`).exec(html)![1];
    expect(note).toContain(NOTE("Claude"));
    expect(note).toContain(CAUTION);
    for (const [n, v] of [["taskId", T], ["briefId", B], ["revision", "7"]]) expect(html).toContain(`name="${n}" value="${v}"`);
    expect(html).not.toContain('role="alert"');
  });

  it("공급자가 하나면 선택 칸 대신 '공급자: …' 배지와 숨은 provider 값, 모델은 기본 모델이 골라져 있다", () => {
    const html = render(ONE);
    expect(html).toContain("공급자: <!-- -->Claude (Anthropic)");
    expect(html).toContain('name="provider" value="anthropic"');
    expect(html).not.toMatch(/<select[^>]*name="provider"/);
    expect(html).toMatch(/<select[^>]*name="model"[^>]*>/);
    expect(html).toMatch(/<option value="claude-sonnet-5-5" selected="">Claude Sonnet 5\.5 — 균형\(추천\) \(1회 약 80원\)<\/option>/);
    expect(html).toContain("1회 대략 비용: 약 80원 추정 (공개 요금표 기준, 실제 과금과 다를 수 있음)");
  });

  it("공급자가 여럿이면 플랫폼 선택 칸(키 있는 공급자만), 기본은 서버와 같게 Claude, 안내의 {공급자}도 Claude", () => {
    const html = render(THREE);
    const sel = /<select[^>]*name="provider"[^>]*>(.*?)<\/select>/.exec(html)![1];
    expect([...sel.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1])).toEqual(["openai", "anthropic", "google"]);
    expect(sel).toMatch(/<option value="anthropic" selected="">/);
    expect(html).toContain(NOTE("Claude"));
    expect(html).toContain("플랫폼 (키 설정된 공급자)");
  });

  it("Claude 키가 없으면 첫 공급자(서버와 같은 규칙)와 그 기본 모델, 안내의 {공급자}는 그 이름", () => {
    const html = render(choicesFor("google", "openai"));
    expect(html).toContain(NOTE("Gemini"));
    expect(html).toMatch(/<option value="gemini-3\.8-flash" selected="">/);
  });

  it("생성 중: 단추·선택 칸이 꺼지고 '생성 중…', 늘 있는 status 영역에 안내", () => {
    use("생성 중");
    const html = render(THREE);
    const b = button(html)!;
    expect(b[1]).toMatch(/disabled/);
    expect(b[2]).toBe("생성 중…");
    expect(html).toMatch(/<select[^>]*name="provider"[^>]*disabled=""/);
    expect(html).toMatch(/<select[^>]*name="model"[^>]*disabled=""/);
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

  it("완료: 만든 모델 이름, 변형마다 '초안' 표시와 채택 단추(runId·변형 번호·revision), 상자는 점선 강조", () => {
    use("완료");
    const html = render();
    expect(html).toContain("만든 모델: <!-- -->Claude Sonnet 5.5");
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
      writeFileSync(join(out, `${k}.html`), render(THREE));
      writeFileSync(join(out, `${k}-공급자1.html`), render(ONE));
    }
  });
});
