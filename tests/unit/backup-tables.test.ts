import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkTableCoverage, LATER_TABLES, TABLES } from "../../scripts/backup/common.mts";

/**
 * BACKUP-P2-TABLES-01: 백업 행 수 목록(TABLES)이 migration 이 만드는 public 표와 빠짐없이 맞는지.
 * 새 migration 이 표를 더했는데 목록을 안 고치면 이 시험이 먼저 실패한다(운영 백업 때는 checkTableCoverage 가 멈춘다).
 */
const MIGRATIONS = join(import.meta.dirname, "..", "..", "supabase", "migrations");

function tablesFromMigrations(): Set<string> {
  const created = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi)) created.add(m[1].toLowerCase());
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi)) created.delete(m[1].toLowerCase());
  }
  return created;
}

describe("백업 표 목록 = migration 표", () => {
  const created = tablesFromMigrations();

  it("migration 이 만드는 표는 모두 TABLES 에 있다", () => {
    const missing = [...created].filter((t) => !(TABLES as readonly string[]).includes(t));
    expect(missing).toEqual([]);
  });

  it("TABLES 중 migration 에 없는 표는 뒤 migration 표(LATER_TABLES)뿐이다", () => {
    const extra = TABLES.filter((t) => !created.has(t));
    expect(extra.every((t) => (LATER_TABLES as readonly string[]).includes(t))).toBe(true);
  });

  it("목록에 중복이 없다", () => {
    expect(new Set(TABLES).size).toBe(TABLES.length);
  });
});

describe("checkTableCoverage", () => {
  const base = TABLES.filter((t) => !(LATER_TABLES as readonly string[]).includes(t));

  it("목록에 없는 표가 DB에 있으면 멈춘다(누락 시 실패)", () => {
    expect(() => checkTableCoverage([...base, "new_table_x"])).toThrow(/백업 목록에 없는 표가 DB에 있습니다: new_table_x/);
  });

  it("뒤 migration 표는 없어도 되고, 있으면 센다", () => {
    expect(checkTableCoverage(base)).toEqual(base);
    expect(checkTableCoverage([...TABLES])).toEqual([...TABLES]);
  });

  it("기본 표가 없으면 멈춘다(대상 DB migration 상태가 이상함)", () => {
    expect(() => checkTableCoverage(base.filter((t) => t !== "tasks"))).toThrow(/있어야 할 표가 없습니다: tasks/);
  });

  it("세는 순서는 TABLES 순서(DB 목록 순서와 무관)", () => {
    expect(checkTableCoverage([...base].reverse())).toEqual(base);
  });
});
