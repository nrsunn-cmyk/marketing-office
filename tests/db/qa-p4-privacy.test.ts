/**
 * QA-P4-PRIVACY-DELTA-01(Tester): 후보 9749ddc 의 문의 개인정보(R1)·CRM 성과 연결 같은 프로젝트(R2) — Backend 시험과 겹치지 않는 우회·경계 공격.
 * 원문 칸 우회 읽기(조건·정렬·묶음·행 통째로), 업무실 사이, 마스킹 경계. 모든 값은 합성. inquiries 표가 없으면 건너뛴다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  asUser,
  createDb,
  expectDbError,
  one,
  seedOwner,
  type Db,
  type Fixture,
} from "./harness";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const MIG = join(import.meta.dirname, "..", "..", "supabase", "migrations");
const present = readdirSync(MIG).some(
  (f) =>
    f.endsWith(".sql") &&
    readFileSync(join(MIG, f), "utf8").includes(
      "revoke select on public.inquiries",
    ),
);

let db: Db;
let a: Fixture;
let b: Fixture;
let inqA = "";
const RAW = {
  name: "홍길동합성",
  phone: "010-9876-5432",
  email: "secret.person@example.test",
  note: "합성 메모: 비밀 상담 내용",
};
const masked = async (f: Fixture, projectId: string) =>
  (
    await asUser(db, f.userId, (tx) =>
      one<{ r: Array<Record<string, string>> }>(
        tx,
        "select public.list_masked_inquiries($1) as r",
        [projectId],
      ),
    )
  ).r;
const newInquiry = (
  f: Fixture,
  name: string,
  phone: string,
  email: string,
  note = "합성",
) =>
  asUser(db, f.userId, (tx) =>
    one<{ id: string }>(
      tx,
      "select public.create_inquiry($1, 'manual', null, $2, $3, $4, $5) as id",
      [f.projectA, name, phone, email, note],
    ),
  ).then((x) => x.id);

describe.skipIf(!present)(
  "P4 문의 개인정보·CRM 연결 우회 공격(9749ddc)",
  () => {
    beforeAll(async () => {
      db = await createDb();
      a = await seedOwner(db, "p4priv-a@example.test");
      b = await seedOwner(db, "p4priv-b@example.test");
      inqA = await newInquiry(a, RAW.name, RAW.phone, RAW.email, RAW.note);
    });

    it("원문 칸 우회 읽기: 조건·정렬·묶음·집계 조건·행 통째로·TABLE 모두 권한 거절", async () => {
      const tries = [
        "select id from public.inquiries where contact_phone like '010%'",
        "select id from public.inquiries where contact_name = '홍길동합성'",
        "select id from public.inquiries order by contact_email",
        "select count(*) from public.inquiries group by contact_name",
        "select count(*) filter (where note like '%비밀%') from public.inquiries",
        "select row_to_json(i) from public.inquiries i",
        "select i from public.inquiries i",
        "table public.inquiries",
        "select id, length(contact_phone) from public.inquiries",
        "select id from public.inquiries where position('9876' in contact_phone) > 0",
      ];
      const leaked: string[] = [];
      for (const q of tries) {
        const r = await asUser(db, a.userId, (tx) => tx.query(q)).then(
          (x) => `성공 ${JSON.stringify(x.rows).slice(0, 60)}`,
          (e: Error) => e.message,
        );
        if (!/permission denied/.test(r)) leaked.push(`${q} → ${r}`);
      }
      expect(leaked, "원문 칸이 새는 질의").toEqual([]);
      // 허용된 칸은 자기 행만
      const own = await asUser(db, a.userId, (tx) =>
        tx.query<{ id: string }>("select id, status from public.inquiries"),
      );
      expect(own.rows.map((r) => r.id)).toEqual([inqA]);
      expect(
        (
          await asUser(db, b.userId, (tx) =>
            tx.query("select id from public.inquiries"),
          )
        ).rows,
      ).toHaveLength(0);
    });

    it("가린 목록: 원문·메모가 그대로 나오지 않고 메모 칸은 아예 없음, 남의 프로젝트는 빈 목록", async () => {
      const list = await masked(a, a.projectA);
      const row = list.find((x) => x.id === inqA)!;
      const text = JSON.stringify(list);
      for (const v of Object.values(RAW)) expect(text, v).not.toContain(v);
      expect(Object.keys(row).sort()).toEqual([
        "created_at",
        "id",
        "masked_email",
        "masked_name",
        "masked_phone",
        "source_kind",
        "status",
      ]);
      expect(row.masked_email).toBe("s***@example.test");
      expect(await masked(b, a.projectA)).toEqual([]);
    });

    it("업무실 사이: 남의 문의에 후속 작업 만들기·남의 후속 작업 고치기·남의 성과 연결 모두 NOT_FOUND", async () => {
      await expectDbError(
        asUser(db, b.userId, (tx) =>
          tx.query(
            "select public.create_crm_followup($1, '남', '2026-12-01')",
            [inqA],
          ),
        ),
        /NOT_FOUND/,
      );
      const fa = (
        await asUser(db, a.userId, (tx) =>
          one<{ id: string }>(
            tx,
            "select public.create_crm_followup($1, '담당 합성', '2026-12-01') as id",
            [inqA],
          ),
        )
      ).id;
      await expectDbError(
        asUser(db, b.userId, (tx) =>
          tx.query("select public.update_crm_followup($1, 'done', null)", [fa]),
        ),
        /NOT_FOUND/,
      );
      // 상태 값 주입
      await expectDbError(
        asUser(db, a.userId, (tx) =>
          tx.query(
            "select public.update_crm_followup($1, 'done''; drop table x;--', null)",
            [fa],
          ),
        ),
        /VALIDATION/,
      );
      // 직접 쓰기는 권한 없음
      await expectDbError(
        asUser(db, a.userId, (tx) =>
          tx.query(
            "update public.crm_followups set linked_result_id = null where id = $1",
            [fa],
          ),
        ),
        /permission denied/,
      );
    });

    it("마스킹 경계: 짧은 이름·이상한 메일은 원문과 다르게 가린다", async () => {
      const cases: Array<[string, string, string]> = [
        ["김", "", ""],
        ["김철", "", "ab@x.test"],
        ["Ann", "", "@x.test"],
        ["👍🏽가", "", "noatsign"],
        ["가나다라마바사", "", "a@b@c.test"],
      ];
      const bad: string[] = [];
      for (const [n, p, e] of cases) {
        const id = await newInquiry(a, n, p, e);
        const r = (await masked(a, a.projectA)).find((x) => x.id === id)!;
        if (r.masked_name === n) bad.push(`이름 ${n} 그대로`);
        if (e && r.masked_email === e) bad.push(`메일 ${e} 그대로`);
      }
      expect(bad).toEqual([]);
    });

    // F1(Tester, 낮음~중간): app.mask_phone 은 8자 이상이면 앞 3자리 + 뒤 4자리를 보인다. 8~9자 번호(대표번호 15881234, 지역 없는 1234-5678 등)는
    //   숫자 대부분이 드러난다(휴대전화 010-****-5678 처럼 가운데 4자리는 가려야 함). 기대: 가려진 숫자 4개 이상. 고쳐지면 it.fails → it.
    it.fails(
      "F1 전화번호 마스킹: 어떤 길이든 가운데 숫자를 4개 이상 가림",
      async () => {
        const report: string[] = [];
        for (const p of [
          "15881234",
          "1234-5678",
          "0212345678",
          "010-1234-5678",
        ]) {
          const id = await newInquiry(a, "번호 합성", p, "");
          const r = (await masked(a, a.projectA)).find((x) => x.id === id)!;
          const digits = p.replace(/\D/g, "");
          const shown = r.masked_phone.replace(/\D/g, "");
          if (digits.length - shown.length < 4)
            report.push(
              `${p} → ${r.masked_phone}(${digits.length - shown.length}/${digits.length} 가림)`,
            );
          report.push(
            `${p} → ${r.masked_phone}(${shown.length}/${digits.length} 드러남)`,
          );
        }
        expect(report).toEqual([]);
      },
    );
  },
);
