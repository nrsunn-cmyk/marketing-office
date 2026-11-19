import { expect, test, type Locator, type Page } from "@playwright/test";
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
 * P2E-UI-01 리드마그넷 영역(화면) + P2E-BACKEND-01 서버(migration 26).
 * 빈 상태 → 추가(값 확인·DB) → 입력 오류는 값 유지 → 고치기 → 전환 오퍼 카드에서 연결·풀기(연결된 카드는 '콘텐츠'로 못 바꿈)
 * → 예전 '리드마그넷' 카드 표시·연결 유지 → 이전 전략 기준(퍼널 보드와 따로 표시, O2) → 보관(연결은 남고 '보관됨')
 * → 보관 프로젝트 읽기 전용(서버도 거절) → 한도 20 → 다른 업무실 격리.
 * 자기 전용 시험 스택에서만 돈다(playwright.config preflight). 모든 값은 합성이다.
 */
test.describe.configure({ mode: "serial" });

let s: StrategySetup;
let LM = "";
let OFFER = "";
let LEGACY = "";

const lmRegion = (page: Page) => page.getByRole("region", { name: /^리드마그넷/ });
/** 리드마그넷 카드: 제목(h3)으로 찾는다 */
const lmCard = (scope: Locator, title: string) => scope.getByRole("listitem").filter({ has: scope.page().getByRole("heading", { level: 3, name: title }) });
const linkLine = (card: Locator) => card.locator("p", { hasText: "연결 리드마그넷:" });

async function funnelId() {
  const sb = await ownerSupabase();
  return (await sb.from("funnels").select("id").eq("strategy_artifact_id", s.artifactId).single()).data!.id as string;
}
async function stageIdOf(key: string) {
  const sb = await ownerSupabase();
  return (await sb.from("funnel_stages").select("id").eq("funnel_id", await funnelId()).eq("stage_key", key).single()).data!.id as string;
}

test("준비: 승인한 전략과 퍼널 보드(화면)", async ({ page }) => {
  s = await setupApprovedStrategy(page, "리드마그넷E2E");
  LM = `${s.label} 합성 원두 고르는 법 가이드`;
  OFFER = `${s.label} 합성 전환 오퍼: 정기 배송 첫 달 할인`;
  LEGACY = `${s.label} 합성 예전 리드마그넷 카드`;
  await page.goto(s.taskUrl);
  const create = funnelRegion(page).getByRole("button", { name: "퍼널 보드 만들기" });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(funnelRegion(page).getByRole("list", { name: "퍼널 5단계" })).toBeVisible();
});

test("빈 상태: 0/20개와 안내, 새 카드 폼에는 '리드마그넷' 유형이 없다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(s.taskUrl);
  const area = lmRegion(page);
  await expect(area.getByRole("heading", { level: 2 })).toHaveText(/리드마그넷\s*0\/20개/);
  await expect(area.getByText("등록된 리드마그넷이 없습니다.")).toBeVisible();
  const add = await openDetails(stageColumn(page, "전환"), "+ 카드 추가");
  await expect(add.getByLabel("카드 유형").locator("option")).toHaveText(["콘텐츠", "전환 오퍼"]);
  await expect(add.getByText("리드마그넷은 리드마그넷 영역에서 만들고 전환(CTA) 카드로 연결하세요.")).toBeVisible();
});

