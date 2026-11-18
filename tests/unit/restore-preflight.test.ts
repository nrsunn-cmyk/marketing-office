import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const commands = vi.hoisted(() => ({ run: vi.fn(), containerProject: vi.fn() }));
vi.mock("../../scripts/backup/common.mts", async (original) => ({
  ...(await original<typeof import("../../scripts/backup/common.mts")>()),
  run: commands.run,
  containerProject: commands.containerProject,
}));

/**
 * 복원 연습(restore-drill)은 초기화(supabase db reset) 전에 대상을 확인한다.
 * 시험은 임시 "전용 연습 스택" 폴더(config.toml: project_id claude-qa-restore, API 55321)에서 돌린다.
 * 실제 초기화·Docker 는 쓰지 않는다(run·containerProject 는 가짜).
 */
describe("복원 초기화 전 대상 설정 확인", () => {
  let folder: string;
  let stack: string;
  let argv: string[];
  let cwd: string;
  const writeConfig = (projectId: string, apiPortValue: number) =>
    writeFileSync(join(stack, "supabase", "config.toml"), `project_id = "${projectId}"\n\n[api]\nenabled = true\nport = ${apiPortValue}\n\n[db]\nport = 55322\n`);

  beforeEach(() => {
    vi.resetModules();
    commands.run.mockReset();
    commands.run.mockReturnValue("");
    commands.containerProject.mockReset();
    commands.containerProject.mockReturnValue("claude-qa-restore");
    folder = mkdtempSync(join(tmpdir(), "codex-restore-preflight-"));
    writeFileSync(join(folder, "manifest.json"), JSON.stringify({ counts: {}, files: [], quoteTotalWon: 0 }));
    writeFileSync(join(folder, "data.sql"), "-- 격리 시험 자료\n");
    stack = mkdtempSync(join(tmpdir(), "restore-preflight-stack-"));
    mkdirSync(join(stack, "supabase"));
    writeConfig("claude-qa-restore", 55321);
    cwd = process.cwd();
    process.chdir(stack);
    argv = process.argv;
    process.argv = [process.execPath, "restore-drill.mts", folder];
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    vi.stubEnv("RESTORE_DRILL_CONFIRM", "local");
    vi.stubEnv("BACKUP_DB_URL", "");
    vi.stubEnv("SUPABASE_DB_CONTAINER", "");
    vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("검사 중단"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(cwd);
    process.argv = argv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(folder, { recursive: true, force: true });
    rmSync(stack, { recursive: true, force: true });
  });

  const expectStopped = async (msg?: RegExp) => {
    await expect(import("../../scripts/backup/restore-drill.mts")).rejects.toThrow("검사 중단");
    expect(commands.run).not.toHaveBeenCalled();
    if (msg) expect(console.error).toHaveBeenCalledWith(expect.stringMatching(msg));
  };

  it("로컬 API와 원격 DB 주소가 섞이면 초기화 명령을 실행하지 않는다", async () => {
    vi.stubEnv("BACKUP_DB_URL", "postgresql://example.invalid/production");
    await expect(import("../../scripts/backup/restore-drill.mts")).rejects.toThrow();
    expect(commands.run).not.toHaveBeenCalled();
  });

  it("로컬 API에 BACKUP_REMOTE=1이 남아 있으면 초기화 명령을 실행하지 않는다(ENG-BKP-02)", async () => {
    vi.stubEnv("BACKUP_REMOTE", "1");
    await expectStopped();
  });

  it("운영 API이면 확인 문자열이 있어도 초기화하지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    await expectStopped();
  });

  it("R2: 초기화 대상이 공용 스택 project_id(marketing-office)이면 무조건 멈춘다(원본 config 사본에서 실행한 경우)", async () => {
    writeConfig("marketing-office", 55321);
    commands.containerProject.mockReturnValue("marketing-office"); // 라벨까지 맞아도 멈춰야 한다
    await expectStopped(/초기화 대상이 공용 로컬 스택\(marketing-office\)입니다/);
  });

  it("R2: API 주소 포트가 초기화할 프로젝트 API 포트와 다르면 멈춘다(예: .env.local 이 공용 54321)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    await expectStopped(/API 주소 포트\(54321\)가 초기화할 프로젝트\(claude-qa-restore\)의 API 포트\(55321\)와 다릅니다/);
  });

  it("R2: 컨테이너 라벨의 프로젝트가 초기화할 프로젝트와 다르면 멈춘다(이름·ID 형태와 무관)", async () => {
    vi.stubEnv("SUPABASE_DB_CONTAINER", "3f9a1c0d2b7e");
    commands.containerProject.mockReturnValue("marketing-office");
    await expectStopped(/초기화할 프로젝트\(claude-qa-restore\)와 데이터를 넣을 컨테이너\(3f9a1c0d2b7e, 프로젝트 marketing-office\)가 다릅니다/);
  });

  it("R2: 스택이 아닌 컨테이너를 지정하면 멈춘다", async () => {
    vi.stubEnv("SUPABASE_DB_CONTAINER", "claude-backup-client-x");
    commands.containerProject.mockReturnValue("");
    await expectStopped(/프로젝트 스택 아님\)가 다릅니다/);
  });

  it("config.toml 이 없는 폴더에서 실행하면 멈춘다", async () => {
    rmSync(join(stack, "supabase"), { recursive: true, force: true });
    await expectStopped(/config\.toml\(project_id\)이 없습니다/);
  });

  it("전용 스택 설정(프로젝트·포트·라벨)이 모두 맞으면 초기화 단계에 도달한다", async () => {
    // 실제 초기화 대신 호출 직후 멈춰 외부 CLI·DB는 사용하지 않는다.
    commands.run.mockImplementation(() => { throw new Error("초기화 단계 도달"); });
    await expect(import("../../scripts/backup/restore-drill.mts")).rejects.toThrow("초기화 단계 도달");
    expect(commands.run).toHaveBeenCalledExactlyOnceWith("supabase", ["db", "reset"]);
    expect(commands.containerProject).toHaveBeenCalledWith("supabase_db_claude-qa-restore");
  });
});
