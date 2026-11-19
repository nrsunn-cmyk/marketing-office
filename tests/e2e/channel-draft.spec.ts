import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginWithWorkspace, ownerSupabase } from "./helpers";
import { approveNewStrategyVersion, openDetails, otherWorkspaceUser, setProjectStatus, setupApprovedStrategy, type StrategySetup } from "./p2-board-setup";

/**
 * P2G-UI-01 채널 초안(티스토리 블로그·한국어) 화면 + P2G-BACKEND-01 서버(migration 27).
 * 준비 안 된 브리프 → 이유 표시 → 준비 완료 → 초안 만들기(템플릿 초기값) → 고치기 → 서식째·HTML 소스 복사(클립보드 확인)
 * → .md·.html 내려받기 → 미리 보기에 HTML 없음 → 게시 기록(개인 도메인 안내·잘못된 주소 거절) → 기록 취소
 * → 이전 전략 기준·맞추기 → 초안 보관(복사만) → 보관 프로젝트 읽기 전용 → 다른 업무실 격리.
 * 자동 게시·외부 요청은 없다(R08). 자기 전용 시험 스택에서만 돈다. 모든 값은 합성이다.
 */
test.describe.configure({ mode: "serial" });

let s: StrategySetup;
let briefId = "";
let briefUrl = "";
let TITLE = "";
const PERSONAL = "https://blog.example.com/coffee/1";

const region = (page: Page) => page.getByRole("region", { name: /^티스토리 초안/ });
const draftCard = (scope: Locator, title: string) => scope.getByRole("listitem").filter({ has: scope.page().getByRole("heading", { level: 3, name: title }) }).first();
/** 카드 맨 위 배지 줄(상태 글자) */
const badges = (card: Locator) => card.locator("article > p").first();
const nl = (t: string) => t.replace(/\r\n/g, "\n");

test("준비: 승인 전략 → 퍼널·카드·블로그 브리프(작성 중, 본인 권한 RPC)", async ({ page }) => {
  s = await setupApprovedStrategy(page, "초안E2E");
  TITLE = `${s.label} 합성 브리프: 출근길 커피 정기 배송`;
  const sb = await ownerSupabase();
  const created = await sb.rpc("create_funnel", { p_strategy_artifact_id: s.artifactId }).single();
  expect(created.error).toBeNull();
  const fid = (created.data as { funnel_id: string }).funnel_id;
  const stage = (await sb.from("funnel_stages").select("id").eq("funnel_id", fid).eq("stage_key", "consideration").single()).data!;
  const item = await sb.rpc("add_funnel_item", { p_stage_id: stage.id, p_kind: "content", p_title: `${s.label} 합성 카드: 정기 배송 안내 글` });
  expect(item.error).toBeNull();
  const itemId = (await sb.from("funnel_items").select("id").eq("funnel_id", fid).eq("title", `${s.label} 합성 카드: 정기 배송 안내 글`).single()).data!.id;
  const b = await sb
    .rpc("create_content_brief", {
      p_funnel_item_id: itemId,
      p_channel: "blog",
      p_title: TITLE,
      p_audience: "출근길에 커피를 사는 동네 직장인",
      p_core_message: "매주 월요일 아침 원두가 도착하는 정기 배송, 첫 달 30% 할인",
      p_cta: "첫 달 할인으로 정기 배송 시작하기",
      p_channel_spec: { keywords: ["정기배송", "커피", "출근길"], outline: ["왜 정기 배송인가", "신청 방법"] },
    })
    .single();
  expect(b.error).toBeNull();
  briefId = (b.data as { brief_id: string }).brief_id;
  briefUrl = `${s.taskUrl}?brief=${briefId}#brief`;
});

test("준비 완료가 아닌 브리프: 만들기 단추 없이 서버가 준 이유", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  const r = region(page);
  await expect(r.getByRole("heading", { level: 2 })).toContainText("0/5개");
  await expect(r.getByText("채널: 티스토리 블로그")).toBeVisible();
  await expect(r.getByRole("note").filter({ hasText: "새 초안을 만들 수 없습니다" })).toContainText("브리프를 준비 완료로 바꾸면 초안을 만들 수 있습니다.");
  await expect(r.getByRole("button", { name: /초안 만들기/ })).toHaveCount(0);
  await expect(r.getByText("아직 티스토리 초안이 없습니다.")).toBeVisible();

  // 브리프를 준비 완료로(본인 권한 RPC)
  const sb = await ownerSupabase();
  const cur = (await sb.from("content_briefs").select("revision, title, audience, core_message, cta, channel_spec").eq("id", briefId).single()).data!;
  const u = await sb.rpc("update_content_brief", {
    p_brief_id: briefId,
    p_expected_revision: cur.revision,
    p_title: cur.title,
    p_audience: cur.audience,
    p_hook: "월요일 아침 커피가 이미 와 있다면?",
    p_core_message: cur.core_message,
    p_cta: cur.cta,
    p_channel_spec: cur.channel_spec,
    p_copy_draft: null as never,
    p_copy_origin: "manual",
    p_image_guide: null as never,
    p_status: "ready",
  });
  expect(u.error).toBeNull();
});

