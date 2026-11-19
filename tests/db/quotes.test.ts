import { beforeAll, describe, expect, it } from "vitest";
import { calculateQuote, type TaxMode } from "@/domain/quote";
import { asUser, createDb, createTask, createUser, type Db, expectDbError, type Fixture, one, seedOwner, DENIED } from "./harness";

let db: Db;
let f: Fixture;

beforeAll(async () => {
  db = await createDb();
  f = await seedOwner(db);
}, 60_000);

const asOwner = <T>(fn: Parameters<typeof asUser<T>>[2]) => asUser(db, f.userId, fn);

interface Item {
  name: string;
  quantity_hundredths: number;
  unit_price_won: number;
  line_amount_won: number;
}

/** 화면 계산(TypeScript)으로 확정 요청 값을 만든다 */
function priced(mode: TaxMode, bp: number, rows: Array<[number, number]>) {
  const calc = calculateQuote({
    taxMode: mode,
    taxRateBasisPoints: bp,
    items: rows.map(([q, p], i) => ({ id: String(i), name: `항목${i}`, quantityHundredths: q, unitPriceWon: p, freeItemConfirmed: true, zeroAmountConfirmed: true })),
  });
  const items: Item[] = rows.map(([q, p], i) => ({
    name: `항목${i}`,
    quantity_hundredths: q,
    unit_price_won: p,
    line_amount_won: calc.lines[i].amountWon!,
  }));
  return { mode, bp, items, sub: calc.subtotalWon, tax: calc.taxWon, total: calc.totalWon };
}

async function draft(content: object = { form: {} }) {
  return asOwner(async (tx) => {
    const task = await createTask(tx, f, f.projectB, "quote");
    const r = await one<{ artifact_id: string; version_id: string; version: number }>(
      tx,
      "select * from save_draft_version($1, null, 'h', '{}', $2)",
      [task, JSON.stringify(content)],
    );
    return { task, ...r };
  });
}

function finalize(
  d: { artifact_id: string; version_id: string },
  p: ReturnType<typeof priced>,
  overrides: Partial<{ sub: number; tax: number; total: number; items: Item[]; issue: string | null }> = {},
  uid = f.userId,
) {
  return asUser(db, uid, (tx) =>
    one<{ quote_id: string; quote_version_id: string; quote_number: string; reused: boolean }>(
      tx,
      `select * from finalize_quote($1, $2, null, '{"legal_name":"나다움"}', '{"name":"B"}', $3, $4, $5, $6, $7, $8, null, '선금 50%', null, $9)`,
      [
        d.artifact_id,
        d.version_id,
        p.mode,
        p.bp,
        overrides.sub ?? p.sub,
        overrides.tax ?? p.tax,
        overrides.total ?? p.total,
        overrides.issue === undefined ? "2026-11-13" : overrides.issue,
        JSON.stringify(overrides.items ?? p.items),
      ],
    ),
  );
}

describe("save_draft_version", () => {
  it("첫 초안은 결과물을 만들고 작업은 검토 중", async () => {
    const d = await draft();
    expect(d.version).toBe(1);
    expect((await one<{ status: string }>(db, "select status from tasks where id = $1", [d.task])).status).toBe("review");
  });

  it("이미 결과물이 있는데 revision 없이 저장하면 충돌 (두 번 누른 첫 저장)", async () => {
    const d = await draft();
    await expectDbError(
      asOwner((tx) => tx.query("select * from save_draft_version($1, null, 'h', '{}', '{}')", [d.task])),
      /CONFLICT/,
    );
  });

  it("맞는 revision이면 새 버전, 오래된 revision이면 충돌", async () => {
    const d = await draft();
    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [d.artifact_id])).revision;
    const save = (r: number) =>
      asOwner((tx) => one<{ version: number }>(tx, "select * from save_draft_version($1, $2, 'h', '{}', '{}')", [d.task, r]));
    expect((await save(rev)).version).toBe(2);
    await expectDbError(save(rev), /CONFLICT/);
  });
});

