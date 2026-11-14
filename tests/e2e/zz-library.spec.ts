import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginWithWorkspace, ownerSupabase } from "./helpers";

/**
 * 자료실·결과물 화면, 메뉴 5개, 휴대폰 자료 추가 창.
 * 파일 이름이 zz 로 시작해 앞의 E2E가 만든 자료·결과물이 있는 상태에서 실행된다.
 */

test.describe.configure({ mode: "serial" });

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = r.violations.map(
    (v) => `${v.id}(${v.impact}): ${v.nodes.length}개 — ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" / ")}`,
  );
  expect(summary, `${label} 접근성 위반`).toEqual([]);
}

test("메뉴 5개, 지금 있는 메뉴 표시", async ({ page }) => {
  await loginWithWorkspace(page);
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await expect(nav.getByRole("link")).toHaveText([/현황/, /고객/, /프로젝트/, /자료실/, /결과물/]);
  // 개발 서버는 새 화면을 처음 열 때 화면을 만드는 시간이 걸린다. 정해진 시간만큼 기다리지 않고
  // 실제로 주소가 바뀌었는지 확인한 뒤 제목을 본다(Codex M12 검수: 첫 실행 1회 실패).
  await nav.getByRole("link", { name: /자료실/ }).click();
  await expect(page).toHaveURL(/\/assets$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "자료실" })).toBeVisible();
  await expect(nav.getByRole("link", { name: /자료실/ })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: /결과물/ }).click();
  await expect(page).toHaveURL(/\/results$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "결과물" })).toBeVisible();
  await expect(nav.getByRole("link", { name: /결과물/ })).toHaveAttribute("aria-current", "page");
});

test("자료실: 모든 고객의 자료를 모아 보고 종류·이름으로 좁힌다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/assets");
  const list = page.getByRole("list", { name: "자료실 목록" });
  const pdf = list.getByRole("listitem").filter({ hasText: "회사소개서.pdf" });
  await expect(pdf).toBeVisible();
  await expect(pdf.getByRole("link", { name: /가상고객A/ })).toBeVisible();
  await expect(pdf.getByRole("link", { name: "내려받기" })).toBeVisible();

  const search = page.getByRole("search", { name: "자료 찾기" });
  await search.getByLabel("종류").selectOption("url");
  await search.getByRole("button", { name: "찾기" }).click();
  // 검색 후 주소가 바뀐 다음에 목록을 본다(예전 목록을 검사하지 않도록)
  await expect(page).toHaveURL(/kind=url/);
  await expect(list.getByRole("listitem").first()).toContainText("링크");
  await expect(list.getByText("회사소개서.pdf")).toHaveCount(0);

  await search.getByLabel("종류").selectOption("");
  await search.getByLabel("이름").fill("회사소개서");
  await search.getByRole("button", { name: "찾기" }).click();
  await expect(page).toHaveURL(/q=/);
  for (const item of await list.getByRole("listitem").all()) await expect(item).toContainText("회사소개서");

  await search.getByLabel("이름").fill("없는자료%_");
  await search.getByRole("button", { name: "찾기" }).click();
  await expect(page.getByText("조건에 맞는 자료가 없습니다.")).toBeVisible();
});

test("결과물: 로고·견적을 모아 보고, 승인본 있는 것만 볼 수 있다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/results");
  const list = page.getByRole("list", { name: "결과물 목록" });
  await expect(list.getByRole("link", { name: "로고 브리프·프롬프트" }).first()).toBeVisible();
  await expect(list.getByRole("link", { name: "견적" }).first()).toBeVisible();

  const search = page.getByRole("search", { name: "결과물 찾기" });
  await search.getByLabel("종류").selectOption("quote");
  await search.getByLabel("승인본 있는 것만").check();
  await search.getByRole("button", { name: "찾기" }).click();
  const items = list.getByRole("listitem");
  await expect(items.first()).toBeVisible();
  for (const item of await items.all()) {
    await expect(item.getByRole("link").first()).toHaveText("견적");
    await expect(item.getByText(/승인본 \d+번/)).toBeVisible();
  }
  // 결과물에서 작업 화면으로 이동
  await items.first().getByRole("link", { name: "견적" }).click();
  await expect(page.getByRole("form", { name: "견적 작성" })).toBeVisible();
});

test("휴대폰: 자료 추가는 아래쪽 창에서 하고, 닫으면 여는 버튼으로 돌아간다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await loginWithWorkspace(page);
  await page.goto("/projects");
  await page.getByRole("list", { name: "프로젝트 목록" }).getByRole("link").first().click();
  const open = page.getByRole("button", { name: "자료 추가 열기" });
  await open.click();
  const sheet = page.getByRole("dialog", { name: "자료 추가" });
  await expect(sheet).toBeVisible();
  await axe(page, "휴대폰 자료 추가 창");

  await sheet.getByText("메모 추가").click();
  await sheet.getByLabel("내용").fill("휴대폰에서 남긴 메모");
  await sheet.getByRole("button", { name: "메모 저장" }).click();
  await expect(sheet.getByRole("status").filter({ hasText: "메모를 저장했습니다." })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(open).toBeFocused();
  await expect(page.getByText("휴대폰에서 남긴 메모").filter({ visible: true }).first()).toBeVisible();
});

