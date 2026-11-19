import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { loginWithWorkspace, ownerSupabase } from "./helpers";
import {
  approveNewStrategyVersion,
  cardIn,
  detailsBy,
  funnelRegion,
  openDetails,
  otherWorkspaceUser,
  setProjectStatus,
  setupApprovedStrategy,
  stageColumn,
  type StrategySetup,
} from "./p2-board-setup";

/**
 * P2-E2E-SPEC-01 콘텐츠 제작 브리프(P2F-FRONT-01 화면 + P2F-BACKEND-01 서버, migration 22).
 * 승인 전략 → 퍼널·카드(본인 RPC로 빠르게) → 카드에서 채널 브리프 만들기 → 주장 추가 → [미확인 주장]
 * → 근거 연결 → 마크다운 복사 → 근거 해제(목록에서 숨김) → 브리프 고치기 → 이전 전략 기준·브리프만 맞추기
 * → 보관 프로젝트 읽기 전용 → 다른 업무실 격리. 자기 전용 시험 스택에서만 돈다. 모든 값은 합성이다.
 */
test.describe.configure({ mode: "serial" });

let s: StrategySetup;
let CARD = "";
let briefUrl = "";
let briefId = "";
const CLAIM = "합성 주장: 정기 배송은 매주 월요일에 도착한다";
const HOOK = "합성 훅: 월요일 아침 커피가 이미 와 있다면?";

const briefRegion = (page: Page) => page.getByRole("region", { name: /^콘텐츠 브리프/ });
const claimItem = (page: Page) => briefRegion(page).getByRole("list", { name: "주장 목록" }).getByRole("listitem").filter({ hasText: CLAIM }).first();

test("준비: 승인한 전략 → 퍼널 보드·카드(본인 권한 RPC)", async ({ page }) => {
  s = await setupApprovedStrategy(page, "브리프E2E");
  CARD = `${s.label} 합성 카드: 정기 배송 안내 글`;
  const sb = await ownerSupabase();
  const created = await sb.rpc("create_funnel", { p_strategy_artifact_id: s.artifactId }).single();
  expect(created.error).toBeNull();
  const fid = (created.data as { funnel_id: string }).funnel_id;
  const stage = (await sb.from("funnel_stages").select("id").eq("funnel_id", fid).eq("stage_key", "awareness").single()).data!;
  expect((await sb.rpc("add_funnel_item", { p_stage_id: stage.id, p_kind: "content", p_title: CARD })).error).toBeNull();
});

