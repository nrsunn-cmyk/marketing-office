/**
 * P3B-BACKEND-IMPL-01: 홈페이지 구조·문구 DB(20261121002000_p3b_web_copy) 시험. 설계: Plan/Claude-Backend-20261120/P3B-BACKEND-01-DESIGN.md.
 * 모든 값은 합성이다. 전략은 실제 경로(generate_strategy → decide_version), 제작 브리프는 create/update_production_brief 로 만든다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft } from "@/domain/strategy";
import { DEFAULT_WEB_COPY_PAGES } from "@/domain/web-copy/template";
import { asUser, createDb, expectDbError, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "webcopy-owner-a@example.test");
  b = await seedOwner(db, "webcopy-owner-b@example.test");
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
  for (const f of [a, b]) await asUser(db, f.userId, (tx) => approveProfile(tx, f.profileA1));
}, 60_000);

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const asAnon = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn);
const count = async (sql: string, p: unknown[] = []) => (await one<{ n: number }>(db, `select count(*)::int as n from (${sql}) x`, p)).n;
const audits = (id: string) => count("select 1 from audit_events where entity_type = 'web_copy_doc' and entity_id = $1", [id]);
const replica = async (fn: () => Promise<unknown>) => {
  await db.exec("set session_replication_role = replica");
  try {
    await fn();
  } finally {
    await db.exec("set session_replication_role = origin");
  }
};
const approveProfile = (tx: Tx, id: string) =>
  tx.query(
    "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
    [id],
  );

async function strategy(f: Fixture) {
  return asUser(db, f.userId, async (tx) => {
    const taskId = (
      await one<{ id: string }>(tx, "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id", [
        f.workspaceId, f.projectA, strategyTpl, newKey(),
      ])
    ).id;
    const input = {
      templateVersion: STRATEGY_TEMPLATE_VERSION,
      projectId: f.projectA,
      profile: { id: f.profileA1, version: 1, projectId: f.projectA, clientId: f.clientA, projectKind: "client" },
      sections: { goals: { facts: [{ text: "합성 목표", sources: [{ kind: "profile", profileId: f.profileA1, version: 1 }] }], inferences: [] }, offers: { facts: [], inferences: [{ text: "합성 제안" }] } },
      unknowns: [],
    };
    const d = buildStrategyDraft(input);
    if (!d.ok) throw new Error(`계약 실패: ${JSON.stringify(d.issues)}`);
    const g = await one<{ artifact_id: string; version_id: string }>(tx, "select * from generate_strategy($1, $2, $3, $4, $5)", [taskId, newKey(), f.profileA1, JSON.stringify(input), JSON.stringify(d.result)]);
    await tx.query("select decide_version($1, $2, 'approved', null)", [g.artifact_id, g.version_id]);
    return { taskId, artifactId: g.artifact_id };
  });
}

type Brief = { id: string; revision: number; taskId: string };
/** 확정(ready) 제작 브리프. kinds 기본 web_copy 포함 */
async function brief(f: Fixture, o: { kinds?: string[]; ready?: boolean; title?: string } = {}): Promise<Brief> {
  const s = await strategy(f);
  const kinds = o.kinds ?? ["web_copy", "ppt_deck"];
  return asUser(db, f.userId, async (tx) => {
    const id = (await one<{ id: string }>(tx, "select create_production_brief($1, $2, $3, '대상', '메시지', $4::text[], '범위') as id", [f.projectA, s.artifactId, o.title ?? "봄 캠페인 홈페이지", kinds])).id;
    if (o.ready === false) return { id, revision: 1, taskId: s.taskId };
    await tx.query("select update_production_brief($1, 1, $2, '대상', '메시지', $3::text[], '범위', null, null, 'ready')", [id, o.title ?? "봄 캠페인 홈페이지", kinds]);
    return { id, revision: 2, taskId: s.taskId };
  });
}
const createDoc = (tx: Tx, briefId: string, copyFrom: string | null = null) =>
  one<{ id: string }>(tx, "select create_web_copy_doc($1, $2) as id", [briefId, copyFrom]).then((r) => r.id);