test("추가: 입력 오류는 안내하고 값을 남긴다 → 고치면 저장, 카드에 값이 보이고 DB 에 남는다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(s.taskUrl);
  const area = lmRegion(page);
  const form = await openDetails(area, "+ 첫 리드마그넷 추가");
  await form.getByLabel("제목 (필수)").fill(LM);
  await form.getByLabel("형식 (필수)").selectOption({ label: "가이드북" });
  await form.getByLabel("연결 퍼널 단계 (필수)").selectOption({ label: "4단계 · 전환" });
  await form.getByLabel("전달 방식").selectOption({ label: "이메일 발송" });
  await form.getByLabel("대상").fill("합성 대상: 출근길 직장인");
  await form.getByLabel("약속하는 가치").fill("합성 가치: 5분 안에 원두 고르는 기준");
  await form.getByLabel("구성·목차 (한 줄에 하나)").fill("1. 산지별 맛\n2. 로스팅 정도");
  // 수집할 정보 11개 → 개수 표시가 오류색, 서버가 거절, 입력은 남는다
  await form.getByLabel("수집할 정보 (한 줄에 하나)").fill(Array.from({ length: 11 }, (_, i) => `항목${i + 1}`).join("\n"));
  await expect(form.getByText("11/10개")).toBeVisible();
  const submit = form.getByRole("button", { name: "리드마그넷 추가" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(form.getByText("수집할 정보는 10개까지입니다.")).toBeVisible();
  await expect(form.getByLabel("제목 (필수)")).toHaveValue(LM);

  await form.getByLabel("수집할 정보 (한 줄에 하나)").fill("이메일\n회사명");
  await submit.click();
  const card = lmCard(area, LM);
  await expect(card).toBeVisible();
  await expect(area.getByRole("heading", { level: 2 })).toHaveText(/1\/20개/);
  await expect(card).toContainText("가이드북");
  await expect(card).toContainText("단계: 전환");
  await expect(card).toContainText("기획");
  await expect(card).toContainText("이메일, 회사명 (2/10개)");
  await expect(card).toContainText("연결된 카드 없음");

  const sb = await ownerSupabase();
  const row = (await sb.from("lead_magnets").select("format, delivery, lead_fields, outline, status, stage_id").eq("title", LM).single()).data!;
  expect(row).toMatchObject({ format: "guide", delivery: "email", lead_fields: ["이메일", "회사명"], outline: ["1. 산지별 맛", "2. 로스팅 정도"], status: "planned", stage_id: await stageIdOf("conversion") });
});

test("고치기: 진행 상태를 '준비 완료'로", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(s.taskUrl);
  const card = lmCard(lmRegion(page), LM);
  const edit = await openDetails(card, "고치기·보관");
  await edit.getByLabel("진행 상태").selectOption({ label: "준비 완료" });
  await edit.getByRole("button", { name: "리드마그넷 저장" }).click();
  // 배지 줄(카드의 첫 p)만 본다(닫힌 고치기 폼의 선택지 글자와 겹치지 않게)
  await expect(lmCard(lmRegion(page), LM).locator("p").first()).toContainText("준비 완료");
});

test("전환 오퍼 카드에서 연결 → 양쪽에 보이고 '콘텐츠'로 못 바꿈 → 풀기 → 다시 연결", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(s.taskUrl);
  const conv = stageColumn(page, "전환");
  const add = await openDetails(conv, "+ 카드 추가");
  await add.getByLabel("카드 유형").selectOption("cta");
  await add.getByLabel("제목 (필수)").fill(OFFER);
  await add.getByRole("button", { name: "카드 추가" }).click();
  const offer = cardIn(conv, OFFER);
  await expect(linkLine(offer)).toHaveText("연결 리드마그넷: 없음");

  const link = async (label: string) => {
    const box = await openDetails(cardIn(stageColumn(page, "전환"), OFFER), /^리드마그넷 (연결|바꾸기·풀기)$/);
    await box.getByLabel("이 카드가 안내할 리드마그넷").selectOption({ label });
    await box.getByRole("button", { name: "연결 저장" }).click();
  };
  await link(`${LM} · 가이드북`);
  await expect(linkLine(cardIn(stageColumn(page, "전환"), OFFER))).toHaveText(`연결 리드마그넷: ${LM}`);
  await expect(lmCard(lmRegion(page), LM)).toContainText(`전환 오퍼 · ${OFFER}`);
  const edit = await openDetails(cardIn(stageColumn(page, "전환"), OFFER), "고치기·옮기기");
  await expect(edit.getByLabel("카드 유형").locator("option")).toHaveText(["전환 오퍼"]);

  await link("연결 안 함");
  await expect(linkLine(cardIn(stageColumn(page, "전환"), OFFER))).toHaveText("연결 리드마그넷: 없음");
  await expect(lmCard(lmRegion(page), LM)).toContainText("연결된 카드 없음");

  await link(`${LM} · 가이드북`);
  await expect(linkLine(cardIn(stageColumn(page, "전환"), OFFER))).toHaveText(`연결 리드마그넷: ${LM}`);
});