test("카드에서 채널 브리프 만들기 → 상세 열기, 빈 브리프 안내", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(s.taskUrl);
  const card = cardIn(stageColumn(page, "인지"), CARD);
  await expect(card.getByText("아직 브리프가 없습니다.")).toBeVisible();
  const make = await openDetails(card, "+ 채널 브리프 만들기");
  await make.getByLabel("채널").selectOption("blog");
  const btn = make.getByRole("button", { name: "브리프 만들기" });
  await expect(btn).toBeEnabled();
  await btn.click();
  const link = card.getByRole("link", { name: "블로그" });
  await expect(link).toBeVisible();
  // 같은 카드에서 블로그는 다시 고를 수 없다(카드 1장 × 채널마다 1개)
  await expect((await openDetails(card, "+ 채널 브리프 만들기")).getByLabel("채널").locator("option", { hasText: "블로그" })).toHaveCount(0);

  await link.click();
  await expect(page).toHaveURL(/\?brief=[0-9a-f-]{36}#brief$/);
  briefUrl = page.url();
  briefId = new URL(briefUrl).searchParams.get("brief")!;
  const brief = briefRegion(page);
  await expect(brief.getByRole("heading", { level: 2 })).toHaveText(`콘텐츠 브리프: ${CARD}`); // 템플릿 제목 = 카드 제목
  await expect(brief.getByText("아직 비어 있는 브리프입니다.")).toBeVisible();
  // A1(DEC08-UI-01): 시험 스택에는 AI 키(ANTHROPIC/OPENAI/GEMINI_API_KEY)가 없으므로 선택지 0개 → AI 영역 자체가 없다.
  // 실제 생성 흐름은 외부 호출이라 E2E 에서 하지 않는다(서버 단위 시험이 가짜 fetch 로 맡음)
  await expect(brief.getByRole("heading", { name: "AI 문구 초안 만들기" })).toHaveCount(0);
  await expect(brief.getByRole("button", { name: /AI/ })).toHaveCount(0);
  await expect(brief.getByText(/외부 AI\(/)).toHaveCount(0);
});

test("주장 추가 → [미확인 주장] → 근거 연결 → ✓ 근거 연결됨", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  const brief = briefRegion(page);
  const add = await openDetails(brief, "+ 주장 추가");
  await add.getByLabel("주장 문장 (필수)").fill(CLAIM);
  await add.getByLabel("주장 종류").selectOption("capability");
  await add.getByRole("button", { name: "주장 추가" }).click();
  await expect(claimItem(page)).toContainText("[미확인 주장]");
  await expect(brief.getByRole("note").filter({ hasText: "미확인 주장 1개" })).toBeVisible();

  const link = await openDetails(claimItem(page), "근거 연결하기");
  // 근거 범위 안내(QA-P2F-BACKEND-01 O1, 문구는 DEC-09 B 확정본 COPY-DEC09-01)
  await expect(link.getByText(/같은 고객의 공통 자료\. 다른 프로젝트의 자료는 고를 수 없습니다/)).toBeVisible();
  await link.getByLabel("근거", { exact: true }).selectOption(`profile:${s.profileVersionId}:products`);
  await link.getByLabel("근거 메모 (선택)").fill("상품 칸 첫 문장");
  await link.getByRole("button", { name: "근거 연결" }).click();
  await expect(claimItem(page)).toContainText("✓ 근거 연결됨");
  await expect(claimItem(page)).toContainText("근거: 회사 프로필 v1 · 제품·서비스");
  await expect(brief.getByRole("note").filter({ hasText: "미확인 주장" })).toHaveCount(0);
});

test("마크다운 복사: 화면 글과 같고, 근거가 붙어 있다", async ({ page, context }) => {
  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  const brief = briefRegion(page);
  await brief.getByRole("button", { name: "마크다운 복사" }).click();
  await expect(brief.getByRole("status").filter({ hasText: "복사했습니다." })).toBeVisible();
  // Windows 클립보드는 CRLF 로 돌려주므로 줄바꿈만 맞춰 비교한다(p2-strategy-profile.spec 과 같은 이유)
  const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
  expect(text).toBe(await brief.getByLabel("복사할 마크다운").textContent());
  expect(text.startsWith(`# ${CARD}\n`)).toBe(true);
  expect(text).toContain("- 채널: 블로그");
  expect(text).toContain("- 퍼널 단계: 인지");
  expect(text).toContain(`1. ${CLAIM}\n   - 근거: 회사 프로필 v1 · 제품·서비스`);
  expect(text).not.toContain("[미확인 주장]");
});

test("근거 해제 → 목록에서 숨김, 다시 [미확인 주장](DB 는 unlinked_at)", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  await claimItem(page).getByRole("button", { name: "근거 해제" }).click();
  await expect(claimItem(page)).toContainText("[미확인 주장]");
  await expect(claimItem(page)).not.toContainText("근거: 회사 프로필");
  const sb = await ownerSupabase();
  const claim = (await sb.from("content_brief_claims").select("id").eq("brief_id", briefId).single()).data!;
  const rows = (await sb.from("content_claim_sources").select("unlinked_at").eq("claim_id", claim.id)).data!;
  expect(rows).toHaveLength(1);
  expect(rows[0]!.unlinked_at).not.toBeNull();
});

