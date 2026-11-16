import { expect, test, type Page } from "@playwright/test";
import { loginWithWorkspace, ownerSupabase, unique } from "./helpers";

/**
 * SEC-E2E-01: QA-SEC-UI-01 체크리스트에서 E2E가 없던 흐름 3개(02·04·05).
 * SEC-FIX-01 이후 decide_version·record_delivery 가 정의자 권한 RPC가 된 뒤에도 화면 흐름이 그대로 동작하는지 본다.
 * 사전 조건: npm run e2e:reset. 이 파일은 자기 가상 고객·프로젝트·작업을 따로 만들어 다른 시험과 섞이지 않는다.
 */

test.describe.configure({ mode: "serial" });

const CLIENT = unique("가상고객S 서점");
const COMMENT = "색을 더 차분하게";
const NOTE = "대표님 메일로 PDF 전달";
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

  await page.getByText("새 프로젝트").click();
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

test("흐름 02: 수정 요청(메모) → 직접 고친 새 버전 → 다시 승인", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);

  // 수정 요청: 메모를 남기고 보낸다
  await page.getByLabel("수정할 점 (선택)").fill(COMMENT);
  await page.getByRole("button", { name: "수정 요청" }).click();
  await expect(page.getByRole("status").filter({ hasText: "수정 요청으로 표시했습니다." })).toBeVisible();
  const v1 = history(page).getByRole("listitem").filter({ hasText: "1번 버전" });
  await expect(v1.getByText("수정 요청됨")).toBeVisible();
  // 작업 상태 배지(span). 같은 글자의 "수정 요청" 버튼(button)과 구분한다
  await expect(page.locator("span").filter({ hasText: /^수정 요청$/, visible: true })).toHaveCount(1);
  await expect(deliverySection(page)).toHaveCount(0); // 수정 요청만으로는 승인본이 없다

  // 메모는 화면에 따로 보이지 않으므로 본인 권한(RLS) 조회로 저장값을 확인한다
  const sb = await ownerSupabase();
  const taskId = taskUrl.split("/tasks/")[1]!.split(/[?#]/)[0]!;
  const art = await sb.from("artifacts").select("id").eq("task_id", taskId).single();
  expect(art.error).toBeNull();
  const ap = await sb.from("approvals").select("decision, comment").eq("artifact_id", art.data!.id);
  expect(ap.error).toBeNull();
  expect(ap.data).toEqual([{ decision: "changes_requested", comment: COMMENT }]);

  // 다시 고치기: 직접 고쳐 2번 버전
  await page.getByText("직접 고치기 (새 버전으로 저장)").click();
  await page.getByLabel("이미지 생성 프롬프트").fill("차분한 색으로 고친 프롬프트");
  await page.getByRole("button", { name: "고친 내용 저장" }).click();
  await expect(resultHeading(page, 2)).toBeVisible();
  await expect(visible(page, "검토 중", true)).toBeVisible();

  // 다시 승인
  await page.getByRole("button", { name: "이 버전 승인" }).click();
  await expect(visible(page, "완료(승인)", true)).toBeVisible();
  const v2 = history(page).getByRole("listitem").filter({ hasText: "2번 버전" });
  await expect(v2.getByText("승인본")).toBeVisible();
  await expect(history(page).getByRole("listitem").filter({ hasText: "1번 버전" }).getByText("수정 요청됨")).toBeVisible();
});

test("흐름 05: 승인본 수동 전달 기록 저장(방법·메모·시각)", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(taskUrl);
  const section = deliverySection(page);
  await expect(section).toBeVisible();
  await expect(section.getByText("승인본(2번 버전)")).toBeVisible();
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
  await expect(list.getByRole("listitem")).toContainText("2번 버전");
  await expect(list.getByRole("listitem")).toContainText(NOTE);
  // 시각은 업무실 시간대(서울)로 다시 그려진다: 입력한 09:30 이 그대로 보여야 한다
  await expect(list.getByRole("listitem")).toContainText("9:30");
  await expect(section.getByText("아직 전달 기록이 없습니다.")).toHaveCount(0);
});
