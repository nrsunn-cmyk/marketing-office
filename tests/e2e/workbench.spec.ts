import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, loginWithWorkspace, unique } from "./helpers";

/**
 * M4 고객·프로젝트·자료 E2E.
 * 사전 조건: npm run e2e:reset
 */

test.describe.configure({ mode: "serial" });

const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

async function createClientNamed(page: Page, name: string, industry = "") {
  await page.goto("/clients");
  await page.getByLabel("고객명 (필수)").fill(name);
  if (industry) await page.getByLabel("업종").fill(industry);
  await page.getByRole("button", { name: "고객 등록" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url();
}

async function createProject(page: Page, title: string) {
  await page.getByText("새 프로젝트", { exact: true }).click(); // 빈 상태 안내 문구에도 같은 글자가 있어 펼치기 이름만 정확히(QA-E2E-FULL-01 T1)
  await page.getByLabel("프로젝트 제목 (필수)").fill(title);
  await page.getByLabel("예산 (원)").fill("1,500,000");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return page.url();
}

async function upload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByText("파일 올리기 (PDF·PNG·JPEG·TXT, 10MB까지)").click();
  await page.getByLabel("파일", { exact: true }).setInputFiles({ name, mimeType, buffer });
  await page.getByRole("button", { name: "파일 올리기" }).click();
}

let clientAUrl = "";
let projectAUrl = "";
const A = unique("가상고객A 베이커리");
const B = unique("가상고객B 세무회계");

test("고객 등록·검색·필수값 오류", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/clients");
  await page.getByRole("button", { name: "고객 등록" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "고객명을 입력해 주세요." })).toBeVisible();

  clientAUrl = await createClientNamed(page, A, "동네 빵집");
  await createClientNamed(page, B, "세무");

  await page.goto("/clients");
  await page.getByRole("searchbox").or(page.getByLabel("검색")).fill("베이커리");
  await page.getByRole("button", { name: "찾기" }).click();
  await expect(page.getByRole("link", { name: A })).toBeVisible();
  await expect(page.getByRole("link", { name: B })).toHaveCount(0);

  await page.getByLabel("검색").fill("없는고객%_");
  await page.getByRole("button", { name: "찾기" }).click();
  await expect(page.getByText("검색 결과가 없습니다.").filter({ visible: true })).toBeVisible();
});

test("회사 프로필은 저장할 때마다 새 버전 (R06)", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(clientAUrl);
  await expect(page.getByRole("heading", { name: /회사 프로필 \(아직 없음\)/ })).toBeVisible();
  await page.getByLabel("상품·서비스").fill("천연 발효 식빵");
  await page.getByLabel("강점 (한 줄에 하나)").fill("천연 발효\n당일 생산\n\n천연 발효");
  await page.getByRole("button", { name: "새 버전으로 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "1번 버전을 저장했습니다" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /현재 1번 버전/ })).toBeVisible();

  await page.getByLabel("채널 주소 (한 줄에 하나)").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "새 버전으로 저장" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "http:// 또는 https://" })).toBeVisible();

  await page.getByLabel("채널 주소 (한 줄에 하나)").fill("https://blog.example.com");
  await page.getByLabel("상품·서비스").fill("천연 발효 식빵, 쿠키");
  await page.getByRole("button", { name: "새 버전으로 저장" }).click();
  await expect(page.getByRole("heading", { name: /현재 2번 버전/ })).toBeVisible();
  await expect(page.getByLabel("강점 (한 줄에 하나)")).toHaveValue("천연 발효\n당일 생산");
  await expect(page.getByText("이전 버전 1개").filter({ visible: true })).toBeVisible();
});

test("T13 두 탭에서 같은 고객을 고치면 늦게 저장한 쪽은 충돌 안내", async ({ page, context }) => {
  await loginWithWorkspace(page);
  await page.goto(clientAUrl);
  const tab2 = await context.newPage();
  await tab2.goto(clientAUrl);

  await page.getByLabel("업종").fill("베이커리 카페");
  await page.getByRole("button", { name: "기본 정보 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "저장했습니다." })).toBeVisible();

  await tab2.getByLabel("업종").fill("오래된 화면의 값");
  await tab2.getByRole("button", { name: "기본 정보 저장" }).click();
  await expect(tab2.getByRole("alert").filter({ hasText: "다른 곳에서 먼저 수정되었습니다" })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("업종")).toHaveValue("베이커리 카페");
  await tab2.close();
});

test("프로젝트 생성·최신 프로필 연결·상태 변경", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(clientAUrl);
  projectAUrl = await createProject(page, unique("A 로고"));
  await expect(page.getByText("2번 버전", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("1,500,000원").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("접수", { exact: true }).filter({ visible: true })).toBeVisible();

  // 허용된 다음 상태만 버튼으로 나온다 (접수 → 납품 같은 건너뛰기 없음)
  await expect(page.getByRole("button", { name: "납품함(으)로" }).filter({ visible: true })).toHaveCount(0);
  await page.getByRole("button", { name: "진행 중(으)로" }).click();
  await expect(page.getByText("진행 중", { exact: true }).filter({ visible: true })).toBeVisible();
});

test("T04·T05 파일 올리기: 정상 PDF는 보관, 내용은 '읽기 전'으로 표시", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(projectAUrl);
  await upload(page, "회사소개서.pdf", "application/pdf", PDF);
  await expect(page.getByRole("status").filter({ hasText: "파일을 보관했습니다" })).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: "회사소개서.pdf" });
  await expect(item.getByText("보관됨").filter({ visible: true })).toBeVisible();
  await expect(item.getByText("내용 읽기 전 (보관만 됨)").filter({ visible: true })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), item.getByRole("link", { name: "내려받기" }).click()]);
  const path = await download.path();
  const { readFileSync } = await import("node:fs");
  expect(readFileSync(path).equals(PDF)).toBe(true);
});

