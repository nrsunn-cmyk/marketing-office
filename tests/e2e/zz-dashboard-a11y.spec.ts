import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginWithWorkspace, OWNER, unique } from "./helpers";
import { clearMailbox, waitForLoginLink } from "./mailpit";

/**
 * M7 기능: 현황(T17)·수동 전달 기록(T18)·접근성(T19).
 * 파일 이름이 zz 로 시작해 다른 E2E 뒤에 실행된다(앞 테스트가 만든 데이터가 있는 상태).
 */

test.describe.configure({ mode: "serial" });

const CLIENT = unique("가상고객E 카페");
const PROJECT = unique("E 메뉴판");
let projectUrl = "";
let taskUrl = "";

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "가로 스크롤이 생기면 안 된다").toBeLessThanOrEqual(1);
}

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = r.violations.map(
    (v) => `${v.id}(${v.impact}): ${v.nodes.length}개 — ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" / ")}`,
  );
  expect(summary, `${label} 접근성 위반`).toEqual([]);
}

test("T17 현황: 실제 데이터로 숫자·오늘 처리할 작업·납기 임박·최근 결과물", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/clients");
  await page.getByLabel("고객명 (필수)").fill(CLIENT);
  await page.getByRole("button", { name: "고객 등록" }).click();
  await expect(page.getByRole("heading", { level: 1, name: CLIENT })).toBeVisible();
  await page.getByText("새 프로젝트").click();
  await page.getByLabel("프로젝트 제목 (필수)").fill(PROJECT);
  await page.getByLabel("납기").fill(tomorrow());
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PROJECT })).toBeVisible();
  projectUrl = page.url();
  await page.getByRole("button", { name: "작업 시작" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로고 브리프·프롬프트" })).toBeVisible();
  taskUrl = page.url();
  await page.getByRole("region", { name: "로고 입력" }).getByRole("button", { name: "브리프 만들기" }).click();
  await expect(page.getByRole("heading", { name: "결과 1번 버전" })).toBeVisible();

  await page.goto("/");
  await expect(page.getByText(/^기준 시각:/)).toBeVisible();
  const tiles = page.getByRole("list", { name: "현황 숫자" });
  for (const label of ["진행 중 프로젝트", "검토 대기 작업", "자료 대기 프로젝트", "7일 안 납기"]) {
    const tile = tiles.getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) });
    await expect(tile).toBeVisible();
    expect(Number(await tile.locator("span").nth(1).textContent())).toBeGreaterThanOrEqual(label === "자료 대기 프로젝트" ? 0 : 1);
  }
  await expect(page.getByRole("region", { name: "납기 임박" }).getByRole("link", { name: PROJECT, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "오늘 처리할 작업" }).getByText(PROJECT)).toBeVisible();
  await expect(page.getByRole("region", { name: "최근 결과물" }).getByText(PROJECT).first()).toBeVisible();
  // 참고 이미지의 예시 숫자(65%·95% 등)는 나오지 않는다
  await expect(page.getByText(/\d+%/)).toHaveCount(0);
});

test("T18 수동 전달 기록: 승인 전에는 없고, 승인 후 기록하면 목록에 남는다 (자동 발송 없음)", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  await expect(page.getByRole("region", { name: "전달 기록" })).toHaveCount(0);
  await page.getByRole("button", { name: "이 버전 승인" }).click();
  const panel = page.getByRole("region", { name: "전달 기록" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("이 앱은 고객에게 직접 보내지 않습니다")).toBeVisible();

  await panel.getByText("전달 기록 남기기").click();
  await panel.getByRole("button", { name: "전달 기록 저장" }).click();
  await expect(panel.getByRole("alert").filter({ hasText: "전달 방법을 골라 주세요." })).toBeVisible();

  await panel.getByLabel("전달 방법").selectOption("email_manual");
  await expect(panel.getByLabel("전달 시각")).not.toHaveValue("");
  await panel.getByLabel("메모 (선택)").fill("대표님 메일로 전달");
  await panel.getByRole("button", { name: "전달 기록 저장" }).click();
  const item = panel.getByRole("list", { name: "전달 기록 목록" }).getByRole("listitem");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("이메일로 직접 보냄");
  await expect(item).toContainText("1번 버전");
  await expect(item).toContainText("대표님 메일로 전달");
});

