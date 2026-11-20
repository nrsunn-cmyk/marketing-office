/**
 * QA-P3A-PREP-01(Tester): P3-a 공통 제작 브리프 공격 시험(PGlite). 수용 기준: Plan/Claude-Tester-20261120/QA-PLAN-P3A-01.md R1 절.
 * 이름·인자·한도는 ./qa-p3a-names.ts 한곳에서 바꾼다. migration 28 이 없으면 전체를 건너뛴다. 모든 값은 합성이다.
 * 한계: PGlite 는 연결이 하나라 「동시」 요청은 차례로 처리된다. 진짜 동시성(L1·L2·L5)은 PG 17 전용 스택에서 따로 본다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft } from "@/domain/strategy";
import {
  asUser,
  createDb,
  createUser,
  expectDbError,
  newKey,
  one,
  seedOwner,
  type Db,
  type Fixture,
  type Tx,
} from "./harness";
import {
  DEFAULT_INPUT,
  P3A,
  p3aMigrationPresent,
  sql,
  type BriefInput,
} from "./qa-p3a-names";

const present = p3aMigrationPresent();
let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;

const asU = <T>(f: Fixture | null, fn: (tx: Tx) => Promise<T>) =>
  asUser(db, f ? f.userId : null, fn);
const count = async (q: string, p: unknown[] = []) =>
  (await one<{ n: number }>(db, `select count(*)::int as n from (${q}) x`, p))
    .n;
const audits = (id: string) =>
  count(
    "select 1 from audit_events where entity_type = $1 and entity_id = $2",
    [P3A.auditEntity, id],
  );
const allAudits = () =>
  count("select 1 from audit_events where entity_type = $1", [P3A.auditEntity]);
const replica = async (fn: () => Promise<unknown>) => {
  await db.exec("set session_replication_role = replica");
  try {
    await fn();
  } finally {
    await db.exec("set session_replication_role = origin");
  }
};
const row = (id: string) =>
  one<Record<string, unknown>>(
    db,
    `select * from public.${P3A.table} where id = $1`,
    [id],
  );
const inp = (o: Partial<BriefInput> = {}): BriefInput => ({
  ...DEFAULT_INPUT,
  ...o,
});

const create = (
  tx: Tx,
  projectId: string,
  strategyId: string,
  v: BriefInput = DEFAULT_INPUT,
) => {
  const q = sql.create(projectId, strategyId, v);
  return one<{ id: string }>(tx, q.text, q.params).then((r) => r.id);
};
const update = (
  tx: Tx,
  id: string,
  rev: number,
  v: BriefInput = inp({ title: `고친 제목 ${rev}` }),
  status = "drafting",
) => {
  const q = sql.update(id, rev, v, status);
  return one<{ r: number }>(tx, q.text, q.params).then((r) => r.r);
};
const rebase = (tx: Tx, id: string, rev: number) => {
  const q = sql.rebase(id, rev);
  return one<{ r: number }>(tx, q.text, q.params).then((r) => r.r);
};
const archive = (tx: Tx, id: string, rev: number) => {
  const q = sql.archive(id, rev);
  return one<{ r: number }>(tx, q.text, q.params).then((r) => r.r);
};

const approveProfile = (tx: Tx, id: string) =>
  tx.query(
    "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
    [id],
  );

/** 시험마다 새 프로젝트(한도·보관 상태가 섞이지 않게) */
async function newProject(
  f: Fixture,
  title = "합성 제작 프로젝트",
): Promise<string> {
  return asU(
    f,
    async (tx) =>
      (
        await one<{ id: string }>(
          tx,
          "insert into projects (workspace_id, client_id, kind, title) values ($1, $2, 'client', $3) returning id",
          [f.workspaceId, f.clientA, title],
        )
      ).id,
  );
}

