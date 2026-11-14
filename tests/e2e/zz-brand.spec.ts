import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loginWithWorkspace, OWNER, requestLink } from "./helpers";
import { clearMailbox } from "./mailpit";

/**
 * AGY 브랜드 에셋 적용: 탭 아이콘·아이폰 아이콘·링크 미리보기 그림·머리글/로그인 심볼·로그인 메일.
 */

test("탭 아이콘·홈 화면 아이콘·링크 미리보기 그림이 걸려 있고, 로그인 없이 받을 수 있다", async ({ page, request }) => {
  await page.goto("/login");
  const head = page.locator("head");
  const icon = await head.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute("href");
  const apple = await head.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  const og = await head.locator('meta[property="og:image"]').getAttribute("content");
  await expect(head.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
  await expect(head.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
  await expect(head.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  for (const [url, type] of [
    [icon, "image/svg+xml"],
    [apple, "image/png"],
    [og, "image/png"],
    ["/brand/logo-symbol.svg", "image/svg+xml"],
  ] as const) {
    expect(url, type).toBeTruthy();
    const r = await request.get(url!, { maxRedirects: 0 });
    expect(r.status(), url!).toBe(200);
    expect(r.headers()["content-type"], url!).toContain(type);
  }
});

test("머리글과 로그인 화면에 심볼이 보이고, 밝은·어두운 화면 모두 접근성 위반이 없다", async ({ page }) => {
  await page.goto("/login");
  const mark = page.locator('main img[src*="logo-symbol"]');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute("alt", "");
  await loginWithWorkspace(page);
  const brand = page.getByRole("banner").getByRole("link", { name: "마케팅 업무실" });
  await expect(brand).toBeVisible();
  await expect(brand.locator("img")).toBeVisible();
  expect(await brand.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    await page.waitForLoadState("networkidle");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(r.violations.map((v) => v.id), scheme).toEqual([]);
  }
});

test("로그인 메일은 AGY 디자인이고, 유효 시간은 실제 설정(1시간)과 같다", async ({ page }) => {
  await clearMailbox();
  // 메일 발송 간격(1초 제한)을 지키는 공용 도우미로 요청한다. 다음 시험의 로그인과 부딪히지 않게 한다.
  await requestLink(page, OWNER);
  const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324/api/v1";
  let html = "";
  for (let i = 0; i < 50 && !html; i += 1) {
    const list = (await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${OWNER}"`)}`)).json()) as { messages: Array<{ ID: string }> };
    if (list.messages[0]) html = ((await (await fetch(`${MAILPIT}/message/${list.messages[0].ID}`)).json()) as { HTML: string }).HTML;
    else await new Promise((r) => setTimeout(r, 300));
  }
  expect(html).toContain("업무실 바로 접속하기");
  expect(html).toContain("1시간 동안");
  expect(html).not.toContain("15분");
  expect(html).not.toContain("{{");
  expect(html.match(/\/auth\/v1\/verify/g)?.length).toBe(3); // 버튼 링크 + 아래 주소 링크 + 그 주소 글자
});
