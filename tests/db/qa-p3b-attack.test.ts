/**
 * QA-P3B-PREP-01(Tester): P3-b 홈페이지 구조·문구 공격 시험(PGlite). 근거: P3B-BACKEND-01-DESIGN.md 7절 + Tester 추가.
 * 이름·인자·한도는 ./qa-p3b-names.ts 한곳. migration 29 가 없으면 전체를 건너뛴다. 모든 값은 합성이다.
 * 한계: PGlite 는 연결 하나라 동시성(같은 브리프 동시 만들기·동시 저장 20)은 PG 17 에서 따로 본다.
 */
import { appendFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft } from "@/domain/strategy";
import {
  asUser,
  createDb,
  expectDbError,
  newKey,
  one,
  seedOwner,
  type Db,
  type Fixture,
  type Tx,
} from "./harness";
import {
  newPage,
  newSection,
  P3B,
  p3bMigrationPresent,
  sql,
  type Section,
  type Page,
} from "./qa-p3b-names";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });
const present = p3bMigrationPresent();
let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;
const L = P3B.limits;

const asU = <T>(f: Fixture | null, fn: (tx: Tx) => Promise<T>) =>
  asUser(db, f ? f.userId : null, fn);
const count = async (q: string, p: unknown[] = []) =>
  (await one<{ n: number }>(db, `select count(*)::int as n from (${q}) x`, p))
    .n;
const audits = (id: string) =>
  count(
    "select 1 from audit_events where entity_type = $1 and entity_id = $2",
    [P3B.auditEntity, id],
  );
const versions = (id: string) =>
  count(`select 1 from public.${P3B.versions} where doc_id = $1`, [id]);
const replica = async (fn: () => Promise<unknown>) => {
  await db.exec("set session_replication_role = replica");
  try {
    await fn();
  } finally {
    await db.exec("set session_replication_role = origin");
  }
};
const docRow = (id: string) =>
  one<{
    revision: number;
    current_version_no: number;
    status: string;
    archived_at: string | null;
    source_brief_revision: number;
    production_brief_id: string;
    workspace_id: string;
  }>(db, `select * from public.${P3B.docs} where id = $1`, [id]);
const current = async (id: string) => {
  const d = await docRow(id);
  const v = await one<{
    id: string;
    content: { pages: Page[] };
    kind: string;
    restored_from_version_no: number | null;
    source_brief_revision: number;
  }>(
    db,
    `select * from public.${P3B.versions} where doc_id = $1 and version_no = $2`,
    [id, d.current_version_no],
  );
  return { d, v, pages: v.content.pages };
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const run = <T = { r: number }>(
  tx: Tx,
  q: { text: string; params: unknown[] },
) => one<T>(tx, q.text, q.params);
/** revision 을 트랜잭션 밖에서 먼저 읽고 부른다(PGlite 는 연결이 하나라 트랜잭션 안에서 db 로 다시 물으면 멈춘다) */
const act = async (
  f: Fixture | null,
  id: string,
  mk: (rev: number) => { text: string; params: unknown[] },
) => {
  const rev = (await docRow(id)).revision;
  return asU(f, (tx) => run(tx, mk(rev)));
};
const save = async (
  f: Fixture,
  id: string,
  pages: unknown,
  status = "drafting",
  rev?: number,
) => {
  const r = rev ?? (await docRow(id)).revision;
  return (await asU(f, (tx) => run(tx, sql.save(id, r, status, pages)))).r;
};

const approveProfile = (tx: Tx, id: string) =>
  tx.query(
    "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
    [id],
  );

type Ctx = {
  projectId: string;
  strategy: {
    taskId: string;
    artifactId: string;
    versionId: string;
    content: { facts: Array<{ text: string }> } & Record<string, unknown>;
  };
  briefId: string;
};
async function newProject(f: Fixture): Promise<string> {
  return asU(
    f,
    async (tx) =>
      (
        await one<{ id: string }>(
          tx,
          "insert into projects (workspace_id, client_id, kind, title) values ($1, $2, 'client', '합성 P3B') returning id",
          [f.workspaceId, f.clientA],
        )
      ).id,
  );
}
async function strategy(
  f: Fixture,
  projectId: string,
): Promise<Ctx["strategy"]> {
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
    if (!d.ok) throw new Error(JSON.stringify(d.issues));
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
    await tx.query("select decide_version($1, $2, 'approved', null)", [
      g.artifact_id,
      g.version_id,
    ]);
    return {
      taskId,
      artifactId: g.artifact_id,
      versionId: g.version_id,
      content: d.result as unknown as Ctx["strategy"]["content"],
    };
  });
}
/** 제작 브리프(기본: web_copy 포함·확정) */
async function brief(
  f: Fixture,
  projectId: string,
  artifactId: string,
  o: { types?: string[]; status?: "ready" | "drafting" } = {},
): Promise<string> {
  return asU(f, async (tx) => {
    const types = o.types ?? ["web_copy", "ppt_deck"];
    const id = (
      await one<{ id: string }>(
        tx,
        `select ${P3B.brief.create}($1, $2, '합성 제작 브리프', '대상', '메시지', $3::text[], '범위', null, null) as id`,
        [projectId, artifactId, types],
      )
    ).id;
    if ((o.status ?? "ready") === "ready")
      await tx.query(
        `select ${P3B.brief.update}($1, 1, '합성 제작 브리프', '대상', '메시지', $2::text[], '범위', null, null, 'ready')`,
        [id, types],
      );
    return id;
  });
}
async function ctx(f: Fixture): Promise<Ctx> {
  const projectId = await newProject(f);
  const s = await strategy(f, projectId);
  return {
    projectId,
    strategy: s,
    briefId: await brief(f, projectId, s.artifactId),
  };
}
const createDoc = (
  f: Fixture,
  briefId: string,
  copyFrom: string | null = null,
) =>
  asU(f, (tx) => run<{ id: string }>(tx, sql.create(briefId, copyFrom))).then(
    (r) => r.id,
  );
