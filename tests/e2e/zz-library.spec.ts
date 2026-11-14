import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginWithWorkspace } from "./helpers";

/**
 * 자료실·결과물 화면, 메뉴 5개, 휴대폰 자료 추가 창.
 * 파일 이름이 zz 로 시작해 앞의 E2E가 만든 자료·결과물이 있는 상태에서 실행된다.
 */

test.describe.configure({ mode: "serial" });

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = r.violations.map(
    (v) => `${v.id}(${v.impact}): ${v.nodes.length}개 — ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" / ")}`,
  );
  expect(summary, `${label} 접근성 위반`).toEqual([]);
}

test("메뉴 5개, 지금 있는 메뉴 표시", async ({ page }) => {
  await loginWithWorkspace(page);
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await expect(nav.getByRole("link")).toHaveText([/현황/, /고객/, /프로젝트/, /자료실/, /결과물/]);
  await nav.getByRole("link", { name: /자료실/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "자료실" })).toBeVisible();
  await expect(nav.getByRole("link", { name: /자료실/ })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: /결과물/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "결과물" })).toBeVisible();
  await expect(nav.getByRole("link", { name: /결과물/ })).toHaveAttribute("aria-current", "page");
});

test("자료실: 모든 고객의 자료를 모아 보고 종류·이름으로 좁힌다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/assets");
  const list = page.getByRole("list", { name: "자료실 목록" });
  const pdf = list.getByRole("listitem").filter({ hasText: "회사소개서.pdf" });
  await expect(pdf).toBeVisible();
  await expect(pdf.getByRole("link", { name: /가상고객A/ })).toBeVisible();
  await expect(pdf.getByRole("link", { name: "내려받기" })).toBeVisible();

  const search = page.getByRole("search", { name: "자료 찾기" });
  await search.getByLabel("종류").selectOption("url");
  await search.getByRole("button", { name: "찾기" }).click();
  await expect(list.getByRole("listitem").first()).toContainText("링크");
  await expect(list.getByText("회사소개서.pdf")).toHaveCount(0);

  await search.getByLabel("종류").selectOption("");
  await search.getByLabel("이름").fill("회사소개서");
  await search.getByRole("button", { name: "찾기" }).click();
  for (const item of await list.getByRole("listitem").all()) await expect(item).toContainText("회사소개서");

  await search.getByLabel("이름").fill("없는자료%_");
  await search.getByRole("button", { name: "찾기" }).click();
  await expect(page.getByText("조건에 맞는 자료가 없습니다.")).toBeVisible();
});

test("결과물: 로고·견적을 모아 보고, 승인본 있는 것만 볼 수 있다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/results");
  const list = page.getByRole("list", { name: "결과물 목록" });
  await expect(list.getByRole("link", { name: "로고 브리프·프롬프트" }).first()).toBeVisible();
  await expect(list.getByRole("link", { name: "견적" }).first()).toBeVisible();

  const search = page.getByRole("search", { name: "결과물 찾기" });
  await search.getByLabel("종류").selectOption("quote");
  await search.getByLabel("승인본 있는 것만").check();
  await search.getByRole("button", { name: "찾기" }).click();
  const items = list.getByRole("listitem");
  await expect(items.first()).toBeVisible();
  for (const item of await items.all()) {
    await expect(item.getByRole("link").first()).toHaveText("견적");
    await expect(item.getByText(/승인본 \d+번/)).toBeVisible();
  }
  // 결과물에서 작업 화면으로 이동
  await items.first().getByRole("link", { name: "견적" }).click();
  await expect(page.getByRole("form", { name: "견적 작성" })).toBeVisible();
});

test("휴대폰: 자료 추가는 아래쪽 창에서 하고, 닫으면 여는 버튼으로 돌아간다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await loginWithWorkspace(page);
  await page.goto("/projects");
  await page.getByRole("list", { name: "프로젝트 목록" }).getByRole("link").first().click();
  const open = page.getByRole("button", { name: "자료 추가 열기" });
  await open.click();
  const sheet = page.getByRole("dialog", { name: "자료 추가" });
  await expect(sheet).toBeVisible();
  await axe(page, "휴대폰 자료 추가 창");

  await sheet.getByText("메모 추가").click();
  await sheet.getByLabel("내용").fill("휴대폰에서 남긴 메모");
  await sheet.getByRole("button", { name: "메모 저장" }).click();
  await expect(sheet.getByRole("status").filter({ hasText: "메모를 저장했습니다." })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(open).toBeFocused();
  await expect(page.getByText("휴대폰에서 남긴 메모").filter({ visible: true }).first()).toBeVisible();
});

test("자료실·결과물 접근성 검사와 휴대폰 가로 스크롤 없음", async ({ page }) => {
  await loginWithWorkspace(page);
  for (const url of ["/assets", "/results"]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await axe(page, url);
  }
  for (const width of [390, 640]) {
    await page.setViewportSize({ width, height: 900 });
    for (const url of ["/assets", "/results"]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${url} ${width}px 가로 스크롤`).toBeLessThanOrEqual(1);
    }
  }
});
