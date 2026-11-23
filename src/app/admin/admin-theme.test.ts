import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** NADAUM-BRAND-ADMIN-THEME-01 관리자 화면 나다움 테마: 레이아웃·로고·파비콘·토큰 대비 */
vi.mock("@/features/admin/server", () => ({ isAdmin: async () => true }));
vi.mock("./admin.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { default: AdminLayout } = await import("./layout");
const { AdminHeader } = await import("./admin-parts");

const root = process.cwd();
const css = readFileSync(join(root, "src/app/admin/admin.module.css"), "utf8");
const themeBlock = css.match(/\.theme\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const token = (name: string) => themeBlock.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("관리자 나다움 테마", () => {
  it("레이아웃은 관리자 화면만 data-theme=dark + theme 로 감싼다(서버 조회 없음)", () => {
    const h = renderToString(createElement(AdminLayout, null, createElement("main", null, "본문")));
    expect(h).toBe('<div data-theme="dark" class="theme"><main>본문</main></div>');
    expect(readFileSync(join(root, "src/app/admin/layout.tsx"), "utf8")).not.toMatch(/features\/admin|isAdmin|supabase/);
  });

  it("관리자 머리: 나다움 로고(alt NADAUM)와 '관리자 콘솔' 배지(AGY msg_ed6cda9e89ef), 탭 6개(공개 상담 포함)·제목·기존 읽기 전용 안내", () => {
    const h = renderToString(createElement(AdminHeader, { current: "/admin/p4", title: "P4 실행 현황", lead: "설명" }));
    expect(h).toMatch(/<img[^>]*alt="NADAUM"[^>]*src="\/brand\/nadaum\/nadaum-logo\.svg"|src="\/brand\/nadaum\/nadaum-logo\.svg"[^>]*alt="NADAUM"/);
    expect(h).toContain("관리자 콘솔");
    expect(h).not.toContain("관리자 · 읽기 전용");
    expect(h).toContain('href="/admin/inquiries"');
    expect(h).toContain('aria-current="page"');
    expect((h.match(/href="\/admin/g) ?? []).length).toBe(6);
    expect(h).toContain("운영 상태를 보기만 하는 화면입니다.");
  });

  it("관리자 파비콘은 /admin 폴더에만(나다움 파비콘), 루트 파비콘은 그대로", () => {
    const fav = readFileSync(join(root, "public/brand/nadaum/nadaum-favicon.svg"), "utf8");
    expect(readFileSync(join(root, "src/app/admin/icon.svg"), "utf8")).toBe(fav);
    expect(readFileSync(join(root, "src/app/icon.svg"), "utf8")).not.toBe(fav);
    expect(existsSync(join(root, "public/brand/nadaum/nadaum-logo.svg"))).toBe(true);
  });

  it("토큰 대비(WCAG AA 4.5:1 이상): 본문·보조·링크·라일락 단추 글자", () => {
    const [bg, surface, subtle, text, muted, primary, primaryHover, onPrimary] = ["bg-app", "bg-surface", "bg-subtle", "text-main", "text-muted", "primary-600", "primary-700", "text-on-primary"].map(token);
    for (const v of [bg, surface, subtle, text, muted, primary, primaryHover, onPrimary]) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    expect(primary!.toLowerCase()).toBe("#b67af5");
    expect(onPrimary!.toLowerCase()).toBe("#06070c"); // 라일락 위 흰 글자 금지
    const pairs: [string, string, string][] = [
      ["본문/배경", text!, bg!],
      ["본문/카드", text!, surface!],
      ["보조/카드", muted!, surface!],
      ["보조/옅은 면", muted!, subtle!],
      ["링크/카드", primary!, surface!],
      ["링크/배경", primary!, bg!],
      ["단추 글자/라일락", onPrimary!, primary!],
      ["단추 글자/라일락 hover", onPrimary!, primaryHover!],
    ];
    for (const [name, a, b] of pairs) expect(contrast(a, b), `${name} ${a}/${b}`).toBeGreaterThanOrEqual(4.5);
  });
});

// 화면 점검용 HTML(환경 변수로만). Plan/…/NADAUM-BRAND-ADMIN-THEME-01/admin-browser.mjs 가 쓴다
if (process.env.ADMIN_THEME_HARNESS) {
  const out = process.env.ADMIN_THEME_HARNESS;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "header.html"), renderToString(createElement(AdminHeader, { current: "/admin", title: "가입자·업무실", lead: "설명" })));
}
