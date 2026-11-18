import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, loginAsOwner, loginWithPassword, mailGap, OWNER, OWNER_PASSWORD } from "./helpers";
import { countMessagesTo, deleteMessagesTo, waitForMail, waitForMailLink } from "./mailpit";

/**
 * 회원가입·이메일+비밀번호 로그인·비밀번호 찾기 E2E (D03 변경, 2026-11-15) + 업무실 처음 설정(T16) + 허용 계정(T01).
 * 사전 조건: npm run e2e:reset (DB 초기화 + 시험용 본인 계정 생성)
 * 허용 이메일: 앱은 playwright.config.ts 의 ALLOWED_USER_EMAILS, DB는 public.signup_allowlist 로 따로 정한다.
 */

const NEWBIE = "newbie@marketing-office.test"; // 앱·DB 모두 허용 → 가입 가능
const DB_BLOCKED = "dbblocked@marketing-office.test"; // 앱은 허용하지만 DB 목록에 없음 → DB가 막음
const STRANGER = "stranger@marketing-office.test"; // 앱 허용 목록에 없음
const NEWBIE_PASSWORD = "Newbie-pass-2026";
const NEWBIE_NEW_PASSWORD = "Changed-pass-2027";
const LOGIN_FAILED = "이메일 또는 비밀번호가 올바르지 않습니다.";

test.describe.configure({ mode: "serial" });

const alert = (page: Page, text: string | RegExp) => page.getByRole("alert").filter({ hasText: text });

async function fillSignup(page: Page, email: string, password: string, confirm = password) {
  await page.goto("/signup");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인", { exact: true }).fill(confirm);
  await page.getByRole("button", { name: "회원가입" }).click();
}