type Strategy = {
  taskId: string;
  artifactId: string;
  versionId: string;
  projectId: string;
  content: { facts: Array<{ text: string }> } & Record<string, unknown>;
};
/** 실제 경로(generate_strategy → decide_version)로 전략을 만든다. approve=false 면 승인하지 않는다. */
async function strategy(
  f: Fixture,
  projectId: string,
  approve = true,
): Promise<Strategy> {
  return asU(f, async (tx) => {
    const taskId = (
      await one<{ id: string }>(
        tx,
        "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id",
        [f.workspaceId, projectId, strategyTpl, newKey()],
      )
    ).id;
    const input = {
      templateVersion: STRATEGY_TEMPLATE_VERSION,
      projectId,
      profile: {
        id: f.profileA1,
        version: 1,
        projectId,
        clientId: f.clientA,
        projectKind: "client",
      },
      sections: {
        goals: {
          facts: [
            {
              text: "합성 목표",
              sources: [
                { kind: "profile", profileId: f.profileA1, version: 1 },
              ],
            },
          ],
          inferences: [],
        },
        offers: { facts: [], inferences: [{ text: "합성 제안" }] },
      },
      unknowns: [],
    };
    const d = buildStrategyDraft(input);
    if (!d.ok) throw new Error(`계약 실패: ${JSON.stringify(d.issues)}`);
    const g = await one<{ artifact_id: string; version_id: string }>(
      tx,
      "select * from generate_strategy($1, $2, $3, $4, $5)",
      [
        taskId,
        newKey(),
        f.profileA1,
        JSON.stringify(input),
        JSON.stringify(d.result),
      ],
    );
    if (approve)
      await tx.query("select decide_version($1, $2, 'approved', null)", [
        g.artifact_id,
        g.version_id,
      ]);
    return {
      taskId,
      artifactId: g.artifact_id,
      versionId: g.version_id,
      projectId,
      content: d.result as unknown as Strategy["content"],
    };
  });
}

/** 같은 전략 결과물에 새 판을 만들어 승인한다(이전 전략 상태 만들기). 새 판 id */
async function approveNewVersion(f: Fixture, s: Strategy): Promise<string> {
  const rev = (
    await one<{ revision: number }>(
      db,
      "select revision from artifacts where id = $1",
      [s.artifactId],
    )
  ).revision;
  const edited = {
    ...s.content,
    facts: s.content.facts.map((x) => ({ ...x, text: `${x.text} v2` })),
  };
  return asU(f, async (tx) => {
    const v = await one<{ version_id: string }>(
      tx,
      "select * from save_strategy_manual_version($1, $2, $3)",
      [s.artifactId, rev, JSON.stringify(edited)],
    );
    await tx.query("select decide_version($1, $2, 'approved', null)", [
      s.artifactId,
      v.version_id,
    ]);
    return v.version_id;
  });
}

