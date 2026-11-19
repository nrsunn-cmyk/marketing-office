/**
 * QA-P3C-PREP-01(Tester): P3-c 디자인 자산 공격 시험(PGlite). 근거: P3C-BACKEND-01-DESIGN.md 1~4절, QA-PLAN-P3CDE-01 2절 CS1~CS10.
 * 이름·인자·서명 형식·한도는 ./qa-p3c-names.ts 한곳. migration 31(design_assets)이 없으면 전체를 건너뛴다. 모든 값은 합성이다.
 * 저장소는 storage.objects 흉내 행으로 대신한다(metadata.size·mimetype). 실제 Storage API·서명 URL 시간·attachment 는 전용 스택에서 따로 본다.
 */
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  confirmMessage,
  P3C,
  p3cMigrationPresent,
  reserveMessage,
  sql,
} from "./qa-p3c-names";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const present = p3cMigrationPresent();
const L = P3C.limits;
const T = P3C.tables;
let db: Db;
let a: Fixture;
let b: Fixture;
let strategyTpl: string;
let secret = "";

const asU = <T>(f: Fixture | null, fn: (tx: Tx) => Promise<T>) =>
  asUser(db, f ? f.userId : null, fn);
const count = async (q: string, p: unknown[] = []) =>
  (await one<{ n: number }>(db, `select count(*)::int as n from (${q}) x`, p))
    .n;
const audits = (id: string) =>
  count(
    "select 1 from audit_events where entity_type = $1 and entity_id = $2",
    [P3C.auditEntity, id],
  );
const assetRow = (id: string) =>
  one<{
    revision: number;
    current_version_no: number;
    archived_at: string | null;
    status: string;
    workspace_id: string;
  }>(db, `select * from public.${T.assets} where id = $1`, [id]);
const versionsOf = (id: string) =>
  db
    .query<{
      version_no: number;
      kind: string;
      storage_key: string;
      restored_from_version_no: number | null;
    }>(
      `select * from public.${T.versions} where asset_id = $1 order by version_no`,
      [id],
    )
    .then((r) => r.rows);
