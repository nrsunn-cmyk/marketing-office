import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * RESET-SAFETY-01: e2e:reset 래퍼가 공유·원격·불일치 대상이면 어떤 명령도 실행하지 않고,
 * 자기 전용 스택일 때만 "supabase db reset --workdir <폴더>" → create-owner 순서로 실행하는지 확인한다.
 * 실제 초기화·스택 기동·DB 접속은 하지 않는다(run·lookup·child_process 는 가짜).
 */
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  spawnSync: vi.fn(() => ({ status: 0, error: undefined })),
}));

import { spawnSync } from "node:child_process";
import { OWNER_EMAIL, OWNER_PASSWORD, planReset, runReset, spawnStep, type ResetDeps, type Step } from "../../scripts/e2e-reset.mts";
import type { PortLookup } from "../e2e/stack-guard";

const OWN_TOML = `
project_id = "claude-qa-test"
[api]
port = 57321
[db]
port = 57322
shadow_port = 57320
[db.pooler]
port = 57329
[local_smtp]
port = 57324
[auth]
site_url = "http://127.0.0.1:4500"
`;
const CWD = "C:/qa/claude-qa-test";
const WORKDIR = resolve(CWD);
const GOOD_ENV = { E2E_SUPABASE_PROJECT_ID: "claude-qa-test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:57321" };
const MATCHING: Record<string, number> = { "supabase_db_claude-qa-test": 57322, "supabase_kong_claude-qa-test": 57321 };

function setup(over: { env?: Record<string, string | undefined>; toml?: string | null; ports?: Record<string, number | null>; codes?: number[] } = {}) {
  const calls: Step[] = [];
  const codes = [...(over.codes ?? [0, 0])];
  const lookup = vi.fn<PortLookup>((c) => (over.ports ?? MATCHING)[c] ?? null);
  const deps: ResetDeps = {
    env: { ...GOOD_ENV, ...(over.env ?? {}) },
    cwd: CWD,
    readConfig: () => {
      if (over.toml === null) throw new Error("ENOENT");
      return over.toml ?? OWN_TOML;
    },
    lookup,
    run: vi.fn((step: Step) => {
      calls.push(step);
      return codes.shift() ?? 0;
    }),
    execPath: "C:/node/node.exe",
  };
  return { deps, calls, lookup };
}

function expectBlocked(over: Parameters<typeof setup>[0], pattern: RegExp) {
  const { deps, calls } = setup(over);
  expect(() => runReset(deps)).toThrow(pattern);
  expect(calls).toHaveLength(0); // reset·create-owner 모두 0회
}

afterEach(() => vi.clearAllMocks());