const source = (f: Fixture, projectId: string, i = 0) =>
  asU(
    f,
    async (tx) =>
      (
        await one<{ id: string }>(
          tx,
          "select add_research_source($1, $2, $3, now()) as id",
          [projectId, `https://example.com/r${i}`, `합성 출처 ${i}`],
        )
      ).id,
  );

describe.skipIf(!present)(
  `P3-b 홈페이지 구조·문구 공격 시험(${P3B.docs})`,
  () => {
    beforeAll(async () => {
      db = await createDb();
      a = await seedOwner(db, "p3b-owner-a@example.test");
      b = await seedOwner(db, "p3b-owner-b@example.test");
      strategyTpl = (
        await one<{ id: string }>(
          db,
          "select id from templates where key = $1",
          [STRATEGY_TEMPLATE_VERSION],
        )
      ).id;
      await asU(a, (tx) => approveProfile(tx, a.profileA1));
      await asU(b, (tx) => approveProfile(tx, b.profileA1));
    }, 120_000);

    describe("만들기 조건·기본 판", () => {
      it("확정·web_copy 포함 브리프 → v1(create), 기본 4페이지(섹션 1개 이상, 홈은 AGY 템플릿 2개), id 모두 채움, 감사 1", async () => {
        const c = await ctx(a);
        const id = await createDoc(a, c.briefId);
        const { d, v, pages } = await current(id);
        expect(d.current_version_no).toBe(1);
        expect(v.kind).toBe("create");
        expect(pages.map((p) => p.slug)).toEqual([
          "/",
          "/about",
          "/services",
          "/contact",
        ]);
        expect(
          pages.every(
            (p) =>
              p.id && p.sections.length >= 1 && p.sections.every((x) => x.id),
          ),
        ).toBe(true);
        expect(await audits(id)).toBe(1);
      });
      it("작성 중 브리프·web_copy 없는 브리프·보관 브리프 → INVALID_TRANSITION, 남의 브리프·없는 id → NOT_FOUND, 감사 0", async () => {
        const c = await ctx(a);
        const drafting = await brief(a, c.projectId, c.strategy.artifactId, {
          status: "drafting",
        });
        const noWeb = await brief(a, c.projectId, c.strategy.artifactId, {
          types: ["ppt_deck"],
        });
        const archived = await brief(a, c.projectId, c.strategy.artifactId);
        await asU(a, (tx) =>
          tx.query(`select ${P3B.brief.archive}($1, 2)`, [archived]),
        );
        const n0 = await count(
          `select 1 from audit_events where entity_type = $1`,
          [P3B.auditEntity],
        );
        await expectDbError(createDoc(a, drafting), P3B.err.invalid);
        await expectDbError(createDoc(a, noWeb), P3B.err.invalid);
        await expectDbError(createDoc(a, archived), P3B.err.invalid);
        await expectDbError(createDoc(b, c.briefId), P3B.err.notFound);
        await expectDbError(
          createDoc(a, "00000000-0000-4000-8000-000000000000"),
          P3B.err.notFound,
        );
        expect(
          await count(`select 1 from audit_events where entity_type = $1`, [
            P3B.auditEntity,
          ]),
        ).toBe(n0);
      });
      it("보관 안 된 문서가 있으면 두 번째 만들기 거절, 보관하면 새로 만들기 가능, 보관 포함 10개째 다음은 LIMIT_REACHED", async () => {
        const c = await ctx(a);
        let id = await createDoc(a, c.briefId);
        await expectDbError(createDoc(a, c.briefId), P3B.err.invalid);
        for (let i = 1; i < L.docsPerBrief; i++) {
          await act(a, id, (rev) => sql.archive(id, rev));
          id = await createDoc(a, c.briefId);
        }
        await act(a, id, (rev) => sql.archive(id, rev));
        await expectDbError(createDoc(a, c.briefId), P3B.err.limit);
      });
      it("복사 만들기: 같은 브리프의 보관 문서 마지막 판을 복사, 다른 브리프 문서는 NOT_FOUND", async () => {
        const c = await ctx(a);
        const d1 = await createDoc(a, c.briefId);
        const p = clone((await current(d1)).pages);
        p[0]!.sections[0]!.headline = "복사될 헤드라인";
        await save(a, d1, p);
        await act(a, d1, (rev) => sql.archive(d1, rev));
        const d2 = await createDoc(a, c.briefId, d1);
        expect((await current(d2)).pages[0]!.sections[0]!.headline).toBe(
          "복사될 헤드라인",
        );
        const other = await ctx(a);
        const o1 = await createDoc(a, other.briefId);
        await act(a, d2, (rev) => sql.archive(d2, rev));
        await expectDbError(createDoc(a, c.briefId, o1), P3B.err.notFound);
      });
    });

    describe("한도(제외 섹션 포함)", () => {
      let c: Ctx;
      let id: string;
      beforeAll(async () => {
        c = await ctx(a);
        id = await createDoc(a, c.briefId);
      });
      const bad = async (pages: unknown, re = P3B.err.validation) => {
        const n0 = await versions(id);
        await expectDbError(save(a, id, pages), re);
        expect(await versions(id)).toBe(n0);
      };
      it("페이지 0·11 거절, 10 통과", async () => {
        await bad({ pages: [] }.pages);
        await bad(
          Array.from({ length: 11 }, (_, i) =>
            newPage(i + 1, i ? `/p${i}` : "/"),
          ),
        );
        await save(
          a,
          id,
          Array.from({ length: 10 }, (_, i) =>
            newPage(i + 1, i ? `/p${i}` : "/"),
          ),
        );
      });
      it("섹션: 페이지당 0·13(제외 12 + 1 포함) 거절, 12 통과(제외 포함)", async () => {
        await bad([newPage(1, "/", [])]);
        await bad([
          newPage(
            1,
            "/",
            Array.from({ length: 13 }, (_, i) =>
              newSection(i + 1, { excluded: i < 12 }),
            ),
          ),
        ]);
        await save(a, id, [
          newPage(
            1,
            "/",
            Array.from({ length: 12 }, (_, i) =>
              newSection(i + 1, { excluded: i % 2 === 0 }),
            ),
          ),
        ]);
      });
      it("문서 전체 61(제외 포함) 거절, 60 통과", async () => {
        const pages = (perPage: number[]) =>
          perPage.map((k, i) =>
            newPage(
              i + 1,
              i ? `/p${i}` : "/",
              Array.from({ length: k }, (_, j) =>
                newSection(j + 1, { excluded: j > 5 }),
              ),
            ),
          );
        await bad(pages([12, 12, 12, 12, 12, 1]));
        await save(a, id, pages([12, 12, 12, 12, 12]));
      });
    });

    describe("출처 0~10(같은 프로젝트 목록에 있는 것만)", () => {
      it("0·10 통과, 11·중복·다른 프로젝트·다른 업무실·없는 id 거절", async () => {
        const c = await ctx(a);
        const id = await createDoc(a, c.briefId);
        const mine = await Promise.all(
          Array.from({ length: 11 }, (_, i) => source(a, c.projectId, i)),
        );
        const otherProject = await ctx(a);
        const foreignProj = await source(a, otherProject.projectId, 99);
        const bctx = await ctx(b);
        const foreignWs = await source(b, bctx.projectId, 98);
        const withCites = (ids: string[]) => {
          const p = [newPage(1, "/", [newSection(1, { citation_ids: ids })])];
          return p;
        };
        await save(a, id, withCites([]));
        await save(a, id, withCites(mine.slice(0, 10)));
        for (const ids of [
          mine,
          [mine[0]!, mine[0]!],
          [foreignProj],
          [foreignWs],
          ["00000000-0000-4000-8000-0000000000c1"],
          ["x"],
        ]) {
          await expectDbError(save(a, id, withCites(ids)), P3B.err.validation);
        }
      });
    });

    describe("id 주입", () => {
      it("현재 판에 없는 uuid·다른 문서의 섹션 id·페이지 id 를 섹션 자리에·같은 id 두 번 → VALIDATION, 판 0", async () => {
        const c = await ctx(a);
        const id = await createDoc(a, c.briefId);
        const other = await createDoc(a, (await ctx(a)).briefId);
        const cur = (await current(id)).pages;
        const otherSec = (await current(other)).pages[0]!.sections[0]!.id;
        const n0 = await versions(id);
        const cases: Array<(p: Page[]) => void> = [
          (p) => {
            p[0]!.sections[0]!.id = "00000000-0000-4000-8000-0000000000d1";
          },
          (p) => {
            p[0]!.sections[0]!.id = otherSec;
          },
          (p) => {
            p[0]!.sections[0]!.id = p[1]!.id;
          },
          (p) => {
            p[1]!.sections[0]!.id = p[0]!.sections[0]!.id;
          },
          (p) => {
            p[1]!.id = p[0]!.id;
          },
          (p) => {
            p[0]!.id = "not-a-uuid";
          },
        ];
        const passed: number[] = [];
        for (const [i, mut] of cases.entries()) {
          const p = clone(cur);
          mut(p);
          await save(a, id, p).then(
            () => passed.push(i),
            (e: Error) => expect(e.message).toMatch(P3B.err.validation),
          );
        }
        expect(passed, "받아들여진 id 주입 경우(번호)").toEqual([]);
        expect(await versions(id)).toBe(n0);
        // 새 섹션은 id null → 서버가 채우고, 다음 판에서도 그대로 이어진다
        const p = clone(cur);
        const n = p[0]!.sections.length;
        p[0]!.sections.push(newSection(n + 1));
        await save(a, id, p);
        const after = (await current(id)).pages;
        expect(after[0]!.sections[n]!.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(after[0]!.sections[0]!.id).toBe(cur[0]!.sections[0]!.id);
      });
    });

    describe("형식", () => {
      let id: string;
      beforeAll(async () => {
        id = await createDoc(a, (await ctx(a)).briefId);
      });
      const one1 = (
        over: Record<string, unknown> = {},
        pageOver: Record<string, unknown> = {},
      ) => [{ ...newPage(1, "/", [newSection(1, over)]), ...pageOver }];
      it("slug: 대문자·공백·//·/a/b(설계: 한 단계)·끝 /·81자·중복·빈 값 거절, '/'·'/a-b-1' 통과", async () => {
        for (const slug of [
          "/About",
          "/a b",
          "//",
          "/a/b",
          "/a/",
          "a",
          "",
          "/-a",
          "/a--b",
          `/${"a".repeat(80)}`,
          "/%61",
        ]) {
          await expectDbError(
            save(a, id, one1({}, { slug })),
            P3B.err.validation,
          );
        }
        await expectDbError(
          save(a, id, [newPage(1, "/x"), newPage(2, "/x")]),
          P3B.err.validation,
        );
        await save(a, id, [newPage(1, "/"), newPage(2, "/a-b-1")]);
      });
      it("cta_target: javascript:·data:·http:·https://a@b·//host·201자·대소문자 섞은 JaVaScRiPt: 거절, 앞뒤 공백은 정리 뒤 저장, /contact·/contact#form·https:// 통과", async () => {
        const accepted: Array<string | null> = [];
        for (const t of [
          "javascript:alert(1)",
          "JaVaScRiPt:alert(1)",
          "data:text/html,x",
          "http://example.com",
          "https://a@b.com",
          "//evil.com",
          "/\\evil.com",
          `https://example.com/${"a".repeat(190)}`,
          "https://",
          "/a b",
        ]) {
          accepted.push(
            await save(a, id, one1({ cta_target: t, cta_label: "이동" })).then(
              () => t,
              () => null,
            ),
          );
        }
        expect(accepted.filter(Boolean), "받아들여진 cta_target").toEqual([]);
        // 앞뒤 공백은 정리한 뒤 검사·저장한다(다른 칸과 같은 규칙)
        await save(
          a,
          id,
          one1({
            cta_target: "  https://example.com/trim  ",
            cta_label: "정리",
          }),
        );
        expect((await current(id)).pages[0]!.sections[0]!.cta_target).toBe(
          "https://example.com/trim",
        );
        for (const t of [
          "/contact",
          "/contact#form",
          "/services/detail",
          "https://example.com/x?y=1",
        ])
          await save(a, id, one1({ cta_target: t, cta_label: `이동 ${t}` }));
      });
      it("sort_order 빈틈·순서 다름, 모르는 키, 잘못된 형 → VALIDATION", async () => {
        const cases: unknown[] = [
          [{ ...newPage(1, "/"), sort_order: 2 }],
          [newPage(1, "/", [newSection(1), newSection(3)])],
          [newPage(1, "/", [newSection(2), newSection(1)])],
          [{ ...newPage(1, "/"), extra: 1 }],
          [newPage(1, "/", [{ ...newSection(1), html: "<b>x</b>" }])],
          [
            newPage(1, "/", [
              { ...newSection(1), headline: 123 } as unknown as Section,
            ]),
          ],
          [
            newPage(1, "/", [
              { ...newSection(1), citation_ids: {} } as unknown as Section,
            ]),
          ],
          [
            newPage(1, "/", [
              { ...newSection(1), excluded: "false" } as unknown as Section,
            ]),
          ],
          [{ ...newPage(1, "/"), sections: null }],
          [null],
          { pages: [] },
          "문자열",
        ];
        for (const p of cases)
          await expectDbError(save(a, id, p), P3B.err.validation);
      });
    });

    describe("글자 수(코드 포인트·앞뒤 공백)·XSS 보존", () => {
      let id: string;
      beforeAll(async () => {
        id = await createDoc(a, (await ctx(a)).briefId);
      });
      const fields: Array<[string, number, boolean, "page" | "section"]> = [
        ["title", L.pageTitle, true, "page"],
        ["section_name", L.sectionName, true, "section"],
        ["purpose", L.purpose, false, "section"],
        ["headline", L.headline, true, "section"],
        ["body", L.body, false, "section"],
        ["cta_label", L.ctaLabel, false, "section"],
      ];
      const build = (where: "page" | "section", k: string, v: unknown) =>
        where === "page"
          ? [{ ...newPage(1, "/"), [k]: v }]
          : [newPage(1, "/", [{ ...newSection(1), [k]: v }])];
      for (const [k, max, req, where] of fields) {
        it(`${k}: 이모지 ${max}(앞뒤 공백 포함) 통과·${max + 1} 거절·공백만 ${req ? "거절" : "null"}`, async () => {
          await save(a, id, build(where, k, `  ${"😀".repeat(max)}  `));
          const cur = (await current(id)).pages[0]!;
          const stored =
            where === "page"
              ? (cur as Record<string, unknown>)[k]
              : (cur.sections[0] as Record<string, unknown>)[k];
          expect(Array.from(String(stored)).length).toBe(max);
          await expectDbError(
            save(a, id, build(where, k, "가".repeat(max + 1))),
            P3B.err.validation,
          );
          if (req)
            await expectDbError(
              save(a, id, build(where, k, "  \t ")),
              P3B.err.validation,
            );
          else {
            await save(a, id, build(where, k, "   "));
            const c2 = (await current(id)).pages[0]!;
            expect((c2.sections[0] as Record<string, unknown>)[k]).toBeNull();
          }
        });
      }
      it("본문 \\r\\n → \\n, XSS·SQL 모양 글은 그대로 저장", async () => {
        const x =
          "<script>window.__xss=1</script><img src=x onerror=alert(1)>'); drop table projects; --";
        await save(a, id, [
          newPage(1, "/", [
            newSection(1, {
              headline: x.slice(0, 160),
              body: `첫 줄\r\n둘째 줄 ${x}`,
            }),
          ]),
        ]);
        const s = (await current(id)).pages[0]!.sections[0]!;
        expect(s.headline).toBe(x.slice(0, 160));
        expect(s.body).toBe(`첫 줄\n둘째 줄 ${x}`);
        expect(await count("select 1 from projects")).toBeGreaterThan(0);
      });
    });

    describe("상태·바뀜 없음·충돌", () => {
      it("같은 내용 저장 → VALIDATION·감사 0·판 0, 상태만 바꾸면 새 판, 모르는 상태 거절, 틀린 revision CONFLICT", async () => {
        const id = await createDoc(a, (await ctx(a)).briefId);
        const cur = (await current(id)).pages;
        const n0 = [await versions(id), await audits(id)];
        await expectDbError(save(a, id, cur), P3B.err.validation);
        expect([await versions(id), await audits(id)]).toEqual(n0);
        await save(a, id, cur, "reviewed");
        expect((await docRow(id)).status).toBe("reviewed");
        await save(a, id, cur, "drafting");
        for (const st of ["approved", "REVIEWED", "", "ready"])
          await expectDbError(save(a, id, cur, st), P3B.err.validation);
        await expectDbError(save(a, id, cur, "reviewed", 1), P3B.err.conflict);
      });
    });

    describe("되돌리기(v n+1)", () => {
      it("v1 로 되돌리면 새 판 n+1(kind restore, restored_from=1), 내용 = v1, 지금과 같으면 VALIDATION, 없는 판·다른 문서 판 NOT_FOUND", async () => {
        const id = await createDoc(a, (await ctx(a)).briefId);
        const v1 = (await current(id)).pages;
        for (let i = 2; i <= 3; i++) {
          const p = clone(v1);
          p[0]!.sections[0]!.headline = `v${i} 헤드라인`;
          await save(a, id, p);
        }
        const rev = (await docRow(id)).revision;
        const r = await asU(a, (tx) => run(tx, sql.restore(id, rev, 1)));
        const { d, v, pages } = await current(id);
        expect(d.current_version_no).toBe(4);
        expect([v.kind, v.restored_from_version_no]).toEqual(["restore", 1]);
        expect(pages).toEqual(v1);
        expect(r.r).toBe(d.revision);
        await expectDbError(
          asU(a, (tx) => run(tx, sql.restore(id, d.revision, 4))),
          P3B.err.validation,
        );
        await expectDbError(
          asU(a, (tx) => run(tx, sql.restore(id, d.revision, 1))),
          P3B.err.validation,
        ); // v1 = 지금
        await expectDbError(
          asU(a, (tx) => run(tx, sql.restore(id, d.revision, 99))),
          P3B.err.notFound,
        );
        await expectDbError(
          asU(a, (tx) => run(tx, sql.restore(id, d.revision, 0))),
          /NOT_FOUND|VALIDATION/,
        );
        const other = await createDoc(a, (await ctx(a)).briefId);
        await save(a, other, (await current(other)).pages, "reviewed"); // other 에 v2
        await save(a, other, (await current(other)).pages, "drafting"); // v3
        const id2 = await createDoc(a, (await ctx(a)).briefId); // v1 만 있는 문서에서 v3 요청
        await expectDbError(
          asU(a, (tx) => run(tx, sql.restore(id2, 1, 3))),
          P3B.err.notFound,
        );
      });
    });

    describe("이전 브리프 기준", () => {
      it("브리프 수정 → stale, 맞추기(kind rebase, 내용 그대로), 다시 맞추기 VALIDATION, 브리프 작성 중이면 맞추기 INVALID·편집은 됨, 브리프 보관이어도 편집은 됨", async () => {
        const c = await ctx(a);
        const id = await createDoc(a, c.briefId);
        const before = (await current(id)).pages;
        await asU(a, (tx) =>
          tx.query(
            `select ${P3B.brief.update}($1, 2, '고친 제작 브리프', '대상', '메시지', $2::text[], '범위', null, null, 'ready')`,
            [c.briefId, ["web_copy", "ppt_deck"]],
          ),
        );
        const br = await one<{ revision: number }>(
          db,
          `select revision from public.${P3B.brief.table} where id = $1`,
          [c.briefId],
        );
        expect((await docRow(id)).source_brief_revision).not.toBe(br.revision);
        await act(a, id, (rev) => sql.rebase(id, rev));
        const { d, v, pages } = await current(id);
        expect([
          d.source_brief_revision,
          v.kind,
          v.source_brief_revision,
        ]).toEqual([br.revision, "rebase", br.revision]);
        expect(pages).toEqual(before);
        await expectDbError(
          asU(a, (tx) => run(tx, sql.rebase(id, d.revision))),
          P3B.err.validation,
        );
        // 브리프 작성 중
        await asU(a, (tx) =>
          tx.query(
            `select ${P3B.brief.update}($1, $3, '고친 제작 브리프 2', '대상', '메시지', $2::text[], '범위', null, null, 'drafting')`,
            [c.briefId, ["web_copy", "ppt_deck"], br.revision],
          ),
        );
        await expectDbError(
          act(a, id, (rev) => sql.rebase(id, rev)),
          P3B.err.invalid,
        );
        const p = clone(pages);
        p[0]!.sections[0]!.headline = "작성 중 브리프여도 편집";
        await save(a, id, p);
        // 브리프 보관
        const brRev = (
          await one<{ revision: number }>(
            db,
            `select revision from public.${P3B.brief.table} where id = $1`,
            [c.briefId],
          )
        ).revision;
        await asU(a, (tx) =>
          tx.query(`select ${P3B.brief.archive}($1, $2)`, [c.briefId, brRev]),
        );
        p[0]!.sections[0]!.headline = "보관 브리프여도 편집";
        await save(a, id, p);
        await expectDbError(
          act(a, id, (rev) => sql.rebase(id, rev)),
          P3B.err.invalid,
        );
      });
    });

    describe("읽기 전용·동결·추가 전용", () => {
      it("문서 보관·프로젝트 보관·전략 작업 취소 → 쓰기 4개 INVALID_TRANSITION, 읽기는 됨, 감사 보관 1행만", async () => {
        const c = await ctx(a);
        const id = await createDoc(a, c.briefId);
        const cur = (await current(id)).pages;
        const p = clone(cur);
        p[0]!.sections[0]!.headline = "바뀜";
        const writes = async (rev: number) => {
          await expectDbError(save(a, id, p, "drafting", rev), P3B.err.invalid);
          await expectDbError(
            asU(a, (tx) => run(tx, sql.restore(id, rev, 1))),
            P3B.err.invalid,
          );
          await expectDbError(
            asU(a, (tx) => run(tx, sql.rebase(id, rev))),
            P3B.err.invalid,
          );
          await expectDbError(
            asU(a, (tx) => run(tx, sql.archive(id, rev))),
            P3B.err.invalid,
          );
        };
        const n0 = await audits(id);
        await replica(() =>
          db.query("update projects set status = 'archived' where id = $1", [
            c.projectId,
          ]),
        );
        await writes(1);
        await replica(async () => {
          await db.query(
            "update projects set status = 'active' where id = $1",
            [c.projectId],
          );
          await db.query(
            "update tasks set status = 'cancelled' where id = $1",
            [c.strategy.taskId],
          );
        });
        await writes(1);
        await replica(() =>
          db.query("update tasks set status = 'completed' where id = $1", [
            c.strategy.taskId,
          ]),
        );
        await asU(a, (tx) => run(tx, sql.archive(id, 1)));
        await writes(2);
        expect(await audits(id)).toBe(n0 + 1);
        expect(
          await asU(a, (tx) =>
            tx
              .query(`select 1 from public.${P3B.versions} where doc_id = $1`, [
                id,
              ])
              .then((x) => x.rows.length),
          ),
        ).toBeGreaterThan(0);
        // 슈퍼유저 직접 수정도 동결
        await expectDbError(
          db.query(
            `update public.${P3B.docs} set status = 'reviewed' where id = $1`,
            [id],
          ),
          P3B.err.frozen,
        );
        await expectDbError(
          db.query(
            `update public.${P3B.docs} set archived_at = null where id = $1`,
            [id],
          ),
          P3B.err.frozen,
        );
      });
      it("판 표는 슈퍼유저도 고치기·지우기 거절", async () => {
        const id = await createDoc(a, (await ctx(a)).briefId);
        await expectDbError(
          db.query(
            `update public.${P3B.versions} set status = 'reviewed' where doc_id = $1`,
            [id],
          ),
          P3B.err.frozen,
        );
        await expectDbError(
          db.query(`delete from public.${P3B.versions} where doc_id = $1`, [
            id,
          ]),
          P3B.err.frozen,
        );
        expect(await versions(id)).toBe(1);
      });
      it("고정 열(업무실·프로젝트·브리프·작성자)은 슈퍼유저 UPDATE 도 거절", async () => {
        const id = await createDoc(a, (await ctx(a)).briefId);
        const other = await ctx(a);
        for (const [col, val] of [
          ["workspace_id", b.workspaceId],
          ["project_id", other.projectId],
          ["production_brief_id", other.briefId],
          ["created_by", b.userId],
        ] as const) {
          await expectDbError(
            db.query(
              `update public.${P3B.docs} set ${col} = $1 where id = $2`,
              [val, id],
            ),
            /./,
          );
        }
      });
    });

    describe("판 100 한도", () => {
      it("100판이 되면 저장·되돌리기·맞추기 LIMIT_REACHED", async () => {
        const c = await ctx(a);
        const id = await createDoc(a, c.briefId);
        const base = (await current(id)).pages;
        for (let i = 2; i <= L.versionsMax; i++) {
          const p = clone(base);
          p[0]!.sections[0]!.headline = `판 ${i}`;
          await save(a, id, p);
        }
        expect((await docRow(id)).current_version_no).toBe(L.versionsMax);
        const p = clone(base);
        p[0]!.sections[0]!.headline = "101번째";
        await expectDbError(save(a, id, p), P3B.err.limit);
        await expectDbError(
          act(a, id, (rev) => sql.restore(id, rev, 1)),
          P3B.err.limit,
        );
        await asU(a, (tx) =>
          tx.query(
            `select ${P3B.brief.update}($1, 2, '고친 브리프', '대상', '메시지', $2::text[], '범위', null, null, 'ready')`,
            [c.briefId, ["web_copy"]],
          ),
        );
        await expectDbError(
          act(a, id, (rev) => sql.rebase(id, rev)),
          P3B.err.limit,
        );
        expect(await versions(id)).toBe(L.versionsMax);
      }, 300_000);
    });

    describe("보안: 남의 업무실·RLS·직접 쓰기·anon·감사 본문 0", () => {
      it("남의 문서: 쓰기 4개 오류 문구가 없는 id 와 같다, 보관+틀린 revision 이어도 NOT_FOUND 먼저, RLS 0행", async () => {
        const c = await ctx(a);
        const id = await createDoc(a, c.briefId);
        const ghost = "00000000-0000-4000-8000-0000000000ee";
        const pages = (await current(id)).pages;
        const msg = async (
          target: string,
          q: (t: string) => { text: string; params: unknown[] },
        ) => {
          try {
            await asU(b, (tx) => run(tx, q(target)));
            return "성공함";
          } catch (e) {
            return (e as Error).message;
          }
        };
        for (const q of [
          (t: string) => sql.save(t, 1, "drafting", pages),
          (t: string) => sql.restore(t, 1, 1),
          (t: string) => sql.rebase(t, 1),
          (t: string) => sql.archive(t, 1),
        ]) {
          const mine = await msg(id, q);
          expect(mine).toMatch(P3B.err.notFound);
          expect(mine).toBe(await msg(ghost, q));
        }
        expect(
          await asU(b, (tx) =>
            tx
              .query(`select 1 from public.${P3B.docs} where id = $1`, [id])
              .then((x) => x.rows.length),
          ),
        ).toBe(0);
        expect(
          await asU(b, (tx) =>
            tx
              .query(`select 1 from public.${P3B.versions} where doc_id = $1`, [
                id,
              ])
              .then((x) => x.rows.length),
          ),
        ).toBe(0);
        await asU(a, (tx) => run(tx, sql.archive(id, 1)));
        for (const q of [
          (t: string) => sql.save(t, 99, "drafting", pages),
          (t: string) => sql.archive(t, 99),
        ])
          await expectDbError(
            asU(b, (tx) => run(tx, q(id))),
            P3B.err.notFound,
          );
      });
      it("직접 쓰기(두 표) 거절, app.*web_copy* 도우미 실행 권한 없음, RPC 5개는 정의자·authenticated 만", async () => {
        const id = await createDoc(a, (await ctx(a)).briefId);
        for (const t of [P3B.docs, P3B.versions]) {
          await expectDbError(
            asU(a, (tx) =>
              tx.query(
                `update public.${t} set created_at = now() where ${t === P3B.docs ? "id" : "doc_id"} = $1`,
                [id],
              ),
            ),
            P3B.err.denied,
          );
          await expectDbError(
            asU(a, (tx) =>
              tx.query(
                `delete from public.${t} where ${t === P3B.docs ? "id" : "doc_id"} = $1`,
                [id],
              ),
            ),
            P3B.err.denied,
          );
          await expectDbError(
            asU(a, (tx) => tx.query(`truncate public.${t}`)),
            P3B.err.denied,
          );
          await expectDbError(
            asU(null, (tx) => tx.query(`select * from public.${t}`)),
            P3B.err.denied,
          );
        }
        const helpers = (
          await db.query<{ sig: string }>(
            "select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname like '%web_copy%'",
          )
        ).rows.map((r) => r.sig);
        expect(helpers.length).toBeGreaterThan(0);
        for (const sig of helpers)
          expect(
            (
              await one<{ ok: boolean }>(
                db,
                "select has_function_privilege('authenticated', $1::regprocedure, 'execute') as ok",
                [sig],
              )
            ).ok,
            sig,
          ).toBe(false);
        for (const name of Object.values(P3B.rpc)) {
          const sig = (
            await one<{ sig: string }>(
              db,
              "select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
              [name],
            )
          ).sig;
          expect(
            (
              await one<{ ok: boolean }>(
                db,
                "select has_function_privilege('anon', $1::regprocedure, 'execute') as ok",
                [sig],
              )
            ).ok,
            name,
          ).toBe(false);
          expect(
            (
              await one<{ ok: boolean }>(
                db,
                "select has_function_privilege('authenticated', $1::regprocedure, 'execute') as ok",
                [sig],
              )
            ).ok,
            name,
          ).toBe(true);
          expect(
            (
              await one<{ d: boolean }>(
                db,
                "select prosecdef as d from pg_proc where oid = $1::regprocedure",
                [sig],
              )
            ).d,
            name,
          ).toBe(true);
        }
      });
      it("감사 details 에 제목·헤드라인·본문 글자가 없다(표식 검사)", async () => {
        const mark = "ZZ-P3B-AUDIT-77";
        const c = await ctx(a);
        const id = await createDoc(a, c.briefId);
        await save(a, id, [
          {
            ...newPage(1, "/", [
              newSection(1, {
                headline: `${mark} 헤드`,
                body: `${mark} 본문`,
                cta_label: mark,
                purpose: mark,
              }),
            ]),
            title: `${mark} 페이지`,
          },
        ]);
        await act(a, id, (rev) => sql.restore(id, rev, 1));
        await act(a, id, (rev) => sql.archive(id, rev));
        expect(
          await count(
            "select 1 from audit_events where entity_type = $1 and details::text like $2",
            [P3B.auditEntity, `%${mark}%`],
          ),
        ).toBe(0);
        expect(await audits(id)).toBe(4);
      });
    });

    // QA-P3B-BACKEND-01 추가: 칸 빠뜨리기 15가지(app.jt), Q4 브리프 보관·작성 중, Q5 되돌릴 때 출처
    describe("칸 빠뜨리기 15가지(CHECK 가 NULL 로 빠지지 않음)", () => {
      it("섹션 9칸·페이지 4칸(id 말고)을 하나씩 빼면 모두 VALIDATION, 판 0 / id 를 빼면 새 id", async () => {
        const id = await createDoc(a, (await ctx(a)).briefId);
        const n0 = await versions(id);
        // id 칸은 빠지면 null(새것)로 본다(설계 2-3: null 또는 현재 판의 id) — 아래 따로 기록
        const secKeys = [
          "section_name",
          "purpose",
          "headline",
          "body",
          "cta_label",
          "cta_target",
          "citation_ids",
          "sort_order",
          "excluded",
        ];
        const pageKeys = ["title", "slug", "sort_order", "sections"];
        const passed: string[] = [];
        for (const k of secKeys) {
          const s = newSection(1) as Record<string, unknown>;
          delete s[k];
          await save(a, id, [newPage(1, "/", [s as Section])]).then(
            () => passed.push(`섹션.${k}`),
            (e: Error) => expect(e.message).toMatch(P3B.err.validation),
          );
        }
        for (const k of pageKeys) {
          const p = newPage(1, "/") as Record<string, unknown>;
          delete p[k];
          await save(a, id, [p]).then(
            () => passed.push(`페이지.${k}`),
            (e: Error) => expect(e.message).toMatch(P3B.err.validation),
          );
        }
        for (const bad of [[{}], [newPage(1, "/", [{} as Section])]]) {
          await save(a, id, bad).then(
            () => passed.push(JSON.stringify(bad).slice(0, 30)),
            (e: Error) => expect(e.message).toMatch(P3B.err.validation),
          );
        }
        expect(passed, "빠진 칸이 통과함").toEqual([]);
        expect(await versions(id)).toBe(n0);
        // id 를 뺀 섹션은 새 id 를 받는다(기존 섹션 id 는 이어지지 않음 → 화면은 id 를 빠뜨리지 말아야 함)
        const cur = (await current(id)).pages;
        const p = clone(cur);
        delete (p[0]!.sections[0] as Record<string, unknown>).id;
        await save(
          a,
          id,
          p.map((x, i) =>
            i === 0
              ? {
                  ...x,
                  sections: x.sections.map((s, j) =>
                    j === 0 ? { ...s, headline: "id 뺌" } : s,
                  ),
                }
              : x,
          ),
        );
        expect((await current(id)).pages[0]!.sections[0]!.id).not.toBe(
          cur[0]!.sections[0]!.id,
        );
      });
    });

    describe("Q4·Q5 결정 동작", () => {
      it("브리프 보관 뒤: 문서 편집은 되고, stale 계산(revision 비교)과 맞추기 거절 문구(보관)를 기록", async () => {
        const c = await ctx(a);
        const id = await createDoc(a, c.briefId);
        const br0 = (
          await one<{ revision: number }>(
            db,
            `select revision from public.${P3B.brief.table} where id = $1`,
            [c.briefId],
          )
        ).revision;
        await asU(a, (tx) =>
          tx.query(`select ${P3B.brief.archive}($1, $2)`, [c.briefId, br0]),
        );
        const br1 = (
          await one<{ revision: number }>(
            db,
            `select revision from public.${P3B.brief.table} where id = $1`,
            [c.briefId],
          )
        ).revision;
        const d = await docRow(id);
        // 서버 stale = source_brief_revision !== brief.revision (server.ts). 보관이 revision 을 올리면 true 가 된다
        const seen = {
          보관전: br0,
          보관후: br1,
          문서기준: d.source_brief_revision,
          stale: d.source_brief_revision !== br1,
        };
        if (process.env.QA_OUT)
          appendFileSync(
            process.env.QA_OUT,
            `Q4 브리프 보관 뒤 ${JSON.stringify(seen)}
`,
          );
        let msg = "";
        await act(a, id, (rev) => sql.rebase(id, rev)).catch(
          (e: Error) => (msg = e.message),
        );
        expect(msg).toMatch(/보관한 제작 브리프라 맞출 수 없습니다/);
        const p = clone((await current(id)).pages);
        p[0]!.sections[0]!.headline = "보관 브리프 뒤 편집";
        await save(a, id, p);
      });
      it("브리프 작성 중: 맞추기 거절 문구(작성 중) 갈래", async () => {
        const c = await ctx(a);
        const id = await createDoc(a, c.briefId);
        await asU(a, (tx) =>
          tx.query(
            `select ${P3B.brief.update}($1, 2, '작성 중으로', '대상', '메시지', $2::text[], '범위', null, null, 'drafting')`,
            [c.briefId, ["web_copy"]],
          ),
        );
        let msg = "";
        await act(a, id, (rev) => sql.rebase(id, rev)).catch(
          (e: Error) => (msg = e.message),
        );
        expect(msg).toMatch(/작성 중이라 맞출 수 없습니다/);
      });
      it("Q5: 출처를 단 판(v2) → 출처 뺀 판(v3) → v2 로 되돌리면 출처가 그대로 돌아오고, 출처를 지우는 경로가 없다", async () => {
        const c = await ctx(a);
        const id = await createDoc(a, c.briefId);
        const src = await source(a, c.projectId, 1);
        const p = clone((await current(id)).pages);
        p[0]!.sections[0]!.citation_ids = [src];
        await save(a, id, p);
        p[0]!.sections[0]!.citation_ids = [];
        await save(a, id, p);
        await act(a, id, (rev) => sql.restore(id, rev, 2));
        expect((await current(id)).pages[0]!.sections[0]!.citation_ids).toEqual(
          [src],
        );
        // 직접 지우기는 RLS(select 정책만)에 걸려 0행 — 출처는 남는다
        await asU(a, (tx) =>
          tx.query("delete from public.research_sources where id = $1", [src]),
        );
        expect(
          await count("select 1 from public.research_sources where id = $1", [
            src,
          ]),
        ).toBe(1);
        const delFns = await count(
          "select 1 from pg_proc where proname ~ '(delete|remove|archive)_research_source'",
        );
        expect(delFns).toBe(0);
      });
    });
  },
);