const save = (tx: Tx, docId: string, rev: number, pages: unknown, status = "drafting") =>
  one<{ r: number }>(tx, "select save_web_copy($1, $2, $3, $4::jsonb) as r", [docId, rev, status, JSON.stringify(pages)]).then((r) => r.r);
const doc = (id: string) => one<{ revision: number; current_version_no: number; status: string; source_brief_revision: number; archived_at: string | null }>(db, "select * from web_copy_docs where id = $1", [id]);
type Page = { id: string | null; title: string; slug: string; sort_order: number; sections: Record<string, unknown>[] };
const current = async (id: string) =>
  (await one<{ content: { pages: Page[] } }>(db, "select v.content from web_copy_versions v join web_copy_docs d on d.id = v.doc_id and v.version_no = d.current_version_no where d.id = $1", [id])).content.pages;
const section = (o: Record<string, unknown> = {}) => ({ id: null, section_name: "새 섹션", purpose: null, headline: "새 헤드라인", body: null, cta_label: null, cta_target: null, citation_ids: [], sort_order: 1, excluded: false, ...o });

describe("만들기", () => {
  it("기본 4페이지(AGY 확정표 그대로, 홈 첫 헤드라인 = 브리프 제목)·id 채움·v1·감사 본문 0", async () => {
    const br = await brief(a, { title: "  여름 캠페인  " });
    const id = await asA((tx) => createDoc(tx, br.id));
    expect(await doc(id)).toMatchObject({ revision: 1, current_version_no: 1, status: "drafting", source_brief_revision: br.revision, archived_at: null });
    const pages = await current(id);
    // id(서버가 채움)와 화면용 키(page_key·section_key, 판 내용에는 없음)를 빼고 비교한다
    const strip = (p: Page[]) =>
      (structuredClone(p) as unknown as Record<string, unknown>[]).map((pg) => {
        delete pg.id;
        delete pg.page_key;
        for (const sc of pg.sections as Record<string, unknown>[]) {
          delete sc.id;
          delete sc.section_key;
        }
        return pg;
      });
    const want = strip(DEFAULT_WEB_COPY_PAGES as unknown as Page[]);
    (want[0].sections as Record<string, unknown>[])[0].headline = "여름 캠페인";
    expect(strip(pages)).toEqual(want);
    const ids = pages.flatMap((p) => [p.id, ...p.sections.map((s) => s.id as string)]);
    expect(ids.every((x) => /^[0-9a-f-]{36}$/.test(String(x)))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const au = await one<{ details: Record<string, unknown> }>(db, "select details from audit_events where entity_type = 'web_copy_doc' and entity_id = $1", [id]);
    expect(au.details).toMatchObject({ production_brief_id: br.id, version_no: 1, pages: 4, sections: 5, excluded: 0 });
    expect(JSON.stringify(au.details)).not.toMatch(/여름|직접 입력|문의/);
  });

  it("브리프 조건: drafting·보관·web_copy 없음·남의 것·anon 거절, 작업 중 문서가 있으면 거절, 보관 포함 10개까지", async () => {
    const draft = await brief(a, { ready: false });
    await expectDbError(asA((tx) => createDoc(tx, draft.id)), /INVALID_TRANSITION: 확정한 제작 브리프로만/);
    const noKind = await brief(a, { kinds: ["ppt_deck"] });
    await expectDbError(asA((tx) => createDoc(tx, noKind.id)), /INVALID_TRANSITION: .*홈페이지 구조·문구가 없습니다/);
    const br = await brief(a);
    await expectDbError(asB((tx) => createDoc(tx, br.id)), /NOT_FOUND: 제작 브리프를 찾을 수 없습니다/);
    await expectDbError(asAnon((tx) => createDoc(tx, br.id)), /permission denied/);
    const first = await asA((tx) => createDoc(tx, br.id));
    await expectDbError(asA((tx) => createDoc(tx, br.id)), /INVALID_TRANSITION: .*작업 중인 홈페이지 문서가 이미/);
    let last = first;
    for (let i = 0; i < 9; i++) {
      await asA((tx) => tx.query("select archive_web_copy($1, $2)", [last, 1]));
      last = await asA((tx) => createDoc(tx, br.id));
    }
    await asA((tx) => tx.query("select archive_web_copy($1, 1)", [last]));
    await expectDbError(asA((tx) => createDoc(tx, br.id)), /LIMIT_REACHED: .*10개까지/);
    const archivedBrief = await brief(a);
    await asA((tx) => tx.query("select archive_production_brief($1, $2)", [archivedBrief.id, archivedBrief.revision]));
    await expectDbError(asA((tx) => createDoc(tx, archivedBrief.id)), /INVALID_TRANSITION: 보관한 제작 브리프/);
  });
});

describe("저장·되돌리기·맞추기·보관", () => {
  it("저장: 새 페이지·섹션 id 는 서버가 채우고 이어 감, 모르는 id·같은 내용·CONFLICT 거절, 상태만 바꿔도 새 판", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createDoc(tx, br.id));
    const p = await current(id);
    p[0].sections[0].headline = "  바뀐 헤드라인  ";
    p[0].sections.push(section({ sort_order: 3, excluded: true }));
    p.push({ id: null, title: "블로그", slug: "/blog", sort_order: 5, sections: [section()] });
    expect(await asA((tx) => save(tx, id, 1, p))).toBe(2);
    const p2 = await current(id);
    expect(p2[0].sections[0].headline).toBe("바뀐 헤드라인");
    expect(p2[0].sections[2]).toMatchObject({ excluded: true, id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(p2[4].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p2[0].id).toBe(p[0].id);
    await expectDbError(asA((tx) => save(tx, id, 2, p2)), /VALIDATION: 바뀐 내용이 없습니다/);
    expect(await asA((tx) => save(tx, id, 2, p2, "reviewed"))).toBe(3);
    expect(await doc(id)).toMatchObject({ current_version_no: 3, status: "reviewed" });
    await expectDbError(asA((tx) => save(tx, id, 2, p2)), /CONFLICT/);
    const injected = structuredClone(p2);
    injected[0].sections[0].id = "00000000-0000-4000-8000-000000000001";
    await expectDbError(asA((tx) => save(tx, id, 3, injected)), /VALIDATION: 이 문서에 없는 페이지·섹션 id/);
    expect(await audits(id)).toBe(3);
  });

  it("값 검사: 한도(제외 포함)·경로·CTA·정렬·모르는 키·글자 수, 출처는 같은 프로젝트 것만", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createDoc(tx, br.id));
    const base = await current(id);
    const bad: [(p: Page[]) => void, RegExp][] = [
      [(p) => (p[1].sections = Array.from({ length: 13 }, (_, i) => section({ sort_order: i + 1, excluded: i > 0 }))), /섹션은 1~12개여야 합니다\(제외한 섹션 포함\)/],
      [(p) => p.splice(0, 4), /페이지는 1~10개/],
      [(p) => (p[1].slug = "/About"), /페이지 경로는 \/ 로 시작/],
      [(p) => (p[1].slug = "/"), /페이지 경로 \/ 가 두 번/],
      [(p) => (p[1].slug = "/a/b"), /페이지 경로는/],
      [(p) => (p[0].sections[0].cta_target = "javascript:alert(1)"), /CTA 이동 대상은/],
      [(p) => (p[0].sections[0].cta_target = "http://a.com/"), /CTA 이동 대상은/],
      [(p) => (p[0].sections[0].sort_order = 5), /섹션 정렬 번호는/],
      [(p) => (p[1].sort_order = 9), /페이지 정렬 번호는/],
      [(p) => (p[0].sections[0].extra = 1), /알 수 없는 칸이 있습니다: extra/],
      [(p) => (p[0].sections[0].headline = "가".repeat(161)), /헤드라인은 1~160자/],
      [(p) => (p[0].sections[0].headline = "   "), /헤드라인은 1~160자/],
      [(p) => (p[0].sections[0].citation_ids = ["00000000-0000-4000-8000-000000000009"]), /이 프로젝트의 출처만/],
      [(p) => (p[0].sections[0].excluded = "true"), /제외 여부는/],
    ];
    for (const [mut, re] of bad) {
      const p = structuredClone(base);
      mut(p);
      await expectDbError(asA((tx) => save(tx, id, 1, p)), re);
    }
    // 61개(제외 포함)
    const big = structuredClone(base);
    for (let i = 0; i < 4; i++) big[i].sections = Array.from({ length: 12 }, (_, k) => section({ sort_order: k + 1, excluded: k % 2 === 0 }));
    big.push({ id: null, title: "추가", slug: "/more", sort_order: 5, sections: Array.from({ length: 13 }, (_, k) => section({ sort_order: k + 1 })).slice(0, 12) });
    big[4].sections.push(section({ sort_order: 13 }));
    await expectDbError(asA((tx) => save(tx, id, 1, big)), /섹션은/);
    big[4].sections = big[4].sections.slice(0, 12);
    big.push({ id: null, title: "하나 더", slug: "/one", sort_order: 6, sections: [section()] });
    await expectDbError(asA((tx) => save(tx, id, 1, big)), /섹션은 문서 전체 60개까지/);
    // 같은 프로젝트 출처는 된다, 다른 프로젝트·업무실 출처는 안 된다
    const src = await one<{ id: string }>(db, "insert into research_sources (workspace_id, project_id, url, title, retrieved_at, created_by) values ($1, $2, 'https://a.com/x', '출처', now(), $3) returning id", [a.workspaceId, a.projectA, a.userId]);
    const other = await one<{ id: string }>(db, "insert into research_sources (workspace_id, project_id, url, title, retrieved_at, created_by) values ($1, $2, 'https://a.com/y', '다른 프로젝트', now(), $3) returning id", [a.workspaceId, a.projectB, a.userId]);
    const ok = structuredClone(base);
    ok[0].sections[0].citation_ids = [src.id];
    expect(await asA((tx) => save(tx, id, 1, ok))).toBe(2);
    ok[0].sections[0].citation_ids = [src.id, other.id];
    await expectDbError(asA((tx) => save(tx, id, 2, ok)), /이 프로젝트의 출처만/);
    expect(await audits(id)).toBe(2);
  });

  it("되돌리기: 판 번호로 새 판(restored_from), 같은 내용·없는 판 거절", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createDoc(tx, br.id));
    const p = await current(id);
    p[0].title = "메인";
    await asA((tx) => save(tx, id, 1, p));
    await expectDbError(asA((tx) => tx.query("select restore_web_copy_version($1, 2, 2)", [id])), /VALIDATION: 지금 판과 내용이 같습니다/);
    await expectDbError(asA((tx) => tx.query("select restore_web_copy_version($1, 2, 9)", [id])), /NOT_FOUND: 이 문서에 그 판이 없습니다/);
    expect(await asA((tx) => one<{ r: number }>(tx, "select restore_web_copy_version($1, 2, 1) as r", [id]))).toEqual({ r: 3 });
    const v = await one<{ kind: string; restored_from_version_no: number; version_no: number }>(db, "select kind, restored_from_version_no, version_no from web_copy_versions where doc_id = $1 order by version_no desc limit 1", [id]);
    expect(v).toEqual({ kind: "restore", restored_from_version_no: 1, version_no: 3 });
    expect((await current(id))[0].title).toBe("홈");
  });

  it("이전 브리프 기준: 브리프가 바뀌어도 저장은 되고, 맞추기는 새 판(내용 그대로), 브리프가 확정이 아니면 맞추기 거절", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createDoc(tx, br.id));
    await expectDbError(asA((tx) => tx.query("select rebase_web_copy($1, 1)", [id])), /VALIDATION: 이미 지금 제작 브리프 기준/);
    await asA((tx) => tx.query("select update_production_brief($1, $2, '새 제목', '대상', '메시지', array['web_copy'], '범위', null, null, 'ready')", [br.id, br.revision]));
    const p = await current(id);
    p[1].title = "소개";
    expect(await asA((tx) => save(tx, id, 1, p))).toBe(2);
    expect(await asA((tx) => one<{ r: number }>(tx, "select rebase_web_copy($1, 2) as r", [id]))).toEqual({ r: 3 });
    expect(await doc(id)).toMatchObject({ source_brief_revision: br.revision + 1, current_version_no: 3 });
    const v = await one<{ kind: string; source_brief_revision: number }>(db, "select kind, source_brief_revision from web_copy_versions where doc_id = $1 and version_no = 3", [id]);
    expect(v).toEqual({ kind: "rebase", source_brief_revision: br.revision + 1 });
    // 브리프를 drafting 으로 돌리면 맞추기는 안 되지만 저장은 된다
    await asA((tx) => tx.query("select update_production_brief($1, $2, '새 제목', '대상', '메시지', array['web_copy'], '범위', null, null, 'drafting')", [br.id, br.revision + 1]));
    await expectDbError(asA((tx) => tx.query("select rebase_web_copy($1, 3)", [id])), /INVALID_TRANSITION: 제작 브리프가 작성 중이라 맞출 수 없습니다/);
    p[1].title = "소개2";
    expect(await asA((tx) => save(tx, id, 3, p))).toBe(4);
    // 브리프를 보관하면 원인이 다른 문구(Q4). 문서는 계속 고칠 수 있다
    await asA((tx) => tx.query("select archive_production_brief($1, $2)", [br.id, br.revision + 2]));
    await expectDbError(asA((tx) => tx.query("select rebase_web_copy($1, 4)", [id])), /INVALID_TRANSITION: 보관한 제작 브리프라 맞출 수 없습니다/);
    p[1].title = "소개3";
    expect(await asA((tx) => save(tx, id, 4, p))).toBe(5);
  });

  it("읽기 전용: 문서 보관·프로젝트 보관·전략 작업 취소면 쓰기 5개 거절, 보관 문서·판은 슈퍼유저도 못 바꿈", async () => {
    const c = await seedOwner(db, "webcopy-owner-c@example.test");
    await asUser(db, c.userId, (tx) => approveProfile(tx, c.profileA1));
    const asC = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, c.userId, fn);
    const br = await brief(c);
    const id = await asC((tx) => createDoc(tx, br.id));
    const p = await current(id);
    const all = async (re: RegExp, rev = 1) => {
      await expectDbError(asC((tx) => save(tx, id, rev, p, "reviewed")), re);
      await expectDbError(asC((tx) => tx.query("select restore_web_copy_version($1, $2, 1)", [id, rev])), re);
      await expectDbError(asC((tx) => tx.query("select rebase_web_copy($1, $2)", [id, rev])), re);
      await expectDbError(asC((tx) => tx.query("select archive_web_copy($1, $2)", [id, rev])), re);
    };
    await replica(() => db.query("update projects set status = 'archived' where id = $1", [c.projectA]));
    await all(/INVALID_TRANSITION: 보관한 프로젝트/);
    await replica(async () => {
      await db.query("update projects set status = 'active' where id = $1", [c.projectA]);
      await db.query("update tasks set status = 'cancelled' where id = $1", [br.taskId]);
    });
    await all(/INVALID_TRANSITION: 취소된 전략 작업/);
    await replica(() => db.query("update tasks set status = 'completed' where id = $1", [br.taskId]));
    expect(await audits(id)).toBe(1);
    expect(await asC((tx) => one<{ r: number }>(tx, "select archive_web_copy($1, 1) as r", [id]))).toEqual({ r: 2 });
    await all(/INVALID_TRANSITION: (보관한 홈페이지 문서|이미 보관한)/, 2);
    await expectDbError(db.query("update web_copy_docs set archived_at = null where id = $1", [id]), /FROZEN_COLUMN: 보관한 홈페이지 문서/);
    await expectDbError(db.query("update web_copy_versions set status = 'reviewed' where doc_id = $1", [id]), /.+/);
    await expectDbError(db.query("delete from web_copy_versions where doc_id = $1", [id]), /.+/);
    expect(await count("select 1 from web_copy_versions where doc_id = $1", [id])).toBe(1);
  });

  it("판 100개: 101번째 저장·되돌리기·맞추기 LIMIT_REACHED, 보관 뒤 마지막 판을 복사해 새 문서", async () => {
    const br = await brief(a);
    const id = await asA((tx) => createDoc(tx, br.id));
    const p = await current(id);
    for (let i = 2; i <= 100; i++) {
      p[1].title = `소개 ${i}`;
      await asA((tx) => save(tx, id, i - 1, p));
    }
    expect(await doc(id)).toMatchObject({ current_version_no: 100, revision: 100 });
    p[1].title = "넘침";
    await expectDbError(asA((tx) => save(tx, id, 100, p)), /LIMIT_REACHED: 한 문서의 판은 100개까지/);
    await expectDbError(asA((tx) => tx.query("select restore_web_copy_version($1, 100, 1)", [id])), /LIMIT_REACHED/);
    await asA((tx) => tx.query("select archive_web_copy($1, 100)", [id]));
    const copy = await asA((tx) => createDoc(tx, br.id, id));
    expect(await current(copy)).toEqual(await current(id));
    expect(await doc(copy)).toMatchObject({ current_version_no: 1 });
    const another = await brief(a);
    await expectDbError(asA((tx) => createDoc(tx, another.id, id)), /NOT_FOUND: 복사할 홈페이지 문서/);
  }, 60_000);
});

