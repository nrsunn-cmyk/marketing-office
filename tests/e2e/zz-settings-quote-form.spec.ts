import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";
import { loginWithWorkspace } from "./helpers";

/**
 * 업무실 설정(공급자 정보)과 표준 견적서 양식.
 * 앞의 견적 E2E가 확정한 견적이 있는 상태에서 실행된다(파일 이름 zz).
 */

test.describe.configure({ mode: "serial" });

const BIZ_TYPE = `서비스-${Date.now().toString(36)}`;

async function pdfText(page: Page, link: ReturnType<Page["getByRole"]>) {
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(await download.path())));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/\s+/g, " ");
}

test("업무실 설정: 공급자 정보를 새 버전으로 저장한다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.getByRole("link", { name: "설정" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "업무실 설정" })).toBeVisible();
  const form = page.getByRole("region", { name: /공급자 정보/ });

  await form.getByLabel("상호 (필수)").fill("");
  await form.getByRole("button", { name: "새 버전으로 저장" }).click();
  await expect(form.getByRole("alert").filter({ hasText: "상호를 입력해 주세요." })).toBeVisible();

  await form.getByLabel("상호 (필수)").fill("나다움 마케팅");
  await form.getByLabel("사업자등록번호").fill("000-00-00000");
  await form.getByLabel("업태").fill(BIZ_TYPE);
  await form.getByLabel("종목").fill("광고대행, 디자인");
  await form.getByLabel("담당자").fill("홍길동 실장");
  await form.getByLabel("입금 계좌").fill("○○은행 000-000-000000 (예금주 시험)");
  await form.getByLabel("이메일").fill("not-email");
  await form.getByRole("button", { name: "새 버전으로 저장" }).click();
  await expect(form.getByRole("alert").filter({ hasText: "이메일 형식이 올바르지 않습니다." })).toBeVisible();

  await form.getByLabel("이메일").fill("hello@example.com");
  await form.getByRole("button", { name: "새 버전으로 저장" }).click();
  await expect(form.getByRole("status").filter({ hasText: /공급자 정보 \d+번 버전을 저장했습니다/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: /공급자 정보/ }).getByLabel("업태")).toHaveValue(BIZ_TYPE);
});

test("새로 확정한 견적서는 표준 양식에 새 공급자 정보, 예전 확정본은 예전 정보 그대로", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/results?type=quote&approved=1");
  await page.getByRole("list", { name: "결과물 목록" }).getByRole("link", { name: "견적" }).first().click();
  const editor = page.getByRole("form", { name: "견적 작성" });
  await expect(editor).toBeVisible();

  const finals = page.getByRole("list", { name: "확정 견적서 목록" }).getByRole("listitem");
  const before = await finals.count();
  const oldText = await pdfText(page, finals.first().getByRole("link", { name: "PDF 내려받기" }));
  expect(oldText).not.toContain(BIZ_TYPE);

  await editor.getByLabel("1번째 줄 수량", { exact: true }).fill("7");
  await editor.getByRole("button", { name: "초안 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: /견적 초안 \d+번 버전을 저장했습니다/ })).toBeVisible();
  await page.getByRole("button", { name: "확정하고 견적 번호 받기" }).click();
  await expect(finals).toHaveCount(before + 1);

  const text = await pdfText(page, finals.first().getByRole("link", { name: "PDF 내려받기" }));
  for (const t of ["견 적 서", "귀하", "공 급 자", "000-00-00000", BIZ_TYPE, "광고대행, 디자인", "홍길동 실장", "합계금액 일금", "원정", "특기사항", "○○은행 000-000-000000"]) {
    expect(text).toContain(t);
  }
  // 예전 확정본은 다시 받아도 예전 내용 그대로 (R06·T12)
  const again = await pdfText(page, finals.last().getByRole("link", { name: "PDF 내려받기" }));
  expect(again).not.toContain(BIZ_TYPE);
});

test("입력 오류가 나도 이미 입력한 다른 칸은 지워지지 않는다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/clients");
  const form = page.getByRole("region", { name: "새 고객 등록" });
  await form.getByLabel("업종").fill("남아 있어야 하는 업종");
  await form.getByLabel("설명").fill("남아 있어야 하는 설명");
  await form.getByRole("button", { name: "고객 등록" }).click();
  await expect(form.getByRole("alert").filter({ hasText: "고객명을 입력해 주세요." })).toBeVisible();
  await expect(form.getByLabel("업종")).toHaveValue("남아 있어야 하는 업종");
  await expect(form.getByLabel("설명")).toHaveValue("남아 있어야 하는 설명");
});
