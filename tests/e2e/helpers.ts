import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import { clearMailbox, waitForLoginLink } from "./mailpit";

export const OWNER = "owner@marketing-office.test";

export async function requestLink(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByRole("button", { name: "로그인 링크 받기" }).click();
  await expect(page.getByRole("status")).toContainText("등록된 이메일이면 로그인 링크를 보냈습니다");
}

export async function loginAsOwner(page: Page) {
  await clearMailbox();
  await requestLink(page, OWNER);
  await page.goto(await waitForLoginLink(OWNER));
}

/** 로그인하고, 업무실이 없으면 만든다. */
export async function loginWithWorkspace(page: Page) {
  await loginAsOwner(page);
  // 첫 화면(/)은 내용이 흘러 들어온 뒤에야 처음 설정(/setup)으로 보낼 수 있다.
  // 주소가 아니라 실제로 나타난 화면(설정 폼 또는 첫 화면 메뉴)을 기다린다.
  const setupField = page.getByLabel("업무실 이름 (필수)");
  const homeMenu = page.getByRole("link", { name: "고객 관리" });
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
