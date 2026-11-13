import { expect, test, type Page } from "@playwright/test";
import { loginWithWorkspace, unique } from "./helpers";

/**
 * M5 작업·결과 버전·승인 (로고 브리프) E2E.
 * 사전 조건: npm run e2e:reset
 */

test.describe.configure({ mode: "serial" });

const CLIENT = unique("가상고객C 꽃집");
let taskUrl = "";

const visible = (page: Page, text: string, exact = false) => page.getByText(text, { exact }).filter({ visible: true });
/** 작업 화면의 입력 영역 (이전 화면이 숨겨진 채 남아 있어도 이 영역 안에서만 찾는다) */
const logo = (page: Page) => page.getByRole("region", { name: "로고 입력" });
const result = (page: Page) => page.getByRole("region", { name: /^결과/ });
const resultHeading = (page: Page, n: number) => page.getByRole("heading", { name: `결과 ${n}번 버전` });

async function generate(page: Page) {
  await logo(page).getByRole("button", { name: "브리프 만들기" }).click();
}

test("고객·프로필·프로젝트 준비 후 로고 작업 시작, 입력은 프로필에서 미리 채움 (R02)", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/clients");
  await page.getByLabel("고객명 (필수)").fill(CLIENT);
  await page.getByLabel("업종").fill("꽃집");
  await page.getByRole("button", { name: "고객 등록" }).click();
  await expect(page.getByRole("heading", { level: 1, name: CLIENT })).toBeVisible();

  await page.getByLabel("주요 고객(타깃)").fill("기념일을 챙기는 직장인");
  await page.getByLabel("강점 (한 줄에 하나)").fill("당일 배송\n제철 꽃");
  await page.getByRole("button", { name: "새 버전으로 저장" }).click();
  await expect(page.getByRole("heading", { name: /현재 1번 버전/ })).toBeVisible();

  await page.getByText("새 프로젝트").click();
  await page.getByLabel("프로젝트 제목 (필수)").fill("C 로고");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "C 로고" })).toBeVisible();

  await expect(page.getByRole("option", { name: /견적 \(다음 단계에서\)/ })).toBeDisabled();
  await page.getByRole("button", { name: "작업 시작" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로고 브리프·프롬프트" })).toBeVisible();
  taskUrl = page.url();

  await expect(logo(page).getByLabel("회사명 (필수)")).toHaveValue(CLIENT);
  await expect(logo(page).getByLabel("업종")).toHaveValue("꽃집");
  await expect(logo(page).getByLabel("주요 고객")).toHaveValue("기념일을 챙기는 직장인");
  await expect(logo(page).getByLabel("강점")).toHaveValue("당일 배송\n제철 꽃");
  await expect(visible(page, "회사 프로필 1번 버전 사용")).toBeVisible();
  await expect(visible(page, "작성 전", true)).toBeVisible();
});

test("T07 AI 생성은 '연결 안 됨'으로 선택할 수 없다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  await expect(page.getByLabel("AI로 만들기 (연결 안 됨)")).toBeDisabled();
});

test("T06 브리프 만들기: 입력 반영, 빈 항목은 '확인 필요', 상태는 검토 중", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  await logo(page).getByLabel("선호 색상").fill("연분홍\n초록");
  await generate(page);
  await expect(page.getByRole("status").filter({ hasText: "브리프 1번 버전을 만들었습니다" })).toBeVisible();
  await expect(resultHeading(page, 1)).toBeVisible();

  const prompt = page.locator("#result-prompt");
  await expect(prompt).toContainText(`'${CLIENT}' 로고 디자인`);
  await expect(prompt).toContainText("주요 고객: 기념일을 챙기는 직장인");
  await expect(prompt).toContainText("색상: 연분홍, 초록");
  await expect(page.getByRole("note")).toContainText("피해야 할 요소");
  await expect(page.getByRole("note")).not.toContainText("선호 색상");
  await expect(visible(page, "검토 중", true)).toBeVisible();
});

test("T06 복사: 프롬프트가 클립보드에 그대로 들어간다", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3000" });
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  await page.getByRole("button", { name: "프롬프트 복사" }).click();
  await expect(visible(page, "복사했습니다.")).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(await page.locator("#result-prompt").textContent());
});

