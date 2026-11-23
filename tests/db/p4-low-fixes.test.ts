// P4-LOW-FIXES-R3-BACKEND-01 (006000): R4 문의 출처 확인 · R7 https 규칙 · R8 연결 감사(합성 데이터)
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({}));
vi.mock("@/server/supabase/server", () => ({}));
import { approvedChannelEndpoint } from "@/features/execution/channel-boundary";
import { asUser, createDb, expectDbError, one, seedOwner, type Db, type Fixture } from "./harness";

let db: Db;
beforeAll(async () => {
  db = await createDb();
}, 60_000);

/** 시험 준비용: 외래 키 검사를 이 문장 동안만 끄고 출처 행을 최소 열로 넣는다(함수 검사는 로그인 역할로 따로 한다) */
async function seedSource(kind: "lead_magnet" | "web_copy_contact", f: Fixture, projectId: string): Promise<string> {
  const id = randomUUID();
  await db.exec("set session_replication_role = replica");
  try {
    if (kind === "lead_magnet") {
      await db.query(
        `insert into public.lead_magnets (id, workspace_id, project_id, funnel_id, stage_id, strategy_artifact_id, strategy_version_id, title, format, created_by)
         values ($1, $2, $3, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '합성 리드 자료', 'checklist', $4)`,
        [id, f.workspaceId, projectId, f.userId],
      );
    } else {
      await db.query(
        `insert into public.web_copy_docs (id, workspace_id, project_id, production_brief_id, source_brief_revision, current_version_no, created_by)
         values ($1, $2, $3, gen_random_uuid(), 1, 1, $4)`,
        [id, f.workspaceId, projectId, f.userId],
      );
    }
  } finally {
    await db.exec("set session_replication_role = origin");
  }
  return id;
}

const inquiry = (f: Fixture, kind: string, sourceId: string | null, projectId = f.projectA) =>
  asUser(db, f.userId, async (tx) =>
    (await one<{ id: string }>(tx, "select public.create_inquiry($1, $2, $3, '합성문의자', '', '', '') as id", [projectId, kind, sourceId])).id,
  );

describe("R4 문의 출처 확인 (006000)", () => {
  it("manual 은 출처 없이만, 출처 종류는 출처 id 가 꼭 있어야 한다", async () => {
    const owner = await seedOwner(db, "r4-manual@example.test");
    await inquiry(owner, "manual", null);
    await expectDbError(inquiry(owner, "manual", randomUUID()), /VALIDATION: 직접 등록한 문의에는 출처를 지정할 수 없습니다/);
    await expectDbError(inquiry(owner, "lead_magnet", null), /VALIDATION: 접수 출처를 지정해 주세요/);
    await expectDbError(inquiry(owner, "web_copy_contact", null), /VALIDATION: 접수 출처를 지정해 주세요/);
    await expectDbError(inquiry(owner, "unknown", null), /VALIDATION: 알 수 없는 접수 출처입니다/);
  });

  for (const kind of ["lead_magnet", "web_copy_contact"] as const) {
    it(`${kind}: 같은 프로젝트만 받고, 다른 프로젝트·다른 업무실·없는 id 는 NOT_FOUND`, async () => {
      const owner = await seedOwner(db, `r4-${kind}@example.test`);
      const other = await seedOwner(db, `r4-${kind}-other@example.test`);
      const same = await seedSource(kind, owner, owner.projectA);
      const otherProject = await seedSource(kind, owner, owner.projectB);
      const otherWs = await seedSource(kind, other, other.projectA);

      const id = await inquiry(owner, kind, same);
      const saved = await one<{ s: string }>(db, "select source_id::text as s from public.inquiries where id = $1", [id]);
      expect(saved.s).toBe(same);
      await expectDbError(inquiry(owner, kind, otherProject), /NOT_FOUND: 같은 프로젝트의/);
      await expectDbError(inquiry(owner, kind, otherWs), /NOT_FOUND: 같은 프로젝트의/);
      await expectDbError(inquiry(owner, kind, randomUUID()), /NOT_FOUND: 같은 프로젝트의/);
    });
  }

  it("보관한 출처도 같은 프로젝트면 받는다(E2)", async () => {
    const owner = await seedOwner(db, "r4-archived@example.test");
    const src = await seedSource("lead_magnet", owner, owner.projectA);
    await db.exec("set session_replication_role = replica");
    await db.query("update public.lead_magnets set archived_at = now() where id = $1", [src]);
    await db.exec("set session_replication_role = origin");
    await inquiry(owner, "lead_magnet", src);
  });
});

