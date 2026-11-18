import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, loginWithWorkspace, ownerSupabase, unique } from "./helpers";

/**
 * P2-APP-E2E-01: P2-b 프로필 승인 · P2-c 전략 생성 · E1(hydration 전 제출 차단) 회귀.
 * 자기 전용 시험 스택에서만 실행한다(playwright.config preflight). 모든 값은 합성이다.
 * N2(승인 철회된 프로필을 기준으로 만든 전략의 승인 의미)는 미정이므로 기대값으로 고정하지 않고 관찰만 기록한다.
 */
test.describe.configure({ mode: "serial" });

const CLIENT = unique("가상고객P2 카페");
const PROJECT = unique("P2 전략 프로젝트");
/**
 * 다른 업무실 주인(합성): 실행마다 고유 주소를 만든다(P2-E2E-ISOLATION-01).
 * 고정 주소(newbie@…)는 auth.spec 의 가입 시험이 "아직 가입 안 됨"을 전제로 쓰므로 여기서 쓰지 않는다.
 * 이 계정은 앱 화면에 로그인하지 않으므로 앱 허용 목록(ALLOWED_USER_EMAILS)이 필요 없고, DB 가입 허용 목록에만 올린다.
 */
const OTHER_EMAIL = `p2-other-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}@marketing-office.test`;
const OTHER_PASSWORD = `Other-${randomBytes(9).toString("base64url")}9`;

let sb: SupabaseClient;
let clientId = "";
let taskUrl = "";
const versionIds: Record<number, string> = {};

const review = (page: Page) => page.getByRole("region", { name: "프로필 버전 검토·승인" });
const editor = (page: Page) => page.getByRole("region", { name: "전략 입력" });
const section = (page: Page, legend: string) => editor(page).getByRole("group", { name: legend });

async function saveProfile(page: Page, products: string) {
  await page.getByLabel("상품·서비스").fill(products);
  await page.getByRole("button", { name: "새 버전으로 저장" }).click();
}
async function profileId(version: number) {
  const { data, error } = await sb.from("company_profile_versions").select("id").eq("client_id", clientId).eq("version", version).single();
  if (error) throw error;
  return data.id as string;
}
async function decisionsOf(versionId: string) {
  const ap = await sb.from("company_profile_approvals").select("decision, seq").eq("company_profile_version_id", versionId).order("seq");
  const au = await sb.from("audit_events").select("id").eq("entity_id", versionId).like("action", "profile_%");
  return { decisions: (ap.data ?? []).map((d) => d.decision), audits: (au.data ?? []).length };
}
/** 화면 결정 폼(승인·철회)을 hydration 뒤 같은 순번으로 두 번 동시에 보낸다 */
async function doubleSubmitDecision(page: Page, buttonName: RegExp) {
  const button = review(page).getByRole("button", { name: buttonName });
  await expect(button).toBeEnabled();
  await button.evaluate((b) => {
    const f = (b as HTMLButtonElement).form!;
    f.requestSubmit();
    f.requestSubmit();
  });
}

test("준비: 업무실·고객·프로필 2개 버전·고객 프로젝트(화면)", async ({ page }) => {
  sb = await ownerSupabase();
  await loginWithWorkspace(page);
  await page.goto("/clients");
  await page.getByLabel("고객명 (필수)").fill(CLIENT);
  await page.getByRole("button", { name: "고객 등록" }).click();
  await expect(page.getByRole("heading", { level: 1, name: CLIENT })).toBeVisible();
  clientId = page.url().split("/clients/")[1]!.split(/[?#]/)[0]!;
  await saveProfile(page, "합성 원두 v1");
  await expect(page.getByRole("heading", { name: /현재 1번 버전/ })).toBeVisible();
  await saveProfile(page, "합성 원두·디저트 v2");
  await expect(page.getByRole("heading", { name: /현재 2번 버전/ })).toBeVisible();
  versionIds[1] = await profileId(1);
  versionIds[2] = await profileId(2);

  await page.getByText("새 프로젝트", { exact: true }).click(); // 빈 상태 안내 문구에도 같은 글자가 있어 펼치기 이름만 정확히(QA-E2E-FULL-01 T1)
  await page.getByLabel("프로젝트 제목 (필수)").fill(PROJECT);
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PROJECT })).toBeVisible();
});

