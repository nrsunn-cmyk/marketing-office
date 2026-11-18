import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BACKUP-SECRET-01: 운영 DB 연결 주소의 비밀번호가 명령 인자(argv)·오류 메시지에 들어가지 않고,
 * 덤프는 자식 환경의 PGPASSWORD, psql 은 표준 입력 첫 줄로만 넘어가는지 확인한다.
 * 합성 값만 쓴다(존재하지 않는 호스트, 가짜 비밀번호). 실제 실행·DB 접속 없음(spawnSync 는 가짜).
 */
const spawnSync = vi.fn();
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), spawnSync }));

const REF = "abcdefghijklmnopqrst";
const API = `https://${REF}.supabase.co`;
const SECRET = "SYNTH'p@ss/w\\rd:7c1"; // 따옴표·@·/·역슬래시·콜론 섞인 합성 비밀
const ENC = encodeURIComponent(SECRET);
const DIRECT = `postgresql://postgres:${ENC}@db.${REF}.supabase.co:5432/postgres`;
const POOLER = `postgresql://postgres.${REF}:${ENC}@aws-0-x.pooler.supabase.com:5432/postgres?sslmode=require`;

type Call = { cmd: string; args: string[]; opts: { input?: string; env?: NodeJS.ProcessEnv } };
const calls = (): Call[] => spawnSync.mock.calls.map(([cmd, args, opts]) => ({ cmd, args, opts }));
const leaks = (c: Call) => [c.cmd, ...c.args].some((a) => a.includes(SECRET) || a.includes(ENC) || a.includes("SYNTH"));

async function load() {
  vi.resetModules();
  return import("../../scripts/backup/common.mts");
}

beforeEach(() => {
  spawnSync.mockReset();
  spawnSync.mockReturnValue({ status: 0, stdout: "ok", stderr: "" });
});
afterEach(() => vi.unstubAllEnvs());

