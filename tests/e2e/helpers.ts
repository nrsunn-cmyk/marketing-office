import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

export const OWNER = "owner@marketing-office.test";
/** 시험용 본인 비밀번호. npm run e2e:reset 이 이 비밀번호로 계정을 만든다(로컬 시험 DB 전용 값). */
export const OWNER_PASSWORD = "Owner-test-1234";

/**
 * 같은 주소로 메일(가입 확인·비밀번호 재설정)을 1초 안에 두 번 요청하면 Supabase가 429로 거절한다
 * (supabase/config.toml [auth.email] max_frequency = "1s"). 직전 요청에서 1.2초가 지나지 않았으면 남은 시간만 기다린다.
 */
const lastMailAt = new Map<string, number>();
export async function mailGap(email: string) {
  const wait = (lastMailAt.get(email) ?? 0) + 1_200 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMailAt.set(email, Date.now());
}

/** 이메일+비밀번호로 로그인한다. 성공하면 로그인 화면을 벗어난다. */
export async function loginWithPassword(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

export async function loginAsOwner(page: Page) {
  await loginWithPassword(page, OWNER, OWNER_PASSWORD);
}

/** 로그인하고, 업무실이 없으면 만든다. */
export async function loginWithWorkspace(page: Page) {
  await loginAsOwner(page);
  // 첫 화면(/)은 내용이 흘러 들어온 뒤에야 처음 설정(/setup)으로 보낼 수 있다.
  // 주소가 아니라 실제로 나타난 화면(설정 폼 또는 첫 화면 메뉴)을 기다린다.
  const setupField = page.getByLabel("업무실 이름 (필수)");
  // 상단 메뉴는 처음 설정으로 보내기 전에도 그려지므로, 로그인 정보를 읽은 뒤에만 나오는 현황 내용을 기다린다.
  // 현황 숫자 목록은 업무실이 있으면 데이터가 있든 없든 화면에 하나만 있다(IMP-01 이후).
  // 예전 판별(기준 시각 | 아직 데이터가 없습니다)은 빈 업무실에서 두 요소가 함께 보여 strict 위반이 됐다(E2E-HELPER-01).
  const homeMenu = page.getByRole("list", { name: "현황 숫자" });
  await expect(setupField.or(homeMenu)).toBeVisible();
  if (await setupField.isVisible()) {
    await setupField.fill("나다움 업무실");
    await page.getByLabel("상호 (견적서 공급자) (필수)").fill("나다움 마케팅");
    await page.getByRole("button", { name: "업무실 만들기" }).click();
    await expect(homeMenu).toBeVisible();
  }
}

export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY 필요 (.env.local)");
  return createClient(url, secret, { auth: { persistSession: false } });
}

export const unique = (label: string) => `${label}-${Date.now().toString(36)}`;

/**
 * 본인 계정 권한(RLS 적용)의 Supabase 연결. 많은 시험 자료를 화면 없이 빠르게 만들 때 쓴다.
 * 시험용 비밀번호로 본인으로 로그인한다(로컬 시험 DB 전용).
 */
export async function ownerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) throw new Error("로컬 시험 DB에서만 쓴다");
  const sb = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const auth = await sb.auth.signInWithPassword({ email: OWNER, password: OWNER_PASSWORD });
  if (auth.error) throw auth.error;
  return sb;
}