test("P2-b: 목록·비교, 승인→잠금 표시, 철회→표시 갱신, 수정 요청은 미지원 표시", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(`/clients/${clientId}?pv=2`);
  await expect(review(page).getByText("2번 버전 (1번 대비 변경)")).toBeVisible();
  await expect(review(page).getByText("합성 원두·디저트 v2")).toBeVisible();
  await expect(review(page).getByText(/수정 요청: 지원하지 않습니다/)).toBeVisible();

  // v1 승인(전략 기준용으로 유지)
  await page.goto(`/clients/${clientId}?pv=1`);
  await review(page).getByRole("button", { name: "1번 버전 승인" }).click();
  await expect(review(page).getByText("이 버전을 승인했습니다.")).toBeVisible();
  await page.goto(`/clients/${clientId}?pv=1`);
  await expect(review(page).getByRole("button", { name: "승인 철회" })).toBeVisible();

  // v2 승인 → 철회 → 목록 상태 갱신
  await page.goto(`/clients/${clientId}?pv=2`);
  await review(page).getByRole("button", { name: "2번 버전 승인" }).click();
  await expect(review(page).getByText("이 버전을 승인했습니다.")).toBeVisible();
  await page.goto(`/clients/${clientId}?pv=2`);
  await review(page).getByRole("button", { name: "승인 철회" }).click();
  await expect(review(page).getByText("이 버전의 승인을 철회했습니다.")).toBeVisible();
  await page.goto(`/clients/${clientId}?pv=2`);
  await expect(review(page).getByRole("listitem").filter({ hasText: "2번 버전 (보는 중)" })).toContainText("승인 철회됨");
  expect(await decisionsOf(versionIds[2]!)).toEqual({ decisions: ["approved", "revoked"], audits: 2 });
});

test("P2-b: 같은 기대 순번 이중 제출 → DB 기록·감사 1건, 패자는 충돌 안내", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(`/clients/${clientId}`);
  await saveProfile(page, "합성 원두 v3");
  await expect(page.getByRole("heading", { name: /현재 3번 버전/ })).toBeVisible();
  versionIds[3] = await profileId(3);
  await page.goto(`/clients/${clientId}?pv=3`);
  await doubleSubmitDecision(page, /3번 버전 승인/);
  await expect(review(page).getByText(/그 사이 이 버전에 다른 결정이 기록되었습니다|이미 승인된 버전입니다/)).toBeVisible();
  await expect.poll(async () => decisionsOf(versionIds[3]!)).toEqual({ decisions: ["approved"], audits: 1 });
});

test("E1: 서버가 보낸 첫 HTML에서 서버 동작 제출 버튼은 비활성(hydration 전 제출 차단)", async ({ page }) => {
  await loginWithWorkspace(page);
  const html = await (await page.request.get(`/clients/${clientId}?pv=3`)).text();
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>승인 철회<\/button>/);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>새 버전으로 저장<\/button>/);
  // 로그인 화면(로그인 상태가 아닌 새 요청) 제출 버튼도 비활성으로 시작
  const loginHtml = await (await page.request.get("/login", { headers: { cookie: "" } })).text();
  expect(loginHtml).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>로그인(<!-- -->)?<(svg|\/button)/); // 버튼 안에 화살표 아이콘이 뒤따른다
});

test("P2-c: 승인된 프로필만 선택 가능, 같은 키 이중 제출은 버전 1개, 결과 열기·배지·질문", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto("/projects");
  await page.getByRole("link", { name: PROJECT }).click();
  await page.getByLabel("새 작업").selectOption({ label: "마케팅 전략" });
  await page.getByRole("button", { name: "작업 시작" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "마케팅 전략" })).toBeVisible();
  taskUrl = page.url();
  await expect(page.getByRole("link", { name: "결과 바로 보기" })).toHaveCount(0); // 결과가 없으면 링크 숨김

  const profile = editor(page).getByLabel("기준 회사 프로필 버전 (필수)");
  await expect(profile.locator("option", { hasText: "1번 버전 · 승인됨" })).toBeEnabled();
  await expect(profile.locator("option", { hasText: "2번 버전 · 승인 철회됨" })).toBeDisabled();
  await profile.selectOption({ label: "1번 버전 · 승인됨" });

  await section(page, "목표 (필수 영역)").getByRole("button", { name: "+ 사실 (출처 필수)" }).click();
  await section(page, "목표 (필수 영역)").getByRole("textbox", { name: /^목표 사실 1(\s|$)/ }).fill("3개월 안에 평일 오전 방문을 늘린다");
  await section(page, "포지셔닝 (필수 영역)").getByRole("button", { name: "+ 추정 (가설)" }).click();
  await section(page, "포지셔닝 (필수 영역)").getByRole("textbox", { name: /^포지셔닝 추정 1(\s|$)/ }).fill("동네 단골 카페로 기억될 것이다");

  const generate = editor(page).getByRole("button", { name: "전략 초안 만들기" });
  await expect(generate).toBeEnabled();
  await generate.evaluate((b) => {
    const f = (b as HTMLButtonElement).form!;
    f.requestSubmit();
    f.requestSubmit(); // 같은 멱등 키(화면이 그린 키) 동시 재전송
  });
  await expect(page.getByRole("heading", { name: "전략 1번 버전" })).toBeVisible();
  const taskId = taskUrl.split("/tasks/")[1]!;
  const versionCount = async () => {
    const art = await sb.from("artifacts").select("id").eq("task_id", taskId).single();
    if (art.error) return -1;
    const v = await sb.from("artifact_versions").select("id").eq("artifact_id", art.data.id);
    return v.error ? -1 : v.data.length;
  };
  await expect.poll(versionCount).toBe(1);

  const result = page.getByRole("region", { name: "전략 1번 버전" });
  await expect(result.getByRole("article", { name: "목표" })).toContainText("근거 있음");
  await expect(result.getByRole("article", { name: "포지셔닝" })).toContainText("추정만 있음");
  await expect(result.getByRole("article", { name: "상품·제안" })).toContainText("확인 필요");
  await expect(result.getByRole("article", { name: "기회" })).toContainText("비어 있음");
  await expect(result.getByText(/\[포지셔닝\] 추정만 있습니다/)).toBeVisible();
  await expect(result.getByText("출처: 회사 프로필 1번 버전")).toBeVisible();
});

