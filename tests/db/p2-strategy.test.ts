/**
 * P2-STRATEGY-IMPL-01: 전략 1종 DB 후보(20261117001000_p2_strategy) 시험.
 * 번호는 Plan/Claude-Plan-Audit-20261116/P2-DB-DESIGN-01.md 7·9절 T1–T17.
 * 입력·결과는 실제 순수 함수(strategyInputSchema·buildStrategyDraft)로 만든다. 모든 값은 합성이다.
 * T10(이전 전략 근거 결과물 승인)은 사용자 결정 DEC-P2-01-A 전이라 하위 유형이 없어 시험하지 않는다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft, type StrategyDraft } from "@/domain/strategy";
import { asUser, createDb, expectDbError, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;
let assetA: string; // 프로젝트 A 자료
let assetB: string; // 같은 업무실, 프로젝트 B 자료

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "p2-owner-a@example.test");
  b = await seedOwner(db, "p2-owner-b@example.test");
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
  const asset = (projectId: string, url: string) =>
    asA(async (tx) =>
      (await one<{ id: string }>(tx, "insert into source_assets (workspace_id, project_id, kind, url) values ($1, $2, 'url', $3) returning id", [a.workspaceId, projectId, url])).id,
    );
  assetA = await asset(a.projectA, "https://example.com/a");
  assetB = await asset(a.projectB, "https://example.com/b");
}, 60_000); // 병렬 부하에서 PGlite 준비가 10초를 넘을 수 있다(QA-SEC-RELEASE-04 T1)

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const asAnon = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn);
const count = async (sql: string, p: unknown[] = []) => (await one<{ n: number }>(db, `select count(*)::int as n from (${sql}) x`, p)).n;

/** 프로젝트 A·프로필 A1 기준 계약 입력. sources 를 바꿔 끼울 수 있다 */
function strategyInput(opts: { profileVersion?: number; profileId?: string; sources?: unknown[]; projectId?: string } = {}) {
  const pid = opts.projectId ?? a.projectA;
  return {
    templateVersion: STRATEGY_TEMPLATE_VERSION,
    projectId: pid,
    profile: { id: opts.profileId ?? a.profileA1, version: opts.profileVersion ?? 1, projectId: pid, clientId: a.clientA, projectKind: "client" },
    sections: {
      goals: { facts: [{ text: "합성 목표", sources: opts.sources ?? [{ kind: "profile", profileId: opts.profileId ?? a.profileA1, version: opts.profileVersion ?? 1 }] }], inferences: [] },
      offers: { facts: [], inferences: [{ text: "합성 추정" }] },
    },
    unknowns: [{ topic: "합성 미확인" }],
  };
}
/** 계약을 통과시키고 (입력, 결과) 를 돌려준다 */
function draft(input: ReturnType<typeof strategyInput>) {
  const r = buildStrategyDraft(input);
  if (!r.ok) throw new Error(`계약 실패: ${JSON.stringify(r.issues)}`);
  return { input, content: r.result };
}
const newStrategyTask = (tx: Tx, f: Fixture = a, projectId = a.projectA) =>
  one<{ id: string }>(
    tx,
    "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id",
    [f.workspaceId, projectId, strategyTpl, newKey()],
  ).then((r) => r.id);
/** 지금 마지막 결정 순번을 기대값으로 넘겨 승인·철회한다(20261117002000 원자 확인) */
const approveProfile = (tx: Tx, id: string, decision = "approved") =>
  tx.query(
    "select approve_company_profile_version($1, $2, coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
    [id, decision],
  );
const generate = (tx: Tx, taskId: string, profileId: string, d: { input: unknown; content: unknown }, key = newKey()) =>
  one<{ artifact_id: string; version_id: string; version: number; reused: boolean }>(
    tx,
    "select * from generate_strategy($1, $2, $3, $4, $5)",
    [taskId, key, profileId, JSON.stringify(d.input), JSON.stringify(d.content)],
  );