test("예전 '리드마그넷' 카드: 그대로 보이고 기획 보기·유형 유지·연결 칸이 있다", async ({ page }) => {
  // 예전 화면으로 만든 카드와 같게 본인 권한 RPC 로 만든다(새 화면에서는 이 유형을 만들 수 없다)
  const sb = await ownerSupabase();
  const r = await sb.rpc("add_funnel_item", { p_stage_id: await stageIdOf("consideration"), p_kind: "lead_magnet", p_title: LEGACY, p_details: { deliverable: "PDF 체크리스트", leadFields: ["이메일"] } });
  expect(r.error).toBeNull();
  await loginWithWorkspace(page);
  await page.goto(s.taskUrl);
  const legacy = cardIn(stageColumn(page, "고려"), LEGACY);
  await expect((await openDetails(legacy, "리드마그넷 기획 보기")).getByText("PDF 체크리스트")).toBeVisible();
  await expect(linkLine(legacy)).toHaveText("연결 리드마그넷: 없음");
  const edit = await openDetails(legacy, "고치기·옮기기");
  await expect(edit.getByLabel("카드 유형").locator("option")).toHaveText(["콘텐츠", "리드마그넷", "전환 오퍼"]);
});

test("이전 전략 기준: 리드마그넷과 퍼널 보드가 따로 표시되고, 리드마그넷만 맞춰도 보드는 그대로(O2)", async ({ page }) => {
  await loginWithWorkspace(page);
  await approveNewStrategyVersion(page, s);
  await page.goto(s.taskUrl);
  const area = lmRegion(page);
  await expect(area.getByRole("note").filter({ hasText: "이전 전략 기준:" })).toContainText("리드마그넷 1개가");
  const card = lmCard(area, LM);
  await expect(card.getByText("이전 전략 기준", { exact: true })).toBeVisible();
  await expect(funnelRegion(page).getByText("보드: 이전 전략 기준")).toBeVisible();
  const rebase = card.getByRole("button", { name: "지금 승인본 기준으로 맞추기" });
  await expect(rebase).toBeEnabled();
  await rebase.click();
  await expect(lmCard(lmRegion(page), LM).getByText("이전 전략 기준", { exact: true })).toHaveCount(0);
  await expect(lmRegion(page).getByRole("note").filter({ hasText: "이전 전략 기준:" })).toHaveCount(0);
  await expect(funnelRegion(page).getByText("보드: 이전 전략 기준")).toBeVisible(); // 보드는 따로 맞춘다
});

test("보관: 목록·한도에서 빠지고 연결된 카드에는 '(보관됨)', 다시 고를 수 없다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(s.taskUrl);
  const edit = await openDetails(lmCard(lmRegion(page), LM), "고치기·보관");
  await edit.getByRole("button", { name: "이 리드마그넷 보관" }).click();
  const area = lmRegion(page);
  await expect(area.getByRole("heading", { level: 2 })).toHaveText(/0\/20개/);
  await expect(area.getByText("보관된 리드마그넷 1개")).toBeVisible();
  await expect(lmCard(area.getByRole("list", { name: "보관된 리드마그넷 목록" }), LM)).toContainText("보관됨");
  const offer = cardIn(stageColumn(page, "전환"), OFFER);
  await expect(linkLine(offer)).toHaveText(`연결 리드마그넷: ${LM} (보관됨)`);
  const box = await openDetails(offer, "리드마그넷 바꾸기·풀기");
  await expect(box.getByLabel("이 카드가 안내할 리드마그넷").locator("option")).toHaveText(["연결 안 함"]);
});