test("P2-c: 화면을 우회한 미승인·다른 업무실 프로필은 서버가 거절", async ({ page }) => {
  // 다른 업무실(두 번째 합성 계정)과 그 업무실의 승인된 프로필
  const admin = adminClient();
  expect((await admin.from("signup_allowlist").insert({ email: OTHER_EMAIL, note: "P2-E2E-ISOLATION-01 실행별 합성 계정" })).error).toBeNull();
  const created = await admin.auth.admin.createUser({ email: OTHER_EMAIL, password: OTHER_PASSWORD, email_confirm: true });
  if (created.error) throw created.error; // 고유 주소이므로 "이미 있음"은 허용하지 않는다
  const other = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const signIn = await other.auth.signInWithPassword({ email: OTHER_EMAIL, password: OTHER_PASSWORD });
  if (signIn.error) throw signIn.error;
  const ws = await other.from("workspaces").select("id").maybeSingle();
  const wsId = ws.data?.id ?? (await other.rpc("setup_workspace", { p_name: "다른 업무실", p_legal_name: "다른 상호" })).data;
  const oc = await other.from("clients").insert({ workspace_id: wsId, name: unique("다른 고객") }).select("id").single();
  const op = await other.from("company_profile_versions").insert({ workspace_id: wsId, client_id: oc.data!.id, version: 1 }).select("id").single();
  // 다른 업무실 프로필은 승인하지 않는다: 지울 수 없는(추가 전용) 승인 기록을 남기지 않기 위해서다.
  // 서버는 "이 프로젝트 고객의 프로필인가"를 승인 여부보다 먼저 보므로 같은 거절 경로를 탄다.

  // 다른 업무실 사용자는 이 업무실 프로필을 승인할 수 없다(DB NOT_FOUND)
  const cross = await other.rpc("approve_company_profile_version", { p_profile_version_id: versionIds[1]!, p_decision: "revoked", p_expected_last_seq: 0 });
  expect(cross.error?.message).toMatch(/^NOT_FOUND/);

  await loginWithWorkspace(page);
  const submitWith = async (profileVersionId: string) => {
    await page.goto(taskUrl);
    const generate = editor(page).getByRole("button", { name: "전략 초안 만들기" });
    await expect(generate).toBeEnabled();
    await generate.evaluate((b, pid) => {
      const f = (b as HTMLButtonElement).form!;
      const h = f.querySelector<HTMLInputElement>("input[name=payload]")!;
      const p = JSON.parse(h.value);
      p.profileVersionId = pid;
      p.sections.goals.facts = [{ text: "우회 시험", source: { kind: "profile" } }];
      h.value = JSON.stringify(p);
      f.requestSubmit();
    }, profileVersionId);
    return editor(page).getByRole("alert");
  };
  await expect(await submitWith(versionIds[2]!)).toContainText("승인된 회사 프로필 버전만 쓸 수 있습니다.");
  await expect(await submitWith(op.data!.id)).toContainText("이 프로젝트 고객의 회사 프로필 버전을 골라 주세요.");
});