test("비로그인: 업무 화면은 로그인으로, 가입·비밀번호 찾기는 열린다", async ({ page }) => {
  // "/"는 이제 공개 랜딩이다(7411d5b~). 랜딩은 아래 "비로그인 '/'는 공개 랜딩…" 시험이 따로 확인한다(QA-E2E-FULL-01 T2)
  for (const path of ["/setup", "/reset-password"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  await page.getByRole("link", { name: "회원가입" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("navigation", { name: "로그인·회원가입 전환" }).getByRole("link", { name: "회원가입" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goto("/login");
  await page.getByRole("link", { name: "비밀번호 찾기?" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "비밀번호 재설정" })).toBeVisible();
});

test("로그인 실패: 틀린 비밀번호·없는 계정·허용 안 된 이메일은 같은 안내, 입력 오류는 칸별 안내", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(alert(page, "이메일 형식이 올바르지 않습니다.")).toBeVisible();
  await expect(alert(page, "비밀번호를 입력해 주세요.")).toBeVisible();

  for (const [email, pw] of [
    [OWNER, "wrong-pass-1"],
    ["nobody@marketing-office.test", "whatever-1"],
    [STRANGER, "whatever-1"],
  ]) {
    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(pw);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(alert(page, LOGIN_FAILED)).toBeVisible();
    // 실패해도 입력한 이메일은 남는다
    await expect(page.getByLabel("이메일")).toHaveValue(email);
  }
});

test("본인: 비밀번호 로그인 → 처음 설정 → 첫 화면", async ({ page }) => {
  await loginAsOwner(page);
  await expect(page).toHaveURL(/\/setup$/);

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

  await page.goto("/setup");
  await expect(page).toHaveURL(/\/$/);
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
  }
});

test("비로그인 '/'는 공개 랜딩(200)이고 로그인·가입으로 갈 수 있으며, 보호 경로는 로그인으로 보낸다", async ({ page }) => {
  // LANDING-FIX-01 E1: 7411d5b 부터 '/'만 공개(proxy.ts). 데이터 화면은 그대로 보호한다
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("고객 자료는 단 한 번 입력");
  // LANDING-FIX-01-R1 T-a: 비로그인 '/'에 대시보드(현황 숫자·기준 시각)가 새어 나오지 않는다
  await expect(page.getByRole("list", { name: "현황 숫자" })).toHaveCount(0);
  await expect(page.getByText(/^기준 시각:/)).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { name: "로그인" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("banner").getByRole("link", { name: "무료 시작하기" })).toHaveAttribute("href", "/signup");
  for (const path of ["/projects", "/clients", "/settings"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login$/);
  }
});

test("T16 로그아웃 후 다시 로그인해도 업무실이 그대로 있다", async ({ page }) => {
  await loginAsOwner(page);
  await expect(page.getByRole("heading", { name: "나다움 업무실" })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  // 7411d5b 이후 '/'는 공개 랜딩이다. 보호 경로로 로그아웃 상태를 확인한다(LANDING-FIX-01 E1)
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login$/);
  await loginAsOwner(page);
  await expect(page.getByRole("heading", { name: "나다움 업무실" })).toBeVisible();
});

test("회원가입 입력 검사: 형식·약한 비밀번호·확인 불일치·허용 안 된 이메일", async ({ page }) => {
  await fillSignup(page, "not-an-email", "abc", "abd");
  await expect(alert(page, "이메일 형식이 올바르지 않습니다.")).toBeVisible();
  await expect(alert(page, "비밀번호는 8자 이상이어야 합니다.")).toBeVisible();

  await fillSignup(page, NEWBIE, "abcdefgh");
  await expect(alert(page, "영문과 숫자를 모두")).toBeVisible();

  await fillSignup(page, NEWBIE, NEWBIE_PASSWORD, "Different-1");
  await expect(alert(page, "비밀번호 확인이 일치하지 않습니다.")).toBeVisible();

  await fillSignup(page, STRANGER, NEWBIE_PASSWORD);
  await expect(alert(page, "가입이 허용되지 않은 이메일입니다")).toBeVisible();
});

test("DB 허용 목록에 없으면 앱이 허용해도 가입되지 않는다(직접 가입 API 호출도 막힘)", async ({ page }) => {
  await deleteMessagesTo([DB_BLOCKED]);
  await mailGap(DB_BLOCKED);
  await fillSignup(page, DB_BLOCKED, NEWBIE_PASSWORD);
  await expect(alert(page, "가입하지 못했습니다")).toBeVisible();

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const direct = await anon.auth.signUp({ email: "direct-api@marketing-office.test", password: NEWBIE_PASSWORD });
  expect(direct.error).not.toBeNull();
  const { data } = await adminClient().auth.admin.listUsers();
  expect(data.users.map((u) => u.email)).not.toContain(DB_BLOCKED);
  expect(data.users.map((u) => u.email)).not.toContain("direct-api@marketing-office.test");
  expect(await countMessagesTo(DB_BLOCKED)).toBe(0);
});

test("회원가입 → 메일 인증 전에는 로그인 불가 → 한국어 확인 메일 링크 → 바로 업무실 처음 설정", async ({ page }) => {
  expect((await adminClient().from("signup_allowlist").upsert({ email: NEWBIE })).error).toBeNull();
  await deleteMessagesTo([NEWBIE]);
  await mailGap(NEWBIE);
  await fillSignup(page, NEWBIE, NEWBIE_PASSWORD);
  await expect(page).toHaveURL(/\/signup\?sent=1$/);
  await expect(page.getByRole("status")).toContainText("확인 메일을 보냈습니다");

  // 인증 전 로그인
  await page.goto("/login");
  await page.getByLabel("이메일").fill(NEWBIE);
  await page.getByLabel("비밀번호", { exact: true }).fill(NEWBIE_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(alert(page, "메일 인증이 아직 끝나지 않았습니다")).toBeVisible();

  const mail = await waitForMail(NEWBIE);
  expect(mail.subject).toBe("[마케팅 업무실] 회원가입 메일 인증");
  expect(mail.html).toContain("메일 인증하고 시작하기");
  // 다른 기기에서 열어도 되도록 새 브라우저에서 연다
  const link = await waitForMailLink(NEWBIE);
  const other = await page.context().browser()!.newContext({ channel: "chrome" } as never);
  const p2 = await other.newPage();
  await p2.goto(link);
  await expect(p2.getByLabel("업무실 이름 (필수)")).toBeVisible({ timeout: 30_000 });
  // 같은 링크는 한 번만
  const p3 = await (await page.context().browser()!.newContext({ channel: "chrome" } as never)).newPage();
  await p3.goto(link);
  await expect(p3).toHaveURL(/\/login\?error=link_invalid$/);
  await other.close();

  // 이제 비밀번호로 로그인된다
  await loginWithPassword(page, NEWBIE, NEWBIE_PASSWORD);
  await expect(page.getByLabel("업무실 이름 (필수)")).toBeVisible();
});

test("이미 가입한 이메일로 다시 가입해도 같은 안내만 나온다(가입 여부 노출 없음)", async ({ page }) => {
  await mailGap(NEWBIE);
  await fillSignup(page, NEWBIE, NEWBIE_PASSWORD);
  await expect(page.getByRole("status")).toContainText("확인 메일을 보냈습니다");
});

test("비밀번호 찾기 → 한국어 재설정 메일 → 새 비밀번호 → 새 비밀번호로만 로그인", async ({ page }) => {
  await deleteMessagesTo([NEWBIE, STRANGER]);
  // 허용 안 된 이메일은 같은 안내지만 메일이 가지 않는다
  for (const email of [STRANGER, NEWBIE]) {
    await mailGap(email);
    await page.goto("/forgot-password");
    await page.getByLabel("이메일").fill(email);
    await page.getByRole("button", { name: "재설정 링크 받기" }).click();
    await expect(page.getByRole("status")).toContainText("가입된 이메일이면 비밀번호 재설정 메일을 보냈습니다");
  }
  const mail = await waitForMail(NEWBIE);
  expect(mail.subject).toBe("[마케팅 업무실] 비밀번호 재설정");
  expect(mail.html).toContain("새 비밀번호 정하기");
  expect(await countMessagesTo(STRANGER)).toBe(0);

  await page.goto(await waitForMailLink(NEWBIE));
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByText(`${NEWBIE} 계정의 새 비밀번호를 정해 주세요.`)).toBeVisible();

  await page.getByLabel("새 비밀번호", { exact: true }).fill("short1");
  await page.getByLabel("새 비밀번호 확인", { exact: true }).fill("short1");
  await page.getByRole("button", { name: "비밀번호 바꾸기" }).click();
  await expect(alert(page, "비밀번호는 8자 이상이어야 합니다.")).toBeVisible();

  await page.getByLabel("새 비밀번호", { exact: true }).fill(NEWBIE_NEW_PASSWORD);
  await page.getByLabel("새 비밀번호 확인", { exact: true }).fill(NEWBIE_NEW_PASSWORD);
  await page.getByRole("button", { name: "비밀번호 바꾸기" }).click();
  await expect(page.getByRole("status")).toContainText("비밀번호를 바꿨습니다");

  // 새 비밀번호 화면에는 머리글이 없으므로 쿠키를 지워 로그아웃 상태로 만든다
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("이메일").fill(NEWBIE);
  await page.getByLabel("비밀번호", { exact: true }).fill(NEWBIE_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(alert(page, LOGIN_FAILED)).toBeVisible();
  await loginWithPassword(page, NEWBIE, NEWBIE_NEW_PASSWORD);
});

test("가입한 다른 사람은 본인 업무실 자료를 볼 수 없다", async ({ page }) => {
  await loginWithPassword(page, NEWBIE, NEWBIE_NEW_PASSWORD);
  await expect(page.getByLabel("업무실 이름 (필수)")).toBeVisible();
  await page.goto("/clients");
  await expect(page).toHaveURL(/\/setup$/);
  // 본인 계정은 그대로
  await page.context().clearCookies();
  await loginWithPassword(page, OWNER, OWNER_PASSWORD);
  await expect(page.getByRole("heading", { name: "나다움 업무실" })).toBeVisible();
});

test("T01 앱 허용 목록에 없는 계정은 Supabase 계정이 있어도 들어올 수 없다", async ({ page }) => {
  const admin = adminClient();
  expect((await admin.from("signup_allowlist").upsert({ email: STRANGER })).error).toBeNull();
  const made = await admin.auth.admin.createUser({ email: STRANGER, password: NEWBIE_PASSWORD, email_confirm: true });
  expect(made.error?.message ?? "").not.toMatch(/database/i);
  await page.goto("/login");
  await page.getByLabel("이메일").fill(STRANGER);
  await page.getByLabel("비밀번호", { exact: true }).fill(NEWBIE_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(alert(page, LOGIN_FAILED)).toBeVisible();

  // 관리자 링크로 세션을 받아도 앱이 다시 확인해 내보낸다
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: STRANGER,
    options: { redirectTo: `${process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000"}/auth/callback` },
  });
  expect(error).toBeNull();
  await page.goto(`/auth/callback?token_hash=${data.properties!.hashed_token}&type=email`);
  await expect(page).toHaveURL(/\/login\?error=not_allowed$/);
  // 허용되지 않은 사람은 세션이 남지 않는다: 보호 경로는 로그인으로 보낸다('/'는 공개 랜딩, LANDING-FIX-01 E1)
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login$/);
});
