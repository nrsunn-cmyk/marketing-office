// P4-PHONE-MASK-BACKEND-01: 전화번호 가리기 — 어떤 길이든 숫자 4개 이상 가림, 휴대전화 형식 유지(합성 번호)
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, expectDbError, one, seedOwner, type Db } from "./harness";

let db: Db;
beforeAll(async () => {
  db = await createDb();
}, 60_000);

const mask = async (p: string | null) => (await one<{ m: string }>(db, "select app.mask_phone($1) as m", [p])).m;
const digits = (s: string) => s.replace(/\D/g, "");

describe("app.mask_phone (20261123005000)", () => {
  it.each([
    ["010-1234-5678", "010-****-5678"],
    ["01012345678", "010-****-5678"],
    ["+82 10-1234-5678", "821-****-5678"],
    ["0212345678", "02-****-5678"],
    ["031-123-4567", "03-****-4567"],
    ["15881234", "****-1234"],
    ["1588-1234", "****-1234"],
    ["1234-5678", "****-5678"],
    ["123456789", "****-6789"],
    ["1234567", "***"],
    ["112", "***"],
    ["전화 없음", "***"],
    ["", ""],
    ["   ", ""],
  ])("%s → %s", async (input, want) => {
    expect(await mask(input)).toBe(want);
  });

  it("null 은 빈칸", async () => {
    expect(await mask(null)).toBe("");
  });

  it("1~20자리 모든 길이에서 숫자를 4개 이상 가린다(드러난 숫자는 원래 숫자의 앞·뒤 부분과 같다)", async () => {
    const all = "98765432109876543210";
    for (let n = 1; n <= 20; n++) {
      const raw = all.slice(0, n);
      const m = await mask(raw);
      const shown = digits(m);
      expect(n - shown.length, `${raw} → ${m}`).toBeGreaterThanOrEqual(Math.min(4, n));
      // 드러난 숫자는 원문 앞 부분 + 뒤 4자리뿐(가운데는 보이지 않음)
      if (shown.length > 0) expect(raw.endsWith(shown.slice(-4)), `${raw} → ${m}`).toBe(true);
    }
  });

  it("Tester F2 사례 4개: 가린 숫자 4개 이상", async () => {
    for (const p of ["15881234", "1234-5678", "0212345678", "010-1234-5678"]) {
      const m = await mask(p);
      expect(digits(p).length - digits(m).length, `${p} → ${m}`).toBeGreaterThanOrEqual(4);
    }
  });

  it("가린 문의 목록 계약 그대로: 키·형식, 원문 숫자 없음", async () => {
    const owner = await seedOwner(db, "mask-list@example.test");
    await asUser(db, owner.userId, (tx) =>
      tx.query("select public.create_inquiry($1, 'manual', null, '합성문의자', '15881234', 'synthetic@example.test', '')", [owner.projectA]),
    );
    const list = await asUser(db, owner.userId, (tx) =>
      one<{ j: Array<Record<string, unknown>> }>(tx, "select public.list_masked_inquiries($1) as j", [owner.projectA]),
    );
    expect(Object.keys(list.j[0]!).sort()).toEqual(["created_at", "id", "masked_email", "masked_name", "masked_phone", "source_kind", "status"]);
    expect(list.j[0]!.masked_phone).toBe("****-1234");
    expect(JSON.stringify(list.j)).not.toContain("15881234");
  });

  it("실행 권한: 로그인·익명 역할은 마스킹 함수를 직접 부를 수 없다(기존과 같음)", async () => {
    const owner = await seedOwner(db, "mask-acl@example.test");
    await expectDbError(asUser(db, owner.userId, (tx) => tx.query("select app.mask_phone('01012345678')")), /permission denied/);
    await expectDbError(asUser(db, null, (tx) => tx.query("select app.mask_phone('01012345678')")), /permission denied/);
  });
});
