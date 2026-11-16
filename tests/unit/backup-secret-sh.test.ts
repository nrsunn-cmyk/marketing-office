import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PSQL_STDIN_PASSWORD_SCRIPT } from "../../scripts/backup/common.mts";

/**
 * BACKUP-SECRET-01: 컨테이너 안에서 쓰는 셸 스크립트를 실제 sh 로 실행해,
 * 표준 입력 첫 줄만 PGPASSWORD 가 되고 나머지 입력은 손대지 않고 psql 에 넘어가는지 확인한다.
 * psql 은 가짜(받은 인자·PGPASSWORD·표준 입력을 파일에 기록만 함). 컨테이너·DB 접속 없음.
 * sh 가 없는 환경이면 건너뛴다.
 */
const hasSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;
const dir = mkdtempSync(join(tmpdir(), "backup-secret-sh-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SECRET = "SYNTH 'p@ss' $HOME `x` \\ end"; // 공백·따옴표·$·백틱·역슬래시: 셸에서 해석되면 안 되는 문자들
const SQL = "select 1;\nselect 'two lines';\n";

describe.skipIf(!hasSh)("컨테이너용 sh 스크립트(실제 sh, 가짜 psql)", () => {
  it("첫 줄은 PGPASSWORD 로만, 나머지 SQL 은 그대로 psql 표준 입력으로, 인자에는 비밀 없음", () => {
    const fake = join(dir, "psql");
    const outFile = join(dir, "seen.txt");
    writeFileSync(
      fake,
      ["#!/bin/sh", `{ printf 'ARGS:'; printf '%s|' "$@"; printf '\\nPW:%s\\nSTDIN:' "$PGPASSWORD"; cat; } > "${outFile.replace(/\\/g, "/")}"`, ""].join("\n"),
    );
    chmodSync(fake, 0o755);
    // 가짜 psql 폴더를 PATH 앞에 둔다(Windows 경로의 드라이브 콜론을 피하려고 cd 뒤 pwd 의 POSIX 경로를 쓴다)
    const r = spawnSync("sh", ["-c", `cd "$1" && PATH="$(pwd):$PATH"; shift; ${PSQL_STDIN_PASSWORD_SCRIPT}`, "sh", dir.replace(/\\/g, "/"), "host='h.invalid' user='u'", "-v", "ON_ERROR_STOP=1", "-At", "-q"], {
      input: `${SECRET}\n${SQL}`,
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: "" },
    });
    expect(r.status, r.stderr).toBe(0);
    const seen = readFileSync(outFile, "utf8");
    expect(seen).toBe(`ARGS:host='h.invalid' user='u'|-v|ON_ERROR_STOP=1|-At|-q|\nPW:${SECRET}\nSTDIN:${SQL}`);
    expect(seen.split("\nPW:")[0]).not.toContain("SYNTH"); // 인자에는 비밀 없음
  });

  it("입력이 비어 있으면(비밀번호 줄 없음) psql 을 실행하지 않고 실패한다", () => {
    const r = spawnSync("sh", ["-c", PSQL_STDIN_PASSWORD_SCRIPT, "sh"], { input: "", encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});