// 프로필 A1 승인(대부분의 시험 전제). 고객 B 프로필은 승인하지 않는다.
beforeAll(async () => {
  await asA((tx) => approveProfile(tx, a.profileA1));
}, 60_000); // 병렬 부하에서 PGlite 준비가 10초를 넘을 수 있다(QA-SEC-RELEASE-04 T1)

describe("정상 흐름: 프로필 승인 → 생성 → 직접 고치기 → 승인", () => {
  it("DB가 프로필 사본·근거 참조를 직접 만들고, 작업은 review → completed", async () => {
    const d = draft(strategyInput({ sources: [{ kind: "profile", profileId: a.profileA1, version: 1 }, { kind: "asset", assetId: assetA, projectId: a.projectA }] }));
    const { taskId, g } = await asA(async (tx) => {
      const taskId = await newStrategyTask(tx);
      return { taskId, g: await generate(tx, taskId, a.profileA1, d) };
    });
    expect(g.version).toBe(1);
    expect(g.reused).toBe(false);
    // 근거 참조: 프로필 1 + 자료 1 (FK 표)
    const refs = (await db.query<{ ref_kind: string; company_profile_version_id: string | null; source_asset_id: string | null }>(
      "select ref_kind, company_profile_version_id, source_asset_id from artifact_version_refs where from_version_id = $1 order by ref_kind", [g.version_id],
    )).rows;
    expect(refs).toEqual([
      { ref_kind: "company_profile_version", company_profile_version_id: a.profileA1, source_asset_id: null },
      { ref_kind: "source_asset", company_profile_version_id: null, source_asset_id: assetA },
    ]);
    // 입력 사본: 프로필 내용은 DB 값(시드 products='식빵'), 참조 목록도 DB가 만든 것
    const snap = await one<{ products: string; refs: unknown; hash: string }>(
      db,
      `select s.profile_snapshot #>> '{profile,products}' as products, s.source_version_refs as refs, s.input_hash as hash
         from task_input_snapshots s join artifact_versions v on v.input_snapshot_id = s.id where v.id = $1`, [g.version_id],
    );
    expect(snap.products).toBe("식빵");
    expect(snap.refs).toEqual([{ type: "company_profile_version", id: a.profileA1, version: 1 }, { type: "source_asset", id: assetA }]);
    expect(snap.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await one<{ status: string }>(db, "select status from tasks where id = $1", [taskId])).status).toBe("review");

    // 직접 고치기: 새 초안, 근거 참조 승계
    const art = await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [g.artifact_id]);
    const edited = { ...d.content, facts: d.content.facts.map((f) => ({ ...f, text: `${f.text} (수정)` })) };
    const v2 = await asA((tx) =>
      one<{ version_id: string; version: number }>(tx, "select * from save_strategy_manual_version($1, $2, $3)", [g.artifact_id, art.revision, JSON.stringify(edited)]),
    );
    expect(v2.version).toBe(2);
    expect(await count("select 1 from artifact_version_refs where from_version_id = $1", [v2.version_id])).toBe(2);
    // 승인은 기존 decide_version(정의자)
    await asA((tx) => tx.query("select decide_version($1, $2, 'approved', null)", [g.artifact_id, v2.version_id]));
    expect((await one<{ status: string }>(db, "select status from tasks where id = $1", [taskId])).status).toBe("completed");
    expect((await one<{ v: string }>(db, "select approved_version_id as v from artifacts where id = $1", [g.artifact_id])).v).toBe(v2.version_id);
  });

  it("승인 기록의 행위자는 본인이고 감사 기록이 남는다(T4)", async () => {
    const ap = await one<{ actor_id: string; decision: string }>(db, "select actor_id, decision from company_profile_approvals where company_profile_version_id = $1 order by seq limit 1", [a.profileA1]);
    expect(ap).toEqual({ actor_id: a.userId, decision: "approved" });
    expect(await count("select 1 from audit_events where entity_id = $1 and action = 'profile_approved'", [a.profileA1])).toBe(1);
  });
});

