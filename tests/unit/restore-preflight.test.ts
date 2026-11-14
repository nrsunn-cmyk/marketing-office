import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const commands = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../scripts/backup/common.mts", async (original) => ({
  ...(await original<typeof import("../../scripts/backup/common.mts")>()),
  run: commands.run,
}));

describe("복원 초기화 전 대상 설정 확인", () => {
  let folder: string;
  let argv: string[];

  beforeEach(() => {
    vi.resetModules();
    commands.run.mockReset();
    commands.run.mockReturnValue("");
    folder = mkdtempSync(join(tmpdir(), "codex-restore-preflight-"));
    writeFileSync(join(folder, "manifest.json"), JSON.stringify({ counts: {}, files: [], quoteTotalWon: 0 }));
    writeFileSync(join(folder, "data.sql"), "-- 격리 시험 자료\n");
    argv = process.argv;
    process.argv = [process.execPath, "restore-drill.mts", folder];
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    vi.stubEnv("RESTORE_DRILL_CONFIRM", "local");
    vi.stubEnv("BACKUP_DB_URL", "");
    vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("검사 중단"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = argv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(folder, { recursive: true, force: true });
  });

  it("로컬 API와 원격 DB 주소가 섞이면 초기화 명령을 실행하지 않는다", async () => {
    vi.stubEnv("BACKUP_DB_URL", "postgresql://example.invalid/production");
    await expect(import("../../scripts/backup/restore-drill.mts")).rejects.toThrow();
    expect(commands.run).not.toHaveBeenCalled();
  });

  it("운영 API이면 확인 문자열이 있어도 초기화하지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    await expect(import("../../scripts/backup/restore-drill.mts")).rejects.toThrow("검사 중단");
    expect(commands.run).not.toHaveBeenCalled();
  });

  it("로컬 설정과 명시 확인이 맞으면 초기화 단계에 도달한다", async () => {
    // 실제 초기화 대신 호출 직후 멈춰 외부 CLI·DB는 사용하지 않는다.
    commands.run.mockImplementation(() => { throw new Error("초기화 단계 도달"); });
    await expect(import("../../scripts/backup/restore-drill.mts")).rejects.toThrow("초기화 단계 도달");
    expect(commands.run).toHaveBeenCalledExactlyOnceWith("supabase", ["db", "reset"]);
  });
});