test("T04 위장 파일·10MB 초과·빈 파일은 거절하고 성공처럼 보이지 않는다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(projectAUrl);
  const before = await page.getByRole("listitem").filter({ hasText: "보관됨" }).count();

  await upload(page, "견적서.pdf", "application/pdf", EXE);
  await expect(page.getByRole("alert").filter({ hasText: "내용이 다른 형식입니다" })).toBeVisible();

  const big = Buffer.alloc(10 * 1024 * 1024 + 1);
  PDF.copy(big);
  await page.getByLabel("파일", { exact: true }).setInputFiles({ name: "큰파일.pdf", mimeType: "application/pdf", buffer: big });
  await page.getByRole("button", { name: "파일 올리기" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "10MB까지" })).toBeVisible();

  await page.getByLabel("파일", { exact: true }).setInputFiles({ name: "setup.exe", mimeType: "application/octet-stream", buffer: EXE });
  await page.getByRole("button", { name: "파일 올리기" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "PDF, PNG, JPEG, TXT 파일만" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "보관됨" })).toHaveCount(before);
  await expect(page.getByText("견적서.pdf").filter({ visible: true })).toHaveCount(0);
});

test("메모·링크 자료 (링크는 주소만 기록)", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(projectAUrl);
  await page.getByText("메모 추가").click();
  await page.getByLabel("내용").fill("통화 메모: 크림색 선호");
  await page.getByRole("button", { name: "메모 저장" }).click();
  await expect(page.getByText("통화 메모: 크림색 선호").filter({ visible: true })).toBeVisible();

  await page.getByText("링크 추가").click();
  await page.getByLabel("주소").fill("file:///C:/secret.txt");
  await page.getByRole("button", { name: "링크 저장" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "http:// 또는 https://" })).toBeVisible();
  await page.getByLabel("주소").fill("https://example.com/brand");
  await page.getByRole("button", { name: "링크 저장" }).click();
  await expect(page.getByRole("link", { name: "https://example.com/brand" })).toBeVisible();
});

test("T02 고객 A의 프로젝트 자료는 고객 B 화면에 보이지 않는다", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/clients");
  await page.getByRole("link", { name: B }).click();
  await expect(page.getByRole("heading", { level: 1, name: B })).toBeVisible();
  await expect(page.getByText("회사소개서.pdf").filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText("통화 메모: 크림색 선호").filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText("등록된 자료가 없습니다.").filter({ visible: true })).toBeVisible();
});

test("T01 다른 계정은 저장소의 본인 파일을 내려받을 수 없다", async () => {
  const admin = adminClient();
  const { data: rows } = await admin
    .from("source_assets")
    .select("object_key")
    .eq("upload_status", "stored")
    .eq("kind", "file")
    .limit(1);
  const key = rows?.[0]?.object_key as string;
  expect(key).toBeTruthy();

  const email = `${unique("stranger")}@marketing-office.test`;
  const password = `pw-${crypto.randomUUID()}`;
  // 가입 허용 목록에 있어야 계정을 만들 수 있다(20261115001000_signup_allowlist)
  expect((await admin.from("signup_allowlist").upsert({ email })).error).toBeNull();
  expect((await admin.auth.admin.createUser({ email, password, email_confirm: true })).error).toBeNull();
  const stranger = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const login = await stranger.auth.signInWithPassword({ email, password });
  expect(login.error).toBeNull();

  const dl = await stranger.storage.from("source-assets").download(key);
  expect(dl.data).toBeNull();
  const signed = await stranger.storage.from("source-assets").createSignedUrl(key, 60);
  expect(signed.data).toBeNull();
  const { data: visible } = await stranger.from("source_assets").select("id");
  expect(visible).toEqual([]);
});

test("없는 고객·잘못된 주소는 찾을 수 없음", async ({ page }) => {
  await loginWithWorkspace(page);
  // 화면 내용이 나중에 흘러 들어오는(streaming) 페이지는 응답 코드가 이미 200으로 시작되므로 화면으로 확인한다
  for (const path of ["/clients/00000000-0000-0000-0000-000000000000", "/clients/not-a-uuid", "/projects/00000000-0000-0000-0000-000000000000"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "찾을 수 없습니다" })).toBeVisible();
    await expect(page.getByLabel("고객명 (필수)")).toHaveCount(0);
  }
  // 내려받기는 별도 경로라 실제 404
  const r = await page.goto("/assets/not-a-uuid/download");
  expect(r?.status()).toBe(404);
  const r2 = await page.goto("/assets/00000000-0000-0000-0000-000000000000/download");
  expect(r2?.status()).toBe(404);
});