test("보관 프로젝트: 추가·고치기·연결이 없고 서버도 거절 → 다시 열면 된다", async ({ page }) => {
  await loginWithWorkspace(page);
  await setProjectStatus(page, s, "보관");
  await page.goto(s.taskUrl);
  const area = lmRegion(page);
  await expect(area.getByText("읽기 전용이라 리드마그넷을 추가·수정·보관할 수 없습니다.")).toBeVisible();
  for (const summary of [/리드마그넷 추가$/, "고치기·보관"]) await expect(detailsBy(area, summary)).toHaveCount(0);
  await expect(detailsBy(funnelRegion(page), /^리드마그넷 (연결|바꾸기·풀기)$/)).toHaveCount(0);

  const sb = await ownerSupabase();
  const r = await sb.rpc("create_lead_magnet", { p_stage_id: await stageIdOf("inflow"), p_title: "보관 중 추가", p_format: "checklist" });
  expect(r.error?.message).toMatch(/^INVALID_TRANSITION: 보관한 프로젝트/);

  await setProjectStatus(page, s, "진행 중");
  await page.goto(s.taskUrl);
  await expect(detailsBy(lmRegion(page), /리드마그넷 추가$/)).toHaveCount(1);
});

test("한도: 보관하지 않은 리드마그넷 20개면 추가 대신 안내, 21번째는 서버가 거절", async ({ page }) => {
  const sb = await ownerSupabase();
  const stage = await stageIdOf("awareness");
  for (let i = 1; i <= 20; i++) {
    const r = await sb.rpc("create_lead_magnet", { p_stage_id: stage, p_title: `${s.label} 합성 한도 ${i}`, p_format: "checklist" });
    expect(r.error, `${i}번째`).toBeNull();
  }
  const over = await sb.rpc("create_lead_magnet", { p_stage_id: stage, p_title: `${s.label} 합성 한도 21`, p_format: "checklist" });
  expect(over.error?.message).toMatch(/^VALIDATION: 한 퍼널에는 리드마그넷을 20개까지/);
  await loginWithWorkspace(page);
  await page.goto(s.taskUrl);
  const area = lmRegion(page);
  await expect(area.getByRole("heading", { level: 2 })).toHaveText(/20\/20개/);
  await expect(area.getByText("보관하지 않은 리드마그넷이 20개라 더 추가할 수 없습니다.")).toBeVisible();
  await expect(detailsBy(area, /리드마그넷 추가$/)).toHaveCount(0);
});

test("다른 업무실 격리: 읽기 0행, 쓰기 RPC 는 모두 NOT_FOUND", async () => {
  const sb = await ownerSupabase();
  const mine = (await sb.from("lead_magnets").select("id, revision").eq("title", LM).single()).data!;
  const item = (await sb.from("funnel_items").select("id, revision").eq("title", OFFER).single()).data!;
  const other = await otherWorkspaceUser("lm-iso");
  try {
    expect((await other.sb.from("lead_magnets").select("id").eq("id", mine.id)).data).toEqual([]);
    const tries = [
      other.sb.rpc("create_lead_magnet", { p_stage_id: await stageIdOf("inflow"), p_title: "남의 퍼널", p_format: "checklist" }),
      other.sb.rpc("update_lead_magnet", { p_lead_magnet_id: mine.id, p_expected_revision: mine.revision, p_stage_id: await stageIdOf("inflow"), p_title: "x", p_format: "checklist", p_audience: "합성", p_promise: "합성", p_delivery: "email", p_lead_fields: [], p_outline: [], p_status: "planned" }),
      other.sb.rpc("rebase_lead_magnet", { p_lead_magnet_id: mine.id, p_expected_revision: mine.revision }),
      other.sb.rpc("archive_lead_magnet", { p_lead_magnet_id: mine.id, p_expected_revision: mine.revision }),
      other.sb.rpc("set_funnel_item_lead_magnet", { p_item_id: item.id, p_expected_revision: item.revision, p_lead_magnet_id: null }),
    ];
    for (const r of await Promise.all(tries)) expect(r.error?.message).toMatch(/^NOT_FOUND/);
  } finally {
    await other.cleanup();
  }
});
