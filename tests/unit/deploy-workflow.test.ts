import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DEPLOY-ACTIONS-01: 운영 배포 워크플로의 안전 장치가 빠지지 않게 지킨다.
 * 배포 경로를 바꾸는 변경이므로, 아래 조건을 바꾸려면 이 시험도 함께 고치고 Master 확인을 받는다.
 */
const wf = readFileSync(join(process.cwd(), ".github/workflows/vercel-deploy.yml"), "utf8");
// 주석을 뺀 실제 설정만 본다
const body = wf
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("#"))
  .join("\n");

describe("운영 배포 워크플로(vercel-deploy.yml)", () => {
  it("수동 실행만 받는다(push·PR로는 돌지 않는다)", () => {
    const on = body.match(/^on:\n([\s\S]*?)^\S/m)?.[1] ?? "";
    expect(on).toMatch(/^\s{2}workflow_dispatch:/m);
    expect(on).not.toMatch(/^\s{2}(push|pull_request|pull_request_target|schedule|workflow_run):/m);
  });

  it("main 브랜치에서만 배포한다", () => {
    expect(body).toMatch(/if: github\.ref == 'refs\/heads\/main'/);
  });

  it("저장소 권한은 읽기만, checkout 은 자격 증명을 남기지 않는다", () => {
    expect(body).toMatch(/^permissions:\n\s+contents: read\n(?![ \t])/m);
    expect(body).toMatch(/persist-credentials: false/);
  });

  it("토큰은 환경 변수로만 넘기고 --token 인자를 쓰지 않는다", () => {
    expect(body).toMatch(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
    expect(body).not.toMatch(/--token/);
  });

  it("입력값을 스크립트에 직접 끼워 넣지 않는다(환경 변수 TARGET 으로만)", () => {
    const runBlocks = body.split(/\n\s+- /).filter((s) => /run:/.test(s));
    for (const block of runBlocks) expect(block).not.toMatch(/\$\{\{\s*(inputs|github\.event)/);
  });

  it("Vercel CLI 는 정확한 버전으로 고정한다", () => {
    expect(body).toMatch(/VERCEL_CLI: vercel@\d+\.\d+\.\d+\n/);
    expect(body).not.toMatch(/npx (--yes )?vercel(@latest)?\s/);
  });

  it("배포 전에 verify 를 돈다", () => {
    const verify = body.indexOf("npm run verify");
    const deploy = body.indexOf("deploy --prebuilt");
    expect(verify).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(verify);
  });

  it("배포는 한 번에 하나만 돌고 앞의 배포를 끊지 않는다", () => {
    expect(body).toMatch(/concurrency:\n\s+group: vercel-deploy\n\s+cancel-in-progress: false/);
  });
});