test("자료실·결과물 접근성 검사와 휴대폰 가로 스크롤 없음", async ({ page }) => {
  await loginWithWorkspace(page);
  for (const url of ["/assets", "/results"]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await axe(page, url);
  }
  for (const width of [390, 640]) {
    await page.setViewportSize({ width, height: 900 });
    for (const url of ["/assets", "/results"]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${url} ${width}px 가로 스크롤`).toBeLessThanOrEqual(1);
    }
  }
});

test("CR08 제목 없는 메모·링크도 화면에 보이는 이름으로 찾는다", async ({ page }) => {
  const marker = `표시이름-${Date.now().toString(36)}`;
  // 검색어마다 이번 실행의 표시(marker)를 넣어, 같은 DB에서 다시 실행해도 이전 자료가 섞이지 않게 한다(Codex 재검수)
  const memo = `${marker} 제목 없는 통화 메모, (괄호${marker})와 쉼표 포함`;
  const url = `https://example.com/${marker}`;
  const titled = `${marker}-%_\\자료`;
  // 화면 로그인을 먼저 한다. 시험 자료용 로그인 링크를 바로 이어 만들면 같은 사람 메일 1초 제한에 걸린다.
  await loginWithWorkspace(page);
  const sb = await ownerSupabase();
  const { data: client } = await sb.from("clients").select("id, workspace_id").limit(1).single();
  const added = await sb.from("source_assets").insert([
    { workspace_id: client!.workspace_id, client_id: client!.id, kind: "text", text_content: memo, upload_status: "stored" },
    { workspace_id: client!.workspace_id, client_id: client!.id, kind: "url", url, upload_status: "stored" },
    { workspace_id: client!.workspace_id, client_id: client!.id, kind: "text", file_name: titled, text_content: "본문", upload_status: "stored" },
  ]);
  expect(added.error).toBeNull();

  const list = page.getByRole("list", { name: "자료실 목록" });
  for (const [q, expected, kind] of [
    [`${marker} 제목 없는`, memo, ""],
    [`(괄호${marker})와 쉼표`, memo, ""],
    [url, url, ""],
    [marker, url, "url"],
    [`${marker}-%_\\`, titled, "text"],
  ] as const) {
    await page.goto(`/assets?${new URLSearchParams({ q, kind })}`);
    await expect(list.getByRole("listitem").first(), q).toContainText(expected.slice(0, 40));
    for (const item of await list.getByRole("listitem").all()) await expect(item).toContainText(marker);
  }
  // 종류가 맞지 않으면 나오지 않는다
  await page.goto(`/assets?${new URLSearchParams({ q: marker, kind: "file" })}`);
  await expect(page.getByText("조건에 맞는 자료가 없습니다.")).toBeVisible();
});

test("CR07 결과물이 200개를 넘어도 쪽을 넘겨 모두 볼 수 있다(빠짐·겹침 없음, 걸러 보기 유지)", async ({ page }) => {
  test.setTimeout(180_000);
  const sb = await ownerSupabase();
  const { data: source } = await sb.from("tasks").select("project_id, workspace_id, template_id").eq("type", "logo_brief").limit(1).single();
  const tasks = Array.from({ length: 201 }, () => ({ id: crypto.randomUUID(), ...source!, type: "logo_brief", idempotency_key: crypto.randomUUID() }));
  expect((await sb.from("tasks").insert(tasks)).error).toBeNull();
  for (const t of tasks) {
    const made = await sb.rpc("record_generation", {
      p_task_id: t.id, p_idempotency_key: crypto.randomUUID(), p_input_hash: t.id, p_profile_snapshot: {},
      p_extra_inputs: {}, p_source_refs: [], p_content: { brief: "페이지 시험" }, p_mode: "template",
    });
    expect(made.error).toBeNull();
  }
  const { count } = await sb.from("artifacts").select("id", { count: "exact", head: true }).eq("type", "logo_brief");
  expect(count!).toBeGreaterThan(200);

  await loginWithWorkspace(page);
  await page.goto("/results?type=logo_brief");
  const pager = page.getByRole("navigation", { name: "결과물 쪽 이동" });
  await expect(pager).toContainText(`전체 ${count!.toLocaleString("ko-KR")}개 중 1–50번째`);
  const seen = new Set<string>();
  for (let pageNo = 1; pageNo <= 10; pageNo += 1) {
    const hrefs = await page.getByRole("list", { name: "결과물 목록" }).getByRole("listitem").locator("a[href^='/tasks/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    for (const h of hrefs) {
      expect(seen.has(h), `겹침: ${h}`).toBe(false);
      seen.add(h);
    }
    const next = pager.getByRole("link", { name: "다음 50개" });
    if ((await next.count()) === 0) break;
    await next.click();
    await expect(page).toHaveURL(new RegExp(`page=${pageNo + 1}`));
    await expect(page).toHaveURL(/type=logo_brief/);
  }
  expect(seen.size).toBe(count);
  await expect(pager.getByRole("link", { name: "처음으로" })).toBeVisible();
});