describe("막혀야 하는 경우: 어떤 명령도 실행하지 않는다", () => {
  it("실행 폴더에 supabase/config.toml 이 없다", () => expectBlocked({ toml: null }, /config\.toml 이 없습니다/));
  it("E2E_SUPABASE_PROJECT_ID 를 명시하지 않았다", () => expectBlocked({ env: { E2E_SUPABASE_PROJECT_ID: undefined } }, /E2E_SUPABASE_PROJECT_ID 가 없습니다/));
  it("명시한 project_id 가 설정과 다르다", () => expectBlocked({ env: { E2E_SUPABASE_PROJECT_ID: "someone-else" } }, /설정\(claude-qa-test\)과 다릅니다/));

  it("공유 스택 설정(marketing-office, 5432x)이면 project_id 를 맞춰도 거절하고 컨테이너 조회도 하지 않는다", () => {
    const shared = OWN_TOML.replace("claude-qa-test", "marketing-office").replaceAll("573", "543");
    const { deps, calls, lookup } = setup({ toml: shared, env: { E2E_SUPABASE_PROJECT_ID: "marketing-office", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" } });
    expect(() => runReset(deps)).toThrow(/공유 스택/);
    expect(calls).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("자기 project_id 여도 [db].port 가 공유 543xx 면 거절", () =>
    expectBlocked({ toml: OWN_TOML.replace("port = 57322", "port = 54322") }, /\[db\]\.port\(54322\)가 공유 543xx/));
  it("[api].port 가 공유 543xx 면 거절", () =>
    expectBlocked({ toml: OWN_TOML.replace("port = 57321", "port = 54321"), env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" } }, /\[api\]\.port\(54321\)가 공유 543xx/));

  it.each([
    ["API 주소 없음", undefined, /NEXT_PUBLIC_SUPABASE_URL 가 없습니다/],
    ["API 원격(운영)", "https://abc.supabase.co", /로컬 http/],
    ["API 공유 포트", "http://127.0.0.1:54321", /공유 스택 포트/],
    ["API 설정과 다른 포트", "http://127.0.0.1:57399", /설정의 포트\(57321\)와 다릅니다/],
    ["API 자격증명 포함", "http://u:p@127.0.0.1:57321", /자격증명·query·hash/],
  ])("%s → 거절", (_n, url, pattern) => expectBlocked({ env: { NEXT_PUBLIC_SUPABASE_URL: url } }, pattern));

  it("그 project_id 의 DB 컨테이너가 없으면(꺼짐·다른 스택) 거절", () => expectBlocked({ ports: { "supabase_kong_claude-qa-test": 57321 } }, /supabase_db_claude-qa-test 를 찾지 못했습니다/));
  it("DB 컨테이너가 다른 포트(공유 54322)를 열고 있으면 거절", () =>
    expectBlocked({ ports: { ...MATCHING, "supabase_db_claude-qa-test": 54322 } }, /설정\(57322\)과 다릅니다/));
  it("API 컨테이너가 다른 포트를 열고 있으면 거절", () =>
    expectBlocked({ ports: { ...MATCHING, "supabase_kong_claude-qa-test": 54321 } }, /설정\(57321\)과 다릅니다/));

  it("이 저장소(원본 설정 = 공유 marketing-office)에서 실제 설정 파일로 실행해도 거절", () => {
    const { deps, calls } = setup({ env: { E2E_SUPABASE_PROJECT_ID: "marketing-office", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" } });
    deps.cwd = process.cwd();
    deps.readConfig = (w) => readFileSync(join(w, "supabase", "config.toml"), "utf8");
    expect(() => runReset(deps)).toThrow(/공유 스택/);
    expect(calls).toHaveLength(0);
  });
});

describe("자기 전용 스택: 원래 기능을 정해진 순서·인자로", () => {
  it("supabase db reset --workdir <확인한 폴더> → create-owner, 원격 옵션 없음", () => {
    const { deps, calls, lookup } = setup();
    expect(runReset(deps)).toBe(2);
    expect(lookup).toHaveBeenCalledWith("supabase_db_claude-qa-test", "5432/tcp");
    expect(lookup).toHaveBeenCalledWith("supabase_kong_claude-qa-test", "8000/tcp");
    expect(calls).toEqual([
      { command: "supabase", args: ["db", "reset", "--workdir", WORKDIR], cwd: WORKDIR },
      { command: "C:/node/node.exe", args: ["--env-file=.env.local", "scripts/create-owner.mts", OWNER_EMAIL, "--password", OWNER_PASSWORD], cwd: WORKDIR },
    ]);
    const allArgs = calls.flatMap((c) => c.args);
    expect(allArgs.some((a) => /^--(remote|db-url|linked)/.test(a))).toBe(false);
  });

  it("초기화가 실패하면 create-owner 는 실행하지 않는다", () => {
    const { deps, calls } = setup({ codes: [1] });
    expect(() => runReset(deps)).toThrow(/supabase db 실패\(종료코드 1\)/);
    expect(calls.map((c) => c.args[0])).toEqual(["db"]);
  });

  it("create-owner 가 실패하면 실패로 알린다(초기화는 1회만)", () => {
    const { deps, calls } = setup({ codes: [0, 2] });
    expect(() => runReset(deps)).toThrow(/종료코드 2/);
    expect(calls).toHaveLength(2);
  });

  it("planReset 은 확인만 하고 실행하지 않는다", () => {
    const { deps, calls } = setup();
    const plan = planReset(deps);
    expect(plan.config.dbPort).toBe(57322);
    expect(plan.steps).toHaveLength(2);
    expect(calls).toHaveLength(0);
  });
});

describe("실행 방식", () => {
  it("spawnStep 은 셸 없이 인자 배열로 실행한다(shell: false)", () => {
    const step: Step = { command: "supabase", args: ["db", "reset", "--workdir", WORKDIR], cwd: WORKDIR };
    expect(spawnStep(step)).toBe(0);
    expect(spawnSync).toHaveBeenCalledWith("supabase", ["db", "reset", "--workdir", WORKDIR], { cwd: WORKDIR, stdio: "inherit", shell: false });
  });

  it("package.json 의 e2e:reset 은 래퍼만 부른다(확인 없는 supabase db reset 직접 실행 없음)", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["e2e:reset"]).toBe("node scripts/e2e-reset.mts");
    expect(Object.values(pkg.scripts).some((s) => /supabase db reset/.test(s))).toBe(false);
  });
});
