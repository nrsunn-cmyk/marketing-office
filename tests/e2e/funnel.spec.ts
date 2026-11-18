import { expect, test } from "@playwright/test";
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
 * P2-E2E-SPEC-01 퍼널 보드(P2D-FRONT-01 화면 + P2D-BACKEND-01 서버, migration 21).
 * 전략 승인 → 보드 만들기 → 단계 타깃 → 카드 추가·단계 옮기기·보관 → 병목 경고 → 이전 전략 기준·맞추기
 * → 보관 프로젝트 읽기 전용 → 다른 업무실 격리. 자기 전용 시험 스택에서만 돈다. 모든 값은 합성이다.
 */
test.describe.configure({ mode: "serial" });

let s: StrategySetup;
// 실행마다 고유한 제목(이전 실행의 행과 겹치지 않게). 준비 시험에서 정한다
let CARD = "";
let LEAD = "";

test("준비: 승인한 전략까지(화면)", async ({ page }) => {
  s = await setupApprovedStrategy(page, "퍼널E2E");
  CARD = `${s.label} 합성 카드: 출근길 할인 안내 글`;
  LEAD = `${s.label} 합성 리드마그넷: 원두 고르는 법 체크리스트`;
});

test("보드 만들기: 만들기 전 안내 → 5단계 보드, 빈 보드 안내", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(s.taskUrl);
  const funnel = funnelRegion(page);
  await expect(funnel.getByText("아직 퍼널 보드가 없습니다.")).toBeVisible();
  const create = funnel.getByRole("button", { name: "퍼널 보드 만들기" });
  await expect(create).toBeEnabled();
  await create.click();
  const board = funnel.getByRole("list", { name: "퍼널 5단계" });
  await expect(board.getByRole("heading", { level: 3 })).toHaveText([/^유입/, /^인지/, /^고려/, /^전환/, /^유지/]);
  await expect(funnel.getByText("아직 카드가 없습니다.").first()).toBeVisible();
  await expect(funnel.getByText("지금 승인본", { exact: true })).toBeVisible();
});

test("단계 타깃 문구 적기", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(s.taskUrl);
  const col = stageColumn(page, "유입");
  const box = await openDetails(col, "타깃 문구 적기");
  await box.getByLabel("유입 단계에서 고객이 하는 생각·행동").fill("합성: 출근길 커피 할인 검색");
  await box.getByRole("button", { name: "타깃 저장" }).click();
  await expect(col.getByText("타깃: 합성: 출근길 커피 할인 검색")).toBeVisible();
});

test("카드 추가(콘텐츠·리드마그넷) → 병목 경고 → 단계 옮기기 → 보관", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(s.taskUrl);
  const funnel = funnelRegion(page);

  // 유입에 콘텐츠 카드
  const inflow = stageColumn(page, "유입");
  let add = await openDetails(inflow, "+ 카드 추가");
  await add.getByLabel("제목 (필수)").fill(CARD);
  await add.getByLabel("채널").fill("블로그");
  const addBtn = add.getByRole("button", { name: "카드 추가" });
  await expect(addBtn).toBeEnabled();
  await addBtn.click();
  await expect(cardIn(inflow, CARD)).toBeVisible();
  // 고려·전환이 비어 병목 경고
  await expect(funnel.getByRole("note").filter({ hasText: "병목 경고" })).toContainText("고려·전환");

  // 유입에 리드마그넷 카드(기획 칸 포함)
  add = await openDetails(stageColumn(page, "유입"), "+ 카드 추가");
  await add.getByLabel("카드 유형").selectOption("lead_magnet");
  await add.getByLabel("제목 (필수)").fill(LEAD);
  await add.getByLabel("전달물 형태").fill("PDF 체크리스트");
  await add.getByLabel(/^받을 정보/).fill("이메일\n회사명");
  await add.getByRole("button", { name: "카드 추가" }).click();
  const lead = cardIn(stageColumn(page, "유입"), LEAD);
  await expect(lead).toBeVisible();
  await (await openDetails(lead, "리드마그넷 기획 보기")).getByText("이메일, 회사명").waitFor();

  // 리드마그넷을 고려로 옮긴다(옮긴 단계 맨 끝) → 병목은 전환만
  const edit = await openDetails(lead, "고치기·옮기기");
  await edit.getByLabel("단계").selectOption({ label: "3단계 · 고려" });
  await edit.getByRole("button", { name: "카드 저장" }).click();
  await expect(cardIn(stageColumn(page, "고려"), LEAD)).toBeVisible();
  await expect(cardIn(stageColumn(page, "유입"), LEAD)).toHaveCount(0);
  await expect(funnel.getByRole("note").filter({ hasText: "병목 경고" })).toContainText("전환");
  await expect(funnel.getByRole("note").filter({ hasText: "병목 경고" })).not.toContainText("고려");

  // 콘텐츠 카드 보관 → 보드에서 빠진다(DB 에는 archived_at)
  const e2 = await openDetails(cardIn(stageColumn(page, "유입"), CARD), "고치기·옮기기");
  await e2.getByRole("button", { name: "이 카드 보관" }).click();
  await expect(cardIn(stageColumn(page, "유입"), CARD)).toHaveCount(0);
  const sb = await ownerSupabase();
  const row = await sb.from("funnel_items").select("archived_at").eq("title", CARD).single();
  expect(row.data?.archived_at).not.toBeNull();
});

