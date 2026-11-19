/**
 * P3C-BACKEND-IMPL-01: 디자인 자산 DB(20261121004000_p3c_design_assets) 시험. 설계: Plan/Claude-Backend-20261120/P3C-BACKEND-01-DESIGN.md.
 * 저장소는 shim 의 storage.objects(RLS 켜짐, metadata 칸)로 흉내 낸다. 모든 값은 합성이다.
 */
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft } from "@/domain/strategy";
import { designConfirmMessage, designReserveMessage } from "@/domain/design-assets";
import { asUser, createDb, expectDbError, newKey, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;
let secret: string;

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "design-owner-a@example.test");
  b = await seedOwner(db, "design-owner-b@example.test");
  strategyTpl = (await one<{ id: string }>(db, "select id from templates where key = $1", [STRATEGY_TEMPLATE_VERSION])).id;
  secret = (await one<{ value: string }>(db, "select value from app.server_secrets where name = 'design_asset_signing'")).value;
  for (const f of [a, b])
    await asUser(db, f.userId, (tx) =>
      tx.query(
        "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
        [f.profileA1],
      ),
    );
}, 60_000);

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const asAnon = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn);
const count = async (sql: string, p: unknown[] = []) => (await one<{ n: number }>(db, `select count(*)::int as n from (${sql}) x`, p)).n;
const replica = async (fn: () => Promise<unknown>) => {
  await db.exec("set session_replication_role = replica");
  try {
    await fn();
  } finally {
    await db.exec("set session_replication_role = origin");
  }
};

const sign = (purpose: string, message: string, at = Date.now(), key = secret) => ({
  at,
  sig: createHmac("sha256", key).update(`${purpose}|${message}|${at}`, "utf8").digest("hex"),
});
const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);

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
    return { artifactId: g.artifact_id };
  });
}

type Brief = { id: string; revision: number };
async function brief(f: Fixture, o: { kinds?: string[]; ready?: boolean } = {}): Promise<Brief> {
  // 프로젝트당 브리프 10개 한도: 앞 시험의 오래된 브리프를 보관해 자리를 만든다
  const act = await db.query<{ id: string; revision: number }>(
    "select id, revision from production_briefs where project_id = $1 and archived_at is null order by created_at", [f.projectA]);
  for (const r of act.rows.slice(0, Math.max(0, act.rows.length - 5)))
    await asUser(db, f.userId, (tx) => tx.query("select archive_production_brief($1, $2)", [r.id, r.revision]));
  const s = await strategy(f);
  const kinds = o.kinds ?? ["design_assets", "web_copy"];
  return asUser(db, f.userId, async (tx) => {
    const id = (await one<{ id: string }>(tx, "select create_production_brief($1, $2, '디자인 브리프', '대상', '메시지', $3::text[], '범위') as id", [f.projectA, s.artifactId, kinds])).id;
    if (o.ready === false) return { id, revision: 1 };
    await tx.query("select update_production_brief($1, 1, '디자인 브리프', '대상', '메시지', $2::text[], '범위', null, null, 'ready')", [id, kinds]);
    return { id, revision: 2 };
  });
}

type Res = { kind?: string; fileName?: string; size?: number; mime?: string; assetId?: string | null };
const resArgs = (briefId: string, r: Res) => {
  const kind = r.kind ?? "logo";
  const fileName = r.fileName ?? "logo.svg";
  const size = r.size ?? 1234;
  const mime = r.mime ?? "image/svg+xml";
  const assetId = r.assetId ?? null;
  // 서명 메시지는 앱 서버와 같은 함수로 만든다(앱 ↔ DB 순서 대조)
  return { briefId, kind, fileName, size, mime, assetId, msg: designReserveMessage({ productionBriefId: briefId, assetId, kind, fileName, size, mime } as never) };
};
const reserve = (tx: Tx, briefId: string, r: Res = {}, s?: { at: number; sig: string }) => {
  const x = resArgs(briefId, r);
  const g = s ?? sign("design_reserve", x.msg);
  return one<{ upload_id: string; storage_key: string; expires_at: string }>(tx, "select * from reserve_design_asset_upload($1, $2, $3, $4, $5, $6, $7, $8)", [
    x.briefId, x.assetId, x.kind, x.fileName, x.size, x.mime, g.at, g.sig,
  ]);
};
const putObject = (tx: Tx, key: string, size: number, mime: string, uid: string) =>
  tx.query("insert into storage.objects (bucket_id, name, owner, metadata) values ('design-assets', $1, $2, $3::jsonb)", [key, uid, JSON.stringify({ size, mimetype: mime })]);
