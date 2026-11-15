import { describe, expect, it } from "vitest";
import { resolveBackupTarget } from "../../scripts/backup/common.mts";

/**
 * BACKUP-OPS-01 (Codex): 백업의 DB 내보내기와 파일·API 조회가 반드시 같은 Supabase를 보게 한다.
 * 실제 비밀값 없이 모양만 같은 가짜 주소로 시험한다.
 */
const REF = "abcdefghijklmnopqrst"; // 20자 가짜 프로젝트 ref
const OTHER = "zyxwvutsrqponmlkjihg";
const API = `https://${REF}.supabase.co`;

describe("백업 대상 하나 정하기", () => {
  it("로컬 API만 있으면 로컬 대상(원격 인자 없음)", () => {
    const t = resolveBackupTarget({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" });
    expect(t).toEqual({ kind: "local", label: "local", dumpArgs: [] });
  });

  it.each([
    ["BACKUP_DB_URL", { BACKUP_DB_URL: `postgresql://postgres:x@db.${REF}.supabase.co:5432/postgres` }],
    ["BACKUP_REMOTE", { BACKUP_REMOTE: "1" }],
  ])("로컬 API에 원격 설정(%s)이 섞이면 멈춘다", (_name, extra) => {
    expect(() => resolveBackupTarget({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", ...extra })).toThrow(/섞이지 않도록/);
  });

  it("운영 API인데 DB 연결 주소가 없으면 멈춘다(예전 BACKUP_REMOTE=1 만으로는 안 됨)", () => {
    expect(() => resolveBackupTarget({ NEXT_PUBLIC_SUPABASE_URL: API, BACKUP_REMOTE: "1" })).toThrow(/BACKUP_DB_URL/);
  });

  it.each([
    ["직접 연결", `postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres`],
    ["공유 연결(pooler)", `postgresql://postgres.${REF}:secret@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`],
  ])("운영 API와 DB 연결 주소(%s)가 같은 프로젝트면 그 주소로 내보낸다", (_name, dbUrl) => {
    const t = resolveBackupTarget({ NEXT_PUBLIC_SUPABASE_URL: API, BACKUP_DB_URL: dbUrl });
    expect(t.kind).toBe("remote");
    expect(t.label).toBe(REF);
    expect(t.dumpArgs).toEqual([`--remote=${dbUrl}`]);
    // 기록용 이름(label)에는 비밀값이 들어가지 않는다
    expect(t.label).not.toContain("secret");
  });

  it.each([
    ["직접 연결", `postgresql://postgres:x@db.${OTHER}.supabase.co:5432/postgres`],
    ["공유 연결", `postgresql://postgres.${OTHER}:x@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`],
  ])("API와 DB(%s)가 다른 프로젝트면 멈춘다", (_name, dbUrl) => {
    expect(() => resolveBackupTarget({ NEXT_PUBLIC_SUPABASE_URL: API, BACKUP_DB_URL: dbUrl })).toThrow(/다릅니다/);
  });

  it.each([
    ["주소 아님", "not a url"],
    ["다른 프로토콜", `mysql://root@db.${REF}.supabase.co/x`],
    ["프로젝트를 알 수 없는 호스트", "postgresql://postgres:x@example.com:5432/postgres"],
  ])("DB 연결 주소가 이상하면(%s) 멈춘다", (_name, dbUrl) => {
    expect(() => resolveBackupTarget({ NEXT_PUBLIC_SUPABASE_URL: API, BACKUP_DB_URL: dbUrl })).toThrow();
  });

  it.each([[""], ["https://example.com"], ["http://10.0.0.5:54321"]])("API 주소가 비었거나 Supabase가 아니면(%j) 멈춘다", (api) => {
    expect(() => resolveBackupTarget({ NEXT_PUBLIC_SUPABASE_URL: api })).toThrow(/API 주소/);
  });
});
