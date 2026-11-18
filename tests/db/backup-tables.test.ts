/**
 * BACKUP-P2-TABLES-01: 실제 migration 을 적용한 DB(PGlite)에서 백업 표 목록 대조가 통과하는지.
 * LIST_TABLES_SQL 은 백업·검증이 psql 로 실행하는 것과 같은 조회다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { checkTableCoverage, LIST_TABLES_SQL, TABLES } from "../../scripts/backup/common.mts";
import { createDb, type Db } from "./harness";

let db: Db;
beforeAll(async () => {
  db = await createDb();
}, 60_000); // 병렬 부하에서 PGlite 준비가 10초를 넘을 수 있다(QA-SEC-RELEASE-04 T1)

const dbTables = async () => (await db.query<{ relname: string }>(LIST_TABLES_SQL)).rows.map((r) => r.relname);

describe("migration 적용 DB 의 public 표", () => {
  it("모두 백업 목록에 있고, 목록의 기본 표는 모두 DB에 있다", async () => {
    const tables = await dbTables();
    const counted = checkTableCoverage(tables);
    expect(counted.sort()).toEqual([...tables].sort());
    expect(counted.length).toBeGreaterThanOrEqual(TABLES.length - 6);
  });

  it("목록에 없는 표를 만들면 대조가 멈춘다", async () => {
    await db.exec("create table public.backup_coverage_probe (id int)");
    try {
      expect(() => checkTableCoverage([])).toThrow();
      await expect(dbTables().then(checkTableCoverage)).rejects.toThrow(/backup_coverage_probe/);
    } finally {
      await db.exec("drop table public.backup_coverage_probe");
    }
  });
});