describe("프로필 승인 규칙", () => {
  it("T1 승인되지 않은 프로필 버전으로 생성 → PROFILE_NOT_APPROVED", async () => {
    const pv2 = await asA(async (tx) =>
      (await one<{ id: string }>(tx, "insert into company_profile_versions (workspace_id, client_id, version, products) values ($1, $2, 2, '케이크') returning id", [a.workspaceId, a.clientA])).id,
    );
    const d = draft(strategyInput({ profileId: pv2, profileVersion: 2 }));
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), pv2, d)), /PROFILE_NOT_APPROVED/);
  });

  it("승인 철회(revoked) 뒤에는 생성 불가, 다시 승인하면 가능", async () => {
    const pv3 = await asA(async (tx) =>
      (await one<{ id: string }>(tx, "insert into company_profile_versions (workspace_id, client_id, version) values ($1, $2, 3) returning id", [a.workspaceId, a.clientA])).id,
    );
    const d = draft(strategyInput({ profileId: pv3, profileVersion: 3 }));
    await asA((tx) => approveProfile(tx, pv3));
    await asA((tx) => approveProfile(tx, pv3, "revoked"));
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), pv3, d)), /PROFILE_NOT_APPROVED/);
    await asA((tx) => approveProfile(tx, pv3));
    expect((await asA(async (tx) => generate(tx, await newStrategyTask(tx), pv3, d))).version).toBe(1);
  });

  it("T2 다른 고객의 프로필 버전 → PROFILE_MISMATCH", async () => {
    await asA((tx) => approveProfile(tx, a.profileB1));
    const d = draft(strategyInput());
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileB1, d)), /PROFILE_MISMATCH/);
  });

  it("T3 승인 기록을 직접 insert → 거절(정책 없음)", async () => {
    await expectDbError(
      asA((tx) => tx.query(
        "insert into company_profile_approvals (workspace_id, client_id, company_profile_version_id, actor_id, decision) values ($1, $2, $3, $4, 'approved')",
        [a.workspaceId, a.clientA, a.profileA1, a.userId],
      )),
      /row-level security/,
    );
  });

  it("T9 승인 기록·프로필 버전은 수정·삭제 불가", async () => {
    await expectDbError(db.query("update company_profile_approvals set decision = 'revoked'"), /IMMUTABLE_ROW/);
    await expectDbError(db.query("delete from company_profile_approvals"), /IMMUTABLE_ROW/);
    await expectDbError(db.query("update company_profile_versions set products = 'x' where id = $1", [a.profileA1]), /IMMUTABLE_ROW/);
  });

  it("알 수 없는 결정 값 → VALIDATION", async () => {
    await expectDbError(asA((tx) => approveProfile(tx, a.profileA1, "maybe")), /VALIDATION/);
  });
});