const create = (tx: Tx, uploadId: string, o: { title?: string; license?: string | null; origin?: string; sha?: string; s?: { at: number; sig: string } } = {}) => {
  const sha = o.sha ?? SHA;
  const g = o.s ?? sign("design_confirm", designConfirmMessage(uploadId, sha));
  return one<{ id: string }>(tx, "select create_design_asset($1, $2, $3, $4, $5, $6, $7) as id", [uploadId, o.title ?? "메인 로고", o.license ?? null, o.origin ?? "external_upload", sha, g.at, g.sig]).then((r) => r.id);
};
const replace = (tx: Tx, assetId: string, rev: number, uploadId: string, note: string | null = null, sha = SHA2) => {
  const g = sign("design_confirm", designConfirmMessage(uploadId, sha));
  return one<{ r: number }>(tx, "select replace_design_asset_file($1, $2, $3, $4, $5, $6, $7) as r", [assetId, rev, uploadId, note, sha, g.at, g.sig]).then((r) => r.r);
};
/** 예약 → 저장소에 올리기 → 만들기 */
async function newAsset(f: Fixture, briefId: string, r: Res = {}, title = "메인 로고") {
  return asUser(db, f.userId, async (tx) => {
    const x = resArgs(briefId, r);
    const u = await reserve(tx, briefId, r);
    await putObject(tx, u.storage_key, x.size, x.mime, f.userId);
    return create(tx, u.upload_id, { title });
  });
}
const asset = (id: string) =>
  one<{ revision: number; current_version_no: number; status: string; title: string; license_note: string | null; archived_at: string | null; source_brief_revision: number }>(
    db, "select * from design_assets where id = $1", [id]);
const version = (id: string, n: number) =>
  one<{ kind: string; storage_key: string; sha256: string; restored_from_version_no: number | null; source_brief_revision: number }>(
    db, "select * from design_asset_versions where asset_id = $1 and version_no = $2", [id, n]);

describe("서버 서명(예약·확정·닫기)", () => {
  it("서명 없음·틀림·5분 지난 서명·다른 용도 서명은 BAD_SIGNATURE, anon 은 권한 없음", async () => {
    const br = await brief(a);
    const x = resArgs(br.id, {});
    await expectDbError(asA((tx) => reserve(tx, br.id, {}, { at: Date.now(), sig: "" })), /BAD_SIGNATURE/);
    await expectDbError(asA((tx) => reserve(tx, br.id, {}, sign("design_reserve", x.msg, Date.now(), "f".repeat(64)))), /BAD_SIGNATURE/);
    await expectDbError(asA((tx) => reserve(tx, br.id, {}, sign("design_reserve", x.msg, Date.now() - 6 * 60_000))), /BAD_SIGNATURE/);
    await expectDbError(asA((tx) => reserve(tx, br.id, {}, sign("design_confirm", x.msg))), /BAD_SIGNATURE/);
    // 서명한 값과 다른 크기로 부르면(브라우저가 값을 바꿈) 거절
    await expectDbError(asA((tx) => reserve(tx, br.id, { size: 999 }, sign("design_reserve", x.msg))), /BAD_SIGNATURE/);
    await expectDbError(asAnon((tx) => reserve(tx, br.id)), /permission denied/);

    const u = await asA((tx) => reserve(tx, br.id));
    await asA((tx) => putObject(tx, u.storage_key, 1234, "image/svg+xml", a.userId));
    await expectDbError(asA((tx) => create(tx, u.upload_id, { s: sign("design_reserve", `${u.upload_id}|${SHA}`) })), /BAD_SIGNATURE/);
    // sha 를 바꿔 부르면 서명이 맞지 않는다(서버가 잰 값만)
    await expectDbError(asA((tx) => create(tx, u.upload_id, { sha: SHA2, s: sign("design_confirm", `${u.upload_id}|${SHA}`) })), /BAD_SIGNATURE/);
    const g = sign("design_reject", `${u.upload_id}|TYPE_MISMATCH`);
    await expectDbError(asA((tx) => tx.query("select reject_design_asset_upload($1, 'UNSAFE_SVG', $2, $3)", [u.upload_id, g.at, g.sig])), /BAD_SIGNATURE/);
    expect(await count("select 1 from design_assets where production_brief_id = $1", [br.id])).toBe(0);
  });

  it("서명 키가 DB 에 없으면 NOT_CONFIGURED", async () => {
    const br = await brief(a);
    await db.exec("begin");
    try {
      await db.query("delete from app.server_secrets where name = 'design_asset_signing'");
      await expectDbError(
        (async () => {
          await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: a.userId, role: "authenticated" })]);
          await db.exec("set local role authenticated");
          const x = resArgs(br.id, {});
          const g = sign("design_reserve", x.msg);
          await db.query("select * from reserve_design_asset_upload($1, null, 'logo', 'logo.svg', 1234, 'image/svg+xml', $2, $3)", [br.id, g.at, g.sig]);
        })(),
        /NOT_CONFIGURED/,
      );
    } finally {
      await db.exec("rollback");
    }
  });
});