test("N2 관찰(기대값 고정 안 함): 기준 프로필 철회 뒤 전략 화면 표시", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(`/clients/${clientId}?pv=1`);
  await review(page).getByRole("button", { name: "승인 철회" }).click();
  await expect(review(page).getByText("이 버전의 승인을 철회했습니다.")).toBeVisible();
  await page.goto(taskUrl);
  await expect(page.getByRole("heading", { name: /^전략 \d+번 버전$/ })).toBeVisible(); // 결과가 흘러 들어온 뒤 관찰
  await expect(page.getByRole("button", { name: "이 버전 승인" }).or(page.getByText("승인본"))).toBeVisible();
  const note = await page.getByRole("note").filter({ hasText: "회사 프로필 1번 버전" }).allTextContents();
  const approveVisible = await page.getByRole("button", { name: "이 버전 승인" }).isVisible();
  test.info().annotations.push(
    { type: "N2-관찰", description: `경계 안내: ${note.length ? note[0]!.replace(/\s+/g, " ").trim() : "(없음)"}` },
    { type: "N2-관찰", description: `승인 버튼 표시: ${approveVisible ? "예" : "아니오"} — 정책 미정, 기대값으로 고정하지 않음` },
  );
});

test("BUG-PROFILE-COMMENT-01: 결정 이력에 승인 메모·철회 사유를 구분해 표시(줄바꿈 보존, HTML 은 글자 그대로)", async ({ page }) => {
  await loginWithWorkspace(page);
  await page.goto(`/clients/${clientId}`);
  await saveProfile(page, "합성 원두 v4");
  await expect(page.getByRole("heading", { name: /현재 4번 버전/ })).toBeVisible();
  versionIds[4] = await profileId(4);
  const memo = "첫 줄 메모\n<b>굵게</b> & '따옴표'";
  await page.goto(`/clients/${clientId}?pv=4`);
  await review(page).getByLabel("메모 (선택)").fill(memo);
  await review(page).getByRole("button", { name: "4번 버전 승인" }).click();
  await expect(review(page).getByText("이 버전을 승인했습니다.")).toBeVisible();

  // 철회 사유는 화면 입력 칸이 없어 실제 RPC 로 남긴다(본인 권한, 현재 순번)
  const last = (await sb.from("company_profile_approvals").select("seq").eq("company_profile_version_id", versionIds[4]!).order("seq", { ascending: false }).limit(1).single()).data!.seq;
  const r = await sb.rpc("approve_company_profile_version", { p_profile_version_id: versionIds[4]!, p_decision: "revoked", p_expected_last_seq: last, p_comment: "합성 철회 사유" });
  expect(r.error).toBeNull();

  await page.goto(`/clients/${clientId}?pv=4`);
  await review(page).getByText(/이 버전의 결정 기록 2건/).click();
  const history = review(page).locator("details").filter({ hasText: "이 버전의 결정 기록" });
  const approveItem = history.getByRole("listitem").filter({ hasText: /^승인(?! 철회)/ });
  const revokeItem = history.getByRole("listitem").filter({ hasText: "승인 철회" });
  await expect(approveItem).toContainText("승인 메모: 첫 줄 메모");
  await expect(revokeItem).toContainText("철회 사유: 합성 철회 사유");
  await expect(revokeItem).not.toContainText("승인 메모");
  // 줄바꿈 보존(innerText 에 줄바꿈), HTML 은 요소가 아니라 글자
  expect(await approveItem.innerText()).toContain("첫 줄 메모\n<b>굵게</b> & '따옴표'");
  await expect(approveItem.getByText(/^승인 메모:/)).toHaveCSS("white-space", "pre-wrap");
  await expect(history.locator("b")).toHaveCount(0);

  // 빈 메모: 3번 버전은 메모 없이 승인했다 → 이력에 메모 줄이 없다
  await page.goto(`/clients/${clientId}?pv=3`);
  await review(page).getByText(/이 버전의 결정 기록 \d+건/).click();
  const history3 = review(page).locator("details").filter({ hasText: "이 버전의 결정 기록" });
  await expect(history3.getByRole("listitem").first()).toBeVisible();
  await expect(history3).not.toContainText("승인 메모");
  await expect(history3).not.toContainText("철회 사유");
});

/** 정리: 이번 실행이 만든 가입 허용 목록 행만 지운다. 계정과 그 업무실 행은 추가 전용·FK 규칙 때문에 지우지 않는다(고유 주소라 다음 실행과 겹치지 않음) */
test.afterAll(async () => {
  const admin = adminClient();
  const del = await admin.from("signup_allowlist").delete().eq("email", OTHER_EMAIL).select("email");
  test.info().annotations.push({ type: "정리", description: `허용 목록 행 삭제 ${del.data?.length ?? 0}건(${OTHER_EMAIL.replace(/^(.{12}).*@/, "$1…@")})` });
});