describe.skipIf(!present)(`P3-a 제작 브리프 공격 시험(${P3A.table})`, () => {
  beforeAll(async () => {
    db = await createDb();
    a = await seedOwner(db, "p3a-owner-a@example.test");
    b = await seedOwner(db, "p3a-owner-b@example.test");
    strategyTpl = (
      await one<{ id: string }>(db, "select id from templates where key = $1", [
        STRATEGY_TEMPLATE_VERSION,
      ])
    ).id;
    await asU(a, (tx) => approveProfile(tx, a.profileA1));
    await asU(b, (tx) => approveProfile(tx, b.profileA1));
  }, 120_000);

  describe("A1 승인된 전략만 바탕(STRATEGY_NOT_APPROVED·NOT_FOUND)", () => {
    it("승인 안 된 전략 → STRATEGY_NOT_APPROVED, 감사 0", async () => {
      const p = await newProject(a);
      const s = await strategy(a, p, false);
      const n0 = await allAudits();
      await expectDbError(
        asU(a, (tx) => create(tx, p, s.artifactId)),
        P3A.err.notApproved,
      );
      expect(await allAudits()).toBe(n0);
    });
    it("전략이 아닌 결과물(logo_brief) → 거절", async () => {
      const p = await newProject(a);
      // 준비 데이터는 관리자 연결로 넣는다: 권한 정리(PERM-CLEANUP-01, 묶음 P)로 로그인 사용자의 artifacts 직접 INSERT 가 막혔다(RELEASE-PREP-P-01)
      const art = await (async (tx: Db) => {
        const t = (
          await one<{ id: string }>(
            tx,
            "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'logo_brief', $3, $4) returning id",
            [a.workspaceId, p, a.logoTemplateId, newKey()],
          )
        ).id;
        return (
          await one<{ id: string }>(
            tx,
            "insert into artifacts (workspace_id, project_id, task_id, type) values ($1, $2, $3, 'logo_brief') returning id",
            [a.workspaceId, p, t],
          )
        ).id;
      })(db);
      await expectDbError(
        asU(a, (tx) => create(tx, p, art)),
        /NOT_FOUND|VALIDATION|NOT_APPROVED/,
      );
    });
    it("같은 업무실 다른 프로젝트의 전략 → NOT_FOUND", async () => {
      const p1 = await newProject(a, "P1");
      const p2 = await newProject(a, "P2");
      const s1 = await strategy(a, p1);
      await expectDbError(
        asU(a, (tx) => create(tx, p2, s1.artifactId)),
        P3A.err.notFound,
      );
    });
    it("없는 프로젝트·없는 전략 id → NOT_FOUND", async () => {
      const p = await newProject(a);
      const s = await strategy(a, p);
      await expectDbError(
        asU(a, (tx) =>
          create(tx, "00000000-0000-4000-8000-000000000000", s.artifactId),
        ),
        P3A.err.notFound,
      );
      await expectDbError(
        asU(a, (tx) => create(tx, p, "00000000-0000-4000-8000-000000000000")),
        P3A.err.notFound,
      );
    });
    it("만들면 판 id = 지금 승인본, 사본 strategy_version = 그 판 번호(A2·A16), 감사 1", async () => {
      const p = await newProject(a);
      const s = await strategy(a, p);
      const id = await asU(a, (tx) => create(tx, p, s.artifactId));
      const r = await row(id);
      expect(r.strategy_version_id).toBe(s.versionId);
      const ver = (
        await one<{ version: number }>(
          db,
          "select version from artifact_versions where id = $1",
          [s.versionId],
        )
      ).version;
      expect(
        (r.source_snapshot as { strategy_version: number }).strategy_version,
      ).toBe(ver);
      expect(r.status).toBe("drafting");
      expect(r.revision).toBe(1);
      expect(await audits(id)).toBe(1);
    });
  });

  describe("S1·S12 남의 업무실(NOT_FOUND 숨김)", () => {
    it("B 가 A 의 프로젝트·전략으로 만들기 → NOT_FOUND, A 행 읽기 0, 쓰기 4종 → NOT_FOUND(없는 id 와 같은 문구)", async () => {
      const p = await newProject(a);
      const s = await strategy(a, p);
      const id = await asU(a, (tx) => create(tx, p, s.artifactId));
      const n0 = await allAudits();
      await expectDbError(
        asU(b, (tx) => create(tx, p, s.artifactId)),
        P3A.err.notFound,
      );
      expect(
        await asU(b, (tx) =>
          tx
            .query(`select 1 from public.${P3A.table} where id = $1`, [id])
            .then((x) => x.rows.length),
        ),
      ).toBe(0);
      const ghost = "00000000-0000-4000-8000-0000000000aa";
      const msg = async (
        target: string,
        fn: (tx: Tx, t: string) => Promise<unknown>,
      ) => {
        try {
          await asU(b, (tx) => fn(tx, target));
          return "성공함";
        } catch (e) {
          return (e as Error).message;
        }
      };
      for (const fn of [
        (tx: Tx, t: string) => update(tx, t, 1),
        (tx: Tx, t: string) => rebase(tx, t, 1),
        (tx: Tx, t: string) => archive(tx, t, 1),
      ]) {
        const mine = await msg(id, fn);
        const none = await msg(ghost, fn);
        expect(mine).toMatch(P3A.err.notFound);
        expect(mine).toBe(none);
      }
      expect(await allAudits()).toBe(n0);
    });
    it("S12: 보관된 남의 브리프 + 틀린 revision 이어도 INVALID_TRANSITION·CONFLICT 가 아니라 NOT_FOUND", async () => {
      const p = await newProject(a);
      const s = await strategy(a, p);
      const id = await asU(a, (tx) => create(tx, p, s.artifactId));
      await asU(a, (tx) => archive(tx, id, 1));
      for (const fn of [
        (tx: Tx) => update(tx, id, 99),
        (tx: Tx) => rebase(tx, id, 99),
        (tx: Tx) => archive(tx, id, 99),
      ]) {
        await expectDbError(asU(b, fn), P3A.err.notFound);
      }
    });
  });

  describe("S2 다른 프로젝트·업무실 섞기(슈퍼유저 직접 INSERT 도 FK 로 막힘)", () => {
    const base = async () => {
      const p = await newProject(a);
      const s = await strategy(a, p);
      const id = await asU(a, (tx) => create(tx, p, s.artifactId));
      return { p, s, r: await row(id) };
    };
    const insertLike = (
      r: Record<string, unknown>,
      over: Record<string, unknown>,
    ) => {
      const v = { ...r, ...over };
      delete v.id;
      const cols = Object.keys(v);
      const vals = cols.map((c) =>
        v[c] !== null && typeof v[c] === "object" && !Array.isArray(v[c])
          ? JSON.stringify(v[c])
          : v[c],
      );
      return db.query(
        `insert into public.${P3A.table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        vals,
      );
    };
    it("① 다른 업무실 프로젝트", async () => {
      const { r } = await base();
      await expectDbError(
        insertLike(r, { project_id: b.projectA }),
        P3A.err.fk,
      );
    });
    it("② 같은 업무실 다른 프로젝트의 전략", async () => {
      const { r } = await base();
      const p2 = await newProject(a, "다른 프로젝트");
      const s2 = await strategy(a, p2);
      await expectDbError(
        insertLike(r, {
          strategy_artifact_id: s2.artifactId,
          strategy_version_id: s2.versionId,
        }),
        P3A.err.fk,
      );
    });
    it("③ 다른 전략의 판 id", async () => {
      const { r, p } = await base();
      const s2 = await strategy(a, p);
      await expectDbError(
        insertLike(r, { strategy_version_id: s2.versionId }),
        P3A.err.fk,
      );
    });
  });

  describe("S3 직접 쓰기·도우미 직접 호출·고정 열", () => {
    it("authenticated 의 INSERT·UPDATE·DELETE·TRUNCATE → permission denied", async () => {
      const p = await newProject(a);
      const s = await strategy(a, p);
      const id = await asU(a, (tx) => create(tx, p, s.artifactId));
      await expectDbError(
        asU(a, (tx) =>
          tx.query(
            `insert into public.${P3A.table} (workspace_id) values ($1)`,
            [a.workspaceId],
          ),
        ),
        P3A.err.denied,
      );
      await expectDbError(
        asU(a, (tx) =>
          tx.query(
            `update public.${P3A.table} set title = '직접' where id = $1`,
            [id],
          ),
        ),
        P3A.err.denied,
      );
      await expectDbError(
        asU(a, (tx) =>
          tx.query(`delete from public.${P3A.table} where id = $1`, [id]),
        ),
        P3A.err.denied,
      );
      await expectDbError(
        asU(a, (tx) => tx.query(`truncate public.${P3A.table}`)),
        P3A.err.denied,
      );
      expect((await row(id)).title).toBe(DEFAULT_INPUT.title);
    });
    it("app.* 도우미(제작 브리프용)를 authenticated 가 직접 부를 수 없다", async () => {
      const fns = (
        await db.query<{ sig: string }>(
          "select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname like '%production%'",
        )
      ).rows.map((r) => r.sig);
      expect(fns.length).toBeGreaterThan(0);
      for (const sig of fns) {
        const can = await one<{ ok: boolean }>(
          db,
          "select has_function_privilege('authenticated', $1::regprocedure, 'execute') as ok",
          [sig],
        );
        expect(can.ok, sig).toBe(false);
      }
    });
    it("공개 RPC 4개는 anon 이 아니라 authenticated 만 실행", async () => {
      for (const name of Object.values(P3A.rpc)) {
        const sigs = (
          await db.query<{ sig: string }>(
            "select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
            [name],
          )
        ).rows;
        expect(sigs.length, name).toBe(1);
        expect(
          (
            await one<{ ok: boolean }>(
              db,
              "select has_function_privilege('anon', $1::regprocedure, 'execute') as ok",
              [sigs[0].sig],
            )
          ).ok,
          name,
        ).toBe(false);
        expect(
          (
            await one<{ ok: boolean }>(
              db,
              "select has_function_privilege('authenticated', $1::regprocedure, 'execute') as ok",
              [sigs[0].sig],
            )
          ).ok,
          name,
        ).toBe(true);
        expect(
          (
            await one<{ d: boolean }>(
              db,
              "select prosecdef as d from pg_proc where oid = $1::regprocedure",
              [sigs[0].sig],
            )
          ).d,
          name,
        ).toBe(true);
      }
    });
    it("고정 열(업무실·프로젝트·전략·작성자·작성 시각)은 슈퍼유저 UPDATE 도 거절, 보관을 되돌릴 수 없다", async () => {
      const p = await newProject(a);
      const s = await strategy(a, p);
      const id = await asU(a, (tx) => create(tx, p, s.artifactId));
      const p2 = await newProject(a, "옮길 곳");
      const s2 = await strategy(a, p2);
      const other = await createUser(
        db,
        `p3a-other-${Date.now()}@example.test`,
      );
      for (const [col, val] of [
        ["workspace_id", b.workspaceId],
        ["project_id", p2],
        ["strategy_artifact_id", s2.artifactId],
        ["created_by", other],
        ["created_at", "2000-01-01T00:00:00Z"],
      ] as const) {
        await expectDbError(
          db.query(`update public.${P3A.table} set ${col} = $1 where id = $2`, [
            val,
            id,
          ]),
          /./,
        );
        expect(String((await row(id))[col])).not.toBe(String(val));
      }
      await asU(a, (tx) => archive(tx, id, 1));
      await expectDbError(
        db.query(
          `update public.${P3A.table} set archived_at = null where id = $1`,
          [id],
        ),
        /./,
      );
      expect((await row(id)).archived_at).not.toBeNull();
    });
    it("update RPC 는 판 id·사본을 바꿀 인자가 없다(rebase 만 바꾼다)", async () => {
      const args = (
        await one<{ a: string }>(
          db,
          "select pg_get_function_arguments(p.oid) as a from pg_proc p where p.proname = $1",
          [P3A.rpc.update],
        )
      ).a;
      expect(args).not.toMatch(
        /strategy|snapshot|workspace|project|created_by/i,
      );
    });
    it("사본 형식 검사: 슈퍼유저가 키를 빼거나 유형을 바꿔도 CHECK 로 거절", async () => {
      const p = await newProject(a);
      const s = await strategy(a, p);
      const id = await asU(a, (tx) => create(tx, p, s.artifactId));
      // profile_ref 는 선택 칸(설계: jsonb_strip_nulls)이라 { strategy_version: 1 } 은 올바른 사본이다
      const accepted: string[] = [];
      for (const bad of [
        {},
        { strategy_version: null },
        { strategy_version: "1" },
        { strategy_version: 0 },
        { strategy_version: 1.5 },
        { strategy_version: 1, profile_ref: "x" },
        { strategy_version: 1, extra: 1 },
        [],
      ]) {
        try {
          await db.query(
            `update public.${P3A.table} set source_snapshot = $1 where id = $2`,
            [JSON.stringify(bad), id],
          );
          accepted.push(JSON.stringify(bad));
        } catch (e) {
          expect((e as Error).message).toMatch(/check|violates|VALIDATION/i);
        }
      }
      expect(accepted, "잘못된 사본이 받아들여짐").toEqual([]);
    });
  });

  describe("S4 anon", () => {
    it("표 읽기·RPC 4개 모두 permission denied", async () => {
      const p = await newProject(a);
      const s = await strategy(a, p);
      const id = await asU(a, (tx) => create(tx, p, s.artifactId));
      await expectDbError(
        asU(null, (tx) => tx.query(`select * from public.${P3A.table}`)),
        P3A.err.denied,
      );
      await expectDbError(
        asU(null, (tx) => create(tx, p, s.artifactId)),
        P3A.err.denied,
      );
      await expectDbError(
        asU(null, (tx) => update(tx, id, 1)),
        P3A.err.denied,
      );
      await expectDbError(
        asU(null, (tx) => rebase(tx, id, 1)),
        P3A.err.denied,
      );
      await expectDbError(
        asU(null, (tx) => archive(tx, id, 1)),
        P3A.err.denied,
      );
    });
  });

  describe("A10 보관·읽기 전용(INVALID_TRANSITION, 감사 0, 읽기는 됨)", () => {
    it("보관한 브리프 / 보관한 프로젝트 / 취소된 전략 작업", async () => {
      const p = await newProject(a);
      const s = await strategy(a, p);
      const id = await asU(a, (tx) => create(tx, p, s.artifactId));
      const n0 = await audits(id);
      await replica(() =>
        db.query("update projects set status = 'archived' where id = $1", [p]),
      );
      await expectDbError(
        asU(a, (tx) => create(tx, p, s.artifactId)),
        P3A.err.invalid,
      );
      await expectDbError(
        asU(a, (tx) => update(tx, id, 1)),
        P3A.err.invalid,
      );
      await expectDbError(
        asU(a, (tx) => archive(tx, id, 1)),
        P3A.err.invalid,
      );
      expect(
        await asU(a, (tx) =>
          tx
            .query(`select 1 from public.${P3A.table} where id = $1`, [id])
            .then((x) => x.rows.length),
        ),
      ).toBe(1);
      await replica(async () => {
        await db.query("update projects set status = 'active' where id = $1", [
          p,
        ]);
        await db.query("update tasks set status = 'cancelled' where id = $1", [
          s.taskId,
        ]);
      });
      await expectDbError(
        asU(a, (tx) => create(tx, p, s.artifactId)),
        P3A.err.invalid,
      );
      await expectDbError(
        asU(a, (tx) => update(tx, id, 1)),
        P3A.err.invalid,
      );
      await replica(() =>
        db.query("update tasks set status = 'completed' where id = $1", [
          s.taskId,
        ]),
      );
      expect(await asU(a, (tx) => archive(tx, id, 1))).toBe(2);
      for (const fn of [
        (tx: Tx) => update(tx, id, 2),
        (tx: Tx) => rebase(tx, id, 2),
        (tx: Tx) => archive(tx, id, 2),
      ]) {
        await expectDbError(asU(a, fn), P3A.err.invalid);
      }
      expect(await audits(id)).toBe(n0 + 1);
    });
  });

  describe("L1 한도 10(PGlite 는 차례 처리 — 진짜 동시성은 PG 17)", () => {
    it("20개를 한꺼번에 요청 → 정확히 10개, 나머지 LIMIT_REACHED, 보관하면 다시 1개", async () => {
      const p = await newProject(a);
      const s = await strategy(a, p);
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          asU(a, (tx) =>
            create(tx, p, s.artifactId, inp({ title: `한도 ${i}` })),
          ),
        ),
      );
      const okIds = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<string>).value);
      const bad = results
        .filter((r) => r.status === "rejected")
        .map((r) => String((r as PromiseRejectedResult).reason?.message));
      expect(okIds.length).toBe(P3A.limit);
      expect(bad.every((m) => P3A.err.limit.test(m))).toBe(true);
      expect(
        await count(
          `select 1 from public.${P3A.table} where project_id = $1 and archived_at is null`,
          [p],
        ),
      ).toBe(P3A.limit);
      await asU(a, (tx) => archive(tx, okIds[0], 1));
      await asU(a, (tx) => create(tx, p, s.artifactId));
      await expectDbError(
        asU(a, (tx) => create(tx, p, s.artifactId)),
        P3A.err.limit,
      );
      // 다른 프로젝트는 따로 센다
      const p2 = await newProject(a, "다른 한도");
      const s2 = await strategy(a, p2);
      await asU(a, (tx) => create(tx, p2, s2.artifactId));
    });
  });

  describe("입력 경계(A5·A6·A14)와 XSS 글자 그대로 저장", () => {
    let p: string;
    let s: Strategy;
    beforeAll(async () => {
      p = await newProject(a, "경계");
      s = await strategy(a, p);
    });
    const tryCreate = (v: Partial<BriefInput>) =>
      asU(a, async (tx) => {
        const id = await create(tx, p, s.artifactId, inp(v));
        await tx.query(`select ${P3A.rpc.archive}($1, 1)`, [id]); // 한도에 걸리지 않게 바로 보관
        return id;
      });
    const keys: Array<[keyof BriefInput, string]> = [
      ["title", "title"],
      ["targetAudience", "targetAudience"],
      ["coreMessage", "coreMessage"],
      ["scopeSummary", "scopeSummary"],
      ["brandToneConstraints", "brandToneConstraints"],
      ["referenceNotes", "referenceNotes"],
    ];
    for (const [k] of keys) {
      const lim = P3A.fields[k as keyof typeof P3A.fields];
      it(`${k}: 상한 ${lim.max}(이모지·앞뒤 공백 포함)은 통과, 상한+1 은 VALIDATION${lim.min ? ", 공백만은 VALIDATION" : ", 공백만은 null"}`, async () => {
        const emoji = "😀".repeat(lim.max); // 코드 포인트 max, UTF-16 2×max
        const id = await tryCreate({
          [k]: `  ${emoji}  `,
        } as Partial<BriefInput>);
        const col = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        expect(Array.from(String((await row(id))[col])).length).toBe(lim.max);
        await expectDbError(
          tryCreate({ [k]: "가".repeat(lim.max + 1) } as Partial<BriefInput>),
          P3A.err.validation,
        );
        if (lim.min)
          await expectDbError(
            tryCreate({ [k]: "  \t  " } as Partial<BriefInput>),
            P3A.err.validation,
          );
        else
          expect(
            (await row(await tryCreate({ [k]: "   " } as Partial<BriefInput>)))[
              col
            ],
          ).toBeNull();
      });
    }
    it("산출물 종류: 0개·5개·중복·모르는 값·대소문자·null 원소 → VALIDATION, 4개 모두는 통과", async () => {
      for (const bad of [
        [],
        ["web_copy", "design_assets", "video_plan", "ppt_deck", "web_copy"],
        ["ppt_deck", "ppt_deck"],
        ["website"],
        ["web-copy"],
        ["WEB_COPY"],
        ["ppt_template"],
        [null],
      ]) {
        await expectDbError(
          tryCreate({ deliverables: bad }),
          P3A.err.validation,
        );
      }
      const id = await tryCreate({ deliverables: [...P3A.deliverables] });
      expect((await row(id)).deliverable_types).toEqual([...P3A.deliverables]);
    });
    it("상태 값: drafting·ready 만, ready 에서 고치기·drafting 되돌리기 가능, 모르는 값은 VALIDATION", async () => {
      const id = await asU(a, (tx) => create(tx, p, s.artifactId));
      expect(await asU(a, (tx) => update(tx, id, 1, inp(), "ready"))).toBe(2);
      expect(
        await asU(a, (tx) =>
          update(tx, id, 2, inp({ title: "확정 상태에서 고침" }), "ready"),
        ),
      ).toBe(3);
      expect(
        await asU(a, (tx) =>
          update(tx, id, 3, inp({ title: "확정 상태에서 고침" }), "drafting"),
        ),
      ).toBe(4);
      for (const st of ["confirmed", "archived", "READY", ""])
        await expectDbError(
          asU(a, (tx) => update(tx, id, 4, inp({ title: st || "빈" }), st)),
          P3A.err.validation,
        );
      await asU(a, (tx) => archive(tx, id, 4));
    });
    it("A14 바뀐 것 없는 저장(앞뒤 공백만 다른 값 포함) → VALIDATION, revision·감사 그대로 / CONFLICT", async () => {
      const id = await asU(a, (tx) => create(tx, p, s.artifactId));
      const n0 = await audits(id);
      await expectDbError(
        asU(a, (tx) => update(tx, id, 1, inp())),
        P3A.err.validation,
      );
      await expectDbError(
        asU(a, (tx) =>
          update(tx, id, 1, inp({ title: `  ${DEFAULT_INPUT.title}  ` })),
        ),
        P3A.err.validation,
      );
      await expectDbError(
        asU(a, (tx) => update(tx, id, 7)),
        P3A.err.conflict,
      );
      expect((await row(id)).revision).toBe(1);
      expect(await audits(id)).toBe(n0);
      await asU(a, (tx) => archive(tx, id, 1));
    });
    it("XSS·SQL 처럼 보이는 글은 글자 그대로 저장된다(화면 처리는 E2E S6)", async () => {
      const payloads = [
        "<script>window.__xss=1</script>",
        "<img/src=x/onerror=window.__xss=2>",
        '<a href="javascript:alert(1)">x</a>',
        "</textarea><svg onload=alert(1)>",
        "&#106;avascript:alert(1)",
        "'); drop table projects; --",
        "{{7*7}} ${7*7} <%= 7*7 %>",
      ];
      for (const x of payloads) {
        const id = await tryCreate({
          title: x.slice(0, 120),
          coreMessage: x,
          referenceNotes: x,
        });
        const r = await row(id);
        expect([r.title, r.core_message, r.reference_notes]).toEqual([
          x.slice(0, 120),
          x,
          x,
        ]);
      }
      expect(await count("select 1 from projects where id = $1", [p])).toBe(1);
    });
    it("A12 감사 details 에 본문 글자가 없다(표식 검사)", async () => {
      const mark = "ZZ-AUDIT-PROBE-7f3";
      const id = await asU(a, (tx) =>
        create(
          tx,
          p,
          s.artifactId,
          inp({ title: `${mark} 제목`, scopeSummary: `${mark} 범위` }),
        ),
      );
      await asU(a, (tx) =>
        update(
          tx,
          id,
          1,
          inp({ title: `${mark} 고침`, coreMessage: `${mark} 메시지` }),
        ),
      );
      await asU(a, (tx) => archive(tx, id, 2));
      expect(
        await count(
          "select 1 from audit_events where entity_type = $1 and details::text like $2",
          [P3A.auditEntity, `%${mark}%`],
        ),
      ).toBe(0);
      expect(await audits(id)).toBe(3);
    });
  });

  describe("A4·A15 이전 전략과 맞추기", () => {
    it("새 판 승인 → 이전 전략(판 id ≠ 승인본), rebase 로 맞춤(사본도 새 판), 다시 하면 VALIDATION·감사 0", async () => {
      const p = await newProject(a);
      const s = await strategy(a, p);
      const id = await asU(a, (tx) => create(tx, p, s.artifactId));
      await expectDbError(
        asU(a, (tx) => rebase(tx, id, 1)),
        P3A.err.validation,
      );
      const v2 = await approveNewVersion(a, s);
      const stale = await one<{ stale: boolean }>(
        db,
        `select b.strategy_version_id is distinct from a.approved_version_id as stale from public.${P3A.table} b join artifacts a on a.id = b.strategy_artifact_id where b.id = $1`,
        [id],
      );
      expect(stale.stale).toBe(true);
      const n0 = await audits(id);
      expect(await asU(a, (tx) => rebase(tx, id, 1))).toBe(2);
      const r = await row(id);
      expect(r.strategy_version_id).toBe(v2);
      const ver = (
        await one<{ version: number }>(
          db,
          "select version from artifact_versions where id = $1",
          [v2],
        )
      ).version;
      expect(
        (r.source_snapshot as { strategy_version: number }).strategy_version,
      ).toBe(ver);
      expect(await audits(id)).toBe(n0 + 1);
      await expectDbError(
        asU(a, (tx) => rebase(tx, id, 2)),
        P3A.err.validation,
      );
      expect(await audits(id)).toBe(n0 + 1);
    });
  });
});
