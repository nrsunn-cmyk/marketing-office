/**
 * MAIL-SAFETY-01: E2E 가 "자기 전용 시험 스택"에만 붙도록 네트워크를 쓰기 전에 확인한다.
 * (사고: 기본값 http://127.0.0.1:54324 때문에 공유 marketing-office 스택의 Mailpit 에 메일함 전체 삭제가 나갔다.)
 *
 * 원칙
 * - 기본 주소를 두지 않는다. E2E_SUPABASE_PROJECT_ID·NEXT_PUBLIC_SUPABASE_URL·E2E_MAILPIT_URL·E2E_BASE_URL 을 명시해야 한다.
 * - 로컬(127.0.0.1·localhost) http 만 허용한다. 자격증명·query·hash 가 붙은 애매한 주소는 거절한다.
 * - 공유 스택(project_id "marketing-office", 포트 54320~54329)은 거절한다.
 * - 포트가 다르다는 것만으로 "내 스택"이라고 보지 않는다. 실제 시험 스택 설정(supabase/config.toml 의
 *   project_id·[api].port·[local_smtp].port·[auth].site_url)과 맞아야 하고,
 *   그 project_id 의 Docker 컨테이너가 실제로 그 포트를 열고 있어야 한다.
 * - playwright.config.ts 가 설정을 읽는 단계에서 preflight() 를 부른다(webServer·시험보다 먼저).
 * 이 파일은 Playwright 를 가져오지 않는 순수 함수 모음이라 단위 시험(tests/unit)에서 검사한다.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const SHARED_PROJECT_IDS: readonly string[] = ["marketing-office"];
export const SHARED_PORTS: readonly number[] = Array.from({ length: 10 }, (_, i) => 54320 + i);

export interface StackConfig {
  projectId: string;
  apiPort: number;
  inbucketPort: number;
  /** [db].port (로컬 Postgres). e2e:reset 이 초기화하는 DB 포트 */
  dbPort: number;
  /** [auth].site_url (앱 주소). 메일 링크가 이 주소로 돌아온다. */
  siteUrl: string;
}

/** supabase/config.toml 에서 필요한 다섯 값만 읽는다(단순 해석). */
export function parseStackConfig(toml: string): StackConfig {
  let section = "";
  let projectId = "";
  let apiPort = NaN;
  let inbucketPort = NaN;
  let dbPort = NaN;
  let siteUrl = "";
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").replace(/^#.*$/, "").trim();
    if (!line) continue;
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) {
      section = sec[1]!.trim();
      continue;
    }
    const kv = /^([A-Za-z_]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    const str = value!.replace(/^"|"$/g, "");
    if (section === "" && key === "project_id") projectId = str;
    if (section === "api" && key === "port") apiPort = Number(value);
    if (section === "db" && key === "port") dbPort = Number(value);
    // 메일함(Mailpit) 웹 포트: 현재 CLI 는 [local_smtp], 예전 CLI 는 [inbucket]
    if ((section === "local_smtp" || section === "inbucket") && key === "port") inbucketPort = Number(value);
    if (section === "auth" && key === "site_url") siteUrl = str;
  }
  if (!projectId || !Number.isInteger(apiPort) || !Number.isInteger(dbPort) || !Number.isInteger(inbucketPort) || !siteUrl) {
    throw new Error("시험 스택 설정(supabase/config.toml)에서 project_id·[api].port·[db].port·[local_smtp](또는 [inbucket]).port·[auth].site_url 을 읽지 못했습니다.");
  }
  return { projectId, apiPort, dbPort, inbucketPort, siteUrl };
}

export function readStackConfig(cwd = process.cwd()): StackConfig {
  return parseStackConfig(readFileSync(join(cwd, "supabase", "config.toml"), "utf8"));
}

type Env = Record<string, string | undefined>;

