import { createHmac, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft } from "@/domain/strategy";
import { asUser, createDb, expectDbError, newKey, one, seedOwner, type Db, type Fixture } from "./harness";

let db: Db;
let strategyTpl: string;
let signingKey: string;

beforeAll(async () => {
  db = await createDb();
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
  signingKey = (await one<{ value: string }>(db, "select value from app.server_secrets where name = 'p4_channel_signing'")).value;
}, 60_000);

function proof(action: string, userId: string, data: object) {
  const payload = JSON.stringify(data);
  const at = Date.now();
  const nonce = randomUUID();
  const signature = createHmac("sha256", signingKey).update(["p4", action, userId, at, nonce, payload].join("|")).digest("hex");
  return { action, payload, at, nonce, signature };
}

async function serverCall<T>(userId: string, p: ReturnType<typeof proof>): Promise<T> {
  const row = await asUser(db, userId, (tx) => one<{ result: T }>(
    tx,
    "select public.p4_server_channel_call($1, $2, $3, $4, $5) as result",
    [p.action, p.payload, p.at, p.nonce, p.signature],
  ));
  return row.result;
}

async function setupReviewedDraft(email: string): Promise<{ owner: Fixture; projectId: string; draftId: string }> {
  const owner = await seedOwner(db, email);
  await asUser(db, owner.userId, (tx) =>
    tx.query(
      "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
      [owner.profileA1],
    ),
  );
  const draftId = await asUser(db, owner.userId, async (tx) => {
    const taskId = (
      await one<{ id: string }>(
        tx,
        "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'strategy', $3, $4) returning id",
        [owner.workspaceId, owner.projectA, strategyTpl, newKey()],
      )
    ).id;
    const input = {
      templateVersion: STRATEGY_TEMPLATE_VERSION,
      projectId: owner.projectA,
      profile: { id: owner.profileA1, version: 1, projectId: owner.projectA, clientId: owner.clientA, projectKind: "client" as const },
      sections: {
        goals: { facts: [{ text: "합성 목표", sources: [{ kind: "profile" as const, profileId: owner.profileA1, version: 1 }] }], inferences: [] },
        offers: { facts: [], inferences: [{ text: "합성 제안" }] },
      },
      unknowns: [],
    };
    const d = buildStrategyDraft(input);
    if (!d.ok) throw new Error(JSON.stringify(d.issues));
    const g = await one<{ artifact_id: string; version_id: string }>(
      tx,
      "select * from generate_strategy($1, $2, $3, $4, $5)",
      [taskId, newKey(), owner.profileA1, JSON.stringify(input), JSON.stringify(d.result)],
    );
    await tx.query("select decide_version($1, $2, 'approved', null)", [g.artifact_id, g.version_id]);
    const fn = await one<{ funnel_id: string }>(tx, "select * from create_funnel($1)", [g.artifact_id]);
    const stage = (
      await one<{ id: string }>(tx, "select id from funnel_stages where funnel_id = $1 order by position offset 1 limit 1", [
        fn.funnel_id,
      ])
    ).id;
    const item = (await one<{ id: string }>(tx, "select add_funnel_item($1, 'content', '합성 카드', null, null, 'planned', null, null) as id", [stage])).id;
    const spec = JSON.stringify({ titleIdeas: ["후보 제목"], outline: ["왜 지금인가"], keywords: ["마케팅"] });
    const br = await one<{ brief_id: string }>(
      tx,
      "select * from create_content_brief($1, $2, $3, $4, $5, $6, $7)",
      [item, "blog", "합성 블로그 브리프", "합성 타깃", "핵심 요지 ".repeat(30), "무료 진단 신청", spec],
    );
    await tx.query("select add_brief_claim($1, '주장 하나', 'capability')", [br.brief_id]);
    await tx.query(
      "select update_content_brief($1, 1, '합성 블로그 브리프', '타깃', '훅 문장', '핵심 요지', 'CTA 문장', $2, null, 'manual', null, 'ready')",
      [br.brief_id, spec],
    );
    const id = (await one<{ id: string }>(tx, "select create_channel_draft($1) as id", [br.brief_id])).id;
    await tx.query("select update_channel_draft($1, 1, '외부 연동 제목', '외부 연동 본문', '[\"마케팅\"]', null, null, 'reviewed')", [id]);
    return id;
  });
  return { owner, projectId: owner.projectA, draftId };
}

