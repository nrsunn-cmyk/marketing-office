import { expect, test, type Page } from "@playwright/test";
import { loginWithWorkspace, ownerSupabase, unique } from "./helpers";

/**
 * SEC-E2E-01: QA-SEC-UI-01 체크리스트에서 E2E가 없던 흐름 3개(02·04·05). 흐름 02는 TASK-REVIEW-FIX-01에서 고친 동작을 확인한다.
 * SEC-FIX-01 이후 decide_version·record_delivery 가 정의자 권한 RPC가 된 뒤에도 화면 흐름이 그대로 동작하는지 본다.
 * 사전 조건: npm run e2e:reset. 이 파일은 자기 가상 고객·프로젝트·작업을 따로 만들어 다른 시험과 섞이지 않는다.
 */

test.describe.configure({ mode: "serial" });

const CLIENT = unique("가상고객S 서점");
const COMMENT = `색을 더 차분하게 <b>굵게</b> 바꿔 주세요. ${"글자가 아주 긴 한 줄 메모입니다".repeat(12)}`;
const NOTE = "[시험-미발송] 대표님 메일로 PDF 전달"; // 합성 메모. 실제 발송 없음
let taskUrl = "";

const visible = (page: Page, text: string, exact = false) => page.getByText(text, { exact }).filter({ visible: true });
const logo = (page: Page) => page.getByRole("region", { name: "로고 입력" });
const resultHeading = (page: Page, n: number) => page.getByRole("heading", { name: `결과 ${n}번 버전` });
const history = (page: Page) => page.locator("section[aria-labelledby=history]");
const deliverySection = (page: Page) => page.locator("section[aria-labelledby=delivery]");

test("준비: 고객·프로젝트·로고 작업을 만들고 1번 초안 생성", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/clients");
  await page.getByLabel("고객명 (필수)").fill(CLIENT);
  await page.getByLabel("업종").fill("서점");
  await page.getByRole("button", { name: "고객 등록" }).click();
  await expect(page.getByRole("heading", { level: 1, name: CLIENT })).toBeVisible();

  await page.getByText("새 프로젝트", { exact: true }).click(); // 빈 상태 안내 문구에도 같은 글자가 있어 펼치기 이름만 정확히(QA-E2E-FULL-01 T1)
  await page.getByLabel("프로젝트 제목 (필수)").fill("S 로고");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "S 로고" })).toBeVisible();
  await page.getByRole("button", { name: "작업 시작" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로고 브리프·프롬프트" })).toBeVisible();
  taskUrl = page.url();

  await logo(page).getByRole("button", { name: "브리프 만들기" }).click();
  await expect(resultHeading(page, 1)).toBeVisible();
  await expect(visible(page, "검토 중", true)).toBeVisible();
});

test("흐름 04: 승인본이 없으면 전달 기록 영역이 없다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  await expect(resultHeading(page, 1)).toBeVisible();
  await expect(deliverySection(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "전달 기록" })).toHaveCount(0);
  await expect(page.getByText("전달 기록 남기기")).toHaveCount(0);
});

/** 현황(/)의 "검토 대기 작업" 숫자. 같은 실행의 다른 시험이 만든 작업도 들어 있으므로 차이(증감)로만 본다. */
async function reviewWaiting(page: Page): Promise<number> {
  await page.goto("/workspace");
  const tile = page
    .getByRole("list", { name: "현황 숫자" })
    .getByRole("listitem")
    .filter({ has: page.getByText("검토 대기 작업", { exact: true }) });
  return Number(await tile.locator("span").nth(1).textContent());
}

/**
 * 흐름 02 (TASK-REVIEW-FIX-01 반영)
 * - BUG-CAND-01: 직접 고치기로 새 초안을 저장하면 작업이 '검토 중'으로 돌아와 현황 '검토 대기'에 다시 잡힌다.
 *   (수정 전 관찰: 7cb5dd8 의 이 시험은 '수정 요청' 유지를 확인했다. 근거와 새 기대는 tests/db/manual-review.test.ts·TASK-REVIEW-FIX-01.md)
 * - BUG-CAND-04: 수정 요청 메모가 버전 기록에 텍스트로 보인다(긴 한글 줄·태그 문자 그대로·빈 메모는 표시 없음).
 */