describe("예약", () => {
  it("분류별 형식·크기·파일 이름, 브리프 조건(작성 중·design_assets 없음·남의 것·보관) 거절, 경로는 서버가 정함", async () => {
    const br = await brief(a);
    await expectDbError(asA((tx) => reserve(tx, br.id, { kind: "logo", mime: "image/jpeg", fileName: "a.jpg" })), /UNSUPPORTED_TYPE/);
    await expectDbError(asA((tx) => reserve(tx, br.id, { kind: "image", mime: "image/svg+xml", fileName: "a.svg" })), /UNSUPPORTED_TYPE/);
    await expectDbError(asA((tx) => reserve(tx, br.id, { kind: "font", mime: "text/html", fileName: "a.html" })), /UNSUPPORTED_TYPE/);
    await expectDbError(asA((tx) => reserve(tx, br.id, { kind: "color", mime: "application/json", fileName: "t.json", size: 1048577 })), /TOO_LARGE/);
    await expectDbError(asA((tx) => reserve(tx, br.id, { kind: "image", mime: "image/png", fileName: "a.png", size: 10485761 })), /TOO_LARGE/);
    await expectDbError(asA((tx) => reserve(tx, br.id, { size: 0 })), /TOO_LARGE/);
    await expectDbError(asA((tx) => reserve(tx, br.id, { fileName: "logo.png" })), /TYPE_MISMATCH/);
    await expectDbError(asA((tx) => reserve(tx, br.id, { fileName: "../x/logo.svg" })), /TYPE_MISMATCH/);
    await expectDbError(asA((tx) => reserve(tx, br.id, { fileName: "lo\u0000go.svg" })), /TYPE_MISMATCH|invalid byte|null character/);
    await expectDbError(asA((tx) => reserve(tx, br.id, { fileName: ` ${"a".repeat(10)}.svg` })), /TYPE_MISMATCH/);
    // Tester CS2·CS9·C3: 다중 확장자, '..', 줄바꿈, 역슬래시, 글자 방향 바꾸기(RTL 덮어쓰기), 201자
    for (const fileName of ["logo.svg.html", "..svg", "a..b.svg", "a\nb.svg", "a\\b.svg", "gpj\u202e.svg", "a\u2066b.svg", `${"가".repeat(197)}.svg`])
      await expectDbError(asA((tx) => reserve(tx, br.id, { fileName })), /TYPE_MISMATCH|BAD_SIGNATURE/);
    await asA((tx) => reserve(tx, br.id, { fileName: `${"가".repeat(196)}.svg` })); // 정확히 200자는 된다
    await asA((tx) => reserve(tx, br.id, { fileName: "<img src=x onerror=alert(1)>.svg" })); // 꺾쇠는 글자로만 보인다(화면 이스케이프)
    await expectDbError(asA((tx) => reserve(tx, br.id, { kind: "video", mime: "image/png", fileName: "a.png" })), /VALIDATION|UNSUPPORTED_TYPE/);
    // jpg·jpeg 둘 다 된다
    await asA((tx) => reserve(tx, br.id, { kind: "image", mime: "image/jpeg", fileName: "사진.JPEG" }));
    const u = await asA((tx) => reserve(tx, br.id, { kind: "font", mime: "font/woff2", fileName: "본문.woff2" }));
    expect(u.storage_key).toBe(`${a.workspaceId}/design-assets/${u.upload_id}.woff2`);

    const draft = await brief(a, { ready: false });
    await expectDbError(asA((tx) => reserve(tx, draft.id)), /INVALID_TRANSITION: 확정한 제작 브리프로만/);
    const noKind = await brief(a, { kinds: ["web_copy"] });
    await expectDbError(asA((tx) => reserve(tx, noKind.id)), /INVALID_TRANSITION: .*디자인 자산이 없습니다/);
    await expectDbError(asB((tx) => reserve(tx, br.id)), /NOT_FOUND: 제작 브리프/);
    const arch = await brief(a);
    await asA((tx) => tx.query("select archive_production_brief($1, $2)", [arch.id, arch.revision]));
    await expectDbError(asA((tx) => reserve(tx, arch.id)), /INVALID_TRANSITION: 보관한 제작 브리프/);
  });

  it("예약 표는 사용자가 읽을 수도 쓸 수도 없다", async () => {
    await expectDbError(asA((tx) => tx.query("select * from design_asset_uploads")), /permission denied/);
    await expectDbError(asA((tx) => tx.query("update design_asset_uploads set expires_at = now() + interval '1 day'")), /permission denied/);
  });
});

