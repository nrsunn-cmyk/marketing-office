import { expect, test, type Page } from "@playwright/test";
import { loginWithWorkspace, ownerSupabase } from "./helpers";
import { openDetails, otherWorkspaceUser, setupApprovedStrategy, type StrategySetup } from "./p2-board-setup";

/**
 * E2E-E-F-01 외부 출처 관리(SOURCES-UI-01 화면 + 출처 서버 7b5a281·2a89317·1ba6e58).
 * S1 출처 추가(칸 오류 → 정상 추가 → '확인 전', 프로젝트 상세 건수)
 * S2 확인함 ↔ 확인 전 전환, 상태로 걸러 보기 건수
 * S3 브리프 근거 선택지 '(확인 전)' → 연결 → 출처 화면 '인용한 브리프' 링크로 그 브리프가 열림
 * S4 브리프 보관 뒤 출처 화면에 '(보관)'
 * S5 다른 업무실: 출처 읽기 0행, 추가·검토 RPC 는 NOT_FOUND
 * 자기 전용 시험 스택에서만 돈다(playwright.config preflight). 모든 값은 합성이다.
 */
test.describe.configure({ mode: "serial" });

let s: StrategySetup;
let sourcesUrl = "";
let briefUrl = "";
let briefId = "";
let sourceId = "";
const TITLE = `합성 출처: 2026 소규모 사업자 마케팅 비용 조사 ${Date.now().toString(36)}`;
const URL_ = "https://example.com/research/2026-survey?utm_source=e2e";
const BRIEF_TITLE = "합성 브리프: 출처 인용 시험";
const CLAIM = "합성 주장: 소규모 팀의 82%가 재작업을 겪는다";

const cardOf = (page: Page) => page.getByRole("list", { name: "외부 출처 목록" }).getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: TITLE }) });
const filterLink = (page: Page, label: string) => page.getByRole("navigation", { name: "검토 상태로 걸러 보기" }).getByRole("link", { name: new RegExp(`^${label} `) });

test("준비: 승인한 전략 → 퍼널 카드 → 블로그 브리프·주장(본인 권한 RPC)", async ({ page }) => {
  s = await setupApprovedStrategy(page, "출처E2E");
  sourcesUrl = `/projects/${s.projectId}/sources`;
  const sb = await ownerSupabase();
  const created = await sb.rpc("create_funnel", { p_strategy_artifact_id: s.artifactId }).single();
  expect(created.error).toBeNull();
  const fid = (created.data as { funnel_id: string }).funnel_id;
  const stage = (await sb.from("funnel_stages").select("id").eq("funnel_id", fid).eq("stage_key", "awareness").single()).data!;
  const item = await sb.rpc("add_funnel_item", { p_stage_id: stage.id, p_kind: "content", p_title: `${s.label} 합성 카드` });
  expect(item.error).toBeNull();
  const brief = await sb.rpc("create_content_brief", { p_funnel_item_id: item.data as string, p_channel: "blog", p_title: BRIEF_TITLE }).single();
  expect(brief.error).toBeNull();
  briefId = (brief.data as { brief_id: string }).brief_id;
  expect((await sb.rpc("add_brief_claim", { p_brief_id: briefId, p_text: CLAIM, p_claim_kind: "statistic" })).error).toBeNull();
  briefUrl = `${s.taskUrl}?brief=${briefId}#brief`;
});