test("T19 키보드만으로 로그인할 수 있다", async ({ browser }) => {
  const ctx = await browser.newContext({ channel: "chrome" } as never);
  const page = await ctx.newPage();
  await clearMailbox();
  await page.goto("/login");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("이메일")).toBeFocused();
  await page.keyboard.type(OWNER);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("로그인 링크를 보냈습니다");
  await page.goto(await waitForLoginLink(OWNER));
  await expect(page.getByText(/^기준 시각:/)).toBeVisible();
  await ctx.close();
});

test("T19 자동 접근성 검사 (WCAG 2.1 AA): 주요 화면에 위반 없음", async ({ page, browser }) => {
  const anon = await (await browser.newContext({ channel: "chrome" } as never)).newPage();
  await anon.goto("/login");
  await axe(anon, "로그인");
  await anon.context().close();

  await loginWithWorkspace(page);
  for (const [label, url] of [
    ["현황", "/"],
    ["고객 목록", "/clients"],
    ["프로젝트 목록", "/projects"],
    ["프로젝트", projectUrl],
    ["로고 작업", taskUrl],
  ] as const) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await axe(page, label);
  }
  await page.goto(projectUrl);
  await page.getByLabel("새 작업").selectOption("quote");
  await page.getByRole("button", { name: "작업 시작" }).click();
  await expect(page.getByRole("form", { name: "견적 작성" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await axe(page, "견적 작업");
});

test("T19 휴대폰 폭(390)과 200% 확대(640)에서 가로 스크롤 없음", async ({ page }) => {
  await loginWithWorkspace(page);
  for (const width of [390, 640]) {
    await page.setViewportSize({ width, height: 900 });
    for (const url of ["/", "/clients", "/projects", projectUrl, taskUrl]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await noHorizontalScroll(page);
    }
  }
});

test("다크 모드에서도 접근성 위반 없음, 테마 전환 버튼은 선택을 기억한다", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await loginWithWorkspace(page);
  for (const url of ["/", "/clients", projectUrl, taskUrl]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await axe(page, `다크 ${url}`);
  }
  // OS가 다크여도 버튼으로 밝은 화면을 고르면 다시 열어도 유지된다
  const toggle = page.getByRole("button", { name: "어두운 화면" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("button", { name: "어두운 화면" })).toHaveAttribute("aria-pressed", "false");
  await axe(page, "밝은 화면 선택 후");
});

test("모바일 새 작업 시트: 키보드 닫기·포커스 복귀·작업 생성과 견적 화면", async ({ page }, testInfo) => {
  await loginWithWorkspace(page);
  await page.goto("/");
  await expect(page.getByText(/^기준 시각:/)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: testInfo.outputPath("dashboard-desktop.png") });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(projectUrl);
  const opener = page.getByRole("button", { name: "새 작업 열기" });
  await opener.click();
  const sheet = page.getByRole("dialog", { name: "새 작업" });
  await expect(sheet).toBeVisible();
  await axe(page, "모바일 새 작업 시트");
  await page.screenshot({ path: testInfo.outputPath("mobile-action-sheet.png") });
  await page.keyboard.press("Escape");
  await expect(sheet).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  await page.mouse.click(8, 100);
  await expect(sheet).not.toBeVisible();
  await opener.click();
  await sheet.getByLabel("새 작업", { exact: true }).selectOption("quote");
  await sheet.getByRole("button", { name: "작업 시작" }).click();
  // 작업을 만든 뒤 개발 서버가 작업 화면을 처음 만드는 데 시간이 걸린다. 주소가 바뀐 것을 먼저 확인한다(Codex M13 검수: 5초 대기 실패).
  await expect(page).toHaveURL(/\/tasks\//,{ timeout: 30_000 });
  await expect(page.getByRole("form", { name: "견적 작성" })).toBeVisible({ timeout: 15_000 });
  await noHorizontalScroll(page);
  await axe(page, "모바일 견적");
  await page.screenshot({ path: testInfo.outputPath("quote-mobile-light.png") });
  await page.getByRole("button", { name: "어두운 화면" }).click();
  await axe(page, "다크 모바일 견적");
  await page.screenshot({ path: testInfo.outputPath("quote-mobile-dark.png") });
});