test("브리프 고치기: 훅·채널 지침 저장", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  const brief = briefRegion(page);
  const edit = await openDetails(brief, "브리프 고치기");
  await edit.getByLabel("훅 문장").fill(HOOK);
  await edit.getByLabel(/^키워드/).fill("정기 배송\n원두");
  await edit.getByRole("button", { name: "브리프 저장" }).click();
  await expect(brief.getByRole("definition").filter({ hasText: HOOK })).toBeVisible();
  await expect(brief.getByText("아직 비어 있는 브리프입니다.")).toHaveCount(0);
  const sb = await ownerSupabase();
  const row = (await sb.from("content_briefs").select("hook, channel_spec").eq("id", briefId).single()).data!;
  expect(row.hook).toBe(HOOK);
  expect((row.channel_spec as { keywords?: string[] }).keywords).toEqual(["정기 배송", "원두"]);
});

test("이전 전략 기준: 보드를 맞춰도 브리프는 그대로 → '이 브리프만' 맞추기", async ({ page }) => {
  await loginWithWorkspace(page);
  await approveNewStrategyVersion(page, s);
  await page.goto(s.taskUrl);
  await funnelRegion(page).getByRole("button", { name: "퍼널 보드를 지금 승인본 기준으로 맞추기" }).click();
  await expect(funnelRegion(page).getByText("보드: 이전 전략 기준")).toHaveCount(0);
  await page.goto(briefUrl);
  const brief = briefRegion(page);
  await expect(brief.getByText("브리프: 이전 전략 기준")).toBeVisible(); // 보드와 따로 동작(O3)
  await brief.getByRole("button", { name: "이 브리프만 지금 승인본 기준으로 맞추기" }).click();
  await expect(brief.getByText("브리프: 이전 전략 기준")).toHaveCount(0);
});

test("보관 프로젝트: 브리프 편집 요소가 없고 서버도 거절 → 다시 열기", async ({ page }) => {
  await loginWithWorkspace(page);
  await setProjectStatus(page, s, "보관");
  await page.goto(briefUrl);
  const brief = briefRegion(page);
  // 읽기는 된다. 주장 글은 복사용 마크다운(접힌 칸)에도 있어 getByText 는 두 곳에 걸리므로 주장 목록 항목으로 찾는다(선택자 대조에서 발견)
  await expect(claimItem(page)).toBeVisible();
  for (const summary of ["+ 주장 추가", "근거 연결하기", "브리프 고치기", "주장 고치기·보관"]) await expect(detailsBy(brief, summary)).toHaveCount(0);
  await expect(brief.getByRole("button", { name: /브리프 보관|맞추기/ })).toHaveCount(0);
  await expect(detailsBy(funnelRegion(page), "+ 채널 브리프 만들기")).toHaveCount(0);

  const sb = await ownerSupabase();
  const r = await sb.rpc("add_brief_claim", { p_brief_id: briefId, p_text: "보관 중 추가", p_claim_kind: "other" });
  expect(r.error?.message).toMatch(/^INVALID_TRANSITION/);
  await setProjectStatus(page, s, "진행 중");
});

