import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "./helpers";
import { dockerPortLookup, preflight, SHARED_PROJECT_IDS } from "./stack-guard";

/**
 * E2E-E-F-01 관리자 페이지 1단계(ADMIN-UI-01 화면 + 서버 ADMIN-IMPL-01, migration 25).
 * M1 비관리자: /admin·/admin/usage·/admin/audit 모두 '찾을 수 없습니다', 화면·제목에 관리자 흔적 없음
 * M2 관리자: 시험 계정을 app.admins 에 넣고 3화면(목록·기간·조건 거르기·잘못된 업무실 id 안내), 열람 기록 행 증가,
 *    명단에서 빼면 바로 다시 404
 *
 * 계정(BUNDLE-EF-T2, QA-BUNDLE-EF-01 T2): 시험 주인 계정(owner)을 쓰지 않는다. 실행마다 고유 계정을 만든다.
 * 예전에는 주인 계정으로 로그인하며 업무실을 만들어, 파일 이름 순서상 뒤에 도는 auth.spec 의
 * '업무실 없는 주인 → /setup' 전제를 깼다. 파일 순서에 기대지 않도록 계정 자체를 나눈다.
 * - 앱 로그인 화면은 playwright.config 의 ALLOWED_USER_EMAILS(고정 3개)만 받으므로, 화면 대신 앱과 같은
 *   @supabase/ssr 클라이언트로 로그인해 받은 세션 쿠키를 브라우저에 넣는다. 관리자 화면은 허용 이메일이 아니라
 *   isAdmin()(로그인 사용자 + app.admins)로만 판단하므로 이 쿠키로 열린다. 업무실은 만들지 않는다.
 * - app.admins 는 PostgREST 로 닿지 않는 app 스키마라 DB 소유자 SQL(docker exec psql)로만 넣고 뺀다.
 *   안전 장치(Master 조건): 부를 때마다 stack-guard.preflight 로 환경·설정·실제 컨테이너를 다시 대조하고,
 *   공용 스택·Tester 전용(claude-tester-*)이 아닌 스택·DB 포트가 설정과 다른 컨테이너면 실행 전에 멈춘다. 끝나면 행을 지운다.
 * 자기 전용 시험 스택에서만 돈다. 모든 값은 합성이다.
 */
test.describe.configure({ mode: "serial" });

const PAGES = [
  { path: "/admin", h1: "가입자·업무실" },
  { path: "/admin/usage", h1: "이용 현황" },
  { path: "/admin/audit", h1: "감사 기록" },
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 전용 시험 스택 DB 에 소유자 SQL 한 줄. 조건이 하나라도 어긋나면 docker 를 부르기 전에 멈춘다 */
function stackSql(sql: string): string {
  const { config } = preflight();
  if (SHARED_PROJECT_IDS.includes(config.projectId)) throw new Error("공용 스택에서는 관리자 명단을 바꾸지 않습니다.");
  if (!/^claude-tester-[a-z0-9-]+$/.test(config.projectId)) throw new Error(`Tester 전용 스택(claude-tester-*)이 아닙니다: ${config.projectId}`);
  const container = `supabase_db_${config.projectId}`;
  const dbPort = dockerPortLookup(container, "5432/tcp");
  if (dbPort !== config.dbPort) throw new Error(`${container} 의 DB 포트(${dbPort})가 설정(${config.dbPort})과 다릅니다.`);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql], { encoding: "utf8" }).trim();
}

/** 이 파일 전용 합성 계정(실행마다 고유 주소) */
const ACCOUNT = {
  email: `admin-e2e-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}@marketing-office.test`,
  password: `Admin-${randomBytes(9).toString("base64url")}9`,
  id: "",
};
const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/** 본인 권한(RLS) 클라이언트: 열람 기록 행 세기용 */
async function accountSupabase(): Promise<SupabaseClient> {
  const sb = createClient(url(), key(), { auth: { persistSession: false } });
  const r = await sb.auth.signInWithPassword({ email: ACCOUNT.email, password: ACCOUNT.password });
  if (r.error) throw r.error;
  return sb;
}

/** 앱(@supabase/ssr)과 같은 형식의 세션 쿠키를 만들어 브라우저에 넣는다(화면 로그인 대신) */
async function signIn(page: Page, baseURL: string) {
  const jar = new Map<string, string>();
  const sb = createServerClient(url(), key(), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) {
          if (c.value) jar.set(c.name, c.value);
          else jar.delete(c.name);
        }
      },
    },
  });
  const r = await sb.auth.signInWithPassword({ email: ACCOUNT.email, password: ACCOUNT.password });
  if (r.error) throw r.error;
  expect(jar.size, "세션 쿠키").toBeGreaterThan(0);
  await page.context().addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));
}

const setAdmin = (on: boolean) => {
  if (!UUID.test(ACCOUNT.id)) throw new Error("시험 계정 id 가 없습니다."); // UUID 검사를 통과한 값만 SQL 에 넣는다
  stackSql(on ? `insert into app.admins (user_id, note) values ('${ACCOUNT.id}', 'E2E-E-F-01 시험') on conflict do nothing` : `delete from app.admins where user_id = '${ACCOUNT.id}'`);
};
const adminRows = () => stackSql(`select count(*) from app.admins where user_id = '${ACCOUNT.id}'`);