describe("finalize_quote (T08·R04·C08)", () => {
  it("T08 고정 예제: 별도 2×50,000 → 110,000, 번호 발번, 항목 고정, 작업 완료", async () => {
    const d = await draft();
    const p = priced("EXCLUSIVE", 1000, [[200, 50_000]]);
    expect([p.sub, p.tax, p.total]).toEqual([100_000, 10_000, 110_000]);
    const r = await finalize(d, p);
    expect(r.quote_number).toMatch(/^Q-2026-\d{4}$/);
    expect(r.reused).toBe(false);
    const qv = await one<{ total_won: string; payment_terms: string }>(db, "select total_won, payment_terms from quote_versions where id = $1", [r.quote_version_id]);
    expect(Number(qv.total_won)).toBe(110_000);
    expect(qv.payment_terms).toBe("선금 50%");
    const items = await db.query<{ line_amount_won: string }>("select position, line_amount_won from quote_items where quote_version_id = $1", [r.quote_version_id]);
    expect(items.rows.map((i) => Number(i.line_amount_won))).toEqual([100_000]);
    const a = await one<{ approved_version_id: string }>(db, "select approved_version_id from artifacts where id = $1", [d.artifact_id]);
    expect(a.approved_version_id).toBe(d.version_id);
    expect((await one<{ status: string }>(db, "select status from tasks where id = $1", [d.task])).status).toBe("completed");
  });

  it("같은 버전을 다시 확정하면 같은 번호 (중복 클릭)", async () => {
    const d = await draft();
    const p = priced("EXCLUSIVE", 1000, [[100, 1_000]]);
    const a = await finalize(d, p);
    const b = await finalize(d, p);
    expect(b).toEqual({ ...a, reused: true });
  });

  it.each([
    ["합계 변조", { total: 110_001 }],
    ["세액 변조", { tax: 9_999, total: 109_999 }],
    ["공급가 변조", { sub: 1, total: 10_001 }],
  ])("금액 변조 거절: %s", async (_label, o) => {
    const d = await draft();
    await expectDbError(finalize(d, priced("EXCLUSIVE", 1000, [[200, 50_000]]), o), /AMOUNT_MISMATCH/);
  });

  it("행 금액 변조 거절", async () => {
    const d = await draft();
    const p = priced("EXCLUSIVE", 1000, [[200, 50_000]]);
    await expectDbError(finalize(d, p, { items: [{ ...p.items[0], line_amount_won: 99_999 }] }), /AMOUNT_MISMATCH/);
  });

  it.each([
    ["빈 단가", { unit_price_won: null }],
    ["수량 0", { quantity_hundredths: 0 }],
    ["음수 단가", { unit_price_won: -1 }],
    ["빈 항목명", { name: " " }],
  ])("부적합 항목 거절: %s", async (_label, patch) => {
    const d = await draft();
    const p = priced("EXCLUSIVE", 1000, [[100, 1_000]]);
    await expectDbError(finalize(d, p, { items: [{ ...p.items[0], ...(patch as object) } as Item] }), /VALIDATION/);
  });

  it("작성일 없이는 확정 불가", async () => {
    const d = await draft();
    await expectDbError(finalize(d, priced("EXCLUSIVE", 1000, [[100, 1_000]]), { issue: null }), /VALIDATION/);
  });

  it("최신 초안이 아니면 확정 불가", async () => {
    const d = await draft();
    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [d.artifact_id])).revision;
    await asOwner((tx) => tx.query("select * from save_draft_version($1, $2, 'h', '{}', '{}')", [d.task, rev]));
    await expectDbError(finalize(d, priced("EXCLUSIVE", 1000, [[100, 1_000]])), /CONFLICT/);
  });

  it("다른 계정은 확정할 수 없다", async () => {
    const d = await draft();
    const stranger = await createUser(db, "quote-final-stranger@example.test");
    await expectDbError(finalize(d, priced("EXCLUSIVE", 1000, [[100, 1_000]]), {}, stranger), /NOT_FOUND/);
  });

  it("확정 후 고친 초안을 다시 확정하면 같은 견적 번호의 새 고정본", async () => {
    const d = await draft();
    const first = await finalize(d, priced("EXCLUSIVE", 1000, [[100, 1_000]]));
    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [d.artifact_id])).revision;
    const v2 = await asOwner((tx) =>
      one<{ version_id: string }>(tx, "select * from save_draft_version($1, $2, 'h', '{}', '{}')", [d.task, rev]),
    );
    const second = await finalize({ artifact_id: d.artifact_id, version_id: v2.version_id }, priced("EXCLUSIVE", 1000, [[100, 2_000]]));
    expect(second.quote_number).toBe(first.quote_number);
    expect(second.quote_version_id).not.toBe(first.quote_version_id);
    const old = await one<{ total_won: string }>(db, "select total_won from quote_versions where id = $1", [first.quote_version_id]);
    expect(Number(old.total_won)).toBe(1_100);
  });

  it("화면 계산(TypeScript)과 DB 재계산이 무작위 견적 30개에서 모두 같다", async () => {
    let seed = 20261113;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const modes: TaxMode[] = ["EXCLUSIVE", "INCLUSIVE", "NO_TAX"];
    for (let i = 0; i < 30; i += 1) {
      const mode = modes[i % 3];
      const bp = mode === "NO_TAX" ? 0 : [1000, 330, 0, 1, 9999][rand(5)];
      const rows: Array<[number, number]> = Array.from({ length: 1 + rand(8) }, () => [1 + rand(100_000), rand(5_000_000)]);
      const d = await draft();
      const r = await finalize(d, priced(mode, bp, rows));
      expect(r.reused).toBe(false);
    }
  });
});