test("이전 전략 기준: 새 승인본 → '보드: 이전 전략 기준' → 보드 맞추기", async ({ page }) => {
  await loginWithWorkspace(page);
  await approveNewStrategyVersion(page, s);
  await page.goto(s.taskUrl);
  const funnel = funnelRegion(page);
  await expect(funnel.getByText("보드: 이전 전략 기준")).toBeVisible();
  const rebase = funnel.getByRole("button", { name: "퍼널 보드를 지금 승인본 기준으로 맞추기" });
  await expect(rebase).toBeEnabled();
  await rebase.click();
  await expect(funnel.getByText("지금 승인본", { exact: true })).toBeVisible();
  await expect(funnel.getByText("보드: 이전 전략 기준")).toHaveCount(0);
  await expect(cardIn(stageColumn(page, "고려"), LEAD)).toBeVisible(); // 카드는 그대로
});

test("보관 프로젝트: 편집 요소가 없고 서버도 거절 → 다시 열면 편집 가능", async ({ page }) => {
  await loginWithWorkspace(page);
  await setProjectStatus(page, s, "보관");
  await page.goto(s.taskUrl);
  const funnel = funnelRegion(page);
  await expect(funnel.getByRole("note").filter({ hasText: "보관한 프로젝트의 퍼널은 읽기 전용입니다." })).toBeVisible();
  await expect(cardIn(stageColumn(page, "고려"), LEAD)).toBeVisible(); // 읽기는 된다
  for (const summary of ["+ 카드 추가", "고치기·옮기기", /^타깃 문구/]) await expect(detailsBy(funnel, summary)).toHaveCount(0);

  // 화면을 우회해도 서버가 거절(본인 권한 RPC)
  const sb = await ownerSupabase();
  const fid = (await sb.from("funnels").select("id").eq("strategy_artifact_id", s.artifactId).single()).data!.id;
  const stage = (await sb.from("funnel_stages").select("id").eq("funnel_id", fid).eq("stage_key", "inflow").single()).data!;
  const r = await sb.rpc("add_funnel_item", { p_stage_id: stage.id, p_kind: "content", p_title: "보관 중 추가" });
  expect(r.error?.message).toMatch(/^INVALID_TRANSITION: 보관한 프로젝트/);

  await setProjectStatus(page, s, "진행 중");
  await page.goto(s.taskUrl);
  await expect(detailsBy(funnelRegion(page), "+ 카드 추가").first()).toBeVisible();
});

test("다른 업무실 격리: 읽기 0행, 쓰기 RPC 는 모두 NOT_FOUND", async () => {
  const sb = await ownerSupabase();
  const f = (await sb.from("funnels").select("id, revision").eq("strategy_artifact_id", s.artifactId).single()).data!;
  const stage = (await sb.from("funnel_stages").select("id, revision").eq("funnel_id", f.id).eq("stage_key", "consideration").single()).data!;
  const item = (await sb.from("funnel_items").select("id, revision").eq("funnel_id", f.id).eq("title", LEAD).single()).data!;

  const other = await otherWorkspaceUser("funnel-other");
  try {
    for (const table of ["funnels", "funnel_stages", "funnel_items"] as const) {
      const r = await other.sb.from(table).select("id").eq(table === "funnels" ? "id" : "funnel_id", f.id);
      expect(r.error, table).toBeNull();
      expect(r.data, table).toEqual([]);
    }
    const tries = [
      other.sb.rpc("create_funnel", { p_strategy_artifact_id: s.artifactId }),
      other.sb.rpc("rebase_funnel", { p_funnel_id: f.id, p_expected_revision: f.revision }),
      other.sb.rpc("update_funnel_stage", { p_stage_id: stage.id, p_expected_revision: stage.revision, p_focus: "침입" }),
      other.sb.rpc("add_funnel_item", { p_stage_id: stage.id, p_kind: "content", p_title: "침입" }),
      other.sb.rpc("update_funnel_item", { p_item_id: item.id, p_expected_revision: item.revision, p_stage_id: stage.id, p_kind: "content", p_title: "침입", p_description: "", p_channel: "", p_status: "planned", p_target_note: "", p_details: null as never }),
      other.sb.rpc("archive_funnel_item", { p_item_id: item.id, p_expected_revision: item.revision }),
    ];
    for (const [i, r] of (await Promise.all(tries)).entries()) expect(r.error?.message, `RPC ${i}`).toMatch(/^NOT_FOUND/);
    // 이 업무실 카드는 그대로
    const after = (await sb.from("funnel_items").select("title, revision, archived_at").eq("id", item.id).single()).data!;
    expect(after).toEqual({ title: LEAD, revision: item.revision, archived_at: null });
  } finally {
    test.info().annotations.push({ type: "정리", description: `허용 목록 행 삭제 ${await other.cleanup()}건` });
  }
});