describe("저장소 정책", () => {
  it("예약된 내 경로에만 올릴 수 있고, 다른 경로·남의 예약·만료·이미 확정·같은 경로 두 번은 거절, 고치기·지우기 불가", async () => {
    const br = await brief(a);
    const u = await asA((tx) => reserve(tx, br.id));
    // 예약 안 된 내 업무실 경로
    await expectDbError(asA((tx) => putObject(tx, `${a.workspaceId}/design-assets/${crypto.randomUUID()}.svg`, 1, "image/svg+xml", a.userId)), /row-level security/);
    // 다른 버킷 경로 흉내(source-assets 정책은 별개)·남(B)이 A 의 예약 경로에
    await expectDbError(asB((tx) => putObject(tx, u.storage_key, 1234, "image/svg+xml", b.userId)), /row-level security/);
    await asA((tx) => putObject(tx, u.storage_key, 1234, "image/svg+xml", a.userId));
    await expectDbError(asA((tx) => putObject(tx, u.storage_key, 1234, "image/svg+xml", a.userId)), /duplicate key|row-level security/);
    // 고치기·지우기 정책 없음 → 0행
    await asA((tx) => tx.query("update storage.objects set metadata = '{\"size\":1,\"mimetype\":\"image/svg+xml\"}' where name = $1", [u.storage_key]));
    await asA((tx) => tx.query("delete from storage.objects where name = $1", [u.storage_key]));
    expect(await one(db, "select metadata from storage.objects where name = $1", [u.storage_key])).toEqual({ metadata: { size: 1234, mimetype: "image/svg+xml" } });
    // 읽기는 내 업무실만
    expect(await asA((tx) => one<{ n: number }>(tx, "select count(*)::int as n from storage.objects where name = $1", [u.storage_key]))).toEqual({ n: 1 });
    expect(await asB((tx) => one<{ n: number }>(tx, "select count(*)::int as n from storage.objects where name = $1", [u.storage_key]))).toEqual({ n: 0 });
    // 확정 뒤에는 그 경로에 더 못 올린다(정책: 진행 중 예약만)
    await asA((tx) => create(tx, u.upload_id));
    const exp = await asA((tx) => reserve(tx, br.id));
    await db.query("update design_asset_uploads set expires_at = now() - interval '1 second' where id = $1", [exp.upload_id]);
    await expectDbError(asA((tx) => putObject(tx, exp.storage_key, 1234, "image/svg+xml", a.userId)), /row-level security/);
  });
});

describe("확정(만들기)", () => {
  it("v1·예약 confirmed·감사 본문 0(이름·파일 이름 없음)", async () => {
    const br = await brief(a);
    const id = await newAsset(a, br.id, { fileName: "비밀회사-로고.svg" }, "비밀 프로젝트 로고");
    expect(await asset(id)).toMatchObject({ revision: 1, current_version_no: 1, status: "drafting", source_brief_revision: br.revision, archived_at: null });
    expect(await version(id, 1)).toMatchObject({ kind: "create", sha256: SHA, restored_from_version_no: null });
    expect(await count("select 1 from design_asset_uploads where status = 'confirmed' and storage_key = (select storage_key from design_asset_versions where asset_id = $1)", [id])).toBe(1);
    const au = await one<{ details: Record<string, unknown> }>(db, "select details from audit_events where entity_type = 'design_asset' and entity_id = $1", [id]);
    expect(au.details).toMatchObject({ version_no: 1, asset_kind: "logo", mime_type: "image/svg+xml", file_size_bytes: 1234 });
    expect(JSON.stringify(au.details)).not.toMatch(/비밀|\.svg/);
  });

  it("객체 없음·크기 다름·형식 다름·만료·이미 확정·닫힌 예약·남의 예약·앱 내 생성·이름 검사 거절", async () => {
    const br = await brief(a);
    const u1 = await asA((tx) => reserve(tx, br.id));
    await expectDbError(asA((tx) => create(tx, u1.upload_id)), /UPLOAD_MISSING/);
    await asA((tx) => putObject(tx, u1.storage_key, 9999, "image/svg+xml", a.userId));
    await expectDbError(asA((tx) => create(tx, u1.upload_id)), /TYPE_MISMATCH: 올린 파일의 크기·형식/);

    const u2 = await asA((tx) => reserve(tx, br.id));
    await asA((tx) => putObject(tx, u2.storage_key, 1234, "text/html", a.userId));
    await expectDbError(asA((tx) => create(tx, u2.upload_id)), /TYPE_MISMATCH/);
    // 형식 매개변수(charset)는 떼고 비교: CSS 에 charset 이 붙어도 확정, 매개변수 앞이 다르면 거절
    const css = await asA((tx) => reserve(tx, br.id, { kind: "color", mime: "text/css", fileName: "토큰.css", size: 50 }));
    await asA((tx) => putObject(tx, css.storage_key, 50, "text/css; charset=UTF-8", a.userId));
    await asA((tx) => create(tx, css.upload_id, { title: "토큰" }));
    const js = await asA((tx) => reserve(tx, br.id, { kind: "color", mime: "application/json", fileName: "t.json", size: 50 }));
    await asA((tx) => putObject(tx, js.storage_key, 50, "text/html;charset=UTF-8", a.userId));
    await expectDbError(asA((tx) => create(tx, js.upload_id)), /TYPE_MISMATCH/);

    const u3 = await asA((tx) => reserve(tx, br.id));
    await asA((tx) => putObject(tx, u3.storage_key, 1234, "image/svg+xml", a.userId));
    await expectDbError(asB((tx) => create(tx, u3.upload_id)), /NOT_FOUND: 업로드 예약/);
    await expectDbError(asA((tx) => create(tx, u3.upload_id, { origin: "app_generated" })), /VALIDATION: 앱 내 생성은 아직/);
    await expectDbError(asA((tx) => create(tx, u3.upload_id, { title: "" })), /VALIDATION: 자산 이름/);
    await expectDbError(asA((tx) => create(tx, u3.upload_id, { title: "가".repeat(101) })), /VALIDATION: 자산 이름/);
    await expectDbError(asA((tx) => create(tx, u3.upload_id, { license: "가".repeat(501) })), /VALIDATION: 라이선스/);
    await db.query("update design_asset_uploads set expires_at = now() - interval '1 second' where id = $1", [u3.upload_id]);
    await expectDbError(asA((tx) => create(tx, u3.upload_id)), /UPLOAD_EXPIRED/);

    const u4 = await asA((tx) => reserve(tx, br.id));
    await asA((tx) => putObject(tx, u4.storage_key, 1234, "image/svg+xml", a.userId));
    await asA((tx) => create(tx, u4.upload_id, { license: "무료 글꼴(OFL)" }));
    await expectDbError(asA((tx) => create(tx, u4.upload_id)), /INVALID_TRANSITION: 이미 끝난 업로드/);

    const u5 = await asA((tx) => reserve(tx, br.id));
    const g = sign("design_reject", `${u5.upload_id}|UNSAFE_SVG`);
    await asA((tx) => tx.query("select reject_design_asset_upload($1, 'UNSAFE_SVG', $2, $3)", [u5.upload_id, g.at, g.sig]));
    expect(await one(db, "select status, reject_reason from design_asset_uploads where id = $1", [u5.upload_id])).toEqual({ status: "rejected", reject_reason: "UNSAFE_SVG" });
    await asA((tx) => putObject(tx, u5.storage_key, 1234, "image/svg+xml", a.userId)).catch(() => undefined);
    await expectDbError(asA((tx) => create(tx, u5.upload_id)), /INVALID_TRANSITION: 이미 끝난 업로드/);
  });

  it("사용자는 표에 직접 쓸 수 없고 판은 고치기·지우기 불가", async () => {
    const br = await brief(a);
    const id = await newAsset(a, br.id);
    await expectDbError(asA((tx) => tx.query("insert into design_assets (workspace_id, project_id, production_brief_id, source_brief_revision, title, asset_kind, origin_type, current_version_no, created_by) values ($1, $2, $3, 2, 'x', 'logo', 'external_upload', 1, $4)", [a.workspaceId, a.projectA, br.id, a.userId])), /permission denied/);
    await expectDbError(asA((tx) => tx.query("update design_assets set title = 'x' where id = $1", [id])), /permission denied/);
    await expectDbError(db.query("update design_asset_versions set sha256 = $2 where asset_id = $1", [id, SHA2]), /./);
    await expectDbError(db.query("delete from design_asset_versions where asset_id = $1", [id]), /./);
    expect(await asB((tx) => one<{ n: number }>(tx, "select count(*)::int as n from design_assets where id = $1", [id]))).toEqual({ n: 0 });
  });
});