describe("splitDbUrl", () => {
  it("직접 연결: 비밀번호를 뺀 URL·디코드한 비밀번호·비밀번호 없는 접속 문자열", async () => {
    const { splitDbUrl } = await load();
    const p = splitDbUrl(DIRECT);
    expect(p.password).toBe(SECRET);
    expect(p.redactedUrl).toBe(`postgresql://postgres@db.${REF}.supabase.co:5432/postgres`);
    expect(p.conninfo).toBe(`host='db.${REF}.supabase.co' port='5432' user='postgres' dbname='postgres'`);
    expect(`${p.redactedUrl} ${p.conninfo}`).not.toContain("SYNTH");
  });

  it("pooler + sslmode: 사용자 postgres.<ref>, sslmode 는 접속 문자열에 그대로", async () => {
    const { splitDbUrl } = await load();
    const p = splitDbUrl(POOLER);
    expect(p.redactedUrl).toBe(`postgresql://postgres.${REF}@aws-0-x.pooler.supabase.com:5432/postgres?sslmode=require`);
    expect(p.conninfo).toContain(`user='postgres.${REF}'`);
    expect(p.conninfo).toContain(`sslmode='require'`);
    expect(p.conninfo).not.toContain("SYNTH");
  });

  it("접속 문자열 값의 따옴표·역슬래시는 libpq 규칙으로 감싼다", async () => {
    const { splitDbUrl } = await load();
    const p = splitDbUrl(`postgresql://o'k:pw@h.invalid:5432/d${encodeURIComponent("\\b")}`);
    expect(p.conninfo).toBe(`host='h.invalid' port='5432' user='o\\'k' dbname='d\\\\b'`);
  });

  it.each([
    ["비밀번호 없음", `postgresql://postgres@db.${REF}.supabase.co:5432/postgres`, /비밀번호가 없습니다/],
    ["줄바꿈 비밀번호", `postgresql://postgres:${encodeURIComponent("a\nb")}@db.${REF}.supabase.co/postgres`, /줄바꿈/],
    ["지원하지 않는 설정", `postgresql://postgres:x@db.${REF}.supabase.co/postgres?password=leak`, /지원하지 않습니다/],
    ["형식 오류", "not a url", /형식이 올바르지/],
    ["다른 프로토콜", "https://u:p@h/x", /postgresql:\/\//],
  ])("%s → 거절(오류 메시지에 비밀 없음)", async (_n, url, pattern) => {
    const { splitDbUrl } = await load();
    let msg = "";
    try {
      splitDbUrl(url);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(pattern);
    expect(msg).not.toContain("leak");
  });
});

describe("덤프(runDump): 인자에 비밀 없음, PGPASSWORD 환경 변수로만", () => {
  it.each([["직접 연결", DIRECT], ["pooler", POOLER]])("%s", async (_n, dbUrl) => {
    const { resolveBackupTarget, runDump } = await load();
    const env = { NEXT_PUBLIC_SUPABASE_URL: API, BACKUP_DB_URL: dbUrl, SUPABASE_SECRET_KEY: "SYNTH-service-key", PATH: "x" };
    const target = resolveBackupTarget(env);
    runDump("C:/backups/x/data.sql", target, env);
    const [c] = calls();
    expect(c!.cmd).toBe("supabase");
    expect(c!.args.slice(0, 7)).toEqual(["db", "dump", "--data-only", "--schema", "public,auth", "-f", "C:/backups/x/data.sql"]);
    expect(c!.args[7]).toMatch(/^--remote=postgresql:\/\/postgres(\.[a-z]+)?@/);
    expect(leaks(c!)).toBe(false);
    expect(c!.opts.env!.PGPASSWORD).toBe(SECRET);
    expect(c!.opts.env!.BACKUP_DB_URL).toBeUndefined();
    expect(c!.opts.env!.SUPABASE_SECRET_KEY).toBeUndefined();
    expect(c!.opts.env!.PATH).toBe("x");
    expect(c!.opts.input).toBeUndefined();
  });

  it("로컬 대상은 예전 그대로(원격 인자·비밀 환경 없음)", async () => {
    const { resolveBackupTarget, runDump } = await load();
    runDump("data.sql", resolveBackupTarget({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:57321" }));
    const [c] = calls();
    expect(c!.args).toEqual(["db", "dump", "--data-only", "--schema", "public,auth", "-f", "data.sql"]);
    expect(c!.opts.env).toBeUndefined();
  });
});

describe("검증 psql: 인자에 비밀 없음, 표준 입력 첫 줄로만", () => {
  it("원격: docker exec -i <전용 클라이언트> sh -c … psql <비밀번호 없는 접속 문자열>, 입력 = 비밀번호\\nSQL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", API);
    vi.stubEnv("BACKUP_DB_URL", POOLER);
    vi.stubEnv("SUPABASE_SECRET_KEY", "SYNTH-service-key");
    vi.stubEnv("SUPABASE_DB_CONTAINER", "claude-backup-client-test");
    // R2: 실행 전에 docker inspect 로 스택 라벨을 본다. 전용 클라이언트는 라벨이 없다
    spawnSync.mockImplementation((_cmd, args: string[]) => ({ status: 0, stdout: args[0] === "inspect" ? "<no value>\n" : "ok", stderr: "" }));
    const { psql, PSQL_STDIN_PASSWORD_SCRIPT } = await load();
    psql("select 1;\nselect 2;");
    const [inspect, c] = calls();
    expect(inspect!.args[0]).toBe("inspect");
    expect(leaks(inspect!)).toBe(false);
    expect(c!.cmd).toBe("docker");
    expect(c!.args.slice(0, 7)).toEqual(["exec", "-i", "claude-backup-client-test", "sh", "-c", PSQL_STDIN_PASSWORD_SCRIPT, "sh"]);
    expect(c!.args[7]).toContain(`user='postgres.${REF}'`);
    expect(c!.args.slice(8)).toEqual(["-v", "ON_ERROR_STOP=1", "-At", "-q"]);
    expect(c!.args.some((a) => a.startsWith("-e") || a.includes("PGPASSWORD="))).toBe(false); // docker -e 값 전달 안 씀
    expect(leaks(c!)).toBe(false);
    expect(c!.opts.input).toBe(`${SECRET}\nselect 1;\nselect 2;`);
    expect(c!.opts.env!.BACKUP_DB_URL).toBeUndefined();
    expect(c!.opts.env!.SUPABASE_SECRET_KEY).toBeUndefined();
  });

  it("로컬: 예전 인자 그대로, 입력은 SQL 만", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
    vi.stubEnv("BACKUP_DB_URL", "");
    vi.stubEnv("SUPABASE_DB_CONTAINER", "supabase_db_claude-qa");
    const { psql } = await load();
    psql("select 1;");
    const [c] = calls();
    expect(c!.args).toEqual(["exec", "-i", "supabase_db_claude-qa", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q"]);
    expect(c!.opts.input).toBe("select 1;");
  });
});

describe("실패해도 비밀이 오류에 남지 않는다", () => {
  it("자식 프로세스가 비밀을 stderr 에 되울려도 오류 메시지에서는 가린다", async () => {
    // inspect(스택 라벨 확인)는 성공하고 실제 실행만 실패하는 상황
    spawnSync.mockImplementation((_cmd, args: string[]) =>
      args[0] === "inspect" ? { status: 0, stdout: "<no value>\n", stderr: "" } : { status: 1, stdout: "", stderr: `connection failed for password ${SECRET}` },
    );
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", API);
    vi.stubEnv("BACKUP_DB_URL", DIRECT);
    // 운영 대상 psql 은 전용 클라이언트 지정이 필수다(BACKUP-P2-TABLES-01-R1). 지정해야 실제 실행 단계까지 간다
    vi.stubEnv("SUPABASE_DB_CONTAINER", "claude-backup-client-test");
    const { psql, resolveBackupTarget, runDump } = await load();
    const msgs: string[] = [];
    for (const f of [() => psql("select 1;"), () => runDump("d.sql", resolveBackupTarget())]) {
      try {
        f();
      } catch (e) {
        msgs.push((e as Error).message);
      }
    }
    expect(msgs).toHaveLength(2);
    for (const m of msgs) {
      expect(m).not.toContain(SECRET);
      expect(m).toContain("<비밀값 가림>");
    }
  });
});

describe("childEnv", () => {
  it("BACKUP_DB_URL·SUPABASE_SECRET_KEY·기존 PGPASSWORD 를 빼고 필요한 값만 더한다", async () => {
    const { childEnv } = await load();
    const env = childEnv({ PGPASSWORD: "new" }, { BACKUP_DB_URL: "u", SUPABASE_SECRET_KEY: "k", PGPASSWORD: "old", HOME: "h" });
    expect(env).toEqual({ PGPASSWORD: "new", HOME: "h" });
    expect(childEnv({}, { PGPASSWORD: "old", A: "1" })).toEqual({ A: "1" });
  });
});
