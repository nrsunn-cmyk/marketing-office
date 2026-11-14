import { afterAll, beforeAll, expect, it } from "vitest";
import { asUser, createDb, one, seedOwner, type Db, type Fixture } from "./harness";

/** CR12: 제목 없는 긴 한글 주소(앱이 허용하는 2,000자 이내)를 저장·검색할 수 있어야 한다. */

let db: Db;
let f: Fixture;
beforeAll(async () => {
  db = await createDb();
  f = await seedOwner(db);
}, 60_000);
afterAll(async () => {
  await db.close();
});

it("1,800자 한글 주소를 제목 없이 저장하고, 표시 이름으로 찾는다", async () => {
  let seed = 1234567;
  const path = Array.from({ length: 1800 }, () => {
    seed = (seed * 48271) % 2147483647;
    return String.fromCharCode(0xac00 + (seed % 11172));
  }).join("");
  const url = `https://review.invalid/${path}`;
  expect(url.length).toBeLessThanOrEqual(2000);
  expect(Buffer.byteLength(url)).toBeGreaterThan(2704);

  const found = await asUser(db, f.userId, async (tx) => {
    await tx.query("insert into source_assets(workspace_id, client_id, kind, url, upload_status) values ($1, $2, 'url', $3, 'stored')", [
      f.workspaceId,
      f.clientA,
      url,
    ]);
    return one<{ display_name: string }>(tx, "select display_name from source_assets where workspace_id = $1 and display_name ilike $2", [
      f.workspaceId,
      `%${path.slice(900, 920)}%`,
    ]);
  });
  expect(found.display_name).toBe(url);
});

it("표시 이름 인덱스는 없고, 목록 순서용 인덱스가 있다", async () => {
  const { rows } = await db.query<{ indexname: string }>("select indexname from pg_indexes where tablename = 'source_assets'");
  const names = rows.map((r) => r.indexname);
  expect(names).not.toContain("source_assets_display_name_idx");
  expect(names).toContain("source_assets_workspace_created_idx");
});
