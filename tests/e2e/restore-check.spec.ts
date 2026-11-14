import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";
import { loginWithWorkspace } from "./helpers";

/**
 * T20 복원 후 앱 확인. 복원 훈련(scripts/backup/restore-drill.mts) 직후에만 실행한다:
 *   RESTORE_CHECK=1 npx playwright test tests/e2e/restore-check.spec.ts
 */
test.skip(process.env.RESTORE_CHECK !== "1", "복원 훈련 직후에만 실행");

test("복원된 데이터로 로그인·고객·확정 견적 PDF·자료 내려받기가 된다", async ({ page }) => {
  await loginWithWorkspace(page);
  await expect(page.getByText(/^기준 시각:/)).toBeVisible();

  await page.goto("/projects");
  await page.getByRole("link", { name: "D 브랜딩" }).click();
  await page.getByRole("list", { name: "작업 목록" }).getByRole("link", { name: "견적" }).click();
  const links = page.getByRole("list", { name: "확정 견적서 목록" }).getByRole("link", { name: "PDF 내려받기" });
  // 확정 견적 개수는 백업 시점의 자료에 따라 다르다(M13 이후 E2E는 3개). 개수를 고정하지 않고,
  // 원래 시험 자료의 2개 이상이 보이는지 확인한다. 정확한 개수를 확인하려면 RESTORE_EXPECT_PDFS=개수 (Codex 재검수)
  await expect(links.first()).toBeVisible();
  const expected = Number(process.env.RESTORE_EXPECT_PDFS);
  if (Number.isInteger(expected) && expected > 0) await expect(links).toHaveCount(expected);
  else expect(await links.count()).toBeGreaterThanOrEqual(2);
  const [download] = await Promise.all([page.waitForEvent("download"), links.first().click()]);
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(await download.path())));
  const { text } = await extractText(pdf, { mergePages: true });
  expect(text).toContain("견 적 서");
  expect(text).toMatch(/Q-\d{4}-0001/);

  await page.goto("/projects");
  const fileProject = page.getByRole("listitem").filter({ hasText: "A 로고" }).getByRole("link").first();
  await fileProject.click();
  const item = page.getByRole("listitem").filter({ hasText: "회사소개서.pdf" });
  const [file] = await Promise.all([page.waitForEvent("download"), item.getByRole("link", { name: "내려받기" }).click()]);
  expect(readFileSync(await file.path()).subarray(0, 5).toString()).toBe("%PDF-");
});
