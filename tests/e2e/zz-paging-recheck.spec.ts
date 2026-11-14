import { expect, test } from "@playwright/test";
import { loginWithWorkspace, ownerSupabase } from "./helpers";

/**
 * Codex CR07·CR08 재검수 추가 경계 시험(Plan/Codex-Recheck-CR07-CR08-20261114/repro/paging-recheck.spec.ts).
 * 같은 시각 자료 201개 탐색, CR11 잘못된 날짜 기준값, CR12 긴 한글 주소 저장.
 * 로컬 시험 DB에서만 실행된다(ownerSupabase가 로컬이 아니면 멈춤).
 */

test.describe.configure({ mode: "serial" });

test("자료 201개가 같은 시각이어도 쪽마다 빠짐·겹침이 없다", async ({ page }) => {
  test.setTimeout(120_000);
  await loginWithWorkspace(page);
  const sb = await ownerSupabase();
  const found = await sb.from("clients").select("id, workspace_id").limit(1).single();
  expect(found.error).toBeNull();
  const marker = `동일시각검수-${Date.now()}`;
  const rows = Array.from({ length: 201 }, (_, i) => ({
    workspace_id: found.data!.workspace_id,
    client_id: found.data!.id,
    kind: "text",
    file_name: `${marker}-${i}`,
    text_content: "합성 자료",
    upload_status: "stored",
    created_at: "2026-11-14T00:00:00.000000+00:00",
  }));
  expect((await sb.from("source_assets").insert(rows)).error).toBeNull();

  await page.goto(`/assets?${new URLSearchParams({ kind: "text", q: marker })}`);
  const pager = page.getByRole("navigation", { name: "자료실 쪽 이동" });
  const seen = new Set<string>();
  for (let n = 0; n < 6; n += 1) {
    const items = page.getByRole("list", { name: "자료실 목록" }).getByRole("listitem");
    await expect(items.first()).toBeVisible();
    for (const name of await items.locator("strong").allTextContents()) {
      expect(seen.has(name), `겹침: ${name}`).toBe(false);
      seen.add(name);
    }
    const next = pager.getByRole("link", { name: "다음 50개" });
    if ((await next.count()) === 0) break;
    const old = page.url();
    await next.click();
    await expect(page).not.toHaveURL(old);
    await expect(page).toHaveURL(/kind=text/);
  }
  expect(seen.size).toBe(201);
  await expect(pager).toContainText("201개 중 201–201번째");
});

test("CR11 있을 수 없는 날짜의 기준값은 무시하고 처음 쪽을 보여 준다", async ({ page }) => {
  await loginWithWorkspace(page);
  for (const at of ["2026-99-99T25:00:00Z", "2026-02-29T00:00:00Z", "2026-11-14T03:04:05+15:00"]) {
    const cursor = Buffer.from(`${at}|00000000-0000-0000-0000-000000000001`).toString("base64url");
    for (const [path, label, nav] of [
      ["/assets", "자료실 목록", "자료실 쪽 이동"],
      ["/results", "결과물 목록", "결과물 쪽 이동"],
    ] as const) {
      await page.goto(`${path}?${new URLSearchParams({ cursor, page: "2" })}`);
      await expect(page.getByRole("list", { name: label }), `${path} ${at}`).toBeVisible();
      await expect(page.getByRole("navigation", { name: nav })).toContainText(/중 1–/);
    }
  }
});

test("CR12 허용 길이의 한글 주소를 제목 없이 저장하고 이름으로 찾는다", async ({ page }) => {
  await loginWithWorkspace(page);
  const sb = await ownerSupabase();
  const found = await sb.from("clients").select("id").limit(1).single();
  expect(found.error).toBeNull();
  let seed = Date.now() % 2147483647 || 1234567;
  const path = Array.from({ length: 1800 }, () => {
    seed = (seed * 48271) % 2147483647;
    return String.fromCharCode(0xac00 + (seed % 11172));
  }).join("");
  const url = `https://review.invalid/${path}`;
  expect(url.length).toBeLessThanOrEqual(2000);

  await page.goto(`/clients/${found.data!.id}`);
  const details = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "링크 추가" }) });
  await details.locator("summary").click();
  await details.getByLabel("주소", { exact: true }).fill(url);
  await details.getByRole("button", { name: "링크 저장" }).click();
  await expect(details.getByRole("status").filter({ hasText: "링크를 저장했습니다" })).toBeVisible();

  await page.goto(`/assets?${new URLSearchParams({ q: path.slice(1000, 1020), kind: "url" })}`);
  const items = page.getByRole("list", { name: "자료실 목록" }).getByRole("listitem");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText(path.slice(0, 20));
});