describe("업무실·프로젝트 경계 (P0)", () => {
  it("T5 다른 업무실 사용자는 A의 프로필 승인·전략 생성·고치기·출처 추가 모두 NOT_FOUND", async () => {
    const d = draft(strategyInput());
    const { taskId, g } = await asA(async (tx) => {
      const taskId = await newStrategyTask(tx);
      return { taskId, g: await generate(tx, taskId, a.profileA1, d) };
    });
    await expectDbError(asB((tx) => approveProfile(tx, a.profileA1)), /NOT_FOUND/);
    await expectDbError(asB((tx) => generate(tx, taskId, a.profileA1, d)), /NOT_FOUND/);
    await expectDbError(asB((tx) => tx.query("select * from save_strategy_manual_version($1, 1, $2)", [g.artifact_id, JSON.stringify(d.content)])), /NOT_FOUND/);
    await expectDbError(asB((tx) => tx.query("select add_research_source($1, 'https://example.com/x', '제목', now())", [a.projectA])), /NOT_FOUND/);
  });

  it("T5 다른 업무실 사용자는 A의 승인 기록·근거 참조·출처를 볼 수 없다", async () => {
    await asA((tx) => tx.query("select add_research_source($1, 'https://example.com/s', '합성 출처', now())", [a.projectA]));
    for (const t of ["company_profile_approvals", "artifact_version_refs", "research_sources"]) {
      expect((await asB((tx) => tx.query(`select 1 from ${t}`))).rows, t).toEqual([]);
    }
  });

  it("T6 같은 업무실의 다른 프로젝트 자료를 출처로 → SOURCE_MISMATCH", async () => {
    const d = draft(strategyInput({ sources: [{ kind: "asset", assetId: assetB, projectId: a.projectA }] }));
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, d)), /SOURCE_MISMATCH/);
  });

  it("T6 근거 참조 표는 관리자가 넣어도 프로젝트·고객이 다르면 REF_MISMATCH(트리거)", async () => {
    const v = await one<{ id: string }>(db, "select v.id from artifact_versions v join artifacts a on a.id = v.artifact_id where a.type = 'strategy' and a.project_id = $1 limit 1", [a.projectA]);
    await expectDbError(
      db.query("insert into artifact_version_refs (workspace_id, project_id, from_version_id, ref_kind, source_asset_id) values ($1, $2, $3, 'source_asset', $4)", [a.workspaceId, a.projectA, v.id, assetB]),
      /REF_MISMATCH/,
    );
    await expectDbError(
      db.query("insert into artifact_version_refs (workspace_id, project_id, from_version_id, ref_kind, company_profile_version_id) values ($1, $2, $3, 'company_profile_version', $4)", [a.workspaceId, a.projectA, v.id, a.profileB1]),
      /REF_MISMATCH/,
    );
  });

  it("T7 승인되지 않은 결과 버전을 근거로 참조 → REF_MISMATCH(하위 유형 대비)", async () => {
    const d = draft(strategyInput());
    const g = await asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, d));
    const other = await one<{ id: string }>(db, "select v.id from artifact_versions v join artifacts a on a.id = v.artifact_id where a.type = 'strategy' and v.id <> $1 limit 1", [g.version_id]);
    await expectDbError(
      db.query("insert into artifact_version_refs (workspace_id, project_id, from_version_id, ref_kind, to_version_id) values ($1, $2, $3, 'artifact_version', $4)", [a.workspaceId, a.projectA, other.id, g.version_id]),
      /REF_MISMATCH/,
    );
  });

  it("T14 비로그인은 새 표를 읽을 수 없고 RPC 를 실행할 수 없다", async () => {
    for (const t of ["company_profile_approvals", "artifact_version_refs", "research_sources"]) {
      await expectDbError(asAnon((tx) => tx.query(`select 1 from ${t}`)), /permission denied/);
    }
    await expectDbError(asAnon((tx) => approveProfile(tx, a.profileA1)), /permission denied/);
    await expectDbError(asAnon((tx) => tx.query("select * from generate_strategy(gen_random_uuid(), 'k-12345678', gen_random_uuid(), '{}', '{}')")), /permission denied/);
  });

  it("T15 출처: 다른 업무실 프로젝트 → NOT_FOUND, http(s) 아닌 주소 → 거절, 직접 insert → 거절", async () => {
    await expectDbError(asA((tx) => tx.query("select add_research_source($1, 'https://example.com/x', '제목', now())", [b.projectA])), /NOT_FOUND/);
    await expectDbError(asA((tx) => tx.query("select add_research_source($1, 'javascript:alert(1)', '제목', now())", [a.projectA])), /research_sources_url_check|check constraint/);
    await expectDbError(
      asA((tx) => tx.query("insert into research_sources (workspace_id, project_id, url, title, retrieved_at, created_by) values ($1, $2, 'https://example.com', 't', now(), $3)", [a.workspaceId, a.projectA, a.userId])),
      /row-level security/,
    );
  });

  it("출처 검토 상태: 본인만, revision 충돌은 CONFLICT", async () => {
    const id = await asA(async (tx) => (await one<{ id: string }>(tx, "select add_research_source($1, 'https://example.com/r', '검토 대상', now()) as id", [a.projectA])).id);
    const r = await asA(async (tx) => (await one<{ r: number }>(tx, "select set_research_source_review($1, 'verified', 1) as r", [id])).r);
    expect(r).toBe(2);
    await expectDbError(asA((tx) => tx.query("select set_research_source_review($1, 'unverified', 1)", [id])), /CONFLICT/);
    await expectDbError(asB((tx) => tx.query("select set_research_source_review($1, 'unverified', 2)", [id])), /NOT_FOUND/);
  });
});