test.beforeAll(async () => {
  const admin = adminClient();
  expect((await admin.from("signup_allowlist").insert({ email: ACCOUNT.email, note: "E2E-E-F-01 관리자 시험 합성 계정" })).error).toBeNull();
  const created = await admin.auth.admin.createUser({ email: ACCOUNT.email, password: ACCOUNT.password, email_confirm: true });
  if (created.error) throw created.error; // 고유 주소이므로 "이미 있음"은 허용하지 않는다
  ACCOUNT.id = created.data.user.id;
});

test.afterAll(async () => {
  if (ACCOUNT.id) setAdmin(false);
  const removed = (await adminClient().from("signup_allowlist").delete().eq("email", ACCOUNT.email).select("email")).data?.length ?? 0;
  test.info().annotations.push({ type: "정리", description: `관리자 명단 행 ${ACCOUNT.id ? adminRows() : "?"}개 남음, 허용 목록 행 삭제 ${removed}건` });
});

async function expectHidden(page: Page) {
  for (const p of PAGES) {
    await page.goto(p.path);
    await expect(page.getByRole("heading", { name: "찾을 수 없습니다" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("관리자");
    await expect(page).not.toHaveTitle(/관리자/);
  }
}

test("M1 비관리자: 세 주소 모두 '찾을 수 없습니다', 관리자 흔적 없음", async ({ page, baseURL }) => {
  expect(adminRows()).toBe("0");
  await signIn(page, baseURL!);
  await expectHidden(page);
});

test.describe("M2 관리자", () => {
  test.beforeAll(() => {
    setAdmin(true);
    expect(adminRows()).toBe("1");
  });
  test.afterAll(() => {
    setAdmin(false);
    expect(adminRows()).toBe("0");
  });

  test("가입자·업무실: 시험 계정 줄, 읽기 전용 안내, 쓰기 단추 없음, 메뉴에 없음", async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("가입자·업무실");
    await expect(page).toHaveTitle(/관리자/);
    await expect(page.getByRole("note").filter({ hasText: "운영 상태를 보기만 하는 화면입니다." })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "관리자 화면" });
    await expect(nav.getByRole("link", { name: "가입자·업무실" })).toHaveAttribute("aria-current", "page");
    const row = page.getByRole("region", { name: /가입자 목록/ }).getByRole("row").filter({ hasText: ACCOUNT.email });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("초기 설정 전"); // 이 계정은 업무실을 만들지 않는다
    await expect(row).toContainText("허용 목록");
    await expect(page.locator("main").getByRole("button")).toHaveCount(0); // 쓰기 단추 없음
    await expect(page.getByRole("heading", { name: "아직 가입하지 않은 허용 이메일" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: /관리자/ })).toHaveCount(0); // 메뉴에 넣지 않음
  });

  test("이용 현황: 최근 30일 바로가기 → 기간 주소·합계, 직접 기간 지정", async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    await page.goto("/admin/usage");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("이용 현황");
    await page.getByRole("link", { name: "최근 30일" }).click();
    await expect(page).toHaveURL(/\/admin\/usage\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole("link", { name: "최근 30일" })).toHaveAttribute("aria-current", "true");
    const totals = page.getByRole("list", { name: "기간 합계" });
    await expect(totals.getByRole("listitem")).toHaveCount(5);
    await expect(totals).toContainText("AI 문구 생성 · 추정 비용");

    const form = page.getByRole("form", { name: "기간 직접 고르기" });
    await form.getByLabel("시작일").fill("2026-01-01");
    await form.getByLabel("끝일(포함)").fill("2026-01-02");
    await form.getByRole("button", { name: "이 기간으로 보기" }).click();
    await expect(page).toHaveURL(/from=2026-01-01&to=2026-01-02/);
    await expect(page.getByRole("heading", { level: 2, name: "2026-01-01 ~ 2026-01-02" })).toBeVisible();
  });

  test("감사 기록: 동작 조건으로 거르기, 잘못된 업무실 id 는 알리고 빼기, 조건 지우기", async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    await page.goto("/admin/audit?action=create");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("감사 기록");
    const table = page.getByRole("region", { name: /감사 기록/ });
    if ((await table.count()) > 0) {
      const actions = await table.locator("td[data-label='동작']").allTextContents();
      expect(new Set(actions)).toEqual(new Set(["create"]));
    } else {
      await expect(page.getByText("조건에 맞는 기록이 없습니다.")).toBeVisible();
    }
    await page.goto("/admin/audit?workspace=not-a-uuid");
    await expect(page.getByText("업무실 id 형식이 아닙니다. 이 조건은 빼고 보여 줍니다.")).toBeVisible();
    await expect(page.getByLabel("업무실 id")).toHaveAttribute("aria-invalid", "true");
    await page.getByRole("link", { name: "조건 지우기" }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
  });

  test("열람 기록: 관리자 화면을 열면 본인 열람 기록 행이 는다", async ({ page, baseURL }) => {
    const sb = await accountSupabase();
    const count = async () => (await sb.from("admin_access_log").select("id", { count: "exact", head: true })).count ?? 0;
    const before = await count();
    await signIn(page, baseURL!);
    await page.goto("/admin/usage");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("이용 현황");
    await expect.poll(count).toBeGreaterThan(before);
  });
});

test("명단에서 빼면 바로 다시 '찾을 수 없습니다'", async ({ page, baseURL }) => {
  expect(adminRows()).toBe("0");
  await signIn(page, baseURL!);
  await expectHidden(page);
});