test("UI-GAP: 결과 바로 보기(1280·390·360, 키보드 포커스·하단 메뉴 비겹침)와 전략 JSON 복사(최신·이전 버전, 수동 대안)", async ({ page, context }) => {
  await loginWithWorkspace(page);
  // 이전·최신 버전을 만든다: 1번 내용을 바탕으로 사실 문장만 바꿔 직접 고치기 RPC 로 2번 저장(본인 권한)
  const taskId = taskUrl.split("/tasks/")[1]!;
  const art = (await sb.from("artifacts").select("id, revision, current_draft_version_id").eq("task_id", taskId).single()).data!;
  const cur = (await sb.from("artifact_versions").select("version, content").eq("id", art.current_draft_version_id!).single()).data!;
  const content = structuredClone(cur.content) as { facts: Array<{ text: string }> };
  const before = content.facts[0]!.text;
  const edited = `${before} (UI-GAP 수정)`;
  content.facts[0]!.text = edited;
  const saved = await sb.rpc("save_strategy_manual_version", { p_artifact_id: art.id, p_expected_revision: art.revision, p_content: content });
  expect(saved.error).toBeNull();
  const latest = cur.version + 1;

  // 결과 바로 보기: 폭마다 링크가 입력 폼보다 앞(탭 순서 = 화면 순서), Enter 로 결과 제목에 포커스, 하단 메뉴에 안 가림
  for (const width of [1280, 390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(taskUrl);
    const link = page.getByRole("link", { name: "결과 바로 보기" });
    await expect(link).toBeVisible();
    expect(await link.evaluate((a) => !!(a.compareDocumentPosition(document.getElementById("strategy-input")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#strategy-result")).toBeFocused();
    const covered = await page.locator("#strategy-result").evaluate((h) => {
      const r = h.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
      return { inView: r.top >= 0 && r.bottom <= window.innerHeight, hitIsHeading: !!hit && (hit === h || h.contains(hit)) };
    });
    expect(covered, `폭 ${width}`).toEqual({ inView: true, hitIsHeading: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `폭 ${width} 가로 넘침`).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // JSON 복사: 보고 있는 버전의 전략 데이터(2칸 들여쓰기), DB·감사·사용자 식별 정보 없음
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  const copyOf = async (url: string) => {
    await page.goto(url);
    await page.getByRole("button", { name: "전략 데이터(JSON) 복사" }).click();
    await expect(page.getByRole("status").filter({ hasText: "데이터를 복사했습니다" })).toBeVisible();
    // 앱은 LF 로 쓴다. Windows 클립보드는 읽을 때 CRLF 로 돌려주므로 줄바꿈만 맞춰 비교한다
    const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
    expect(text).toBe(await page.getByTestId("strategy-json").textContent());
    expect(text.startsWith('{\n  "')).toBe(true); // 2칸 들여쓰기
    expect(text).not.toMatch(/workspace_id|created_by|actor_id|artifact|input_snapshot|"seq"|user/i);
    return JSON.parse(text) as { templateVersion: string; projectId: string; sections: { goals: { facts: Array<{ text: string; sources: unknown[] }> } } };
  };
  const newest = await copyOf(taskUrl);
  expect(newest.templateVersion).toBe("strategy-template@1");
  expect(newest.sections.goals.facts[0]!.text).toBe(edited);
  expect(newest.sections.goals.facts[0]!.sources).toEqual([{ kind: "profile", profileId: versionIds[1], version: 1 }]);
  const older = await copyOf(`${taskUrl}?v=${cur.version}`);
  expect(older.sections.goals.facts[0]!.text).toBe(before);
  expect(latest).toBe(cur.version + 1);

  // 클립보드 거부: 수동 복사 안내 + JSON 상자를 펼쳐 글 선택
  await page.goto(taskUrl);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("거부")) }, configurable: true });
  });
  await page.getByRole("button", { name: "전략 데이터(JSON) 복사" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ctrl+C" })).toBeVisible();
  await expect(page.getByTestId("strategy-json")).toBeVisible();
  // Windows 브라우저는 선택 글을 꺼낼 때 줄바꿈을 CRLF 로 돌려준다. 줄바꿈만 맞춰 비교한다
  const selected = (await page.evaluate(() => window.getSelection()?.toString() ?? "")).replace(/\r\n/g, "\n");
  expect(selected).toBe(await page.getByTestId("strategy-json").textContent());
});