test("T15 같은 폼을 두 번 보내도 결과는 하나", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  await logo(page).getByLabel("추가 요청").fill("둥근 느낌");
  await page.waitForLoadState("networkidle");
  // 버튼 비활성화를 우회해 같은 폼(같은 요청 키)을 연달아 두 번 보낸다
  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>("form:has(input[name=companyName])")!;
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(resultHeading(page, 2)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "3번 버전" })).toHaveCount(0);
  await expect(visible(page, "2번 버전 (보는 중)")).toBeVisible();
});

test("직접 고치기 → 새 버전, 승인 → 작업 완료", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  await result(page).getByText("직접 고치기 (새 버전으로 저장)").click();
  await result(page).getByLabel("이미지 생성 프롬프트").fill("손으로 고친 프롬프트");
  await page.getByRole("button", { name: "고친 내용 저장" }).click();
  await expect(resultHeading(page, 3)).toBeVisible();
  await expect(page.locator("#result-prompt")).toHaveText("손으로 고친 프롬프트");
  await expect(visible(page, "직접 수정 ·")).toBeVisible();

  await page.getByRole("button", { name: "이 버전 승인" }).click();
  await expect(visible(page, "완료(승인)", true)).toBeVisible();
  await expect(page.getByRole("button", { name: "이 버전 승인" })).toHaveCount(0);
});

test("T14 승인 후 다시 만들면 새 초안이 생기고 승인본(3번)은 그대로", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  await logo(page).getByLabel("선호 색상").fill("노랑");
  await generate(page);
  await expect(resultHeading(page, 4)).toBeVisible();
  const history = page.getByRole("region", { name: "버전 기록" }).or(page.locator("section[aria-labelledby=history]"));
  const v3 = history.getByRole("listitem").filter({ hasText: "3번 버전" });
  await expect(v3.getByText("승인본")).toBeVisible();
  const v4 = history.getByRole("listitem").filter({ hasText: "4번 버전" });
  await expect(v4.getByText("현재 초안")).toBeVisible();
  await expect(v4.getByText("승인본")).toHaveCount(0);

  await v3.getByRole("link", { name: "3번 버전" }).click();
  await expect(page.locator("#result-prompt")).toHaveText("손으로 고친 프롬프트");
  await expect(visible(page, "이전 버전 보기")).toBeVisible();
});

test("T13 두 탭에서 같은 결과를 고치면 늦게 저장한 쪽은 충돌 안내", async ({ page, context }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  const tab2 = await context.newPage();
  await tab2.goto(taskUrl);

  for (const p of [page, tab2]) await result(p).getByText("직접 고치기 (새 버전으로 저장)").click();
  await result(page).getByLabel("브리프", { exact: true }).fill("탭1 브리프");
  await page.getByRole("button", { name: "고친 내용 저장" }).click();
  await expect(resultHeading(page, 5)).toBeVisible();

  await result(tab2).getByLabel("브리프", { exact: true }).fill("탭2 오래된 브리프");
  await tab2.getByRole("button", { name: "고친 내용 저장" }).click();
  await expect(tab2.getByRole("alert").filter({ hasText: "다른 곳에서 먼저 수정되었습니다" })).toBeVisible();
  await tab2.close();
});

test("오래된 화면에서 예전 버전을 승인할 수 없다", async ({ page, context }) => {
  await loginWithWorkspace(page);
  const stale = await context.newPage();
  await stale.goto(taskUrl);
  await expect(resultHeading(stale, 5)).toBeVisible();

  await page.goto(taskUrl);
  await logo(page).getByLabel("선호 색상").fill("하늘색");
  await generate(page);
  await expect(resultHeading(page, 6)).toBeVisible();

  await stale.getByRole("button", { name: "이 버전 승인" }).click();
  await expect(stale.getByRole("alert").filter({ hasText: "최신 버전이 아닙니다" })).toBeVisible();
  await stale.close();
});

test("프로젝트 화면에 작업과 상태가 보인다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  await page.getByRole("link", { name: "C 로고" }).click();
  const item = page.getByRole("list", { name: "작업 목록" }).getByRole("listitem");
  await expect(item).toHaveCount(1);
  await expect(item.getByText("완료(승인)")).toBeVisible();
});