// R7: 주소 판정을 서버 발신 규칙과 대조. 정규식은 migration 안의 SQL 리터럴 그대로 쓴다(셸·JS 문자열을 거치지 않음)
const URLS: string[] = [
  "https://crm.example.test/hook", "https://crm.example.test", "https://crm.example.test/", "https://a.b.example.test/x/y-z_1",
  "http://crm.example.test/hook", "https://crm.example.test:8443/hook", "https://crm.example.test/hook?token=1", "https://crm.example.test/hook#a",
  "https://user:pw@crm.example.test/hook", "https://user@crm.example.test/", "https://10.0.0.1/hook", "https://127.0.0.1",
  "https://localhost/hook", "https://crm.example.test./hook", "https://[::1]/hook", "https://CRM.Example.Test/hook",
  "ftp://crm.example.test/", "https://xn--bj0bj06e.example.test/", "https://crm.example.test/" + "a".repeat(470),
  "https://crm.example.test/한글", "https://crm.example.test/%20x", "https://1.2.3.4.example.test/", "https://123.example.test/",
  "https://crm.example.test/a/b/",
];
// 문서화한 근사 차이(DB 가 더 엄격): 잘못된 호스트 모양, 경로 공백, 500자 초과
const DB_STRICTER: string[] = [
  "https://-bad.example.test/", "https://bad-.example.test/", "https://crm..example.test/", "https://crm.example.test/has space",
  "https://crm.example.test/" + "a".repeat(490),
];
const urlOk = async (u: string) => (await one<{ ok: boolean }>(db, "select app.channel_url_ok($1) as ok", [u])).ok;