describe("직접 쓰기 차단 (T16) — 전략 유형만, P1은 그대로", () => {
  it("전략 결과물·버전·입력 사본을 로그인 역할이 직접 넣으면 DIRECT_WRITE_FORBIDDEN", async () => {
    const taskId = await asA((tx) => newStrategyTask(tx));
    await expectDbError(
      asA((tx) => tx.query("insert into artifacts (workspace_id, project_id, task_id, type) values ($1, $2, $3, 'strategy')", [a.workspaceId, a.projectA, taskId])),
      /DIRECT_WRITE_FORBIDDEN/,
    );
    await expectDbError(
      asA((tx) => tx.query("insert into task_input_snapshots (workspace_id, task_id, profile_snapshot, input_hash) values ($1, $2, '{}', 'h')", [a.workspaceId, taskId])),
      /DIRECT_WRITE_FORBIDDEN/,
    );
    const g = await asA((tx) => generate(tx, taskId, a.profileA1, draft(strategyInput())));
    await expectDbError(
      asA((tx) => tx.query("insert into artifact_versions (workspace_id, artifact_id, version, content, generator) values ($1, $2, 99, '{}', 'manual')", [a.workspaceId, g.artifact_id])),
      /DIRECT_WRITE_FORBIDDEN/,
    );
  });

  it("P1 호출자 권한 RPC(record_generation·save_manual_version)로 전략을 우회 저장 → DIRECT_WRITE_FORBIDDEN", async () => {
    const taskId = await asA((tx) => newStrategyTask(tx));
    await expectDbError(
      asA((tx) => tx.query("select * from record_generation($1, $2, 'h', '{}', '{}', '[]', '{}', 'template')", [taskId, newKey()])),
      /DIRECT_WRITE_FORBIDDEN/,
    );
    const g = await asA((tx) => generate(tx, taskId, a.profileA1, draft(strategyInput())));
    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [g.artifact_id])).revision;
    await expectDbError(asA((tx) => tx.query("select * from save_manual_version($1, $2, '{}')", [g.artifact_id, rev])), /DIRECT_WRITE_FORBIDDEN/);
  });

  it("근거 참조 직접 insert → 거절(정책 없음), 수정·삭제 → IMMUTABLE_ROW(T8)", async () => {
    const v = await one<{ id: string }>(db, "select from_version_id as id from artifact_version_refs limit 1");
    await expectDbError(
      asA((tx) => tx.query("insert into artifact_version_refs (workspace_id, project_id, from_version_id, ref_kind, company_profile_version_id) values ($1, $2, $3, 'company_profile_version', $4)", [a.workspaceId, a.projectA, v.id, a.profileA1])),
      /row-level security/,
    );
    await expectDbError(db.query("update artifact_version_refs set ref_kind = ref_kind"), /IMMUTABLE_ROW/);
    await expectDbError(db.query("delete from artifact_version_refs"), /IMMUTABLE_ROW/);
  });

  it("P1 로고 경로는 그대로 동작한다(직접 쓰기 차단은 전략에만)", async () => {
    const r = await asA(async (tx) => {
      const t = await one<{ id: string }>(tx, "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'logo_brief', $3, $4) returning id", [a.workspaceId, a.projectA, a.logoTemplateId, newKey()]);
      return one<{ version: number }>(tx, "select * from record_generation($1, $2, 'h', '{}', '{}', '[]', '{\"brief\":\"b\"}', 'template')", [t.id, newKey()]);
    });
    expect(r.version).toBe(1);
  });
});

