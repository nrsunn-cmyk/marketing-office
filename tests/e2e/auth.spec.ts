import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { loginAsOwner, OWNER, requestLink } from "./helpers";
import { clearMailbox, countMessagesTo, waitForLoginLink } from "./mailpit";

/**
 * M3 로그인·업무실 E2E (T01·T16 앱 수준).
 * 사전 조건: npm run e2e:reset (DB 초기화 + owner@marketing-office.test 계정 생성)
 */

const STRANGER = "stranger@marketing-office.test";

test.describe.configure({ mode: "serial" });

test("비로그인 상태로 첫 화면에 가면 로그인 화면으로 보낸다", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login$/);
});

test("허용되지 않은 이메일은 같은 안내가 나오지만 메일이 가지 않는다", async ({ page }) => {
  // 이미 Supabase에 있는 계정이어도 허용 목록에 없으면 메일을 보내지 않는다
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const secret = process.env.SUPABASE_SECRET_KEY;
  test.skip(!secret, "SUPABASE_SECRET_KEY 필요 (.env.local)");
  const admin = createClient(url, secret!, { auth: { persistSession: false } });
  await admin.auth.admin.createUser({ email: STRANGER, email_confirm: true });

  await clearMailbox();
  await requestLink(page, STRANGER);
  await requestLink(page, OWNER);
  await waitForLoginLink(OWNER); // 메일 발송이 동작하는 상태임을 확인한 뒤
  expect(await countMessagesTo(STRANGER)).toBe(0);
});

test("잘못된 이메일 형식은 오류를 보여 준다", async ({ page }) => {
  await page.goto("/login");
  // 브라우저 자체 형식 검사를 끄고 서버 검사를 시험한다. React 화면 준비(hydration)가 끝난 뒤에 바꾼다.
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.querySelector("form")?.setAttribute("novalidate", ""));
  await page.getByLabel("이메일").fill("not-an-email");
  await page.getByRole("button", { name: "로그인 링크 받기" }).click();
  // Next.js 자체의 화면 전환 안내(role=alert)와 구분하려고 문구로 찾는다
  await expect(page.getByRole("alert").filter({ hasText: "이메일 형식이 올바르지 않습니다" })).toBeVisible();
});

test("본인: 링크 로그인 → 처음 설정 → 첫 화면", async ({ page }) => {
  await loginAsOwner(page);
  await expect(page).toHaveURL(/\/setup$/);

  // 필수값 누락 오류
  await page.getByRole("button", { name: "업무실 만들기" }).click();
  await expect(page.getByText("업무실 이름을 입력해 주세요.")).toBeVisible();
  await expect(page.getByText("상호를 입력해 주세요.")).toBeVisible();

  await page.getByLabel("업무실 이름 (필수)").fill("나다움 업무실");
  await page.getByLabel("상호 (견적서 공급자) (필수)").fill("나다움 마케팅");
  await page.getByLabel("대표자").fill("대표");
  await page.getByRole("button", { name: "업무실 만들기" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "나다움 업무실" })).toBeVisible();
  await expect(page.getByText(OWNER, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "아직 데이터가 없습니다" })).toBeVisible();

  // 업무실이 있으면 처음 설정 화면에 다시 들어갈 수 없다
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/$/);
  // 로그인 상태에서 로그인 화면에 가면 첫 화면으로
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
});

test("T16 로그아웃 후 재로그인해도 업무실이 그대로 있다", async ({ page }) => {
  await loginAsOwner(page);
  await expect(page.getByRole("heading", { name: "나다움 업무실" })).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await loginAsOwner(page);
  await expect(page.getByRole("heading", { name: "나다움 업무실" })).toBeVisible();
});

test("로그인 링크는 한 번만 쓸 수 있다", async ({ page, browser }) => {
  await clearMailbox();
  await requestLink(page, OWNER);
  const link = await waitForLoginLink(OWNER);
  await page.goto(link);
  await expect(page).toHaveURL(/\/$/);

  const other = await browser.newContext({ channel: "chrome" } as never);
  const p2 = await other.newPage();
  await p2.goto(link);
  await expect(p2).toHaveURL(/\/login/);
  await p2.goto("/");
  await expect(p2).toHaveURL(/\/login$/);
  await other.close();
});

test("T01 허용 목록에 없는 계정은 관리자 링크가 있어도 들어올 수 없다", async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const secret = process.env.SUPABASE_SECRET_KEY;
  test.skip(!secret, "SUPABASE_SECRET_KEY 필요 (.env.local)");
  const admin = createClient(url, secret!, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: STRANGER,
    options: { redirectTo: `${process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000"}/auth/callback` },
  });
  expect(error).toBeNull();
  await page.goto(data.properties!.action_link);
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