test("초안 만들기: 템플릿 초기값(제목·태그·소제목·메타 설명), 작성 중", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  const r = region(page);
  const make = r.getByRole("button", { name: "티스토리 초안 만들기" });
  await expect(make).toBeEnabled();
  await make.click();
  const card = draftCard(r, TITLE);
  await expect(card).toBeVisible();
  await expect(r.getByRole("heading", { level: 2 })).toContainText("1/5개");
  await expect(badges(card)).toContainText("작성 중");
  await expect(card.getByText("정기배송, 커피, 출근길", { exact: true })).toBeVisible(); // 태그 = 키워드
  const body = await openDetails(card, "본문 보기");
  await expect(body.getByLabel(`${TITLE} 본문`)).toContainText("## 왜 정기 배송인가");
  await expect(body.getByLabel(`${TITLE} 본문`)).toContainText("## 신청 방법");
  // 자동 게시 단추는 없다(R08)
  await expect(r.getByRole("button", { name: /^(게시|발행)(하기)?$|티스토리로 보내기|자동 게시/ })).toHaveCount(0);
  const sb = await ownerSupabase();
  const rows = (await sb.from("channel_drafts").select("title, status, source_brief_revision").eq("brief_id", briefId)).data!;
  expect(rows).toEqual([expect.objectContaining({ title: TITLE, status: "drafting" })]);
});

test("초안 고치기: 본문·태그·메타 설명·검토 완료 → 배지", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  const card = draftCard(region(page), TITLE);
  const edit = await openDetails(card, "초안 고치기");
  await edit.getByLabel("본문", { exact: true }).fill(
    ["출근길 커피를 아끼는 방법을 소개합니다.", "", "## 왜 정기 배송인가", "매주 월요일 아침 원두가 도착합니다. **첫 달 30% 할인**.", "", "- 원두 3종 중 고르기", "- 언제든 해지", "", "[이미지: 정기 배송 상자 사진]", "", "<script>alert(1)</script> 는 글자로 나갑니다."].join("\n"),
  );
  await edit.getByLabel("태그 (쉼표로 구분)").fill("정기배송, 커피, 원두");
  await edit.getByLabel(/^메타 설명/).fill("월요일 아침 원두가 도착하는 정기 배송, 첫 달 30% 할인 안내");
  await edit.getByLabel("진행 상태").selectOption("reviewed");
  await edit.getByRole("button", { name: "초안 저장" }).click();
  await expect(badges(draftCard(region(page), TITLE))).toContainText("검토 완료");
  await expect(draftCard(region(page), TITLE).getByText("정기배송, 커피, 원두", { exact: true })).toBeVisible();
  await expect(draftCard(region(page), TITLE).getByText("본문 이미지 자리 1곳")).toBeVisible();
});

test("복사: 서식째(text/html + text/plain)·HTML 소스·글자 — 서버 export 그대로, 미리 보기에 HTML 없음", async ({ page, context }) => {
  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  const card = draftCard(region(page), TITLE);
  const source = await (await openDetails(card, "HTML 소스 보기")).getByLabel("복사할 HTML 소스").inputValue();
  const plain = await (await openDetails(card, "글자만 보기")).getByLabel("복사할 글자").inputValue();
  expect(source).toContain("<h2>왜 정기 배송인가</h2>");
  expect(source).toContain("<strong>첫 달 30% 할인</strong>");
  expect(source).not.toContain("<script>");
  expect(source).toContain("&lt;script&gt;");

  // 미리 보기를 HTML 로 그리지 않는다: 카드 안에 본문 소제목이 제목 요소로 생기지 않는다
  await expect(card.getByRole("heading", { name: "왜 정기 배송인가" })).toHaveCount(0);
  await expect(card.locator("script")).toHaveCount(0);

  await card.getByRole("button", { name: "서식째 복사 (기본 모드)" }).click();
  await expect(card.getByRole("status").filter({ hasText: "서식째 복사했습니다." })).toBeVisible();
  const both = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return { types: item!.types, html: await (await item!.getType("text/html")).text(), text: await (await item!.getType("text/plain")).text() };
  });
  expect(both.types).toEqual(expect.arrayContaining(["text/html", "text/plain"]));
  expect(both.html).toContain("<h2>왜 정기 배송인가</h2>"); // 브라우저가 앞뒤를 감쌀 수 있어 포함만 본다
  expect(nl(both.text)).toBe(nl(plain));

  await card.getByRole("button", { name: "HTML 소스 복사 (HTML 모드)" }).click();
  await expect(card.getByRole("status").filter({ hasText: "복사했습니다." })).toBeVisible();
  expect(nl(await page.evaluate(() => navigator.clipboard.readText()))).toBe(nl(source));

  await card.getByRole("button", { name: "태그 복사" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("정기배송, 커피, 원두");
});