test("S1 출처 추가: 빈 제목은 칸 오류, 고치면 '확인 전'으로 추가되고 프로젝트 상세에 건수", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(sourcesUrl);
  await expect(page.getByRole("heading", { level: 1, name: "외부 출처" })).toBeVisible();
  await expect(page.getByText("아직 등록한 외부 출처가 없습니다.")).toBeVisible();

  const form = page.getByRole("region", { name: "출처 추가" }).locator("form");
  await form.getByLabel("원문 주소 (필수)").fill(URL_);
  await form.getByLabel("발행처 (선택)").fill("합성 조사기관");
  await form.getByLabel("인용문 (선택)").fill("소규모 마케팅팀의 82%가 두 번 이상 다시 작업했다.");
  const submit = form.getByRole("button", { name: "출처 추가" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(form.getByRole("alert")).toContainText("제목을 입력해 주세요.");
  await expect(form.getByLabel("원문 주소 (필수)")).toHaveValue(URL_); // 오류여도 입력은 남는다

  await form.getByLabel("제목 (필수)").fill(TITLE);
  await submit.click();
  await expect(page.getByText("출처를 추가했습니다. 아직 '확인 전' 상태입니다.")).toBeVisible();
  const card = cardOf(page);
  await expect(card).toHaveCount(1);
  await expect(card.getByText("확인 전", { exact: true })).toBeVisible();
  await expect(card.getByText("발행처: 합성 조사기관")).toBeVisible();
  await expect(card.getByRole("link", { name: /example\.com\/research\/2026-survey/ })).toHaveAttribute("href", URL_);
  await expect(card.getByText("아직 인용한 브리프가 없습니다.")).toBeVisible();

  const sb = await ownerSupabase();
  const row = (await sb.from("research_sources").select("id, review_status, url").eq("project_id", s.projectId).eq("title", TITLE).single()).data!;
  expect(row).toMatchObject({ review_status: "unverified", url: URL_ });
  sourceId = row.id;

  await page.goto(`/projects/${s.projectId}`);
  const sec = page.getByRole("region", { name: "외부 출처" });
  await expect(sec.getByText("1건 (확인 전 1건)")).toBeVisible();
  await expect(sec.getByRole("link", { name: "외부 출처 관리" })).toHaveAttribute("href", sourcesUrl);
});

test("S2 검토 상태: 확인함 ↔ 확인 전, 거르기 건수와 목록이 따라 바뀐다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(sourcesUrl);
  await cardOf(page).getByRole("button", { name: "원문 확인함으로 표시" }).click();
  await expect(cardOf(page).getByText("확인함", { exact: true })).toBeVisible();
  await expect(filterLink(page, "확인함")).toContainText("1");
  await expect(filterLink(page, "확인 전")).toContainText("0");

  await filterLink(page, "확인 전").click();
  await expect(page).toHaveURL(/\?status=unverified$/);
  await expect(page.getByText("'확인 전' 상태인 출처가 없습니다.")).toBeVisible();
  await page.getByRole("link", { name: "전체 보기" }).click();

  await cardOf(page).getByRole("button", { name: "확인 전으로 되돌리기" }).click();
  await expect(cardOf(page).getByText("확인 전", { exact: true })).toBeVisible();
  const sb = await ownerSupabase();
  const row = (await sb.from("research_sources").select("review_status, revision").eq("id", sourceId).single()).data!;
  expect(row).toEqual({ review_status: "unverified", revision: 3 }); // 두 번 바꿔 revision 1 → 3
});

test("S3 브리프 근거: '(확인 전)' 선택지로 연결 → 출처 화면 '인용한 브리프' 링크로 그 브리프가 열린다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  const brief = page.getByRole("region", { name: /^콘텐츠 브리프/ });
  await expect(brief.getByRole("link", { name: "외부 출처 화면" })).toHaveAttribute("href", sourcesUrl);
  const claim = brief.getByRole("list", { name: "주장 목록" }).getByRole("listitem").filter({ hasText: CLAIM }).first();
  const link = await openDetails(claim, "근거 연결하기");
  const select = link.getByLabel("근거", { exact: true });
  await expect(select.locator("optgroup[label='외부 출처'] option")).toHaveText([`${TITLE} (확인 전)`]);
  await select.selectOption({ label: `${TITLE} (확인 전)` });
  await link.getByRole("button", { name: "근거 연결" }).click();
  await expect(claim).toContainText("✓ 근거 연결됨");
  await expect(claim).toContainText(`근거: 외부 출처 · ${TITLE}`);

  await page.goto(sourcesUrl);
  const cites = cardOf(page).getByRole("region", { name: /이 출처를 인용한 브리프/ });
  await expect(cites.getByRole("heading")).toHaveText("이 출처를 인용한 브리프 (1개)");
  await expect(cites.getByText(`주장: ${CLAIM}`)).toBeVisible();
  await expect(cites.getByText("(보관)")).toHaveCount(0);
  await cites.getByRole("link", { name: new RegExp(BRIEF_TITLE) }).click();
  await expect(page).toHaveURL(new RegExp(`\\?brief=${briefId}#brief$`));
  await expect(page.getByRole("region", { name: /^콘텐츠 브리프/ }).getByRole("heading", { level: 2 })).toHaveText(`콘텐츠 브리프: ${BRIEF_TITLE}`);
});

/**
 * C1·C2(DEC-09 B, DEC09-UI-01): 같은 고객 공통 자료(프로젝트 없이 고객에 올린 자료)는 '(고객 공통)'으로 보이고 연결된다.
 * 같은 고객의 다른 프로젝트 자료는 선택지에 없다. brief.spec 의 주장·근거 '하나' 가정을 깨지 않게 이 파일의 브리프에서 한다.
 */
