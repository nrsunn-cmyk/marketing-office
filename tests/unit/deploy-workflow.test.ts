import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DEPLOY-ACTIONS-01(-R1·R2): 운영 배포 워크플로의 안전 장치가 빠지지 않게 지킨다.
 * 배포 경로를 바꾸는 변경이므로, 아래 조건을 바꾸려면 이 시험도 함께 고치고 Master 확인을 받는다.
 * Tester QA-DEPLOY-ACTIONS-01 의 우회 변형(짧은 토큰 인자, 토큰 출력, `|| true`, write-all,
 * persist-credentials 옮기기, 판 없는 npx, @latest, `${{ }}` 끼워 넣기, 태그 고정 등)을 잡도록 짰다.
 * R2: Vercel CLI 는 앱 의존성과 떼어 tools/vercel-cli 에 둔다.
 */
const root = process.cwd();
const wf = readFileSync(join(root, ".github/workflows/vercel-deploy.yml"), "utf8").replace(/\r\n/g, "\n");
// 주석 줄을 뺀 실제 설정만 본다(줄 끝 주석은 남는다: uses 옆 태그 주석)
const lines = wf.split("\n").filter((l) => !l.trimStart().startsWith("#"));
const body = lines.join("\n");
const readJson = (rel: string) => JSON.parse(readFileSync(join(root, rel), "utf8"));

const indent = (l: string) => l.length - l.trimStart().length;

type Step = { text: string; name: string; uses: string; run: string; envKeys: string[]; envText: string; withText: string };

/** jobs.deploy.steps 를 단계별로 나눈다(6칸 들여쓰기의 "- " 가 단계 시작) */
function parseSteps(): { jobHead: string; steps: Step[] } {
  const start = lines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  expect(start, "steps: 를 찾지 못함").toBeGreaterThan(-1);
  const jobStart = lines.findIndex((l) => /^ {2}deploy:\s*$/.test(l));
  const jobHead = lines.slice(jobStart, start).join("\n");
  const chunks: string[][] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() === "") {
      chunks.at(-1)?.push(l);
      continue;
    }
    if (indent(l) < 6) break;
    if (/^ {6}- /.test(l)) chunks.push([l.replace(/^ {6}- /, "        ")]);
    else chunks.at(-1)?.push(l);
  }
  const block = (c: string[], key: string) => {
    const i = c.findIndex((l) => new RegExp(`^ {8}${key}:`).test(l));
    if (i < 0) return "";
    const inline = c[i].replace(new RegExp(`^ {8}${key}:\\s*`), "");
    const rest: string[] = [];
    for (const l of c.slice(i + 1)) {
      if (l.trim() !== "" && indent(l) <= 8) break;
      rest.push(l);
    }
    return [inline === "|" ? "" : inline, ...rest].join("\n").trim();
  };
  const steps = chunks.map((c) => {
    const envText = block(c, "env");
    return {
      text: c.join("\n"),
      name: block(c, "name"),
      uses: block(c, "uses"),
      run: block(c, "run"),
      envText,
      envKeys: [...envText.matchAll(/^\s*([A-Z_]+):/gm)].map((m) => m[1]),
      withText: block(c, "with"),
    };
  });
  return { jobHead, steps };
}

const { jobHead, steps } = parseSteps();
const runs = steps.filter((s) => s.run);
const TOKEN_KEYS = ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"];
const CLI = "./tools/vercel-cli/node_modules/.bin/vercel";
const TOOL_INSTALL = "npm ci --prefix tools/vercel-cli --ignore-scripts";
const TOOL_CHECK = `${CLI} --version`;
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const CLI_CMD = new RegExp(`${escapeRe(CLI)} (pull|build|deploy)\\b`);
/** 토큰을 쓰는 Vercel 단계(pull·build·deploy) */
const isVercelStep = (s: Step) => CLI_CMD.test(s.run);
const isCheckStep = (s: Step) => s.name === "비밀값 3개와 배포 대상 확인";