describe("입력·결과 대조와 중복 요청", () => {
  it("T17 결과의 프로필 참조가 실제와 다름 → CONTENT_MISMATCH", async () => {
    const d = draft(strategyInput());
    const forged = { ...d, content: { ...d.content, profileRef: { id: a.profileA1, version: 9 } } };
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, forged)), /CONTENT_MISMATCH/);
  });

  it("T17 입력의 프로젝트가 작업 프로젝트와 다름 → CONTENT_MISMATCH", async () => {
    const d = draft(strategyInput({ projectId: a.projectB }));
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, d)), /CONTENT_MISMATCH|PROFILE_MISMATCH/);
  });

  it("T17 입력의 프로필 출처 버전이 참조 버전과 다름 → SOURCE_MISMATCH(계약을 우회한 입력)", async () => {
    const d = draft(strategyInput());
    // 입력만 바꾸면 결과와 달라 CONTENT_MISMATCH, 입력·결과를 같이 바꾸면 출처 규칙으로 SOURCE_MISMATCH
    const badSrc = [{ kind: "profile", profileId: a.profileA1, version: 7 }];
    const inputOnly = { ...d, input: { ...d.input, sections: { ...d.input.sections, goals: { facts: [{ text: "합성 목표", sources: badSrc }], inferences: [] } } } };
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, inputOnly)), /CONTENT_MISMATCH/);
    const both = { input: inputOnly.input, content: { ...d.content, facts: [{ ...d.content.facts[0]!, sources: badSrc }] } };
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, both)), /SOURCE_MISMATCH/);
  });

  it("T13 계약은 통과해도 DB는 거절할 수 있다(미승인 프로필·다른 프로젝트 자료)", async () => {
    // 계약 통과(입력끼리 정합) 확인
    expect(buildStrategyDraft(strategyInput({ sources: [{ kind: "asset", assetId: assetB, projectId: a.projectA }] })).ok).toBe(true);
    // 하지만 DB 는 자료의 실제 프로젝트를 보고 거절(위 T6과 같은 입력)
    const d = draft(strategyInput({ sources: [{ kind: "asset", assetId: assetB, projectId: a.projectA }] }));
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, d)), /SOURCE_MISMATCH/);
  });

  it("T11 같은 키·같은 내용 재요청 → 기존 결과(reused), 같은 키·다른 내용 → IDEMPOTENCY_MISMATCH", async () => {
    const d = draft(strategyInput());
    const key = newKey();
    const taskId = await asA((tx) => newStrategyTask(tx));
    const first = await asA((tx) => generate(tx, taskId, a.profileA1, d, key));
    const again = await asA((tx) => generate(tx, taskId, a.profileA1, d, key));
    expect(again).toEqual({ ...first, reused: true });
    const other = draft({ ...strategyInput(), unknowns: [{ topic: "다른 미확인" }] });
    await expectDbError(asA((tx) => generate(tx, taskId, a.profileA1, other, key)), /IDEMPOTENCY_MISMATCH/);
    expect(await count("select 1 from artifact_versions v join artifacts x on x.id = v.artifact_id where x.task_id = $1", [taskId])).toBe(1);
  });

  it("T11 직접 고치기 revision 충돌 → CONFLICT, 프로필 참조 변경 → CONTENT_MISMATCH", async () => {
    const d = draft(strategyInput());
    const g = await asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, d));
    await expectDbError(asA((tx) => tx.query("select * from save_strategy_manual_version($1, 999, $2)", [g.artifact_id, JSON.stringify(d.content)])), /CONFLICT/);
    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [g.artifact_id])).revision;
    const changed = { ...d.content, profileRef: { id: a.profileB1, version: 1 } };
    await expectDbError(asA((tx) => tx.query("select * from save_strategy_manual_version($1, $2, $3)", [g.artifact_id, rev, JSON.stringify(changed)])), /CONTENT_MISMATCH/);
  });

  it("전략이 아닌 작업에 generate_strategy → VALIDATION, 자체 프로젝트 → PROFILE_REQUIRED", async () => {
    const d = draft(strategyInput());
    await expectDbError(
      asA(async (tx) => {
        const t = await one<{ id: string }>(tx, "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'logo_brief', $3, $4) returning id", [a.workspaceId, a.projectA, a.logoTemplateId, newKey()]);
        return generate(tx, t.id, a.profileA1, d);
      }),
      /VALIDATION/,
    );
    await expectDbError(
      asA(async (tx) => {
        const p = await one<{ id: string }>(tx, "insert into projects (workspace_id, kind, title) values ($1, 'internal_brand', '자체') returning id", [a.workspaceId]);
        return generate(tx, await newStrategyTask(tx, a, p.id), a.profileA1, d);
      }),
      /PROFILE_REQUIRED/,
    );
  });
});

