import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import { adminClient, loginWithWorkspace, ownerSupabase, unique } from "./helpers";

/**
 * P2-E2E-SPEC-01: 퍼널 보드(funnel.spec)·콘텐츠 브리프(brief.spec)가 함께 쓰는 준비 헬퍼.
 * - 승인한 전략까지는 화면으로 만든다(선택자는 p2-strategy-profile.spec 과 같다).
 * - 다른 업무실은 실행마다 고유 계정(P2-E2E-ISOLATION-01 방식). 앱 화면에는 로그인하지 않는다.
 * 자기 전용 시험 스택에서만 돈다(playwright.config preflight). 모든 값은 합성이다.
 */

export interface StrategySetup {
  label: string;
  clientId: string;
  projectId: string;
  taskId: string;
  taskUrl: string;
  profileVersionId: string;
  artifactId: string;
}

export const funnelRegion = (page: Page) => page.getByRole("region", { name: "퍼널 보드" });
/** 단계 칸: li(aria-labelledby=단계 제목). 이름은 "유입0개"처럼 제목 + 카드 수 배지 */
export const stageColumn = (page: Page, label: string) => funnelRegion(page).getByRole("list", { name: "퍼널 5단계" }).getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: new RegExp(`^${label}`) }) }).first();
/** 펼치기 상자(summary 글자로 찾는다) */
export const detailsBy = (scope: Locator, summary: string | RegExp) => scope.locator("details").filter({ has: scope.page().locator("summary", { hasText: summary }) });
export async function openDetails(scope: Locator, summary: string | RegExp) {
  const box = detailsBy(scope, summary).first();
  if (!(await box.evaluate((d) => (d as HTMLDetailsElement).open))) await box.locator("summary").first().click();
  return box;
}
/** 카드: 제목(h4)으로 찾는다 */
export const cardIn = (scope: Locator, title: string) => scope.getByRole("listitem").filter({ has: scope.page().getByRole("heading", { level: 4, name: title }) });