describe("운영 배포 워크플로(vercel-deploy.yml)", () => {
  it("단계를 제대로 읽었다(시험 자체 점검)", () => {
    expect(steps.length).toBe(10);
    expect(steps.filter(isVercelStep)).toHaveLength(3);
    expect(steps.filter(isCheckStep)).toHaveLength(1);
  });

  it("수동 실행만 받는다(push·PR로는 돌지 않는다)", () => {
    const on = body.match(/^on:\n([\s\S]*?)^\S/m)?.[1] ?? "";
    expect(on).toMatch(/^\s{2}workflow_dispatch:/m);
    expect(on.match(/^ {2}\S/gm)).toHaveLength(1);
  });

  it("main 브랜치에서만 배포한다: if 는 job 에 정확히 하나, 그 식 그대로", () => {
    const ifs = lines.filter((l) => /^\s*if:/.test(l));
    expect(ifs).toEqual(["    if: github.ref == 'refs/heads/main'"]);
  });

  it("job 은 Environment production 을 거친다(다른 브랜치 워크플로가 Secret 을 받지 못하게)", () => {
    expect(jobHead).toMatch(/^ {4}environment: production$/m);
  });

  it("저장소 권한은 맨 위 contents: read 하나뿐이고 쓰기 권한이 없다", () => {
    expect(body.match(/permissions:/g)).toHaveLength(1);
    expect(body).toMatch(/^permissions:\n {2}contents: read\n(?![ \t])/m);
    expect(body).not.toMatch(/write/);
  });

  it("checkout 단계가 자격 증명을 남기지 않는다", () => {
    const co = steps.filter((s) => s.uses.startsWith("actions/checkout@"));
    expect(co).toHaveLength(1);
    expect(co[0].withText).toMatch(/^persist-credentials: false$/m);
    expect(body.match(/persist-credentials/g)).toHaveLength(1);
  });

  it("액션은 40자 커밋 SHA 로 고정하고 옆에 태그 주석을 단다", () => {
    const uses = steps.filter((s) => s.uses).map((s) => s.uses);
    expect(uses.length).toBeGreaterThanOrEqual(2);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    expect(body.match(/uses:/g)).toHaveLength(uses.length);
  });

  it("토큰 3개는 job env 에 없고, 확인 단계와 Vercel 세 단계의 step env 에만 있다", () => {
    expect(jobHead).not.toMatch(/secrets\./);
    for (const s of steps) {
      const hasSecret = /secrets\./.test(s.text);
      if (isVercelStep(s) || isCheckStep(s)) {
        expect(s.envKeys.sort(), s.name).toEqual([...TOKEN_KEYS].sort());
        for (const k of TOKEN_KEYS) expect(s.envText).toContain(`${k}: \${{ secrets.${k} }}`);
      } else {
        expect(hasSecret, `${s.name} 에 비밀값이 있음`).toBe(false);
      }
    }
    const allowed = steps.filter((s) => isVercelStep(s) || isCheckStep(s)).length * 3;
    expect(body.match(/secrets\./g)).toHaveLength(allowed);
  });

  it("run 안에서 토큰 변수를 쓰는 곳은 '비어 있는지 확인' 한 줄뿐이다(출력·인자 금지)", () => {
    for (const s of runs) {
      for (const l of s.run.split("\n")) {
        if (!/VERCEL_TOKEN/.test(l)) continue;
        expect(isCheckStep(s) && /^\s*\[ -n "\$VERCEL_TOKEN" \] \|\| missing=/.test(l), `${s.name}: ${l}`).toBe(true);
      }
      expect(s.run, s.name).not.toMatch(/(^|\s)(-t|--token)(\s|=|$)/m);
    }
    expect(body).not.toMatch(/--token/);
  });

  it("run 안에 ${{ }} 식을 끼워 넣지 않는다(입력값·이벤트 값은 환경 변수로만)", () => {
    for (const s of runs) expect(s.run, s.name).not.toMatch(/\$\{\{/);
  });

  it("실패를 덮는 장치(|| true, || :, continue-on-error)가 없다", () => {
    for (const s of runs) expect(s.run, s.name).not.toMatch(/\|\|\s*(true|:)\s*$/m);
    expect(body).not.toMatch(/continue-on-error/);
  });

  it("Vercel CLI 는 tools/vercel-cli 잠금 파일에 고정된 판을 그 경로에서만 부른다(npx·따로 설치 금지)", () => {
    for (const s of runs) {
      for (const l of s.run.split("\n")) {
        if (!/vercel/.test(l) || /::error::/.test(l)) continue;
        const ok = l.trim() === TOOL_INSTALL || l.trim() === TOOL_CHECK || CLI_CMD.test(l);
        expect(ok, `${s.name}: ${l}`).toBe(true);
      }
      expect(s.run, s.name).not.toMatch(/\bnpx\b|\bnpm (exec|install|i|add)\b/);
    }
    expect(body).not.toMatch(/@latest|vercel@/);
    const tool = readJson("tools/vercel-cli/package.json");
    expect(tool.dependencies.vercel).toMatch(/^\d+\.\d+\.\d+$/);
    const v = readJson("tools/vercel-cli/package-lock.json").packages["node_modules/vercel"];
    expect(v.version).toBe(tool.dependencies.vercel);
    expect(v.integrity).toMatch(/^sha512-/);
  });

  it("앱 의존성에는 vercel CLI 가 없다(앱 설치·Vercel 자체 빌드에 끼지 않게, R2)", () => {
    const app = readJson("package.json");
    expect({ ...app.dependencies, ...app.devDependencies }).not.toHaveProperty("vercel");
    expect(readJson("package-lock.json").packages).not.toHaveProperty(["node_modules/vercel"]);
  });

  it("도구 설치·동작 확인 단계에는 토큰이 없고, 설치 스크립트를 돌리지 않는다", () => {
    const install = steps.filter((s) => s.run === TOOL_INSTALL);
    const check = steps.filter((s) => s.run === TOOL_CHECK);
    expect(install).toHaveLength(1);
    expect(check).toHaveLength(1);
    for (const s of [...install, ...check]) {
      expect(s.envText, s.name).toBe("");
      expect(s.text, s.name).not.toMatch(/secrets\.|VERCEL_TOKEN/);
    }
  });

  it("설치 → 시험 → 도구 설치 → 도구 확인 → Vercel 단계 순서이고, 시험을 건너뛰지 않는다", () => {
    const at = (pred: (s: Step) => boolean) => steps.findIndex(pred);
    const order = [
      at((s) => s.run === "npm ci"),
      at((s) => s.run === "npm run verify"),
      at((s) => s.run === TOOL_INSTALL),
      at((s) => s.run === TOOL_CHECK),
      at(isVercelStep),
    ];
    expect(order[0]).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i++) expect(order[i], `순서 ${i}`).toBeGreaterThan(order[i - 1]);
    expect(steps[order[1]].text).not.toMatch(/^\s*if:/m);
  });

  it("배포는 한 번에 하나만 돌고 앞의 배포를 끊지 않는다", () => {
    expect(body).toMatch(/concurrency:\n\s+group: vercel-deploy\n\s+cancel-in-progress: false/);
  });
});