describe("R1 검수: 정의자 RPC 직접 호출로 계약 보장을 우회할 수 없다", () => {
  const firstFact = (c: StrategyDraft) => c.facts[0]!;
  it("R1-a 결과에 입력에 없는 사실을 지어 넣음 → CONTENT_MISMATCH", async () => {
    const d = draft(strategyInput());
    const forged = { ...d, content: { ...d.content, facts: [...d.content.facts, { ...firstFact(d.content), id: "goals-fact-9", text: "지어낸 사실" }] } };
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, forged)), /CONTENT_MISMATCH/);
  });
  it("R1-b 추정을 사실로 올림(결과만 조작) → CONTENT_MISMATCH", async () => {
    const d = draft(strategyInput());
    const inf = d.content.inferences[0]!;
    const promoted = { ...d.content, facts: [...d.content.facts, { id: "offers-fact-1", section: inf.section, text: inf.text, sources: [{ kind: "profile", profileId: a.profileA1, version: 1 }] }] };
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, { ...d, content: promoted })), /CONTENT_MISMATCH/);
  });
  it("R1-c 입력·결과 모두 출처 없는 사실 → VALIDATION", async () => {
    const d = draft(strategyInput());
    const input = { ...d.input, sections: { ...d.input.sections, goals: { facts: [{ text: "합성 목표", sources: [] }], inferences: [] } } };
    const content = { ...d.content, facts: [{ ...firstFact(d.content), sources: [] }] };
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, { input, content })), /VALIDATION/);
  });
  it("R1-d http(s)가 아닌 url 출처(입력·결과 일치) → SOURCE_MISMATCH", async () => {
    const d = draft(strategyInput());
    const bad = [{ kind: "url", url: "javascript:alert(1)" }];
    const input = { ...d.input, sections: { ...d.input.sections, goals: { facts: [{ text: "합성 목표", sources: bad }], inferences: [] } } };
    const content = { ...d.content, facts: [{ ...firstFact(d.content), sources: bad }] };
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, { input, content })), /SOURCE_MISMATCH/);
  });
  it("R1-e 직접 고치기로 다른 프로젝트 자료를 출처로 넣음 → SOURCE_MISMATCH, 출처 없는 사실 → VALIDATION", async () => {
    const d = draft(strategyInput());
    const g = await asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, d));
    const rev = (await one<{ revision: number }>(db, "select revision from artifacts where id = $1", [g.artifact_id])).revision;
    const save = (c: unknown) => asA((tx) => tx.query("select * from save_strategy_manual_version($1, $2, $3)", [g.artifact_id, rev, JSON.stringify(c)]));
    await expectDbError(save({ ...d.content, facts: [{ ...firstFact(d.content), sources: [{ kind: "asset", assetId: assetB, projectId: a.projectA }] }] }), /SOURCE_MISMATCH/);
    await expectDbError(save({ ...d.content, facts: [{ ...firstFact(d.content), sources: [] }] }), /VALIDATION/);
    await expectDbError(save({ ...d.content, facts: [{ ...firstFact(d.content), sources: [{ kind: "profile", profileId: a.profileB1, version: 1 }] }] }), /SOURCE_MISMATCH/);
  });
  it("R1-f 결과의 템플릿 버전·생성 방식 위조 → CONTENT_MISMATCH", async () => {
    const d = draft(strategyInput());
    const forged = { ...d, content: { ...d.content, generator: { mode: "ai", templateVersion: "strategy-template@1" } } };
    await expectDbError(asA(async (tx) => generate(tx, await newStrategyTask(tx), a.profileA1, forged)), /CONTENT_MISMATCH/);
  });
});

