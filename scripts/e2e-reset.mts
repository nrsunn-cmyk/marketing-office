/**
 * RESET-SAFETY-01: `npm run e2e:reset` 안전 래퍼.
 *
 * 예전 명령 `supabase db reset && node --env-file=.env.local scripts/create-owner.mts …` 은
 * 현재 폴더(또는 상위 폴더)의 supabase/config.toml 이 가리키는 스택을 확인 없이 초기화했다.
 * 원본 저장소에서 실행하면 공유 `marketing-office` 스택(5432x) DB 를 지울 수 있었다.
 *
 * 이 래퍼는 아래를 모두 통과해야만 실행한다(하나라도 틀리면 아무 명령도 실행하지 않는다):
 *  1) 실행 폴더(cwd)에 supabase/config.toml 이 있다. 초기화는 `--workdir <그 폴더>` 로 고정한다(상위 폴더 탐색 금지).
 *  2) E2E_SUPABASE_PROJECT_ID 를 명시했고 설정 project_id 와 같으며 공유(marketing-office)가 아니다.
 *  3) 설정의 [db]·[api]·메일 포트가 공유 543xx 가 아니다.
 *  4) create-owner 가 쓸 NEXT_PUBLIC_SUPABASE_URL(.env.local)이 로컬 http 이고 [api].port 와 같다.
 *  5) 그 project_id 의 실제 컨테이너 supabase_db_<id>(5432/tcp)·supabase_kong_<id>(8000/tcp)가 설정 포트를 열고 있다.
 * 통과하면 원래 기능 그대로 실행한다: supabase db reset → create-owner(본인 시험 계정).
 * 명령은 셸 문자열이 아니라 인자 배열로 실행한다(shell: false). `--remote`·`--db-url` 은 절대 붙이지 않는다.
 * 비밀값(.env.local 의 키)은 출력하지 않는다.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  checkResetContainers,
  checkResetEnv,
  dockerPortLookup,
  parseStackConfig,
  type PortLookup,
  type StackConfig,
} from "../tests/e2e/stack-guard.ts";

export const OWNER_EMAIL = "owner@marketing-office.test";
/** 로컬 시험 DB 전용 값(tests/e2e/helpers.ts 의 OWNER_PASSWORD 와 같다) */
export const OWNER_PASSWORD = "Owner-test-1234";

export type Env = Record<string, string | undefined>;
export interface Step {
  command: string;
  args: string[];
  cwd: string;
}
export interface ResetDeps {
  env: Env;
  cwd: string;
  readConfig: (workdir: string) => string;
  lookup: PortLookup;
  run: (step: Step) => number;
  execPath: string;
}

/** 확인만 한다(부작용 없음). 통과하면 실행할 단계 목록을 돌려준다. */
export function planReset(deps: Pick<ResetDeps, "env" | "cwd" | "readConfig" | "lookup" | "execPath">): { config: StackConfig; steps: Step[] } {
  const workdir = resolve(deps.cwd);
  let toml: string;
  try {
    toml = deps.readConfig(workdir);
  } catch {
    throw new Error(`실행 폴더에 supabase/config.toml 이 없습니다: ${workdir}. 시험 스택 폴더에서 실행해야 합니다.`);
  }
  const config = parseStackConfig(toml);
  checkResetEnv(deps.env, config);
  checkResetContainers(config, deps.lookup);
  return {
    config,
    steps: [
      { command: "supabase", args: ["db", "reset", "--workdir", workdir], cwd: workdir },
      {
        command: deps.execPath,
        args: ["--env-file=.env.local", "scripts/create-owner.mts", OWNER_EMAIL, "--password", OWNER_PASSWORD],
        cwd: workdir,
      },
    ],
  };
}

/** 확인 → 단계를 차례로 실행. 한 단계라도 실패하면 다음 단계는 실행하지 않는다. 성공한 단계 수를 돌려준다. */
export function runReset(deps: ResetDeps): number {
  const { config, steps } = planReset(deps);
  console.log(`[e2e:reset 사전 확인] 시험 스택 ${config.projectId} · DB ${config.dbPort} · API ${config.apiPort} 확인 → 초기화합니다`);
  let done = 0;
  for (const step of steps) {
    const code = deps.run(step);
    if (code !== 0) throw new Error(`${step.command} ${step.args[0] ?? ""} 실패(종료코드 ${code}). 다음 단계는 실행하지 않았습니다.`);
    done += 1;
  }
  return done;
}

/** 실제 실행용 run: 셸 없이 인자 배열로 실행하고 출력은 그대로 보여 준다. */
export function spawnStep(step: Step): number {
  const r = spawnSync(step.command, step.args, { cwd: step.cwd, stdio: "inherit", shell: false });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

if (import.meta.main) {
  const cwd = process.cwd();
  // create-owner 와 같은 .env.local 의 API 주소로 확인한다(값은 출력하지 않는다)
  const envFile = join(cwd, ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  try {
    runReset({
      env: process.env,
      cwd,
      readConfig: (workdir) => readFileSync(join(workdir, "supabase", "config.toml"), "utf8"),
      lookup: dockerPortLookup,
      run: spawnStep,
      execPath: process.execPath,
    });
  } catch (e) {
    console.error(`[e2e:reset] 중단: ${(e as Error).message}`);
    process.exit(1);
  }
}
