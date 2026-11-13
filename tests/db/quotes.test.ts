import { beforeAll, describe, expect, it } from "vitest";
import { calculateQuote, type TaxMode } from "@/domain/quote";
import { asUser, createDb, createTask, createUser, type Db, expectDbError, type Fixture, one, seedOwner } from "./harness";

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
