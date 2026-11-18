import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BACKUP-P2-TABLES-01-R1 (QA-BACKUP-P2-01 W1·W2·W3): psql 컨테이너 기본값 제거.
 * - 운영 대상: SUPABASE_DB_CONTAINER 가 없거나 로컬 스택 컨테이너(supabase_…)면 비밀번호를 넘기기 전에 멈춘다
 * - 로컬 대상: 지정이 없으면 현재 폴더 config.toml 의 project_id 로 정한다(공용 스택 기본값 없음)
 * - 예전 20개 목록 백업은 목록 밖 표의 행을 실패가 아닌 경고로 알린다
 * 합성 값만 쓴다. 실제 실행·접속 없음(spawnSync 는 가짜).
 */
const spawnSync = vi.fn();
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), spawnSync }));

const REF = "abcdefghijklmnopqrst";
const API = `https://${REF}.supabase.co`;
const SECRET = "SYNTH-pw-9q!";
const POOLER = `postgresql://postgres.${REF}:${encodeURIComponent(SECRET)}@aws-0-x.pooler.supabase.com:5432/postgres`;

async function load() {
  vi.resetModules();
  return import("../../scripts/backup/common.mts");
}
let dir: string;
beforeEach(() => {
  spawnSync.mockReset();
  spawnSync.mockReturnValue({ status: 0, stdout: "public_table\n", stderr: "" });
  dir = mkdtempSync(join(tmpdir(), "backup-container-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
const stubRemote = (container?: string) => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", API);
  vi.stubEnv("BACKUP_DB_URL", POOLER);
  vi.stubEnv("SUPABASE_SECRET_KEY", "SYNTH-service-key");
  vi.stubEnv("SUPABASE_DB_CONTAINER", container ?? "");
};
const leaked = () =>
  spawnSync.mock.calls.some(([cmd, args, opts]) => [cmd, ...(args as string[])].some((a) => String(a).includes(SECRET)) || String(opts?.input ?? "").includes(SECRET));

describe("운영 대상: 전용 클라이언트 컨테이너 필수", () => {
  it.each([
    ["지정 없음", undefined, /SUPABASE_DB_CONTAINER\(전용 psql 클라이언트 컨테이너\)를 지정해야/],
    ["예전 기본값(공용 스택)", "supabase_db_marketing-office", /로컬 Supabase 스택 컨테이너\(supabase_db_marketing-office\)는 쓸 수 없습니다/],
    ["다른 로컬 스택", "supabase_db_claude-tester-e2e-20261118", /로컬 Supabase 스택 컨테이너/],
  ])("%s → psql·표 목록 모두 실행 전에 멈추고, 비밀번호는 어디에도 넘어가지 않는다", async (_n, container, msg) => {
    stubRemote(container);
    const { psql, listDbTables } = await load();
    let err1 = "", err2 = "";
    try { psql("select 1;"); } catch (e) { err1 = (e as Error).message; }
    try { listDbTables(); } catch (e) { err2 = (e as Error).message; }
    expect(err1).toMatch(msg);
    expect(err2).toMatch(msg);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(leaked()).toBe(false);
    expect(`${err1}${err2}`).not.toContain(SECRET);
  });

  it("전용 클라이언트(스택 라벨 없음)를 지정하면 라벨 확인 뒤 그 컨테이너로 실행하고, 비밀번호는 표준 입력으로만 넘긴다", async () => {
    stubRemote("claude-backup-client-test");
    spawnSync.mockImplementation((_cmd, args: string[]) => ({ status: 0, stdout: args[0] === "inspect" ? "<no value>\n" : "ok", stderr: "" }));
    const { psql } = await load();
    psql("select 1;");
    const [inspect, exec] = spawnSync.mock.calls;
    expect(inspect[1]).toEqual(["inspect", "--format", '{{index .Config.Labels "com.supabase.cli.project"}}', "claude-backup-client-test"]);
    expect(inspect[2]?.input ?? "").toBe("");
    expect(exec[0]).toBe("docker");
    expect((exec[1] as string[]).slice(0, 3)).toEqual(["exec", "-i", "claude-backup-client-test"]);
    expect((exec[1] as string[]).some((a) => a.includes(SECRET))).toBe(false);
    expect(String(exec[2].input).startsWith(`${SECRET}\n`)).toBe(true);
  });

  it.each([
    ["'/이름' 형태", "/supabase_db_marketing-office", null],
    ["컨테이너 ID 형태(라벨이 공용 스택)", "3f9a1c0d2b7e", "marketing-office"],
    ["다른 이름이지만 라벨이 스택", "my-client", "claude-tester-e2e-20261118"],
  ])("R2: %s → 실행(exec) 없이 멈추고 비밀번호는 넘어가지 않는다", async (_n, container, label) => {
    stubRemote(container);
    spawnSync.mockImplementation((_cmd, args: string[]) => ({ status: 0, stdout: args[0] === "inspect" ? `${label}\n` : "ok", stderr: "" }));
    const { psql } = await load();
    expect(() => psql("select 1;")).toThrow(/로컬 Supabase 스택 컨테이너/);
    expect(spawnSync.mock.calls.some(([, args]) => (args as string[])[0] === "exec")).toBe(false);
    expect(leaked()).toBe(false);
  });

  it("R2: 컨테이너가 없으면(inspect 실패) 멈추고 비밀번호는 넘어가지 않는다", async () => {
    stubRemote("claude-backup-client-missing");
    spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "No such object" });
    const { psql } = await load();
    expect(() => psql("select 1;")).toThrow(/컨테이너\(claude-backup-client-missing\)를 찾을 수 없습니다/);
    expect(leaked()).toBe(false);
  });
});

describe("로컬 대상: 공용 기본값 없음", () => {
  it("지정이 없으면 현재 폴더 config.toml 의 project_id 로 정한다", async () => {
    mkdirSync(join(dir, "supabase"));
    writeFileSync(join(dir, "supabase", "config.toml"), 'project_id = "claude-backup-p2-20261119"\n[api]\nport = 1\n');
    const { dbContainer, localProjectId, configApiPort } = await load();
    expect(localProjectId(dir)).toBe("claude-backup-p2-20261119");
    expect(configApiPort(dir)).toBe(1);
    expect(dbContainer("local", { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1" }, dir)).toBe("supabase_db_claude-backup-p2-20261119");
  });

  it("R2: config 로 정할 때 API 주소 포트가 그 프로젝트 API 포트와 다르면 멈춘다(예: .env.local 이 공용 54321)", async () => {
    mkdirSync(join(dir, "supabase"));
    writeFileSync(join(dir, "supabase", "config.toml"), 'project_id = "claude-x"\n[api]\nenabled = true\nport = 58101\n[db]\nport = 58102\n');
    const { dbContainer, configApiPort } = await load();
    expect(configApiPort(dir)).toBe(58101); // [db] port 가 아니라 [api] port
    expect(() => dbContainer("local", { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, dir)).toThrow(/API 주소 포트\(54321\)가 현재 폴더 프로젝트\(claude-x\)의 API 포트\(58101\)와 다릅니다/);
  });

  it("지정도 config.toml 도 없으면 멈춘다", async () => {
    const { dbContainer } = await load();
    expect(() => dbContainer("local", {}, dir)).toThrow(/컨테이너를 정할 수 없어 멈춥니다/);
  });

  it("지정하면 그대로 쓴다", async () => {
    const { dbContainer } = await load();
    expect(dbContainer("local", { SUPABASE_DB_CONTAINER: "supabase_db_claude-qa" }, dir)).toBe("supabase_db_claude-qa");
  });
});

describe("예전 목록 백업 구분(W2)", () => {
  const now = { workspaces: 1, templates: 3, signup_allowlist: 1, funnels: 0 };
  it("예전 20개 목록 백업: 목록 밖 표의 행은 경고(실패 아님)", async () => {
    const { compareCounts } = await load();
    const r = compareCounts({ counts: { workspaces: 1 } }, now);
    expect(r.problems).toEqual([]);
    expect(r.warning).toMatch(/예전 목록 백업입니다\(행 수 목록 1개 표\)/);
    expect(r.warning).toContain("templates 3행");
    expect(r.warning).toContain("signup_allowlist 1행");
    expect(r.warning).not.toContain("funnels");
  });
  it("새 판 백업: 목록 밖 표에 행이 있으면 실패, 경고 없음", async () => {
    const { compareCounts, TABLE_LIST_VERSION } = await load();
    const r = compareCounts({ counts: { workspaces: 1, funnels: 0 }, tableListVersion: TABLE_LIST_VERSION }, now);
    expect(r.warning).toBeNull();
    expect(r.problems).toEqual(["백업 목록에 없는 표에 행이 있음 templates: 3행", "백업 목록에 없는 표에 행이 있음 signup_allowlist: 1행"]);
  });
  it("두 판 모두: 행 수 불일치와 사라진 표는 실패", async () => {
    const { compareCounts } = await load();
    const r = compareCounts({ counts: { workspaces: 2, quotes: 0 } }, now);
    expect(r.problems).toEqual(["행 수 불일치 workspaces: 백업 2 / 복원 1", "백업에 있던 표가 지금 DB에 없음 quotes(백업 0행)"]);
  });
});