test("파일 내보내기: .md(제목 + 본문)·.html(BOM + 같은 소스), 이름은 서버가 정한 값", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  const card = draftCard(region(page), TITLE);
  const source = await (await openDetails(card, "HTML 소스 보기")).getByLabel("복사할 HTML 소스").inputValue();

  const [md] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: ".md 내려받기" }).click()]);
  expect(md.suggestedFilename()).toMatch(/\.md$/);
  const mdText = readFileSync((await md.path())!, "utf8");
  expect(mdText.startsWith(`# ${TITLE}\n\n`)).toBe(true);
  expect(mdText).toContain("## 왜 정기 배송인가");

  const [html] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: ".html 내려받기" }).click()]);
  expect(html.suggestedFilename()).toMatch(/\.html$/);
  const bytes = readFileSync((await html.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(nl(bytes.subarray(3).toString("utf8"))).toBe(nl(source));
  await expect(card.getByRole("status").filter({ hasText: "파일을 내려받았습니다." })).toBeVisible();
});

test("게시 기록: 잘못된 주소 거절 → 개인 도메인 기록(안내·새 창 링크) → '게시 기록됨' → 기록 취소", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  let card = draftCard(region(page), TITLE);
  const add = await openDetails(card, "+ 게시 기록 남기기");
  await add.getByLabel("게시 주소 (https:// 로 시작)").fill("javascript:alert(1)");
  await add.getByRole("button", { name: "게시 기록 남기기" }).click();
  await expect(add.getByRole("alert")).toContainText("https://");
  await expect(card.getByText("아직 게시 기록이 없습니다.")).toBeVisible();

  await add.getByLabel("게시 주소 (https:// 로 시작)").fill(PERSONAL);
  await add.getByLabel("메모 (선택)").fill("개인 도메인에 1차 발행");
  await add.getByRole("button", { name: "게시 기록 남기기" }).click();
  card = draftCard(region(page), TITLE);
  const list = card.getByRole("list", { name: `${TITLE} 게시 기록 목록` });
  const link = list.getByRole("link", { name: new RegExp(PERSONAL.replace(/[./]/g, "\\$&")) });
  await expect(link).toHaveAttribute("href", PERSONAL);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(list.getByText("티스토리 주소가 맞는지 확인하세요")).toBeVisible();
  await expect(list.getByText("메모: 개인 도메인에 1차 발행")).toBeVisible();
  await expect(badges(card)).toContainText("게시 기록됨");
  await expect(card.getByText("취소 안 된 기록 1/50")).toBeVisible();

  const v = await openDetails(list.getByRole("listitem").first(), "이 기록 취소");
  await v.getByLabel("취소 이유 (필수)").fill("주소를 잘못 적음");
  await v.getByRole("button", { name: "기록 취소" }).click();
  card = draftCard(region(page), TITLE);
  await expect(card.getByText("취소 이유: 주소를 잘못 적음")).toBeVisible();
  await expect(card.getByText("취소됨", { exact: true })).toBeVisible();
  await expect(card.getByRole("list", { name: `${TITLE} 게시 기록 목록` }).getByRole("link")).toHaveCount(0); // 취소한 기록은 링크 없음
  await expect(badges(card)).toContainText("검토 완료"); // 계산 배지가 빠진다
  await expect(card.getByText("취소 안 된 기록 0/50")).toBeVisible();

  // 추가 전용: 기록 + 취소 두 행
  const sb = await ownerSupabase();
  const d = (await sb.from("channel_drafts").select("id").eq("brief_id", briefId).single()).data!;
  const rows = (await sb.from("channel_publications").select("kind").eq("draft_id", d.id).order("created_at")).data!;
  expect(rows.map((x) => x.kind)).toEqual(["record", "void"]);
});