/** 로컬 http 주소인지, 애매한 부분(자격증명·query·hash)이 없는지, 공유 포트가 아닌지, 기대 포트와 같은지 확인한다. */
function checkLocalUrl(name: string, raw: string | undefined, expectedPort: number): URL {
  if (!raw) throw new Error(`${name} 가 없습니다. 자기 전용 시험 스택 주소를 명시해야 합니다(기본값 없음).`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} 주소 형식이 틀립니다.`);
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(`${name} 는 로컬 http 주소여야 합니다(원격·운영 주소 거절).`);
  }
  if (url.username || url.password || url.search || url.hash || raw.includes("?") || raw.includes("#") || raw.includes("@")) {
    throw new Error(`${name} 에 자격증명·query·hash 가 있습니다. 주소만 적어야 합니다.`);
  }
  const port = Number(url.port || "80");
  if (SHARED_PORTS.includes(port)) throw new Error(`${name} 가 공유 스택 포트(${port})를 가리킵니다. 공유 543xx 는 쓰지 않습니다.`);
  if (port !== expectedPort) {
    throw new Error(`${name} 포트(${port})가 시험 스택 설정의 포트(${expectedPort})와 다릅니다.`);
  }
  return url;
}

/** 프로젝트·API·앱 주소를 확인하고, 앱 주소(origin)를 돌려준다. */
export function checkStackEnv(env: Env, cfg: StackConfig): string {
  const id = env.E2E_SUPABASE_PROJECT_ID;
  if (!id) throw new Error("E2E_SUPABASE_PROJECT_ID 가 없습니다. 자기 전용 시험 스택의 project_id 를 명시해야 합니다.");
  if (SHARED_PROJECT_IDS.includes(id) || SHARED_PROJECT_IDS.includes(cfg.projectId)) {
    throw new Error(`공유 스택(project_id ${SHARED_PROJECT_IDS.join(",")})에서는 E2E 를 실행하지 않습니다.`);
  }
  if (id !== cfg.projectId) throw new Error(`E2E_SUPABASE_PROJECT_ID(${id})가 시험 스택 설정(${cfg.projectId})과 다릅니다.`);
  if (SHARED_PORTS.includes(cfg.apiPort) || SHARED_PORTS.includes(cfg.inbucketPort)) {
    throw new Error("시험 스택 설정의 포트가 공유 543xx 범위입니다.");
  }
  checkLocalUrl("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL, cfg.apiPort);

  // 앱 주소: E2E_BASE_URL 을 명시하고, 스택의 auth.site_url 과 같아야 한다(메일 링크가 이 앱으로 돌아온다)
  const site = new URL(cfg.siteUrl);
  const app = checkLocalUrl("E2E_BASE_URL", env.E2E_BASE_URL, Number(site.port || "80"));
  if (app.pathname !== "/") throw new Error("E2E_BASE_URL 은 경로 없이 주소만 적어야 합니다.");
  if (app.origin !== site.origin) throw new Error(`E2E_BASE_URL(${app.origin})이 시험 스택 auth.site_url(${site.origin})과 다릅니다.`);
  if (env.NEXT_PUBLIC_SITE_URL && env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "") !== app.origin) {
    throw new Error(`NEXT_PUBLIC_SITE_URL(${env.NEXT_PUBLIC_SITE_URL})이 E2E_BASE_URL(${app.origin})과 다릅니다.`);
  }
  return app.origin;
}

/** 메일함 API 주소. 위 확인을 모두 통과해야 돌려준다(컨테이너 대조는 preflight 가 함께 한다). */
export function resolveMailpitBase(env: Env, cfg: StackConfig): string {
  checkStackEnv(env, cfg);
  const url = checkLocalUrl("E2E_MAILPIT_URL", env.E2E_MAILPIT_URL, cfg.inbucketPort);
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== "/api/v1") throw new Error("E2E_MAILPIT_URL 은 …/api/v1 로 끝나야 합니다.");
  return `${url.origin}/api/v1`;
}

/** 컨테이너가 연 호스트 포트를 돌려준다(없으면 null). */
export type PortLookup = (container: string, containerPort: string) => number | null;

export const dockerPortLookup: PortLookup = (container, containerPort) => {
  try {
    const out = execFileSync("docker", ["port", container, containerPort], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = /:(\d+)\s*$/m.exec(out.trim().split(/\r?\n/)[0] ?? "");
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
};

/** 그 project_id 의 실제 컨테이너가 설정의 포트를 열고 있는지(설정만 맞고 다른 스택이 그 포트를 쓰는 경우를 거른다). */
export function checkContainers(cfg: StackConfig, lookup: PortLookup): void {
  const pairs: Array<[string, string, number]> = [
    [`supabase_kong_${cfg.projectId}`, "8000/tcp", cfg.apiPort],
    [`supabase_inbucket_${cfg.projectId}`, "8025/tcp", cfg.inbucketPort],
  ];
  for (const [container, inner, expected] of pairs) {
    const actual = lookup(container, inner);
    if (actual === null) throw new Error(`시험 스택 컨테이너 ${container} 를 찾지 못했습니다(스택이 꺼져 있거나 다른 스택).`);
    if (actual !== expected) throw new Error(`${container} 가 연 포트(${actual})가 설정(${expected})과 다릅니다.`);
  }
}

export interface Preflight {
  config: StackConfig;
  baseURL: string;
  mailpitBase: string;
}

/** E2E 시작 전 전체 확인. 네트워크 요청은 하지 않는다(docker 포트 조회만). */
export function preflight(env: Env = process.env, cwd = process.cwd(), lookup: PortLookup = dockerPortLookup): Preflight {
  const config = readStackConfig(cwd);
  const baseURL = checkStackEnv(env, config);
  const mailpitBase = resolveMailpitBase(env, config);
  checkContainers(config, lookup);
  return { config, baseURL, mailpitBase };
}

/**
 * RESET-SAFETY-01: e2e:reset(로컬 DB 초기화) 전용 확인.
 * 초기화는 메일·앱 주소를 쓰지 않으므로 E2E_MAILPIT_URL·E2E_BASE_URL 은 요구하지 않는다.
 * 대신 무엇을 지우는지가 핵심이다: 명시한 project_id = 설정 project_id(공유 아님),
 * [db]·[api]·메일 포트가 공유 543xx 가 아님, create-owner 가 쓸 API 주소(로컬)가 [api].port 와 같음.
 */
export function checkResetEnv(env: Env, cfg: StackConfig): void {
  const id = env.E2E_SUPABASE_PROJECT_ID;
  if (!id) throw new Error("E2E_SUPABASE_PROJECT_ID 가 없습니다. 초기화할 자기 전용 시험 스택의 project_id 를 명시해야 합니다.");
  if (SHARED_PROJECT_IDS.includes(id) || SHARED_PROJECT_IDS.includes(cfg.projectId)) {
    throw new Error(`공유 스택(project_id ${SHARED_PROJECT_IDS.join(",")})은 초기화하지 않습니다.`);
  }
  if (id !== cfg.projectId) throw new Error(`E2E_SUPABASE_PROJECT_ID(${id})가 시험 스택 설정(${cfg.projectId})과 다릅니다.`);
  for (const [name, port] of [["[db].port", cfg.dbPort], ["[api].port", cfg.apiPort], ["메일 포트", cfg.inbucketPort]] as const) {
    if (SHARED_PORTS.includes(port)) throw new Error(`시험 스택 설정의 ${name}(${port})가 공유 543xx 범위입니다. 초기화하지 않습니다.`);
  }
  checkLocalUrl("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL, cfg.apiPort);
}

/** 그 project_id 의 실제 DB·API 컨테이너가 설정 포트를 열고 있는지(설정만 맞고 다른 스택이 그 포트를 쓰는 경우를 거른다). */
export function checkResetContainers(cfg: StackConfig, lookup: PortLookup): void {
  const pairs: Array<[string, string, number]> = [
    [`supabase_db_${cfg.projectId}`, "5432/tcp", cfg.dbPort],
    [`supabase_kong_${cfg.projectId}`, "8000/tcp", cfg.apiPort],
  ];
  for (const [container, inner, expected] of pairs) {
    const actual = lookup(container, inner);
    if (actual === null) throw new Error(`시험 스택 컨테이너 ${container} 를 찾지 못했습니다(스택이 꺼져 있거나 다른 스택). 초기화하지 않습니다.`);
    if (actual !== expected) throw new Error(`${container} 가 연 포트(${actual})가 설정(${expected})과 다릅니다. 초기화하지 않습니다.`);
  }
}