test("다른 업무실 격리: 브리프·주장·근거 읽기 0행, 쓰기 RPC 는 모두 NOT_FOUND", async () => {
  const sb = await ownerSupabase();
  const b = (await sb.from("content_briefs").select("id, revision, funnel_item_id").eq("id", briefId).single()).data!;
  const claim = (await sb.from("content_brief_claims").select("id, revision").eq("brief_id", briefId).single()).data!;
  const src = (await sb.from("content_claim_sources").select("id").eq("claim_id", claim.id).single()).data!;

  const other = await otherWorkspaceUser("brief-other");
  try {
    for (const [table, col, id] of [["content_briefs", "id", b.id], ["content_brief_claims", "brief_id", b.id], ["content_claim_sources", "claim_id", claim.id]] as const) {
      const r = await other.sb.from(table).select("id").eq(col, id);
      expect(r.error, table).toBeNull();
      expect(r.data, table).toEqual([]);
    }
    const tries = [
      other.sb.rpc("create_content_brief", { p_funnel_item_id: b.funnel_item_id, p_channel: "instagram", p_title: "침입" }),
      other.sb.rpc("update_content_brief", { p_brief_id: b.id, p_expected_revision: b.revision, p_title: "침입", p_audience: "", p_hook: "", p_core_message: "", p_cta: "", p_channel_spec: {}, p_copy_draft: "", p_copy_origin: "manual", p_image_guide: "", p_status: "drafting" }),
      other.sb.rpc("rebase_content_brief", { p_brief_id: b.id, p_expected_revision: b.revision }),
      other.sb.rpc("archive_content_brief", { p_brief_id: b.id, p_expected_revision: b.revision }),
      other.sb.rpc("add_brief_claim", { p_brief_id: b.id, p_text: "침입", p_claim_kind: "other" }),
      other.sb.rpc("update_brief_claim", { p_claim_id: claim.id, p_expected_revision: claim.revision, p_text: "침입", p_claim_kind: "other" }),
      other.sb.rpc("archive_brief_claim", { p_claim_id: claim.id, p_expected_revision: claim.revision }),
      other.sb.rpc("link_claim_source", { p_claim_id: claim.id, p_kind: "asset", p_target_id: randomUUID() }),
      other.sb.rpc("unlink_claim_source", { p_source_id: src.id }),
    ];
    for (const [i, r] of (await Promise.all(tries)).entries()) expect(r.error?.message, `RPC ${i}`).toMatch(/^NOT_FOUND/);
    const after = (await sb.from("content_briefs").select("title, revision, archived_at").eq("id", b.id).single()).data!;
    expect(after).toEqual({ title: CARD, revision: b.revision, archived_at: null });
  } finally {
    test.info().annotations.push({ type: "정리", description: `허용 목록 행 삭제 ${await other.cleanup()}건` });
  }
});

/** P2F-FRONT-01-R1(QA D1): 카드를 보관한 뒤 브리프를 주소로 직접 열면 읽기 전용(서버 assert_brief_open 과 같은 결과). 카드를 되돌릴 수 없으므로 마지막에 둔다 */
test("보관한 퍼널 카드의 브리프: 주소로 열어도 편집 요소가 없고 서버도 거절", async ({ page }) => {
  const sb = await ownerSupabase();
  const b = (await sb.from("content_briefs").select("funnel_item_id").eq("id", briefId).single()).data!;
  const item = (await sb.from("funnel_items").select("revision").eq("id", b.funnel_item_id).single()).data!;
  expect((await sb.rpc("archive_funnel_item", { p_item_id: b.funnel_item_id, p_expected_revision: item.revision })).error).toBeNull();

  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  const brief = briefRegion(page);
  await expect(brief.getByRole("note").filter({ hasText: "보관한 퍼널 카드의 브리프는 읽기만 할 수 있습니다." })).toBeVisible();
  // 복사용 마크다운(접힌 칸)에도 "- 퍼널 단계: 보관한 카드"가 있어 정확 일치로 머리 줄만 찾는다
  await expect(brief.getByText("퍼널 단계: 보관한 카드", { exact: true })).toBeVisible();
  await expect(claimItem(page)).toBeVisible(); // 읽기는 된다
  for (const summary of ["+ 주장 추가", "근거 연결하기", "브리프 고치기", "주장 고치기·보관"]) await expect(detailsBy(brief, summary)).toHaveCount(0);
  await expect(brief.getByRole("button", { name: /근거 해제|브리프 보관|맞추기/ })).toHaveCount(0);
  await expect(brief.getByRole("button", { name: "마크다운 복사" })).toBeVisible(); // 복사는 읽기라 남는다
  await expect(cardIn(stageColumn(page, "인지"), CARD)).toHaveCount(0); // 보드에서는 빠졌다

  const r = await sb.rpc("add_brief_claim", { p_brief_id: briefId, p_text: "보관 카드에 추가", p_claim_kind: "other" });
  expect(r.error?.message).toMatch(/^INVALID_TRANSITION: 보관한 퍼널 카드의 브리프는 고칠 수 없습니다/);
});