describe("CR03 확정 견적은 finalize_quote 경로로만", () => {
  it("로그인 사용자는 견적·고정본·견적 번호를 직접 만들 수 없다", async () => {
    const d = await draft();
    await expectDbError(
      asOwner((tx) => tx.query("insert into quotes (workspace_id, task_id, artifact_id) values ($1, $2, $3)", [f.workspaceId, d.task, d.artifact_id])),
      DENIED,
    );
    const r = await finalize(d, priced("EXCLUSIVE", 1000, [[100, 1_000]]));
    await expectDbError(
      asOwner((tx) =>
        tx.query(
          `insert into quote_versions (workspace_id, quote_id, artifact_id, artifact_version_id, supplier_snapshot, customer_snapshot, tax_mode, tax_rate_bp, subtotal_won, tax_won, total_won)
           values ($1, $2, $3, $4, '{}', '{}', 'NO_TAX', 0, 1, 0, 1)`,
          [f.workspaceId, r.quote_id, d.artifact_id, d.version_id],
        ),
      ),
      DENIED,
    );
    await expectDbError(
      asOwner((tx) => tx.query("insert into quote_number_sequences (workspace_id, year, last_number) values ($1, 2099, 1)", [f.workspaceId])),
      DENIED,
    );
  });

  it("정상 확정 후 행·금액은 그대로, 바꾸려면 새 초안을 다시 확정해야 한다", async () => {
    const d = await draft();
    const r = await finalize(d, priced("EXCLUSIVE", 1000, [[200, 50_000]]));
    const count = async () =>
      (await one<{ n: number }>(db, "select count(*)::int as n from quote_items where quote_version_id = $1", [r.quote_version_id])).n;
    expect(await count()).toBe(1);
    await expectDbError(
      asOwner((tx) =>
        tx.query(
          "insert into quote_items (workspace_id, quote_version_id, position, name, quantity_hundredths, unit_price_won, line_amount_won) values ($1, $2, 5, 'x', 100, 1, 1)",
          [f.workspaceId, r.quote_version_id],
        ),
      ),
      DENIED,
    );
    expect(await count()).toBe(1);
  });

  it("다른 업무실의 공급자 정보로는 확정할 수 없다", async () => {
    const d = await draft();
    const other = await createUser(db, "supplier-other@example.test");
    const ws = await asUser(db, other, (tx) => one<{ id: string }>(tx, "select setup_workspace('남의 업무실', '남의 상호') as id"));
    const sup = await one<{ id: string }>(db, "select id from supplier_profiles where workspace_id = $1", [ws.id]);
    const p = priced("EXCLUSIVE", 1000, [[100, 1_000]]);
    await expectDbError(
      asOwner((tx) =>
        tx.query(
          `select * from finalize_quote($1, $2, $3, '{}', '{}', 'EXCLUSIVE', 1000, $4, $5, $6, '2026-11-13', null, null, null, $7)`,
          [d.artifact_id, d.version_id, sup.id, p.sub, p.tax, p.total, JSON.stringify(p.items)],
        ),
      ),
      /VALIDATION/,
    );
  });
});

describe("CR04 결과 버전의 입력 스냅샷은 같은 작업의 것", () => {
  it("같은 작업의 스냅샷은 연결되고(직접 수정 흐름), 다른 작업 것은 거절", async () => {
    await db.transaction(async (tx) => {
      const taskA = await createTask(tx, f, f.projectA);
      const taskA2 = await createTask(tx, f, f.projectA);
      const snapA = await one<{ id: string }>(
        tx,
        "insert into task_input_snapshots (workspace_id, task_id, profile_snapshot, input_hash) values ($1, $2, '{}', 'h') returning id",
        [f.workspaceId, taskA],
      );
      const art = await one<{ id: string }>(
        tx,
        "insert into artifacts (workspace_id, project_id, task_id, type) values ($1, $2, $3, 'logo_brief') returning id",
        [f.workspaceId, f.projectA, taskA],
      );
      await tx.query(
        "insert into artifact_versions (workspace_id, artifact_id, version, content, input_snapshot_id, generator) values ($1, $2, 1, '{}', $3, 'template')",
        [f.workspaceId, art.id, snapA.id],
      );
      const art2 = await one<{ id: string }>(
        tx,
        "insert into artifacts (workspace_id, project_id, task_id, type) values ($1, $2, $3, 'logo_brief') returning id",
        [f.workspaceId, f.projectA, taskA2],
      );
      // 같은 고객이라도 다른 작업의 스냅샷은 안 된다
      await tx.query("savepoint s");
      await expect(
        tx.query(
          "insert into artifact_versions (workspace_id, artifact_id, version, content, input_snapshot_id, generator) values ($1, $2, 1, '{}', $3, 'template')",
          [f.workspaceId, art2.id, snapA.id],
        ),
      ).rejects.toThrow(/SOURCE_MISMATCH/);
      await tx.query("rollback to savepoint s");
    });
  });
});