describe("한도", () => {
  it("프로젝트당 50개(보관 포함), 진행 중 예약 20, 업무실 용량 500MB", async () => {
    const f = await seedOwner(db, "design-limit@example.test");
    await asUser(db, f.userId, (tx) =>
      tx.query("select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))", [f.profileA1]),
    );
    const br = await brief(f);
    const asF = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, f.userId, fn);
    // 진행 중 예약 20
    const pend: string[] = [];
    for (let i = 0; i < 20; i++) pend.push((await asF((tx) => reserve(tx, br.id))).upload_id);
    await expectDbError(asF((tx) => reserve(tx, br.id)), /LIMIT_REACHED: 진행 중인 업로드/);
    await db.query("update design_asset_uploads set expires_at = now() - interval '1 second' where id = any($1::uuid[])", [pend]);
    // 50개: 49개는 빠르게(실제 경로로 1개 만든 뒤 판·자산 행을 복제), 마지막 1개는 실제 경로
    const first = await newAsset(f, br.id);
    await replica(async () => {
      for (let i = 0; i < 48; i++) {
        const nid = crypto.randomUUID();
        await db.query("insert into design_assets select $2, workspace_id, project_id, production_brief_id, source_brief_revision, title, asset_kind, origin_type, license_note, status, current_version_no, archived_at, revision, created_by, created_at, updated_at from design_assets where id = $1", [first, nid]);
        await db.query("insert into design_asset_versions (workspace_id, asset_id, version_no, kind, storage_key, file_name, file_size_bytes, mime_type, sha256, source_brief_revision, created_by) select workspace_id, $2, 1, kind, storage_key, file_name, file_size_bytes, mime_type, sha256, source_brief_revision, created_by from design_asset_versions where asset_id = $1", [first, nid]);
      }
    });
    const last = await newAsset(f, br.id);
    await asF((tx) => tx.query("select archive_design_asset($1, 1)", [last]));
    await expectDbError(asF((tx) => reserve(tx, br.id)), /LIMIT_REACHED: 디자인 자산은 프로젝트당 50개/);

    // 용량: 다른 업무실(g)에서 판 50개 × 10MB = 500MB 를 채우면 1바이트도 예약 불가
    const g = await seedOwner(db, "design-quota@example.test");
    await asUser(db, g.userId, (tx) =>
      tx.query("select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))", [g.profileA1]),
    );
    const gb = await brief(g);
    const gid = await newAsset(g, gb.id, { kind: "image", mime: "image/png", fileName: "a.png", size: 10485760 });
    // 판 29개(같은 자산, 서로 다른 파일) + 되돌리기 판 1개(같은 파일 → 용량에 다시 세지 않음) + 다른 자산 20개 = 서로 다른 파일 50개
    await replica(async () => {
      for (let i = 0; i < 29; i++)
        await db.query("insert into design_asset_versions (workspace_id, asset_id, version_no, kind, storage_key, file_name, file_size_bytes, mime_type, sha256, source_brief_revision, created_by) select workspace_id, asset_id, $2, 'replace', storage_key || $3, file_name, file_size_bytes, mime_type, sha256, source_brief_revision, created_by from design_asset_versions where asset_id = $1 and version_no = 1", [gid, 2 + i, `-${i}`]);
      for (let i = 0; i < 20; i++) {
        const nid = crypto.randomUUID();
        await db.query("insert into design_assets select $2, workspace_id, project_id, production_brief_id, source_brief_revision, title, asset_kind, origin_type, license_note, status, current_version_no, archived_at, revision, created_by, created_at, updated_at from design_assets where id = $1", [gid, nid]);
        await db.query("insert into design_asset_versions (workspace_id, asset_id, version_no, kind, storage_key, file_name, file_size_bytes, mime_type, sha256, source_brief_revision, created_by) select workspace_id, $2, 1, kind, storage_key || $3, file_name, file_size_bytes, mime_type, sha256, source_brief_revision, created_by from design_asset_versions where asset_id = $1 and version_no = 1", [gid, nid, `-x${i}`]);
      }
      const nid = crypto.randomUUID();
      await db.query("insert into design_assets select $2, workspace_id, project_id, production_brief_id, source_brief_revision, title, asset_kind, origin_type, license_note, status, current_version_no, archived_at, revision, created_by, created_at, updated_at from design_assets where id = $1", [gid, nid]);
      await db.query("insert into design_asset_versions (workspace_id, asset_id, version_no, kind, storage_key, file_name, file_size_bytes, mime_type, sha256, restored_from_version_no, source_brief_revision, created_by) select workspace_id, $2, 1, 'restore', storage_key, file_name, file_size_bytes, mime_type, sha256, 1, source_brief_revision, created_by from design_asset_versions where asset_id = $1 and version_no = 1", [gid, nid]);
    });
    await expectDbError(asUser(db, g.userId, (tx) => reserve(tx, gb.id, { kind: "color", mime: "text/css", fileName: "t.css", size: 1 })), /QUOTA_EXCEEDED/);
    // 되돌리기 판은 같은 파일을 가리켜 용량을 다시 세지 않는다(서로 다른 storage_key 만)
    expect(await one(db, "select app.design_asset_used_bytes($1)::bigint as n", [g.workspaceId])).toEqual({ n: 524288000 });
  });
});

