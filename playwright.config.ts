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
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    channel: "chrome",
    headless: true,
    locale: "ko-KR",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- -H 127.0.0.1 -p 3000",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
