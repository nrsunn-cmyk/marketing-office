import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";
import { loginWithWorkspace, unique } from "./helpers";

/**
 * M6 견적 작성·확정·PDF E2E (T08·T09·T10·T11·T12).
 * 사전 조건: npm run e2e:reset
 */

test.describe.configure({ mode: "serial" });

const CLIENT = unique("가상고객D 세무회계");
let taskUrl = "";

const editor = (page: Page) => page.getByRole("form", { name: "견적 작성" });
const totals = (page: Page) => editor(page).getByLabel("합계");

async function fillRow(page: Page, n: number, name: string, qty: string, price: string) {
  const e = editor(page);
  await e.getByLabel(`${n}번째 줄 항목명`, { exact: true }).fill(name);
  await e.getByLabel(`${n}번째 줄 수량`, { exact: true }).fill(qty);
  await e.getByLabel(`${n}번째 줄 단가`, { exact: true }).fill(price);
}

async function pdfText(page: Page, link: ReturnType<Page["getByRole"]>) {
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const buf = readFileSync(await download.path());
  expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { totalPages, text: text.replace(/\s+/g, " "), fileName: download.suggestedFilename() };
}

test("견적 작업 시작: 오늘 날짜·세율 10%·부가세 별도가 기본", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/clients");
  await page.getByLabel("고객명 (필수)").fill(CLIENT);
  await page.getByRole("button", { name: "고객 등록" }).click();
  await expect(page.getByRole("heading", { level: 1, name: CLIENT })).toBeVisible();
  await page.getByText("새 프로젝트").click();
  await page.getByLabel("프로젝트 제목 (필수)").fill("D 브랜딩");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "D 브랜딩" })).toBeVisible();

  await page.getByLabel("새 작업").selectOption("quote");
  await page.getByRole("button", { name: "작업 시작" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "견적" })).toBeVisible();
  taskUrl = page.url();

  const e = editor(page);
  await expect(e.getByLabel("세금 방식")).toHaveValue("EXCLUSIVE");
  await expect(e.getByLabel("세율 (%)")).toHaveValue("10");
  await expect(e.getByLabel("작성일")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
});

test("T08 입력하는 동안 바로 계산: 2×50,000 별도 10% = 110,000", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  await fillRow(page, 1, "로고 기획", "2", "50,000");
  await expect(editor(page).getByLabel("1번째 줄 금액", { exact: true })).toHaveText("100,000");
  await expect(totals(page)).toContainText("100,000원");
  await expect(totals(page)).toContainText("10,000원");
  await expect(totals(page)).toContainText("110,000원");

  await editor(page).getByLabel("세금 방식").selectOption("INCLUSIVE");
  await fillRow(page, 1, "로고 기획", "1", "110,000");
  await expect(totals(page)).toContainText("100,000원");
  await expect(totals(page)).toContainText("110,000원");
});

test("T09 빈 단가·잘못된 숫자·0원: 초안은 저장되지만 확정은 막힌다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  const e = editor(page);
  await e.getByLabel("세금 방식").selectOption("EXCLUSIVE");
  await fillRow(page, 1, "로고 기획", "2", "50000");
  await e.getByRole("button", { name: "줄 추가" }).click();
  await fillRow(page, 2, "상담", "1", "1 0");
  await expect(e.getByText("2번째 줄 단가: 숫자 형식이 아닙니다", { exact: true }).first()).toBeVisible();
  await expect(e.getByRole("button", { name: "초안 저장" })).toBeDisabled();

  await e.getByLabel("2번째 줄 단가", { exact: true }).fill("");
  await expect(e.getByText("단가를 입력해 주세요.", { exact: true })).toBeVisible();
  await e.getByRole("button", { name: "초안 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "견적 초안 1번 버전을 저장했습니다" })).toBeVisible();
  await expect(page.getByText("아직 확정할 수 없습니다").filter({ visible: true })).toBeVisible();

  await page.getByRole("button", { name: "확정하고 견적 번호 받기" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "확정할 수 없습니다" })).toBeVisible();

  await e.getByLabel("2번째 줄 단가", { exact: true }).fill("0");
  await expect(e.getByText("단가 0원은 무료 항목인지 확인이 필요합니다.", { exact: true })).toBeVisible();
  await e.getByLabel("무료 항목이 맞습니다").check();
  await expect(e.getByText("단가 0원은 무료 항목인지 확인이 필요합니다.", { exact: true })).toHaveCount(0);
});

test("T13 두 탭에서 같은 견적을 저장하면 늦은 쪽은 충돌 안내", async ({ page, context }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  const tab2 = await context.newPage();
  await tab2.goto(taskUrl);
  await editor(page).getByLabel("지급 조건").fill("탭1");
  await editor(page).getByRole("button", { name: "초안 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2번 버전을 저장했습니다" })).toBeVisible();

  await editor(tab2).getByLabel("지급 조건").fill("탭2");
  await editor(tab2).getByRole("button", { name: "초안 저장" }).click();
  await expect(tab2.getByRole("alert").filter({ hasText: "다른 곳에서 먼저 수정되었습니다" })).toBeVisible();
  await tab2.close();
});