describe("R7 연결 주소 규칙 (006000)", () => {
  it("기준 사례: 반드시 거절·반드시 통과(도구 실수가 조용히 지나가지 않게)", async () => {
    for (const bad of ["https://localhost/hook", "http://crm.example.test/hook", "https://crm.example.test:8443/hook", "https://crm.example.test/x?y=1", "https://10.0.0.1/"]) {
      expect(await urlOk(bad), bad).toBe(false);
    }
    expect(await urlOk("https://crm.example.test/hook")).toBe(true);
  });

  it("서버가 막는 주소를 DB 가 통과시키지 않는다(형식 기준 판정 일치)", async () => {
    for (const u of URLS) {
      process.env.P4_CHANNEL_ALLOWED_ENDPOINTS = JSON.stringify({ crm: { dispatch: u } });
      const server = approvedChannelEndpoint("crm", "dispatch", u) !== null;
      expect(await urlOk(u), u.slice(0, 60)).toBe(server);
    }
    for (const u of DB_STRICTER) {
      process.env.P4_CHANNEL_ALLOWED_ENDPOINTS = JSON.stringify({ crm: { dispatch: u } });
      expect(approvedChannelEndpoint("crm", "dispatch", u) !== null, u.slice(0, 60)).toBe(true);
      expect(await urlOk(u), u.slice(0, 60)).toBe(false);
    }
    delete process.env.P4_CHANNEL_ALLOWED_ENDPOINTS;
  });

  it("upsert_channel_connection 은 http·포트·? 주소를 거절하고, 성과 주소 빈칸은 허용", async () => {
    const owner = await seedOwner(db, "r7-upsert@example.test");
    const save = (ep: string, mp: string) =>
      asUser(db, owner.userId, (tx) =>
        tx.query("select public.upsert_channel_connection('crm', '합성 계정', $1, $2, 0, 0, 'synthetic-key')", [ep, mp]),
      );
    await expectDbError(save("http://crm.example.test/hook", ""), /VALIDATION: 실행 연동 주소는 https:\/\//);
    await expectDbError(save("https://crm.example.test:8443/hook", ""), /VALIDATION: 실행 연동 주소/);
    await expectDbError(save("https://crm.example.test/hook", "https://m.example.test/x?t=1"), /VALIDATION: 성과 수집 주소/);
    await save("https://crm.example.test/hook", "");
    await save("  https://crm.example.test/hook  ", "https://m.example.test/metrics");
  });
});

describe("R8 연결 감사 (006000)", () => {
  const audits = (ws: string) =>
    db.query<{ action: string; details: Record<string, unknown> }>(
      "select action, details from public.audit_events where workspace_id = $1 and entity_type = 'channel_connection' order by seq",
      [ws],
    ).then((r) => r.rows);

  it("연결 → 수정 → 키 교체 → 같은 값 저장 → 해제 → 다시 해제: 감사 4줄, 키·주소 경로·금액 없음", async () => {
    const owner = await seedOwner(db, "r8-audit@example.test");
    const KEY1 = "synthetic-secret-AAAA-1111";
    const KEY2 = "synthetic-secret-BBBB-2222";
    const call = (sql: string, params: unknown[] = []) => asUser(db, owner.userId, (tx) => tx.query(sql, params));
    await call("select public.upsert_channel_connection('crm', '계정 하나', 'https://crm.example.test/hook/secret-path', '', 12345, 678, $1)", [KEY1]);
    await call("select public.upsert_channel_connection('crm', '계정 둘', 'https://crm.example.test/hook/secret-path', 'https://m.example.test/stats', 99999, 678, null)");
    await call("select public.upsert_channel_connection('crm', '계정 둘', 'https://crm.example.test/hook/secret-path', 'https://m.example.test/stats', 99999, 678, $1)", [KEY2]);
    await call("select public.upsert_channel_connection('crm', '계정 둘', 'https://crm.example.test/hook/secret-path', 'https://m.example.test/stats', 99999, 678, null)");
    await call("select public.disconnect_channel_connection('crm')");
    await call("select public.disconnect_channel_connection('crm')");
    await call("select public.disconnect_channel_connection('social_api')"); // 행 없음 → 감사 없음, 반환 true

    const rows = await audits(owner.workspaceId);
    expect(rows.map((r) => r.action)).toEqual(["channel_connected", "channel_updated", "channel_secret_rotated", "channel_disconnected"]);
    expect(rows[0]!.details).toEqual({ channel: "crm", endpoint_host: "crm.example.test", metrics_host: "", secret_set: true });
    expect(rows[1]!.details).toEqual({
      channel: "crm",
      changed: ["account_label", "metrics_url", "monthly_budget_won"],
      endpoint_host: "crm.example.test",
      metrics_host: "m.example.test",
    });
    expect(rows[2]!.details).toEqual({ channel: "crm" });
    expect(rows[3]!.details).toEqual({ channel: "crm", secret_removed: true });

    const all = JSON.stringify(rows);
    for (const secret of [KEY1, KEY2, "secret-path", "/stats", "12345", "99999", "678"]) expect(all).not.toContain(secret);
  });

  it("해제 뒤 다시 연결하면 channel_connected 가 새로 남는다", async () => {
    const owner = await seedOwner(db, "r8-reconnect@example.test");
    const call = (sql: string) => asUser(db, owner.userId, (tx) => tx.query(sql));
    await call("select public.upsert_channel_connection('search_ad', '광고', 'https://ads.example.test/run', '', 0, 0, 'k1')");
    await call("select public.disconnect_channel_connection('search_ad')");
    await call("select public.upsert_channel_connection('search_ad', '광고', 'https://ads.example.test/run', '', 0, 0, 'k2')");
    expect((await audits(owner.workspaceId)).map((r) => r.action)).toEqual(["channel_connected", "channel_disconnected", "channel_connected"]);
  });

  it("감사·주소 도우미는 로그인·익명 역할이 직접 부를 수 없다", async () => {
    const owner = await seedOwner(db, "r8-acl@example.test");
    for (const sql of [
      "select app.channel_url_ok('https://a.example.test/')",
      "select app.channel_url_host('https://a.example.test/')",
      `select app.channel_connection_audit('${owner.workspaceId}', gen_random_uuid(), 'x', '{}'::jsonb)`,
    ]) {
      await expectDbError(asUser(db, owner.userId, (tx) => tx.query(sql)), /permission denied/);
      await expectDbError(asUser(db, null, (tx) => tx.query(sql)), /permission denied/);
    }
  });
});