test("이전 전략 기준: 새 승인본 → 배지·안내 → 지금 승인본 기준으로 맞추기", async ({ page }) => {
  await loginWithWorkspace(page);
  await approveNewStrategyVersion(page, s);
  await page.goto(briefUrl);
  let card = draftCard(region(page), TITLE);
  await expect(badges(card)).toContainText("이전 전략 기준");
  await expect(card.getByRole("note").filter({ hasText: "이전 전략 기준:" })).toBeVisible();
  await card.getByRole("button", { name: "지금 승인본 기준으로 맞추기" }).click();
  card = draftCard(region(page), TITLE);
  await expect(badges(card)).not.toContainText("이전 전략 기준");
  await expect(card.getByText("초안 고치기")).toBeVisible(); // 편집은 그대로
});

test("초안 보관: 보관 목록으로, 복사·내보내기만(고치기·기록·취소 없음) → 새로 만들기 가능", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(briefUrl);
  const r = region(page);
  await draftCard(r, TITLE).getByRole("button", { name: "이 초안 보관" }).click();
  await expect(r.getByRole("list", { name: "티스토리 초안 목록" })).toHaveCount(0);
  const box = await openDetails(r, "보관한 초안 1개");
  const card = draftCard(box, TITLE);
  await expect(badges(card)).toContainText("보관");
  await expect(card.getByRole("note").filter({ hasText: "보관한 초안입니다." })).toBeVisible();
  await expect(card.getByText("초안 고치기")).toHaveCount(0);
  await expect(card.getByText("+ 게시 기록 남기기")).toHaveCount(0);
  await expect(card.getByText("이 기록 취소")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "서식째 복사 (기본 모드)" })).toBeVisible();
  await expect(card.getByRole("button", { name: ".md 내려받기" })).toBeVisible();
  await expect(r.getByRole("heading", { level: 2 })).toContainText("0/5개");
  await expect(r.getByRole("button", { name: "티스토리 초안 만들기" })).toBeVisible();
});

test("보관 프로젝트: 영역 폼이 없고 서버도 거절 → 다시 열면 만들기 가능", async ({ page }) => {
  await loginWithWorkspace(page);
  await setProjectStatus(page, s, "보관");
  await page.goto(briefUrl);
  const r = region(page);
  await expect(r.getByRole("note").filter({ hasText: "읽기와 복사·내보내기만 할 수 있습니다" })).toBeVisible();
  await expect(r.locator("form")).toHaveCount(0);
  const sb = await ownerSupabase();
  const c = await sb.rpc("create_channel_draft", { p_brief_id: briefId });
  expect(c.error?.message).toMatch(/^INVALID_TRANSITION/);

  await setProjectStatus(page, s, "진행 중");
  await page.goto(briefUrl);
  await expect(region(page).getByRole("button", { name: "티스토리 초안 만들기" })).toBeVisible();
});

test("다른 업무실 격리: 읽기 0행, 쓰기 RPC 는 NOT_FOUND", async () => {
  const sb = await ownerSupabase();
  const d = (await sb.from("channel_drafts").select("id, revision").eq("brief_id", briefId).single()).data!;
  const p = (await sb.from("channel_publications").select("id").eq("draft_id", d.id).eq("kind", "record").single()).data!;
  const other = await otherWorkspaceUser("channel-draft-other");
  try {
    for (const table of ["channel_drafts", "channel_publications"] as const) {
      const r = await other.sb.from(table).select("id").eq(table === "channel_drafts" ? "id" : "draft_id", d.id);
      expect(r.error, table).toBeNull();
      expect(r.data, table).toEqual([]);
    }
    const tries = [
      other.sb.rpc("create_channel_draft", { p_brief_id: briefId }),
      other.sb.rpc("rebase_channel_draft", { p_draft_id: d.id, p_expected_revision: d.revision }),
      other.sb.rpc("record_channel_publication", { p_draft_id: d.id, p_url: "https://a.tistory.com/1", p_published_at: new Date().toISOString() }),
      other.sb.rpc("void_channel_publication", { p_publication_id: p.id, p_reason: "침입" }),
    ];
    for (const [i, r] of (await Promise.all(tries)).entries()) expect(r.error?.message, `RPC ${i}`).toMatch(/^NOT_FOUND/);
    const after = (await sb.from("channel_drafts").select("revision").eq("id", d.id).single()).data!;
    expect(after.revision).toBe(d.revision);
  } finally {
    test.info().annotations.push({ type: "정리", description: `허용 목록 행 삭제 ${await other.cleanup()}건` });
  }
});