describe("교체·정보 저장·되돌리기·맞추기·보관", () => {
  it("교체는 같은 분류만 새 판, 되돌리기는 같은 storage_key 로 새 판, 같은 파일 되돌리기·CONFLICT 거절", async () => {
    const br = await brief(a);
    const id = await newAsset(a, br.id);
    const v1 = await version(id, 1);
    await expectDbError(asA((tx) => reserve(tx, br.id, { assetId: id, kind: "image", mime: "image/png", fileName: "a.png" })), /VALIDATION: 같은 분류/);
    const u = await asA((tx) => reserve(tx, br.id, { assetId: id, mime: "image/png", fileName: "logo-v2.png", size: 2000 }));
    await asA((tx) => putObject(tx, u.storage_key, 2000, "image/png", a.userId));
    // 만들기 RPC 로 교체용 예약을 쓰면 거절
    await expectDbError(asA((tx) => create(tx, u.upload_id)), /VALIDATION: 교체용 업로드/);
    await expectDbError(asA((tx) => replace(tx, id, 9, u.upload_id)), /CONFLICT/);
    await expectDbError(asA((tx) => replace(tx, id, 1, u.upload_id, "가".repeat(301))), /VALIDATION: 바꾼 내용 메모/);
    expect(await asA((tx) => replace(tx, id, 1, u.upload_id, "색 보정"))).toBe(2);
    expect(await version(id, 2)).toMatchObject({ kind: "replace", sha256: SHA2, storage_key: u.storage_key });
    // 다른 자산의 교체 예약으로는 못 바꾼다
    const other = await newAsset(a, br.id);
    const uo = await asA((tx) => reserve(tx, br.id, { assetId: other }));
    await asA((tx) => putObject(tx, uo.storage_key, 1234, "image/svg+xml", a.userId));
    await expectDbError(asA((tx) => replace(tx, id, 2, uo.upload_id)), /VALIDATION: 이 자산의 교체용 업로드가 아닙니다/);

    expect(await asA((tx) => one<{ r: number }>(tx, "select restore_design_asset_version($1, 2, 1) as r", [id]))).toEqual({ r: 3 });
    expect(await version(id, 3)).toMatchObject({ kind: "restore", storage_key: v1.storage_key, sha256: v1.sha256, restored_from_version_no: 1 });
    await expectDbError(asA((tx) => tx.query("select restore_design_asset_version($1, 3, 1)", [id])), /VALIDATION: 지금 파일과 같은 판/);
    await expectDbError(asA((tx) => tx.query("select restore_design_asset_version($1, 3, 99)", [id])), /NOT_FOUND: 그 판/);
  });

  it("정보 저장: 판은 그대로, 바뀐 게 없으면 거절, 상태 reviewed, 감사에 이름 없음", async () => {
    const br = await brief(a);
    const id = await newAsset(a, br.id);
    await expectDbError(asA((tx) => tx.query("select update_design_asset($1, 1, '메인 로고', null, 'drafting')", [id])), /VALIDATION: 바뀐 내용이 없습니다/);
    await expectDbError(asA((tx) => tx.query("select update_design_asset($1, 1, '메인 로고', null, 'done')", [id])), /VALIDATION: 알 수 없는 진행 상태/);
    expect(await asA((tx) => one<{ r: number }>(tx, "select update_design_asset($1, 1, '비밀 새 이름', '상업 사용 가능', 'reviewed') as r", [id]))).toEqual({ r: 2 });
    expect(await asset(id)).toMatchObject({ current_version_no: 1, status: "reviewed", title: "비밀 새 이름", license_note: "상업 사용 가능" });
    const au = await one<{ details: unknown }>(db, "select details from audit_events where entity_type = 'design_asset' and entity_id = $1 and action = 'design_asset_update'", [id]);
    expect(JSON.stringify(au.details)).not.toMatch(/비밀|상업/);
    await expectDbError(asB((tx) => tx.query("select update_design_asset($1, 2, 'x', null, 'drafting')", [id])), /NOT_FOUND/);
  });

  it("맞추기: 브리프가 바뀌면 같은 파일로 새 판, 작성 중·보관 브리프는 원인별 문구, 교체는 지난 기준 그대로 됨", async () => {
    const br = await brief(a);
    const id = await newAsset(a, br.id);
    await expectDbError(asA((tx) => tx.query("select rebase_design_asset($1, 1)", [id])), /VALIDATION: 이미 지금 제작 브리프 기준/);
    await asA((tx) => tx.query("select update_production_brief($1, $2, '새 제목', '대상', '메시지', array['design_assets'], '범위', null, null, 'ready')", [br.id, br.revision]));
    expect(await asA((tx) => one<{ r: number }>(tx, "select rebase_design_asset($1, 1) as r", [id]))).toEqual({ r: 2 });
    expect(await version(id, 2)).toMatchObject({ kind: "rebase", source_brief_revision: br.revision + 1, storage_key: (await version(id, 1)).storage_key });
    await asA((tx) => tx.query("select update_production_brief($1, $2, '새 제목', '대상', '메시지', array['design_assets'], '범위', null, null, 'drafting')", [br.id, br.revision + 1]));
    await expectDbError(asA((tx) => tx.query("select rebase_design_asset($1, 2)", [id])), /INVALID_TRANSITION: 제작 브리프가 작성 중이라/);
    // 브리프가 작성 중이어도 교체는 된다(P3-b 저장과 같음)
    const u = await asA((tx) => reserve(tx, br.id, { assetId: id }));
    await asA((tx) => putObject(tx, u.storage_key, 1234, "image/svg+xml", a.userId));
    expect(await asA((tx) => replace(tx, id, 2, u.upload_id))).toBe(3);
    await asA((tx) => tx.query("select archive_production_brief($1, $2)", [br.id, br.revision + 2]));
    await expectDbError(asA((tx) => tx.query("select rebase_design_asset($1, 3)", [id])), /INVALID_TRANSITION: 보관한 제작 브리프라/);
  });

  it("보관: 되돌리기 없음, 보관 뒤 정보·교체·되돌리기·사용처·교체 예약 모두 거절, 판 30 한도", async () => {
    const br = await brief(a);
    const id = await newAsset(a, br.id);
    expect(await asA((tx) => one<{ r: number }>(tx, "select archive_design_asset($1, 1) as r", [id]))).toEqual({ r: 2 });
    await expectDbError(asA((tx) => tx.query("select archive_design_asset($1, 2)", [id])), /INVALID_TRANSITION: 이미 보관/);
    await expectDbError(asA((tx) => tx.query("select update_design_asset($1, 2, 'x', null, 'drafting')", [id])), /INVALID_TRANSITION: 보관한 디자인 자산/);
    await expectDbError(asA((tx) => tx.query("select set_design_asset_usages($1, 2, '[]'::jsonb)", [id])), /INVALID_TRANSITION: 보관한 디자인 자산/);
    await expectDbError(asA((tx) => reserve(tx, br.id, { assetId: id })), /INVALID_TRANSITION: 보관한 디자인 자산/);
    await expectDbError(db.query("update design_assets set archived_at = null where id = $1", [id]), /FROZEN_COLUMN/);

    const id2 = await newAsset(a, br.id);
    await replica(() => db.query("update design_assets set current_version_no = 30 where id = $1", [id2]));
    await expectDbError(asA((tx) => reserve(tx, br.id, { assetId: id2 })), /LIMIT_REACHED: 한 자산의 판은 30개/);
  });
});

