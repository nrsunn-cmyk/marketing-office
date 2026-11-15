import { defineConfig } from "@playwright/test";

// 테스트 코드도 로컬 Supabase 주소·관리자 키를 쓰므로 .env.local 을 읽는다
try {
  process.loadEnvFile(".env.local");
} catch {
  // 없으면 관리자 키가 필요한 테스트는 건너뛴다
}

/**
 * E2E: 실제 설치된 Google Chrome(channel: 'chrome')으로 실행한다 (Codex 05 §5).
 * 사전 조건: `supabase start`, `npm run e2e:reset` (DB 초기화 + 본인 계정 생성).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const testURL = new URL(baseURL);
if (testURL.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(testURL.hostname)) {
  throw new Error("E2E_BASE_URL은 로컬 시험 서버 주소여야 합니다.");
}

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL,
    channel: "chrome",
    headless: true,
    locale: "ko-KR",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- -H ${testURL.hostname} -p ${testURL.port || "80"}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    // 회원가입 시험용 이메일을 앱 허용 목록에 더한다(.env.local 은 그대로). 실제 가입 가능 여부는 DB 허용 목록이 다시 정한다.
    env: {
      ALLOWED_USER_EMAILS: [
        "owner@marketing-office.test",
        "newbie@marketing-office.test",
        "dbblocked@marketing-office.test",
      ].join(","),
    },
  },
});