const replica = async (fn: () => Promise<unknown>) => {
  await db.exec("set session_replication_role = replica");
  try {
    await fn();
  } finally {
    await db.exec("set session_replication_role = origin");
  }
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sign = async (purpose: string, msg: string, at: number, key = secret) =>
  (
    await one<{ h: string }>(
      db,
      "select app.hmac_sha256(convert_to($1, 'UTF8'), convert_to($2, 'UTF8')) as h",
      [key, `${purpose}|${msg}|${at}`],
    )
  ).h;

const approveProfile = (tx: Tx, id: string) =>
  tx.query(
    "select approve_company_profile_version($1, 'approved', coalesce((select max(seq) from company_profile_approvals where company_profile_version_id = $1), 0))",
    [id],
  );

type Ctx = {
  projectId: string;
  taskId: string;
  artifactId: string;
  briefId: string;
};
async function ctx(
  f: Fixture,
  types: string[] = ["design_assets", "web_copy"],
  status: "ready" | "drafting" = "ready",
): Promise<Ctx> {
  return asU(f, async (tx) => {
    const projectId = (
      await one<{ id: string }>(
        tx,
        "insert into projects (workspace_id, client_id, kind, title) values ($1, $2, 'client', '합성 P3C') returning id",
        [f.workspaceId, f.clientA],
      )
    ).id;
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
    const briefId = (
      await one<{ id: string }>(
        tx,
        "select create_production_brief($1, $2, '합성 브리프', '대상', '메시지', $3::text[], '범위', null, null) as id",
        [projectId, g.artifact_id, types],
      )
    ).id;
    if (status === "ready")
      await tx.query(
        "select update_production_brief($1, 1, '합성 브리프', '대상', '메시지', $2::text[], '범위', null, null, 'ready')",
        [briefId, types],
      );
    return { projectId, taskId, artifactId: g.artifact_id, briefId };
  });
}

type File = {
  kind: string;
  mime: string;
  size: number;
  name: string;
  body: string;
};
const PNG: File = {
  kind: "logo",
  mime: "image/png",
  size: 1234,
  name: "logo.png",
  body: "png-bytes",
};
type Upload = { upload_id: string; storage_key: string };
async function reserve(
  f: Fixture,
  briefId: string,
  file: File = PNG,
  assetId: string | null = null,
  o: { sig?: string | null; at?: number } = {},
): Promise<Upload> {
  const at = o.at ?? Date.now();
  const sig =
    o.sig === undefined
      ? await sign(
          P3C.purpose.reserve,
          reserveMessage(
            briefId,
            assetId,
            file.kind,
            file.size,
            file.mime,
            file.name,
          ),
          at,
        )
      : o.sig;
  const q = sql.reserve(
    briefId,
    assetId,
    file.kind,
    file.name,
    file.size,
    file.mime,
    at,
    sig,
  );
  return asU(f, (tx) => one<Upload>(tx, q.text, q.params));
}
/** 사용자가 저장소에 올리기(흉내): 정책이 예약 경로만 허용해야 한다 */
const putObject = (
  f: Fixture | null,
  key: string,
  size: number,
  mime: string,
) =>
  asU(f, (tx) =>
    tx.query(
      "insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, auth.uid(), $3::jsonb)",
      [P3C.bucket, key, JSON.stringify({ size, mimetype: mime })],
    ),
  );
async function confirmCreate(
  f: Fixture,
  up: Upload,
  o: {
    title?: string;
    license?: string | null;
    origin?: string;
    sha?: string;
    sig?: string | null;
    at?: number;
  } = {},
) {
  const at = o.at ?? Date.now();
  const h = o.sha ?? sha(up.upload_id);
  const sig =
    o.sig === undefined
      ? await sign(P3C.purpose.confirm, confirmMessage(up.upload_id, h), at)
      : o.sig;
  const q = sql.create(
    up.upload_id,
    o.title ?? "합성 로고",
    o.license ?? null,
    o.origin ?? "external_upload",
    h,
    at,
    sig,
  );
  return asU(f, (tx) => one<{ id: string }>(tx, q.text, q.params)).then(
    (r) => r.id,
  );
}
async function newAsset(
  f: Fixture,
  c: Ctx,
  file: File = PNG,
  title = "합성 로고",
): Promise<string> {
  const up = await reserve(f, c.briefId, file);
  await putObject(f, up.storage_key, file.size, file.mime);
  return confirmCreate(f, up, { title });
}
async function replace(
  f: Fixture,
  assetId: string,
  file: File = PNG,
  note: string | null = null,
) {
  const briefId = (
    await one<{ production_brief_id: string }>(
      db,
      `select production_brief_id from public.${T.assets} where id = $1`,
      [assetId],
    )
  ).production_brief_id;
  const up = await reserve(f, briefId, file, assetId);
  await putObject(f, up.storage_key, file.size, file.mime);
  const at = Date.now();
  const h = sha(up.upload_id);
  const rev = (await assetRow(assetId)).revision;
  const q = sql.replace(
    assetId,
    rev,
    up.upload_id,
    note,
    h,
    at,
    await sign(P3C.purpose.confirm, confirmMessage(up.upload_id, h), at),
  );
  return asU(f, (tx) => one<{ r: number }>(tx, q.text, q.params)).then(
    (r) => r.r,
  );
}
const act = async (
  f: Fixture | null,
  id: string,
  mk: (rev: number) => { text: string; params: unknown[] },
) => {
  const rev = (await assetRow(id)).revision;
  return asU(f, (tx) => one<{ r: number }>(tx, mk(rev).text, mk(rev).params));
};

describe.skipIf(!present)(`P3-c 디자인 자산 공격 시험(${T.assets})`, () => {
  beforeAll(async () => {
    db = await createDb();
    await db.exec(
      "alter table storage.objects add column if not exists metadata jsonb",
    );
    a = await seedOwner(db, "p3c-owner-a@example.test");
    b = await seedOwner(db, "p3c-owner-b@example.test");
    strategyTpl = (
      await one<{ id: string }>(db, "select id from templates where key = $1", [
        STRATEGY_TEMPLATE_VERSION,
      ])
    ).id;
    await asU(a, (tx) => approveProfile(tx, a.profileA1));
    await asU(b, (tx) => approveProfile(tx, b.profileA1));
    secret = (
      await one<{ value: string }>(
        db,
        "select value from app.server_secrets where name = $1",
        [P3C.secretName],
      )
    ).value;
  });
  // 진행 중 예약 20 한도가 시험끼리 쌓이지 않게, 각 시험 전에 남은 예약을 만료시킨다(한도 시험은 그 안에서 새로 채운다)
  beforeEach(async () => {
    await db.query(
      `update public.${T.uploads} set expires_at = now() - interval '1 second' where status = 'pending'`,
    );
  });

  describe("서버 서명(예약·확정)", () => {
    it("서명 없음·틀림·추측한 키·5분 넘은 시각·미래 시각 → BAD_SIGNATURE, 예약 0", async () => {
      const c = await ctx(a);
      const msg = reserveMessage(
        c.briefId,
        null,
        PNG.kind,
        PNG.size,
        PNG.mime,
        PNG.name,
      );
      const now = Date.now();
      for (const o of [
        { sig: null },
        { sig: await sign(P3C.purpose.reserve, "다른 값", now), at: now },
        {
          sig: await sign(
            P3C.purpose.reserve,
            msg,
            now,
            "사용자가-추측한-키".repeat(4),
          ),
          at: now,
        },
        {
          sig: await sign(
            P3C.purpose.reserve,
            msg,
            now - P3C.signWindowMs - 60_000,
          ),
          at: now - P3C.signWindowMs - 60_000,
        },
        {
          sig: await sign(
            P3C.purpose.reserve,
            msg,
            now + P3C.signWindowMs + 60_000,
          ),
          at: now + P3C.signWindowMs + 60_000,
        },
        { sig: await sign(P3C.purpose.confirm, msg, now), at: now }, // 용도를 바꾼 서명 재사용
      ]) {
        await expectDbError(
          reserve(a, c.briefId, PNG, null, o),
          P3C.err.badSig,
        );
      }
      expect(
        await count(
          `select 1 from public.${T.uploads} where workspace_id = $1`,
          [a.workspaceId],
        ),
      ).toBe(0);
    });
    it("서명 비밀값은 사용자가 읽을 수 없고, 예약 표는 사용자 select 가 0행/거절", async () => {
      await expectDbError(
        asU(a, (tx) => tx.query("select * from app.server_secrets")),
        P3C.err.denied,
      );
      const c = await ctx(a);
      await reserve(a, c.briefId);
      const seen = await asU(a, (tx) =>
        tx.query(`select * from public.${T.uploads}`),
      ).then(
        (r) => r.rows.length,
        () => 0,
      );
      expect(seen).toBe(0);
    });
    it("확정 서명: 다른 sha256 으로 만든 서명·서명 없음 → BAD_SIGNATURE", async () => {
      const c = await ctx(a);
      const up = await reserve(a, c.briefId);
      await putObject(a, up.storage_key, PNG.size, PNG.mime);
      const at = Date.now();
      await expectDbError(
        confirmCreate(a, up, {
          sha: sha("진짜"),
          sig: await sign(
            P3C.purpose.confirm,
            confirmMessage(up.upload_id, sha("다른 것")),
            at,
          ),
          at,
        }),
        P3C.err.badSig,
      );
      await expectDbError(confirmCreate(a, up, { sig: null }), P3C.err.badSig);
    });
  });

  describe("예약 조건·형식·크기·파일 이름", () => {
    let c: Ctx;
    beforeAll(async () => {
      c = await ctx(a);
    });
    it("정상 예약: 경로 = <업무실>/design-assets/<uuid>.<확장자>, 클라이언트가 경로를 정하지 못한다", async () => {
      const up = await reserve(a, c.briefId);
      expect(up.storage_key).toMatch(P3C.keyRe(a.workspaceId));
      expect(up.storage_key.endsWith(".png")).toBe(true);
    });
    it("분류 ↔ 형식 9종: 맞는 조합 통과, 틀린 조합·모르는 형식 거절", async () => {
      for (const [kind, mimes] of Object.entries(P3C.kinds)) {
        for (const mime of Object.keys(P3C.ext)) {
          const name = `f.${P3C.ext[mime]}`;
          const ok = mimes.includes(mime);
          const r = reserve(a, c.briefId, {
            kind,
            mime,
            size: 100,
            name,
            body: "",
          });
          if (ok) await r;
          else await expectDbError(r, P3C.err.validation);
        }
      }
      for (const mime of [
        "text/html",
        "image/gif",
        "application/javascript",
        "image/svg",
        "IMAGE/PNG",
      ]) {
        await expectDbError(
          reserve(a, c.briefId, {
            kind: "logo",
            mime,
            size: 100,
            name: "f.png",
            body: "",
          }),
          P3C.err.validation,
        );
      }
      await expectDbError(
        reserve(a, c.briefId, {
          kind: "video",
          mime: "image/png",
          size: 100,
          name: "f.png",
          body: "",
        }),
        P3C.err.validation,
      );
    });
    it("크기: 0·음수·10MB+1 거절, 10MB 통과, 색상은 1MB+1 거절", async () => {
      for (const size of [0, -1, L.maxBytes + 1])
        await expectDbError(
          reserve(a, c.briefId, { ...PNG, size }),
          P3C.err.tooLarge,
        );
      await reserve(a, c.briefId, { ...PNG, size: L.maxBytes });
      await expectDbError(
        reserve(a, c.briefId, {
          kind: "color",
          mime: "application/json",
          size: L.colorMaxBytes + 1,
          name: "c.json",
          body: "",
        }),
        P3C.err.tooLarge,
      );
    });
    it("파일 이름: 경로 구분자·..·제어 문자·NUL·줄바꿈·RTL 덮어쓰기·201자·확장자 불일치·다중 확장자·앞뒤 공백 거절", async () => {
      const passed: string[] = [];
      for (const name of [
        "../logo.png",
        "a/logo.png",
        "a\\logo.png",
        "lo\u0001go.png",
        "logo\n.png",
        "gpj‮logo.png",
        `${"가".repeat(197)}.png`,
        "logo.jpg",
        "logo.svg.html",
        " logo.png",
        "logo.png ",
        "",
      ]) {
        await reserve(a, c.briefId, { ...PNG, name }).then(
          () => passed.push(JSON.stringify(name).slice(0, 40)),
          (e: Error) => expect(e.message).toMatch(P3C.err.validation),
        );
      }
      expect(passed, "받아들여진 파일 이름").toEqual([]);
    });
    it("바탕 브리프: 작성 중·design_assets 없음·보관 → INVALID_TRANSITION, 남의 브리프 → NOT_FOUND", async () => {
      const drafting = await ctx(a, ["design_assets"], "drafting");
      const noKind = await ctx(a, ["web_copy"]);
      const archived = await ctx(a);
      await asU(a, (tx) =>
        tx.query("select archive_production_brief($1, 2)", [archived.briefId]),
      );
      for (const x of [drafting, noKind, archived])
        await expectDbError(reserve(a, x.briefId), P3C.err.invalid);
      await expectDbError(reserve(b, c.briefId), P3C.err.notFound);
    });
    it("업무실당 진행 중 예약 20개 → 21번째 LIMIT_REACHED", async () => {
      const x = await ctx(b);
      for (let i = 0; i < L.pendingUploads; i++)
        await reserve(b, x.briefId, { ...PNG, name: `l${i}.png` });
      await expectDbError(reserve(b, x.briefId), P3C.err.limit);
    });
  });

  describe("저장소 정책(진행 중 예약 경로만 insert, update·delete 없음)", () => {
    it("예약 경로는 올리기 가능, 예약 밖 경로·남의 업무실 경로·다른 버킷 이름 흉내는 거절", async () => {
      const c = await ctx(a);
      const up = await reserve(a, c.briefId);
      await putObject(a, up.storage_key, PNG.size, PNG.mime);
      for (const key of [
        `${a.workspaceId}/design-assets/${crypto.randomUUID()}.png`,
        `${b.workspaceId}/design-assets/x.png`,
        `${a.workspaceId}/design-assets/../x.png`,
        up.storage_key.replace(".png", ".svg"),
      ]) {
        await expectDbError(putObject(a, key, 1, "image/png"), P3C.err.denied);
      }
    });
    it("같은 경로 덮어쓰기(두 번째 insert)·update·delete 는 안 된다", async () => {
      const c = await ctx(a);
      const up = await reserve(a, c.briefId);
      await putObject(a, up.storage_key, PNG.size, PNG.mime);
      await expectDbError(
        putObject(a, up.storage_key, PNG.size, PNG.mime),
        /duplicate|unique|row-level/i,
      );
      const upd = await asU(a, (tx) =>
        tx.query(
          'update storage.objects set metadata = \'{"size":1,"mimetype":"image/png"}\' where name = $1',
          [up.storage_key],
        ),
      ).then(
        (r) => r.affectedRows ?? 0,
        () => 0,
      );
      const del = await asU(a, (tx) =>
        tx.query("delete from storage.objects where name = $1", [
          up.storage_key,
        ]),
      ).then(
        (r) => r.affectedRows ?? 0,
        () => 0,
      );
      expect([upd, del]).toEqual([0, 0]);
      expect(
        await count("select 1 from storage.objects where name = $1", [
          up.storage_key,
        ]),
      ).toBe(1);
    });
    it("남이 내 예약 경로에 먼저 올리기·anon 올리기 거절, 만료된 예약 경로도 거절", async () => {
      const c = await ctx(a);
      const up = await reserve(a, c.briefId);
      await expectDbError(
        putObject(b, up.storage_key, PNG.size, PNG.mime),
        P3C.err.denied,
      );
      await expectDbError(
        putObject(null, up.storage_key, PNG.size, PNG.mime),
        P3C.err.denied,
      );
      const up2 = await reserve(a, c.briefId);
      await db.query(
        `update public.${T.uploads} set expires_at = now() - interval '1 minute' where id = $1`,
        [up2.upload_id],
      );
      await expectDbError(
        putObject(a, up2.storage_key, PNG.size, PNG.mime),
        P3C.err.denied,
      );
    });
  });

  describe("확정: 객체·크기·형식 대조, 만료, app_generated", () => {
    let c: Ctx;
    beforeAll(async () => {
      c = await ctx(a);
    });
    it("객체 없음 → UPLOAD_MISSING, 크기·형식 다름·metadata 없음 → TYPE_MISMATCH, 자산 0", async () => {
      const n0 = await count(
        `select 1 from public.${T.assets} where project_id = $1`,
        [c.projectId],
      );
      const up = await reserve(a, c.briefId);
      await expectDbError(confirmCreate(a, up), P3C.err.missing);
      for (const [size, mime] of [
        [PNG.size + 1, PNG.mime],
        [PNG.size, "image/jpeg"],
      ] as const) {
        const u = await reserve(a, c.briefId);
        await putObject(a, u.storage_key, size, mime);
        await expectDbError(confirmCreate(a, u), P3C.err.mismatch);
      }
      const u3 = await reserve(a, c.briefId);
      await asU(a, (tx) =>
        tx.query(
          "insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())",
          [P3C.bucket, u3.storage_key],
        ),
      );
      await expectDbError(confirmCreate(a, u3), P3C.err.mismatch);
      expect(
        await count(`select 1 from public.${T.assets} where project_id = $1`, [
          c.projectId,
        ]),
      ).toBe(n0);
    });
    it("만료된 예약 → 거절, 같은 예약 두 번 확정 → 두 번째 거절, 남의 예약 → NOT_FOUND", async () => {
      const up = await reserve(a, c.briefId);
      await putObject(a, up.storage_key, PNG.size, PNG.mime);
      await db.query(
        `update public.${T.uploads} set expires_at = now() - interval '1 minute' where id = $1`,
        [up.upload_id],
      );
      await expectDbError(confirmCreate(a, up), P3C.err.expired);
      const up2 = await reserve(a, c.briefId);
      await putObject(a, up2.storage_key, PNG.size, PNG.mime);
      await confirmCreate(a, up2);
      await expectDbError(
        confirmCreate(a, up2),
        /INVALID_TRANSITION|NOT_FOUND|UPLOAD/,
      );
      const up3 = await reserve(a, c.briefId);
      await putObject(a, up3.storage_key, PNG.size, PNG.mime);
      await expectDbError(confirmCreate(b, up3), P3C.err.notFound);
    });
    it("app_generated·모르는 출처 → 거절, external_upload 는 통과하고 v1 storage_key = 예약 경로", async () => {
      for (const origin of ["app_generated", "ai", ""]) {
        const up = await reserve(a, c.briefId);
        await putObject(a, up.storage_key, PNG.size, PNG.mime);
        await expectDbError(
          confirmCreate(a, up, { origin }),
          /VALIDATION|INVALID_TRANSITION|지원하지/,
        );
      }
      const up = await reserve(a, c.briefId);
      await putObject(a, up.storage_key, PNG.size, PNG.mime);
      const id = await confirmCreate(a, up);
      const v = await versionsOf(id);
      expect(v.map((x) => [x.version_no, x.kind, x.storage_key])).toEqual([
        [1, "create", up.storage_key],
      ]);
      expect(await audits(id)).toBe(1);
    });
    it("제목 1~100(코드 포인트·앞뒤 공백 정리)·라이선스 0~500", async () => {
      const t = async (title: string, license: string | null = null) => {
        const up = await reserve(a, c.briefId);
        await putObject(a, up.storage_key, PNG.size, PNG.mime);
        return confirmCreate(a, up, { title, license });
      };
      // DB 는 앞뒤 공백을 정리하지 않고 거절한다(정리는 앱 zod 몫). 이모지 100자(코드 포인트)는 통과
      await t("😀".repeat(L.title));
      await expectDbError(t(" 앞 공백"), P3C.err.validation);
      await expectDbError(t("가".repeat(L.title + 1)), P3C.err.validation);
      await expectDbError(t("   "), P3C.err.validation);
      await t("라이선스", "가".repeat(L.licenseNote));
      await expectDbError(
        t("라이선스", "가".repeat(L.licenseNote + 1)),
        P3C.err.validation,
      );
    });
  });

  describe("판(교체·되돌리기·맞추기)·한도", () => {
    it("교체 → 새 판(replace, 새 경로), 되돌리기 → 새 판(restore, 같은 경로), 판 표 수정·삭제 거절", async () => {
      const c = await ctx(a);
      const id = await newAsset(a, c);
      await replace(a, id, { ...PNG, name: "v2.png" }, "교체 사유");
      const v = await versionsOf(id);
      expect(v.map((x) => x.kind)).toEqual(["create", "replace"]);
      expect(v[1]!.storage_key).not.toBe(v[0]!.storage_key);
      await act(a, id, (rev) => sql.restore(id, rev, 1));
      const v3 = await versionsOf(id);
      expect([
        v3[2]!.kind,
        v3[2]!.restored_from_version_no,
        v3[2]!.storage_key,
      ]).toEqual(["restore", 1, v[0]!.storage_key]);
      await expectDbError(
        act(a, id, (rev) => sql.restore(id, rev, 3)),
        P3C.err.validation,
      );
      await expectDbError(
        db.query(
          `update public.${T.versions} set kind = 'create' where asset_id = $1`,
          [id],
        ),
        P3C.err.frozen,
      );
      await expectDbError(
        db.query(`delete from public.${T.versions} where asset_id = $1`, [id]),
        P3C.err.frozen,
      );
    });
    it("교체는 같은 분류만(로고 자산에 글꼴 파일 거절)", async () => {
      const c = await ctx(a);
      const id = await newAsset(a, c);
      await expectDbError(
        replace(a, id, {
          kind: "font",
          mime: "font/woff2",
          size: 100,
          name: "f.woff2",
          body: "",
        }),
        /VALIDATION|TYPE_MISMATCH|INVALID/,
      );
    });
    it("판 30 → 교체·되돌리기 LIMIT_REACHED", async () => {
      const c = await ctx(a);
      const id = await newAsset(a, c);
      for (let i = 2; i <= L.versionsPerAsset; i++)
        await replace(a, id, { ...PNG, name: `v${i}.png` });
      await expectDbError(
        replace(a, id, { ...PNG, name: "v31.png" }),
        P3C.err.limit,
      );
      await expectDbError(
        act(a, id, (rev) => sql.restore(id, rev, 1)),
        P3C.err.limit,
      );
    });
    it("프로젝트당 자산 50(보관 포함) → 51번째 LIMIT_REACHED", async () => {
      const c = await ctx(b);
      const ids: string[] = [];
      for (let i = 0; i < L.perProject; i++)
        ids.push(await newAsset(b, c, { ...PNG, name: `p${i}.png` }));
      await act(b, ids[0]!, (rev) => sql.archive(ids[0]!, rev));
      // 예약 단계에서 먼저 막히거나(구현), 확정에서 막혀야 한다
      await expectDbError(
        (async () => {
          const up = await reserve(b, c.briefId);
          await putObject(b, up.storage_key, PNG.size, PNG.mime);
          await confirmCreate(b, up);
        })(),
        P3C.err.limit,
      );
    });
  });

  describe("사용처(같은 프로젝트·현재 판 섹션만, 0~20)", () => {
    it("다른 프로젝트 문서·없는 섹션·중복·21개 → VALIDATION, 현재 판 섹션은 통과", async () => {
      const c = await ctx(a);
      const id = await newAsset(a, c);
      const doc = (
        await asU(a, (tx) =>
          one<{ id: string }>(
            tx,
            "select create_web_copy_doc($1, null) as id",
            [c.briefId],
          ),
        )
      ).id;
      const content = (
        await one<{
          content: { pages: Array<{ sections: Array<{ id: string }> }> };
        }>(
          db,
          "select v.content from web_copy_versions v join web_copy_docs d on d.id = v.doc_id and v.version_no = d.current_version_no where d.id = $1",
          [doc],
        )
      ).content;
      const secs = content.pages.flatMap((p) => p.sections.map((s) => s.id));
      const other = await ctx(a);
      const otherDoc = (
        await asU(a, (tx) =>
          one<{ id: string }>(
            tx,
            "select create_web_copy_doc($1, null) as id",
            [other.briefId],
          ),
        )
      ).id;
      const u = (docId: string, sectionId: string) => ({
        doc_id: docId,
        section_id: sectionId,
      });
      for (const bad of [
        [u(otherDoc, secs[0]!)],
        [u(doc, crypto.randomUUID())],
        [u(doc, secs[0]!), u(doc, secs[0]!)],
        Array.from({ length: L.usagesPerAsset + 1 }, () =>
          u(doc, crypto.randomUUID()),
        ),
      ]) {
        await expectDbError(
          act(a, id, (rev) => sql.usages(id, rev, bad)),
          P3C.err.validation,
        );
      }
      await act(a, id, (rev) => sql.usages(id, rev, [u(doc, secs[0]!)]));
      expect(
        await count(`select 1 from public.${T.usages} where asset_id = $1`, [
          id,
        ]),
      ).toBe(1);
    });
  });

  describe("읽기 전용·남의 업무실·감사 본문 0", () => {
    it("보관·프로젝트 보관·전략 작업 취소 → 쓰기 INVALID_TRANSITION, 읽기는 됨", async () => {
      const c = await ctx(a);
      const id = await newAsset(a, c);
      await replica(() =>
        db.query("update projects set status = 'archived' where id = $1", [
          c.projectId,
        ]),
      );
      await expectDbError(
        act(a, id, (rev) => sql.update(id, rev, "바뀐 이름", null, "drafting")),
        P3C.err.invalid,
      );
      await expectDbError(replace(a, id), /INVALID_TRANSITION/);
      await replica(async () => {
        await db.query("update projects set status = 'active' where id = $1", [
          c.projectId,
        ]);
        await db.query("update tasks set status = 'cancelled' where id = $1", [
          c.taskId,
        ]);
      });
      await expectDbError(
        act(a, id, (rev) => sql.update(id, rev, "바뀐 이름", null, "drafting")),
        P3C.err.invalid,
      );
      await replica(() =>
        db.query("update tasks set status = 'completed' where id = $1", [
          c.taskId,
        ]),
      );
      await act(a, id, (rev) => sql.archive(id, rev));
      for (const mk of [
        (rev: number) => sql.update(id, rev, "또", null, "drafting"),
        (rev: number) => sql.restore(id, rev, 1),
        (rev: number) => sql.archive(id, rev),
      ]) {
        await expectDbError(act(a, id, mk), P3C.err.invalid);
      }
      expect(
        await asU(a, (tx) =>
          tx
            .query(`select 1 from public.${T.assets} where id = $1`, [id])
            .then((r) => r.rows.length),
        ),
      ).toBe(1);
      await expectDbError(
        db.query(
          `update public.${T.assets} set title = '슈퍼유저' where id = $1`,
          [id],
        ),
        P3C.err.frozen,
      );
    });
    it("남의 자산: 쓰기 문구가 없는 id 와 같다, RLS 0행, 저장소 객체 select 0", async () => {
      const c = await ctx(a);
      const id = await newAsset(a, c);
      const ghost = "00000000-0000-4000-8000-0000000000c3";
      const msg = async (
        target: string,
        mk: (t: string) => { text: string; params: unknown[] },
      ) => {
        try {
          await asU(b, (tx) => tx.query(mk(target).text, mk(target).params));
          return "성공함";
        } catch (e) {
          return (e as Error).message;
        }
      };
      for (const mk of [
        (t: string) => sql.update(t, 1, "남", null, "drafting"),
        (t: string) => sql.restore(t, 1, 1),
        (t: string) => sql.archive(t, 1),
        (t: string) => sql.usages(t, 1, []),
      ]) {
        const mine = await msg(id, mk);
        expect(mine).toMatch(P3C.err.notFound);
        expect(mine).toBe(await msg(ghost, mk));
      }
      for (const t of Object.values(T)) {
        const n = await asU(b, (tx) =>
          tx.query(`select 1 from public.${t} where workspace_id = $1`, [
            a.workspaceId,
          ]),
        ).then(
          (r) => r.rows.length,
          () => 0,
        );
        expect(n, t).toBe(0);
      }
      expect(
        await asU(b, (tx) =>
          tx
            .query(
              "select 1 from storage.objects where bucket_id = $1 and name like $2",
              [P3C.bucket, `${a.workspaceId}/%`],
            )
            .then((r) => r.rows.length),
        ),
      ).toBe(0);
    });
    it("직접 쓰기 거절(표 4개), anon 거절, RPC 는 정의자·authenticated 만", async () => {
      for (const t of Object.values(T)) {
        await expectDbError(
          asU(a, (tx) => tx.query(`delete from public.${t}`)),
          P3C.err.denied,
        );
        await expectDbError(
          asU(a, (tx) => tx.query(`truncate public.${t}`)),
          P3C.err.denied,
        );
        await expectDbError(
          asU(null, (tx) => tx.query(`select * from public.${t}`)),
          P3C.err.denied,
        );
      }
      for (const name of Object.values(P3C.rpc)) {
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
    it("감사 details 에 제목·라이선스·파일 이름·교체 사유·storage_key 글자 0(표식)", async () => {
      const mark = "ZZP3CAUDIT";
      const c = await ctx(a);
      const up = await reserve(a, c.briefId, { ...PNG, name: `${mark}.png` });
      await putObject(a, up.storage_key, PNG.size, PNG.mime);
      const id = await confirmCreate(a, up, {
        title: `${mark} 제목`,
        license: `${mark} 라이선스`,
      });
      await replace(a, id, { ...PNG, name: `${mark}2.png` }, `${mark} 사유`);
      await act(a, id, (rev) =>
        sql.update(
          id,
          rev,
          `${mark} 새 제목`,
          `${mark} 새 라이선스`,
          "reviewed",
        ),
      );
      const leaked = await count(
        "select 1 from audit_events where entity_type = $1 and (details::text like $2 or details::text like $3)",
        [P3C.auditEntity, `%${mark}%`, `%${up.storage_key}%`],
      );
      expect(leaked).toBe(0);
      expect(await audits(id)).toBeGreaterThanOrEqual(3);
    });
  });
});