describe("사용처", () => {
  it("같은 프로젝트·작업 중 문서의 현재 판 섹션만, 20곳·중복·형식·바뀐 것 없음 거절, 목록 교체", async () => {
    const br = await brief(a);
    const id = await newAsset(a, br.id);
    const docId = await asA((tx) => one<{ id: string }>(tx, "select create_web_copy_doc($1) as id", [br.id]).then((r) => r.id));
    const sections = (await one<{ ids: string[] }>(db, "select app.web_copy_ids(v.content, 'section') as ids from web_copy_versions v where v.doc_id = $1", [docId])).ids;
    const set = (rev: number, u: unknown) => asA((tx) => one<{ r: number }>(tx, "select set_design_asset_usages($1, $2, $3::jsonb) as r", [id, rev, JSON.stringify(u)]).then((r) => r.r));
    expect(await set(1, [{ doc_id: docId, section_id: sections[0] }, { doc_id: docId, section_id: sections[1] }])).toBe(2);
    expect(await count("select 1 from design_asset_usages where asset_id = $1", [id])).toBe(2);
    await expectDbError(set(2, [{ doc_id: docId, section_id: sections[1] }, { doc_id: docId, section_id: sections[0] }]), /VALIDATION: 바뀐 내용이 없습니다/);
    await expectDbError(set(2, [{ doc_id: docId, section_id: sections[0] }, { doc_id: docId, section_id: sections[0] }]), /VALIDATION: 같은 사용처가 두 번/);
    await expectDbError(set(2, [{ doc_id: docId, section_id: crypto.randomUUID() }]), /VALIDATION: 같은 프로젝트의 작업 중인/);
    await expectDbError(set(2, [{ doc_id: docId, section_id: 3 }]), /VALIDATION: 사용처 항목 형식/);
    await expectDbError(set(2, [{ doc_id: docId, section_id: sections[0], extra: 1 }]), /VALIDATION: 사용처 항목 형식/);
    await expectDbError(set(2, { doc_id: docId }), /VALIDATION: 사용처 목록 형식/);
    await expectDbError(set(2, Array.from({ length: 21 }, () => ({ doc_id: docId, section_id: sections[0] }))), /VALIDATION: 사용처는 자산당 20곳/);
    // 다른 업무실(B)의 문서
    const bb = await brief(b);
    const bDoc = await asB((tx) => one<{ id: string }>(tx, "select create_web_copy_doc($1) as id", [bb.id]).then((r) => r.id));
    const bSec = (await one<{ ids: string[] }>(db, "select app.web_copy_ids(v.content, 'section') as ids from web_copy_versions v where v.doc_id = $1", [bDoc])).ids[0];
    await expectDbError(set(2, [{ doc_id: bDoc, section_id: bSec }]), /VALIDATION: 같은 프로젝트의 작업 중인/);
    // 보관한 문서
    await asA((tx) => tx.query("select archive_web_copy($1, 1)", [docId]));
    await expectDbError(set(2, [{ doc_id: docId, section_id: sections[2] }]), /VALIDATION: 같은 프로젝트의 작업 중인/);
    // 빈 목록으로 비우기
    expect(await set(2, [])).toBe(3);
    expect(await count("select 1 from design_asset_usages where asset_id = $1", [id])).toBe(0);
  });
});

describe("기존 표 정리(O3)", () => {
  it("research_sources 는 사용자가 지울 수 없다(DELETE 권한 회수)", async () => {
    await expectDbError(asA((tx) => tx.query("delete from research_sources")), /permission denied/);
    const g = await one<{ d: boolean; t: boolean; s: boolean }>(db, "select has_table_privilege('authenticated', 'public.research_sources', 'DELETE') as d, has_table_privilege('authenticated', 'public.research_sources', 'TRUNCATE') as t, has_table_privilege('authenticated', 'public.research_sources', 'SELECT') as s");
    expect(g).toEqual({ d: false, t: false, s: true });
  });
});