describe("P4 외부 채널 연동 · 성과 수집 · P4B (20261123001000_p4_external_channels)", () => {
  it("브라우저 DB 역할에 외부 실행 및 연동 키 조회 권한을 주지 않는다", async () => {
    const signatures = [
      "public.dispatch_external_execution_prepare(uuid, int)",
      "public.finish_external_execution(uuid, int, boolean, text, text)",
      "public.get_channel_metrics_credentials(text)",
      "public.sync_channel_result(uuid, uuid, text, numeric, text, numeric, numeric, text, date, date)",
    ];
    for (const role of ["anon", "authenticated"]) {
      const { allowed } = await one<{ allowed: boolean }>(
        db,
        "select bool_or(has_function_privilege($1, signature, 'EXECUTE')) as allowed from unnest($2::text[]) as f(signature)",
        [role, signatures],
      );
      expect(allowed).toBe(false);
    }
  });

  it("서버 증명은 사용자와 요청에 묶이고 한 번만 쓸 수 있다", async () => {
    const owner = await seedOwner(db, "p4-proof-owner@example.test");
    const other = await seedOwner(db, "p4-proof-other@example.test");
    await asUser(db, owner.userId, (tx) => tx.query(
      "select public.upsert_channel_connection('crm', '시험 계정', 'https://example.test/dispatch', 'https://example.test/metrics', 0, 0, 'synthetic-key')",
    ));

    const signed = proof("metrics", owner.userId, { channel: "crm" });
    await expectDbError(serverCall(owner.userId, { ...signed, signature: "" }), /BAD_SIGNATURE/);
    await expectDbError(serverCall(other.userId, signed), /BAD_SIGNATURE/);
    await expectDbError(serverCall(owner.userId, { ...signed, payload: '{"channel":"social_api"}' }), /BAD_SIGNATURE/);
    expect((await serverCall<{ secret_value: string }>(owner.userId, signed)).secret_value).toBe("synthetic-key");
    await expectDbError(serverCall(owner.userId, signed), /이미 사용된 서버 연동 서명/);
  });

  it("미연결 채널은 대기열에서 거절하고, 연결 후 DB 내부 실행 전이와 성과 기록은 유지한다", async () => {
    const { owner, projectId, draftId } = await setupReviewedDraft("p4ext-a@example.test");

    for (const ch of ["crm", "search_ad", "social_api"]) {
      await expectDbError(
        asUser(db, owner.userId, (tx) =>
          tx.query("select public.enqueue_execution($1, 'channel_draft', $2, $3)", [projectId, draftId, ch]),
        ),
        /아직 연결하지 않은 채널/,
      );
    }

    for (const ch of ["crm", "search_ad", "social_api"]) {
      await asUser(db, owner.userId, (tx) =>
        tx.query(
          "select public.upsert_channel_connection($1, $2, $3, $4, 100000, 10000, $5)",
          [ch, `${ch}-계정`, `https://api.example.test/${ch}/dispatch`, `https://api.example.test/${ch}/metrics`, `secret-${ch}-123`],
        ),
      );
    }

    await expectDbError(
      asUser(db, owner.userId, (tx) => tx.query("select * from app.channel_secrets")),
      /permission denied/,
    );

    const jobId = await asUser(db, owner.userId, async (tx) => {
      const r = await tx.query<{ id: string }>(
        "select public.enqueue_execution($1, 'channel_draft', $2, 'social_api') as id",
        [projectId, draftId],
      );
      return r.rows[0].id;
    });

    await asUser(db, owner.userId, (tx) => tx.query("select public.approve_execution($1, 1)", [jobId]));

    const prep = await serverCall<{ blocked: boolean; revision: number; endpoint_url: string; secret_value: string }>(
      owner.userId, proof("prepare", owner.userId, { jobId, revision: 2 }),
    );
    expect(prep.blocked).toBe(false);
    expect(prep.endpoint_url).toBe("https://api.example.test/social_api/dispatch");
    expect(prep.secret_value).toBe("secret-social_api-123");

    await serverCall(owner.userId, proof("finish", owner.userId, {
      jobId, revision: prep.revision, success: true, externalUrl: "https://sns.example.test/post/1",
    }));

    const jobRow = await one<{ status: string; external_url: string }>(
      db,
      "select status, external_url from public.execution_jobs where id = $1",
      [jobId],
    );
    expect(jobRow).toEqual({ status: "succeeded", external_url: "https://sns.example.test/post/1" });

    const resId = await serverCall<string>(owner.userId, proof("recordMetric", owner.userId, {
      projectId, executionJobId: jobId, metricName: "SNS 노출수", value: 1240, unit: "count",
      sourceNote: "SNS API 자동 수집", periodStart: "2026-11-22", periodEnd: "2026-11-23",
    }));
    const resRow = await one<{ collection_mode: string; value: string }>(
      db,
      "select collection_mode, value::text from public.execution_results where id = $1",
      [resId],
    );
    expect(resRow).toEqual({ collection_mode: "readonly_sync", value: "1240.00" });

    await asUser(db, owner.userId, (tx) => tx.query("select public.disconnect_channel_connection('crm')"));
    const secCnt = await one<{ c: string }>(
      db,
      "select count(*)::text as c from app.channel_secrets where workspace_id = $1 and channel = 'crm'",
      [owner.workspaceId],
    );
    expect(secCnt.c).toBe("0");
  });

  it("P4B 예약 실행 · 상담 마스킹 목록 · CRM 후속 작업 및 타 업무실 차단", async () => {
    const { owner, projectId, draftId } = await setupReviewedDraft("p4b-owner@example.test");
    const other = await seedOwner(db, "p4b-other@example.test");

    await asUser(db, owner.userId, (tx) =>
      tx.query("select public.upsert_channel_connection('crm', 'CRM 웹훅', 'https://crm.example.test/hook', '', 0, 0, 'crm-tok')"),
    );
    const jobId = await asUser(db, owner.userId, async (tx) => {
      const r = await tx.query<{ id: string }>(
        "select public.enqueue_execution($1, 'channel_draft', $2, 'crm') as id",
        [projectId, draftId],
      );
      return r.rows[0].id;
    });

    const schedId = await asUser(db, owner.userId, async (tx) => {
      const r = await tx.query<{ id: string }>(
        "select public.schedule_execution($1, '2026-11-25T10:00:00+09:00') as id",
        [jobId],
      );
      return r.rows[0].id;
    });
    await asUser(db, owner.userId, (tx) => tx.query("select public.cancel_execution_schedule($1)", [schedId]));

    const inqId = await asUser(db, owner.userId, async (tx) => {
      const r = await tx.query<{ id: string }>(
        "select public.create_inquiry($1, 'manual', null, '김철수', '01012345678', 'chulsoo@studio.kr', '견적 문의') as id",
        [projectId],
      );
      return r.rows[0].id;
    });

    const maskedList = await asUser(db, owner.userId, async (tx) => {
      const r = await tx.query<{ list: Array<{ masked_name: string; masked_phone: string; masked_email: string }> }>(
        "select public.list_masked_inquiries($1) as list",
        [projectId],
      );
      return r.rows[0].list;
    });
    expect(maskedList).toHaveLength(1);
    expect(maskedList[0].masked_name).toBe("김*수");
    expect(maskedList[0].masked_phone).toBe("010-****-5678");
    expect(maskedList[0].masked_email).toBe("c***@studio.kr");

    const fId = await asUser(db, owner.userId, async (tx) => {
      const r = await tx.query<{ id: string }>(
        "select public.create_crm_followup($1, '홍담당', '2026-11-26') as id",
        [inqId],
      );
      return r.rows[0].id;
    });
    await asUser(db, owner.userId, (tx) => tx.query("select public.update_crm_followup($1, 'done', null)", [fId]));

    await expectDbError(
      asUser(db, other.userId, (tx) => tx.query("select public.update_crm_followup($1, 'hold', null)", [fId])),
      /NOT_FOUND/,
    );
  });
});
