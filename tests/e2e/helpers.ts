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
  // 상단 메뉴는 처음 설정으로 보내기 전에도 그려지므로, 로그인 정보를 읽은 뒤에만 나오는 현황 내용을 기다린다
  const homeMenu = page.getByText(/^기준 시각:|^아직 데이터가 없습니다$/);
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
 * 관리자 키로 일회용 로그인 링크를 만들어 본인으로 로그인한다(로컬 시험 DB 전용).
 */
export async function ownerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) throw new Error("로컬 시험 DB에서만 쓴다");
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "magiclink", email: OWNER });
  if (error) throw error;
  const sb = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const auth = await sb.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (auth.error) throw auth.error;
  return sb;
}
