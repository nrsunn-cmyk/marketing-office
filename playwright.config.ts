import { defineConfig } from "@playwright/test";
import { preflight } from "./tests/e2e/stack-guard";

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
// MAIL-SAFETY-01: 설정을 읽는 이 단계에서 자기 전용 시험 스택을 확인한다(webServer 를 띄우거나 시험을 돌리기 전).
// 필요: E2E_SUPABASE_PROJECT_ID, E2E_BASE_URL(= 스택 auth.site_url), E2E_MAILPIT_URL, NEXT_PUBLIC_SUPABASE_URL(.env.local).
// 기본 주소는 없다. 공유 543xx·원격·설정/컨테이너 불일치면 여기서 멈춘다.
const { baseURL, config: stack } = preflight();
const testURL = new URL(baseURL);
console.log(`[E2E 사전 확인] 시험 스택 ${stack.projectId} · API ${stack.apiPort} · 메일함 ${stack.inbucketPort} · 앱 ${baseURL}`);

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
      // 앱이 만드는 링크·리디렉션도 이 시험 앱 주소를 쓰게 한다(기본값 3000 방지)
      NEXT_PUBLIC_SITE_URL: baseURL,
      ALLOWED_USER_EMAILS: [
        "owner@marketing-office.test",
        "newbie@marketing-office.test",
        "dbblocked@marketing-office.test",
      ].join(","),
    },
  },
});