describe("R1 프로필 승인 원자 확인(20261117002000)", () => {
  const lastSeq = async (id: string) => (await one<{ s: number }>(db, "select coalesce(max(seq), 0)::int as s from company_profile_approvals where company_profile_version_id = $1", [id])).s;
  const rows = async (id: string) => count("select 1 from company_profile_approvals where company_profile_version_id = $1", [id]);
  const audits = async (id: string) => count("select 1 from audit_events where entity_id = $1 and action like 'profile_%'", [id]);
  const newVersion = () =>
    asA(async (tx) => {
      const v = (await one<{ n: number }>(tx, "select coalesce(max(version), 0)::int + 1 as n from company_profile_versions where client_id = $1", [a.clientA])).n;
      return (await one<{ id: string }>(tx, "insert into company_profile_versions (workspace_id, client_id, version) values ($1, $2, $3) returning id", [a.workspaceId, a.clientA, v])).id;
    });

  it("기대 순번이 다르면 CONFLICT, 승인·감사 기록 0건", async () => {
    const id = await newVersion();
    await expectDbError(asA((tx) => tx.query("select approve_company_profile_version($1, 'approved', 7)", [id])), /CONFLICT/);
    expect([await rows(id), await audits(id)]).toEqual([0, 0]);
  });

  it("같은 기대 순번으로 재전송하면 두 번째는 CONFLICT(기록 1건 유지), 이미 승인된 버전 재승인도 CONFLICT", async () => {
    const id = await newVersion();
    const call = (seq: number, decision = "approved") => asA((tx) => tx.query("select approve_company_profile_version($1, $2, $3)", [id, decision, seq]));
    await call(0);
    await expectDbError(call(0), /CONFLICT/);
    await expectDbError(call(await lastSeq(id)), /CONFLICT: 이미 승인된/);
    expect([await rows(id), await audits(id)]).toEqual([1, 1]);
  });

  it("승인 안 된 버전 철회 → VALIDATION, 승인 → 철회 → 재승인 순번 전이", async () => {
    const id = await newVersion();
    const call = (seq: number, decision: string) => asA((tx) => tx.query("select approve_company_profile_version($1, $2, $3)", [id, decision, seq]));
    await expectDbError(call(0, "revoked"), /VALIDATION/);
    await call(0, "approved");
    await call(await lastSeq(id), "revoked");
    await call(await lastSeq(id), "approved");
    expect((await db.query<{ decision: string }>("select decision from company_profile_approvals where company_profile_version_id = $1 order by seq", [id])).rows.map((r) => r.decision)).toEqual(["approved", "revoked", "approved"]);
  });

  it("예전 3인자 함수는 없고, 새 함수는 authenticated 만 실행 가능", async () => {
    const sigs = (await db.query<{ sig: string }>("select pg_get_function_identity_arguments(p.oid) as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'approve_company_profile_version'")).rows.map((r) => r.sig);
    expect(sigs).toEqual(["p_profile_version_id uuid, p_decision text, p_expected_last_seq bigint, p_comment text"]);
    const can = async (role: string) => (await one<{ ok: boolean }>(db, "select has_function_privilege($1, 'public.approve_company_profile_version(uuid, text, bigint, text)', 'execute') as ok", [role])).ok;
    expect([await can("anon"), await can("authenticated")]).toEqual([false, true]);
  });

  it("다른 업무실 사용자는 NOT_FOUND(잠금 대상 아님), 기대 순번 음수·null → VALIDATION", async () => {
    await expectDbError(asB((tx) => tx.query("select approve_company_profile_version($1, 'approved', 0)", [a.profileA1])), /NOT_FOUND/);
    await expectDbError(asA((tx) => tx.query("select approve_company_profile_version($1, 'approved', -1)", [a.profileA1])), /VALIDATION/);
    await expectDbError(asA((tx) => tx.query("select approve_company_profile_version($1, 'approved', null)", [a.profileA1])), /VALIDATION/);
  });
});
