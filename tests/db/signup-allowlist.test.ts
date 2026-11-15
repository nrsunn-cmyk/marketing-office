import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, type Db } from "./harness";

/** 가입 허용 목록: 목록에 없는 이메일은 DB 단계에서 계정을 만들 수 없다(앱을 거치지 않아도). */

let db: Db;
beforeAll(async () => {
  db = await createDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});

describe("가입 허용 목록", () => {
  it("목록에 없는 이메일은 계정 생성이 거절된다", async () => {
    await expect(db.query("insert into auth.users (email) values ('stranger@example.com')")).rejects.toThrow(/SIGNUP_NOT_ALLOWED/);
  });

  it("목록에 있으면 대소문자·앞뒤 공백과 관계없이 만들 수 있다", async () => {
    await db.query("insert into public.signup_allowlist (email) values ('owner@example.com')");
    const r = await db.query<{ id: string }>("insert into auth.users (email) values ('  Owner@Example.com ') returning id");
    expect(r.rows).toHaveLength(1);
  });

  it("이메일이 없는 계정(전화번호 가입 등)도 거절된다", async () => {
    await expect(db.query("insert into auth.users (email) values (null)")).rejects.toThrow(/SIGNUP_NOT_ALLOWED/);
  });

  it("목록은 소문자·@ 포함 형식만 저장된다", async () => {
    await expect(db.query("insert into public.signup_allowlist (email) values ('Upper@Example.com')")).rejects.toThrow();
    await expect(db.query("insert into public.signup_allowlist (email) values ('no-at-sign')")).rejects.toThrow();
  });

  it("로그인 사용자·익명은 목록을 읽거나 고칠 수 없다", async () => {
    const someone = (await db.query<{ id: string }>("select id from auth.users limit 1")).rows[0]!.id;
    for (const role of [someone, null]) {
      await expect(asUser(db, role, (tx) => tx.query("select * from public.signup_allowlist"))).rejects.toThrow(/permission denied/);
      await expect(
        asUser(db, role, (tx) => tx.query("insert into public.signup_allowlist (email) values ('hacker@example.com')")),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