test("C1·C2 고객 공통 자료: '(고객 공통)'으로 골라 연결되고, 같은 고객 다른 프로젝트 자료는 없다", async ({ page }) => {
  const sb = await ownerSupabase();
  const ws = (await sb.from("workspaces").select("id").single()).data!;
  const COMMON = `${s.label} 합성 공통 자료: 회사 소개서`;
  const OTHER = `${s.label} 합성 다른 프로젝트 자료`;
  const common = await sb.from("source_assets").insert({ workspace_id: ws.id, client_id: s.clientId, project_id: null, kind: "text", file_name: COMMON, text_content: "합성 공통 자료 본문", upload_status: "stored" });
  expect(common.error).toBeNull();
  const otherProject = (await sb.from("projects").insert({ workspace_id: ws.id, client_id: s.clientId, kind: "client", title: `${s.label} 합성 다른 프로젝트` }).select("id").single()).data!;
  const other = await sb.from("source_assets").insert({ workspace_id: ws.id, client_id: s.clientId, project_id: otherProject.id, kind: "text", file_name: OTHER, text_content: "합성 다른 프로젝트 본문", upload_status: "stored" });
  expect(other.error).toBeNull();
  const CLAIM2 = "합성 주장: 회사 소개서에 적힌 창업 연도";
  expect((await sb.rpc("add_brief_claim", { p_brief_id: briefId, p_text: CLAIM2, p_claim_kind: "other" })).error).toBeNull();

  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  const brief = page.getByRole("region", { name: /^콘텐츠 브리프/ });
  const claim = brief.getByRole("list", { name: "주장 목록" }).getByRole("listitem").filter({ hasText: CLAIM2 }).first();
  const link = await openDetails(claim, "근거 연결하기");
  await expect(link.getByText(/같은 고객의 공통 자료\. 다른 프로젝트의 자료는 고를 수 없습니다/)).toBeVisible();
  const select = link.getByLabel("근거", { exact: true });
  const assets = select.locator("optgroup[label='프로젝트·고객 공통 자료'] option");
  await expect(assets.filter({ hasText: `${COMMON} (고객 공통)` })).toHaveCount(1);
  await expect(select.locator("option", { hasText: OTHER })).toHaveCount(0); // C2
  await select.selectOption({ label: `${COMMON} (고객 공통)` });
  await link.getByRole("button", { name: "근거 연결" }).click();
  await expect(claim).toContainText("✓ 근거 연결됨");
  await expect(claim).toContainText(`근거: 자료 · 고객 공통 · ${COMMON}`);
});

test("S4 보관한 브리프도 '인용한 브리프'에 남고 '(보관)'이 붙는다", async ({ page }) => {
  const sb = await ownerSupabase();
  const b = (await sb.from("content_briefs").select("revision").eq("id", briefId).single()).data!;
  expect((await sb.rpc("archive_content_brief", { p_brief_id: briefId, p_expected_revision: b.revision })).error).toBeNull();

  await loginWithWorkspace(page);
  await page.goto(sourcesUrl);
  const cites = cardOf(page).getByRole("region", { name: /이 출처를 인용한 브리프/ });
  await expect(cites.getByRole("link", { name: new RegExp(BRIEF_TITLE) })).toContainText("(보관)");
});

test("S5 다른 업무실: 출처 읽기 0행, 추가·검토 RPC 는 NOT_FOUND, 원래 출처는 그대로", async () => {
  const other = await otherWorkspaceUser("sources-other");
  try {
    const read = await other.sb.from("research_sources").select("id").eq("id", sourceId);
    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);
    const add = await other.sb.rpc("add_research_source", { p_project_id: s.projectId, p_url: "https://example.com/x", p_title: "침입", p_retrieved_at: new Date().toISOString() });
    expect(add.error?.message).toMatch(/^NOT_FOUND/);
    const review = await other.sb.rpc("set_research_source_review", { p_source_id: sourceId, p_status: "verified", p_expected_revision: 3 });
    expect(review.error?.message).toMatch(/^NOT_FOUND/);
    const sb = await ownerSupabase();
    const mine = (await sb.from("research_sources").select("review_status, revision").eq("project_id", s.projectId)).data!;
    expect(mine).toEqual([{ review_status: "unverified", revision: 3 }]);
  } finally {
    test.info().annotations.push({ type: "정리", description: `허용 목록 행 삭제 ${await other.cleanup()}건` });
  }
});