/** 고객 → 프로필 1번 버전(승인) → 고객 프로젝트 → 전략 작업 → 전략 초안 → 승인 */
export async function setupApprovedStrategy(page: Page, labelBase: string): Promise<StrategySetup> {
  const label = unique(labelBase);
  const sb = await ownerSupabase();
  await loginWithWorkspace(page);

  await page.goto("/clients");
  await page.getByLabel("고객명 (필수)").fill(`${label} 고객`);
  await page.getByRole("button", { name: "고객 등록" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${label} 고객` })).toBeVisible();
  const clientId = page.url().split("/clients/")[1]!.split(/[?#]/)[0]!;

  await page.getByLabel("상품·서비스").fill("합성 원두 정기 배송");
  await page.getByLabel("주요 고객(타깃)").fill("합성 고객: 동네 직장인");
  await page.getByRole("button", { name: "새 버전으로 저장" }).click();
  await expect(page.getByRole("heading", { name: /현재 1번 버전/ })).toBeVisible();
  const review = page.getByRole("region", { name: "프로필 버전 검토·승인" });
  await review.getByRole("button", { name: "1번 버전 승인" }).click();
  await expect(review.getByText("이 버전을 승인했습니다.")).toBeVisible();
  const pv = await sb.from("company_profile_versions").select("id").eq("client_id", clientId).eq("version", 1).single();
  if (pv.error) throw pv.error;

  // '새 프로젝트' 펼치기. 빈 상태 안내 문구에도 같은 글자가 있을 수 있어 summary 로 정확히 찾는다(UI-RESP-04)
  await page.locator("summary", { hasText: /^새 프로젝트$/ }).click();
  await page.getByLabel("프로젝트 제목 (필수)").fill(`${label} 프로젝트`);
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${label} 프로젝트` })).toBeVisible();
  const projectId = page.url().split("/projects/")[1]!.split(/[?#]/)[0]!;

  await page.getByLabel("새 작업").selectOption({ label: "마케팅 전략" });
  await page.getByRole("button", { name: "작업 시작" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "마케팅 전략" })).toBeVisible();
  const taskUrl = page.url().split(/[?#]/)[0]!;
  const taskId = taskUrl.split("/tasks/")[1]!;

  const editor = page.getByRole("region", { name: "전략 입력" });
  await editor.getByLabel("기준 회사 프로필 버전 (필수)").selectOption({ label: "1번 버전 · 승인됨" });
  const goals = editor.getByRole("group", { name: "목표 (필수 영역)" });
  await goals.getByRole("button", { name: "+ 사실 (출처 필수)" }).click();
  await goals.getByRole("textbox", { name: /^목표 사실 1(\s|$)/ }).fill("합성 목표: 3개월 안에 정기 배송 신청을 늘린다");
  const positioning = editor.getByRole("group", { name: "포지셔닝 (필수 영역)" });
  await positioning.getByRole("button", { name: "+ 추정 (가설)" }).click();
  await positioning.getByRole("textbox", { name: /^포지셔닝 추정 1(\s|$)/ }).fill("합성 추정: 출근길에 들르는 카페로 기억될 것이다");
  const generate = editor.getByRole("button", { name: "전략 초안 만들기" });
  await expect(generate).toBeEnabled(); // hydration 뒤
  await generate.click();
  await expect(page.getByRole("heading", { name: "전략 1번 버전" })).toBeVisible();

  const approve = page.getByRole("button", { name: "이 버전 승인" });
  await expect(approve).toBeEnabled();
  await approve.click();
  // 승인 폼은 성공과 함께 사라지므로 안내는 화면 아래 공용 안내 영역(role=status)에 남는다(BUNDLE-C-PREP-01, QA T5)
  await expect(page.getByRole("status").filter({ hasText: "승인했습니다." })).toBeVisible();
  await expect(page.getByRole("region", { name: /^전략 \d+번 버전$/ }).getByText("승인본", { exact: true })).toBeVisible();
  const art = await sb.from("artifacts").select("id, approved_version_id").eq("task_id", taskId).single();
  if (art.error) throw art.error;
  expect(art.data.approved_version_id).not.toBeNull();

  return { label, clientId, projectId, taskId, taskUrl, profileVersionId: pv.data.id, artifactId: art.data.id };
}

/** 전략 새 버전(직접 고치기 RPC, 본인 권한)을 만들고 화면에서 승인한다 → 기존 퍼널·브리프가 '이전 전략 기준'이 된다 */
export async function approveNewStrategyVersion(page: Page, s: StrategySetup) {
  const sb = await ownerSupabase();
  const art = (await sb.from("artifacts").select("id, revision, current_draft_version_id").eq("id", s.artifactId).single()).data!;
  const cur = (await sb.from("artifact_versions").select("version, content").eq("id", art.current_draft_version_id!).single()).data!;
  const content = structuredClone(cur.content) as { facts: Array<{ text: string }> };
  content.facts[0]!.text = `${content.facts[0]!.text} (새 버전)`;
  const saved = await sb.rpc("save_strategy_manual_version", { p_artifact_id: art.id, p_expected_revision: art.revision, p_content: content });
  expect(saved.error).toBeNull();
  await page.goto(s.taskUrl);
  await expect(page.getByRole("heading", { name: `전략 ${cur.version + 1}번 버전` })).toBeVisible();
  const approve = page.getByRole("button", { name: "이 버전 승인" });
  await expect(approve).toBeEnabled();
  await approve.click();
  // 승인 폼은 성공과 함께 사라지므로 안내는 화면 아래 공용 안내 영역(role=status)에 남는다(BUNDLE-C-PREP-01, QA T5)
  await expect(page.getByRole("status").filter({ hasText: "승인했습니다." })).toBeVisible();
  await expect(page.getByRole("region", { name: /^전략 \d+번 버전$/ }).getByText("승인본", { exact: true })).toBeVisible();
}

/** 프로젝트 상태를 화면에서 바꾼다(보관 = '보관(으)로', 다시 열기 = '진행 중(으)로') */
export async function setProjectStatus(page: Page, s: StrategySetup, to: "보관" | "진행 중") {
  await page.goto(`/projects/${s.projectId}`);
  const button = page.getByRole("button", { name: `${to}(으)로` });
  await expect(button).toBeEnabled();
  await button.click();
  // 상태 버튼 폼은 다시 그려지며 사라지므로 안내는 공용 안내 영역에 남는다(BUNDLE-C-PREP-01, QA T6). 머리 배지도 바뀐다
  await expect(page.getByRole("status").filter({ hasText: "상태를 바꿨습니다." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).locator("..").getByText(to, { exact: true })).toBeVisible();
}

/** 다른 업무실 주인(합성, 실행마다 고유 주소). cleanup 은 이번 실행이 만든 가입 허용 목록 행만 지운다 */
export async function otherWorkspaceUser(tag: string): Promise<{ email: string; sb: SupabaseClient; cleanup: () => Promise<number> }> {
  const email = `${tag}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}@marketing-office.test`;
  const password = `Other-${randomBytes(9).toString("base64url")}9`;
  const admin = adminClient();
  expect((await admin.from("signup_allowlist").insert({ email, note: "P2-E2E-SPEC-01 실행별 합성 계정" })).error).toBeNull();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error; // 고유 주소이므로 "이미 있음"은 허용하지 않는다
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const signIn = await sb.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const ws = await sb.from("workspaces").select("id").maybeSingle();
  if (!ws.data) expect((await sb.rpc("setup_workspace", { p_name: "다른 업무실", p_legal_name: "다른 상호" })).error).toBeNull();
  return {
    email,
    sb,
    cleanup: async () => (await adminClient().from("signup_allowlist").delete().eq("email", email).select("email")).data?.length ?? 0,
  };
}
