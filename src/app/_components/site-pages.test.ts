import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * SITE-FIX-01 공개 화면(/, /login, /signup, /forgot-password) — AGY DESIGN-SITE-AUDIT-01·SITE-FIX-HANDOFF.
 * 세션 확인·서버 동작·next/image 만 가짜로 두고 화면 부품은 실제 코드로 그린다(CSS 모듈은 원래 클래스 이름 그대로).
 */
vi.mock("@/server/auth/session", () => ({ getSessionUser: async () => null }));
vi.mock("../login/actions", () => ({ loginAction: async () => ({}), signupAction: async () => ({}), forgotPasswordAction: async () => ({}) }));
vi.mock("next/image", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ src, alt, width, height, className }: Record<string, unknown>) => h("img", { src, alt, width, height, className }) };
});
vi.mock("./landing.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./auth.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { LandingPage } = await import("./landing-page");
const { default: LoginPage } = await import("../login/page");
const { default: SignupPage } = await import("../signup/page");
const { default: ForgotPage } = await import("../forgot-password/page");

const sp = Promise.resolve({});
const PAGES: Record<string, () => string> = {
  home: () => renderToString(createElement(LandingPage)),
  login: () => renderToString(createElement(LoginPage as never, { searchParams: sp } as never)),
  signup: () => renderToString(createElement(SignupPage as never, { searchParams: sp } as never)),
  forgot: () => renderToString(createElement(ForgotPage as never, { searchParams: sp } as never)),
};
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("공개 화면 문구·로고·아이콘(SITE-FIX-HANDOFF 3·4절)", () => {
  it("첫 화면: ⚡ 이모지 대신 장식 SVG, 로고는 테마별 두 판·대체 글 '마케팅 업무실'", () => {
    const h = PAGES.home();
    expect(h).not.toContain("⚡");
    expect(h).toMatch(/<svg class="heroSpark"[^>]*aria-hidden="true"/);
    expect(text(h)).toContain("1인 에이전시를 위한 전문 AI 마케팅 업무실");
    expect(h).toContain('src="/brand/logo-horizontal.svg" alt="마케팅 업무실"');
    expect(h).toContain('src="/brand/logo-horizontal-dark.svg" alt="마케팅 업무실"');
    expect(h).toContain("logoLight");
    expect(h).toContain("logoDark");
    expect(h).not.toContain('alt="나다움 마케팅 오피스"');
  });

  it("로그인 계열: 영문 부제 없음, '비밀번호 찾기'(물음표 없음), 회원가입은 '업무실' 용어", () => {
    for (const k of ["login", "signup", "forgot"]) expect(PAGES[k](), k).not.toContain("AI MARKETING OFFICE");
    const login = PAGES.login();
    expect(text(login)).toContain("비밀번호 찾기");
    expect(login).not.toContain("비밀번호 찾기?");
    const signup = text(PAGES.signup());
    expect(signup).toContain("새로운 업무실 계정을 만드세요. 허용된 이메일만 가입할 수 있습니다.");
    expect(signup).not.toContain("워크스페이스");
  });
});

// 화면 점검용 HTML(4폭·테마 점검은 별도 스크립트). SITE_HARNESS 가 있을 때만 쓴다
it.runIf(Boolean(process.env.SITE_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.SITE_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const [k, f] of Object.entries(PAGES)) writeFileSync(join(out, `${k}.html`), f());
});