test("흐름 02: 수정 요청(메모 표시) → 직접 고친 새 버전은 검토 중 → 빈 메모 수정 요청 → 다시 고쳐 승인", async ({ page }) => {
  await loginWithWorkspace(page);
  const base = await reviewWaiting(page); // 이 작업은 지금 '검토 중'(1번 초안)
  await page.goto(taskUrl);

  // 1번에 수정 요청: 긴 한글 + 태그처럼 보이는 글자를 메모로
  await page.getByLabel("수정할 점 (선택)").fill(COMMENT);
  await page.getByRole("button", { name: "수정 요청" }).click();
  await expect(page.getByRole("status").filter({ hasText: "수정 요청으로 표시했습니다." })).toBeVisible();
  const v1 = history(page).getByRole("listitem").filter({ hasText: "1번 버전" });
  await expect(v1.getByText("수정 요청됨")).toBeVisible();
  await expect(v1).toContainText(`수정할 점: ${COMMENT}`); // 글자 그대로(이스케이프)
  await expect(history(page).locator("b")).toHaveCount(0); // 태그로 해석되지 않는다
  await expect(page.locator("span").filter({ hasText: /^수정 요청$/, visible: true })).toHaveCount(1); // 작업 상태 배지
  await expect(deliverySection(page)).toHaveCount(0);
  // 긴 메모는 목록 칸 안에서 줄바꿈된다(가로로 넘치지 않음)
  const memo = v1.getByText(/^수정할 점: /);
  const [memoBox, itemBox] = [await memo.boundingBox(), await v1.boundingBox()];
  expect(memoBox!.x + memoBox!.width).toBeLessThanOrEqual(itemBox!.x + itemBox!.width + 1);

  // 저장값(본인 RLS 조회)
  const sb = await ownerSupabase();
  const taskId = taskUrl.split("/tasks/")[1]!.split(/[?#]/)[0]!;
  const art = await sb.from("artifacts").select("id").eq("task_id", taskId).single();
  expect(art.error).toBeNull();
  const ap = await sb.from("approvals").select("decision, comment").eq("artifact_id", art.data!.id);
  expect(ap.error).toBeNull();
  expect(ap.data).toEqual([{ decision: "changes_requested", comment: COMMENT }]);
  expect(await reviewWaiting(page)).toBe(base - 1); // 수정 요청이 되면 검토 대기에서 빠진다
  await page.goto(taskUrl);

  // 직접 고쳐 2번: 검토 중으로 돌아오고 검토 대기에 다시 잡힌다(BUG-CAND-01)
  await page.getByText("직접 고치기 (새 버전으로 저장)").click();
  await page.getByLabel("이미지 생성 프롬프트").fill("차분한 색으로 고친 프롬프트");
  await page.getByRole("button", { name: "고친 내용 저장" }).click();
  await expect(resultHeading(page, 2)).toBeVisible();
  await expect(visible(page, "검토 중", true)).toBeVisible();
  await expect(page.locator("span").filter({ hasText: /^수정 요청$/, visible: true })).toHaveCount(0);
  await expect(history(page).getByRole("listitem").filter({ hasText: "1번 버전" })).toContainText(`수정할 점: ${COMMENT}`);
  expect(await reviewWaiting(page)).toBe(base);
  await page.goto(taskUrl);

  // 2번에 빈 메모로 수정 요청: 배지만 있고 메모 줄은 없다
  await page.getByRole("button", { name: "수정 요청" }).click();
  await expect(page.getByRole("status").filter({ hasText: "수정 요청으로 표시했습니다." })).toBeVisible();
  const v2 = history(page).getByRole("listitem").filter({ hasText: "2번 버전" });
  await expect(v2.getByText("수정 요청됨")).toBeVisible();
  await expect(v2.getByText(/^수정할 점: /)).toHaveCount(0);

  // 다시 고쳐 3번 → 검토 중 → 승인
  await page.getByText("직접 고치기 (새 버전으로 저장)").click();
  await page.getByLabel("이미지 생성 프롬프트").fill("두 번째로 고친 프롬프트");
  await page.getByRole("button", { name: "고친 내용 저장" }).click();
  await expect(resultHeading(page, 3)).toBeVisible();
  await expect(visible(page, "검토 중", true)).toBeVisible();
  await page.getByRole("button", { name: "이 버전 승인" }).click();
  await expect(visible(page, "완료(승인)", true)).toBeVisible();
  const v3 = history(page).getByRole("listitem").filter({ hasText: "3번 버전" });
  await expect(v3.getByText("승인본")).toBeVisible();
  await expect(history(page).getByRole("listitem").filter({ hasText: "1번 버전" }).getByText("수정 요청됨")).toBeVisible();
  expect(await reviewWaiting(page)).toBe(base - 1); // 승인되면 검토 대기에서 빠진다
});

test("흐름 05: 승인본 수동 전달 기록 저장(방법·메모·시각)", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  const section = deliverySection(page);
  await expect(section).toBeVisible();
  await expect(section.getByText("승인본(3번 버전)")).toBeVisible();
  await expect(section.getByText("아직 전달 기록이 없습니다.")).toBeVisible();

  await section.getByText("전달 기록 남기기").click();
  await section.getByLabel("전달 방법").selectOption({ label: "이메일로 직접 보냄" });
  await section.getByLabel("전달 시각").fill("2026-11-16T09:30");
  await section.getByLabel("메모 (선택)").fill(NOTE);
  await section.getByRole("button", { name: "전달 기록 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "전달 기록을 남겼습니다." })).toBeVisible();

  const list = section.getByRole("list", { name: "전달 기록 목록" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("listitem")).toContainText("이메일로 직접 보냄");
  await expect(list.getByRole("listitem")).toContainText("3번 버전");
  await expect(list.getByRole("listitem")).toContainText(NOTE);
  // 시각은 업무실 시간대(서울)로 다시 그려진다: 입력한 09:30 이 그대로 보여야 한다
  await expect(list.getByRole("listitem")).toContainText("9:30");
  await expect(section.getByText("아직 전달 기록이 없습니다.")).toHaveCount(0);
});