test("T10 긴 고객명·30행 견적을 확정하면 번호가 붙고 PDF가 여러 쪽으로 정확히 나온다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  const e = editor(page);
  await e.getByLabel("2번째 줄 삭제", { exact: true }).click();
  for (let i = 2; i <= 30; i += 1) await e.getByRole("button", { name: "줄 추가" }).click();
  for (let i = 1; i <= 30; i += 1) await fillRow(page, i, `${i}번째 상세페이지디자인 작업`, String(1 + (i % 3)), String(10_000 * i));
  await e.getByLabel("유효기간").fill("2099-12-31");
  await e.getByLabel("지급 조건").fill("계약금 50%는 계약 시, 잔금 50%는 납품 후 7일 이내 지급합니다. ".repeat(6));
  const total = (await totals(page).locator("dd").last().textContent())!.trim();
  await e.getByRole("button", { name: "초안 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "3번 버전을 저장했습니다" })).toBeVisible();
  await expect(page.getByText("확정할 수 있습니다").filter({ visible: true })).toBeVisible();

  await page.getByRole("button", { name: "확정하고 견적 번호 받기" }).click();
  await expect(page.getByRole("status").filter({ hasText: /견적 번호 Q-\d{4}-0001\(으\)로 확정했습니다/ })).toBeVisible();
  await expect(page.getByText("완료(승인)", { exact: true }).filter({ visible: true })).toBeVisible();

  const link = page.getByRole("list", { name: "확정 견적서 목록" }).getByRole("link", { name: "PDF 내려받기" }).first();
  const pdf = await pdfText(page, link);
  expect(pdf.fileName).toMatch(/Q-\d{4}-0001\.pdf$/);
  expect(pdf.totalPages).toBeGreaterThan(1);
  expect(pdf.text).toContain(CLIENT);
  expect(pdf.text).toContain(`합계 ${total}`);
  for (let i = 1; i <= 30; i += 1) expect(pdf.text).toContain(`${i}번째 상세페이지디자인`);
  expect(pdf.text).toContain(`${pdf.totalPages} / ${pdf.totalPages}`);

  // T11 다시 받아도 같은 내용
  const again = await pdfText(page, link);
  expect(again.text).toBe(pdf.text);
});

test("T12 고객 이름을 바꿔도 확정 견적서는 당시 이름 그대로, 새로 확정하면 같은 번호의 새 고정본", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/clients");
  await page.getByRole("link", { name: CLIENT }).click();
  // 이전 화면(고객 목록의 등록 폼)이 숨겨진 채 남아 있어 '기본 정보' 영역 안에서만 찾는다
  const info = page.getByRole("region", { name: "기본 정보" });
  await info.getByLabel("고객명 (필수)").fill(`${CLIENT}-새이름`);
  await info.getByRole("button", { name: "기본 정보 저장" }).click();
  await expect(info.getByRole("status").filter({ hasText: "저장했습니다." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "기본 정보" }).getByLabel("고객명 (필수)")).toHaveValue(`${CLIENT}-새이름`);

  await page.goto(taskUrl);
  const oldLink = page.getByRole("list", { name: "확정 견적서 목록" }).getByRole("link", { name: "PDF 내려받기" }).first();
  const old = await pdfText(page, oldLink);
  expect(old.text).toContain(CLIENT);
  expect(old.text).not.toContain("새이름");

  await fillRow(page, 1, "1번째 상세페이지디자인 작업", "5", "10,000");
  await editor(page).getByRole("button", { name: "초안 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "4번 버전을 저장했습니다" })).toBeVisible();
  await page.getByRole("button", { name: "확정하고 견적 번호 받기" }).click();
  await expect(page.getByRole("status").filter({ hasText: /견적 번호 Q-\d{4}-0001\(으\)로 확정했습니다/ })).toBeVisible();

  const list = page.getByRole("list", { name: "확정 견적서 목록" }).getByRole("listitem");
  await expect(list).toHaveCount(2);
  const latest = await pdfText(page, list.first().getByRole("link", { name: "PDF 내려받기" }));
  expect(latest.text).toContain("새이름");
  const first = await pdfText(page, list.last().getByRole("link", { name: "PDF 내려받기" }));
  expect(first.text).toBe(old.text);
});

test("다른 사람·잘못된 주소의 PDF는 받을 수 없다", async ({ page }) => {
  await loginWithWorkspace(page);
  for (const id of ["not-a-uuid", "00000000-0000-0000-0000-000000000000"]) {
    const r = await page.request.get(`/quote-versions/${id}/pdf`);
    expect(r.status()).toBe(404);
  }
});