describe("보안", () => {
  it("남의 업무실 NOT_FOUND·RLS 0행, 직접 쓰기 거절, 도우미 실행 불가, 내용 CHECK 는 NULL 로 빠지지 않음, 복합 FK", async () => {
    // 한 프로젝트 제작 브리프 한도(10)에 걸리지 않게 새 소유자를 쓴다
    const a = await seedOwner(db, "webcopy-owner-s@example.test");
    await asUser(db, a.userId, (tx) => approveProfile(tx, a.profileA1));
    const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
    const br = await brief(a);
    const id = await asA((tx) => createDoc(tx, br.id));
    const p = await current(id);
    for (const q of [
      () => asB((tx) => save(tx, id, 1, p, "reviewed")),
      () => asB((tx) => tx.query("select restore_web_copy_version($1, 1, 1)", [id])),
      () => asB((tx) => tx.query("select rebase_web_copy($1, 1)", [id])),
      () => asB((tx) => tx.query("select archive_web_copy($1, 1)", [id])),
    ]) await expectDbError(q(), /NOT_FOUND: 홈페이지 문서를 찾을 수 없습니다/);
    expect(await asB((tx) => tx.query("select 1 from web_copy_docs where id = $1 union all select 1 from web_copy_versions where doc_id = $1", [id]).then((r) => r.rows.length))).toBe(0);
    expect(await asA((tx) => tx.query("select 1 from web_copy_docs where id = $1 union all select 1 from web_copy_versions where doc_id = $1", [id]).then((r) => r.rows.length))).toBe(2);
    await expectDbError(asA((tx) => tx.query("update web_copy_docs set status = 'reviewed' where id = $1", [id])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("insert into web_copy_versions (workspace_id, doc_id, version_no, kind, status, content, source_brief_revision, created_by) select workspace_id, doc_id, 2, 'save', status, content, source_brief_revision, created_by from web_copy_versions where doc_id = $1", [id])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("delete from web_copy_docs where id = $1", [id])), /permission denied/);
    await expectDbError(asAnon((tx) => tx.query("select * from web_copy_versions")), /permission denied/);
    for (const f of [
      "select app.web_copy_content_problem('{}')",
      `select app.web_copy_audit('${a.workspaceId}', '${id}', 'x', 1, '{}')`,
      `select app.lock_own_web_copy_doc('${id}')`,
      "select app.web_copy_fill_ids('{}')",
    ]) await expectDbError(asA((tx) => tx.query(f)), /permission denied/);
    expect(await one(db, "select app.web_copy_content_ok('{}') as a, app.web_copy_content_ok('null') as b, app.web_copy_content_ok('{\"pages\":[]}') as c")).toEqual({ a: false, b: false, c: false });
    const ins = (content: string) =>
      db.query("insert into web_copy_versions (workspace_id, doc_id, version_no, kind, status, content, source_brief_revision, created_by) values ($1, $2, 2, 'save', 'drafting', $3::jsonb, 1, $4)", [a.workspaceId, id, content, a.userId]);
    await expectDbError(ins("{}"), /check constraint/);
    await expectDbError(ins('{"pages":[{"id":null}]}'), /check constraint/);
    // 칸이 빠지면 형식 비교가 NULL 이 되어 빠져나가던 함정(구현 중 발견): 칸 하나씩 빼도 모두 거절
    const good = (await current(id)).map((pg, i) => ({ ...pg, sort_order: i + 1 }));
    const g = (mut: (c: { pages: Record<string, unknown>[] }) => void) => {
      const c = { pages: structuredClone(good) as unknown as Record<string, unknown>[] };
      mut(c);
      return JSON.stringify(c);
    };
    for (const k of ["id", "title", "slug", "sort_order", "sections"]) await expectDbError(ins(g((c) => delete c.pages[0][k])), /check constraint/);
    for (const k of ["id", "section_name", "headline", "purpose", "body", "cta_label", "cta_target", "citation_ids", "sort_order", "excluded"]) {
      await expectDbError(ins(g((c) => delete (c.pages[0].sections as Record<string, unknown>[])[0][k])), /check constraint/);
    }
    expect(await one(db, "select app.web_copy_content_ok($1::jsonb) as ok", [g(() => undefined)])).toEqual({ ok: true });
    // 다른 프로젝트의 제작 브리프를 가리키는 문서는 FK 가 막는다
    const otherBrief = await brief(b);
    await expectDbError(
      db.query("insert into web_copy_docs (workspace_id, project_id, production_brief_id, source_brief_revision, current_version_no, created_by) values ($1, $2, $3, 1, 1, $4)", [a.workspaceId, a.projectA, otherBrief.id, a.userId]),
      /foreign key/,
    );
  });

  it("정의자 함수 설정: search_path 고정, public·anon 실행 불가, 로그인 실행 가능, 잠금은 문서 한 행·만들기는 브리프 FOR SHARE → advisory", async () => {
    const names = ["create_web_copy_doc", "save_web_copy", "restore_web_copy_version", "rebase_web_copy", "archive_web_copy"];
    const rows = (await db.query<{ proname: string; prosecdef: boolean; cfg: string; anon: boolean; pub: boolean; auth: boolean }>(
      `select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as cfg, has_function_privilege('anon', p.oid, 'execute') as anon,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e where e.grantee = 0 and e.privilege_type = 'EXECUTE') as pub,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`,
      [names],
    )).rows;
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r, r.proname).toMatchObject({ prosecdef: true, cfg: 'search_path=""', anon: false, pub: false, auth: true });
    const src = async (n: string) => (await one<{ s: string }>(db, "select prosrc as s from pg_proc where proname = $1", [n])).s;
    const cr = await src("create_web_copy_doc");
    expect(cr).toMatch(/for share of x/);
    expect(cr.indexOf("for share of x")).toBeLessThan(cr.indexOf("pg_advisory_xact_lock(29001"));
    for (const n of names) expect(await src(n), n).not.toMatch(/public\.(projects|artifacts|tasks|research_sources)[^;]*for (no key )?(update|share)/);
  });
});
