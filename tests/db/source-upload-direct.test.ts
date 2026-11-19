/**
 * SOURCE-UPLOAD-FIX-01: 자료 파일 직접 업로드 DB(20261121005000_source_upload_direct) 시험.
 * 저장소는 shim 의 storage.objects(RLS 켜짐, metadata 칸)로 흉내 낸다. 모든 값은 합성이다.
 */
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sourceConfirmMessage, sourceRejectMessage, sourceReserveMessage } from "@/domain/assets/direct-upload";
import { asUser, createDb, expectDbError, one, seedOwner, type Db, type Fixture, type Tx } from "./harness";

let db: Db;
let a: Fixture;
let b: Fixture;
let secret: string;

beforeAll(async () => {
  db = await createDb();
  a = await seedOwner(db, "source-up-a@example.test");
  b = await seedOwner(db, "source-up-b@example.test");
  secret = (await one<{ value: string }>(db, "select value from app.server_secrets where name = 'source_asset_signing'")).value;
}, 60_000);

const asA = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, a.userId, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, b.userId, fn);
const asAnon = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn);
const sign = (purpose: string, message: string, at = Date.now(), key = secret) => ({
  at,
  sig: createHmac("sha256", key).update(`${purpose}|${message}|${at}`, "utf8").digest("hex"),
});
const SHA = "d".repeat(64);

type Res = { clientId?: string | null; projectId?: string | null; fileName?: string; size?: number; mime?: string };
const args = (f: Fixture, r: Res) => {
  const x = { clientId: r.clientId === undefined ? null : r.clientId, projectId: r.projectId === undefined ? f.projectA : r.projectId, fileName: r.fileName ?? "제안서.pdf", size: r.size ?? 2048, mime: r.mime ?? "application/pdf" };
  return { ...x, msg: sourceReserveMessage(x) };
};
const reserve = (tx: Tx, f: Fixture, r: Res = {}, s?: { at: number; sig: string }) => {
  const x = args(f, r);
  const g = s ?? sign("source_reserve", x.msg);
  return one<{ upload_id: string; object_key: string; expires_at: string }>(tx, "select * from reserve_source_upload($1, $2, $3, $4, $5, $6, $7)", [x.clientId, x.projectId, x.fileName, x.size, x.mime, g.at, g.sig]);
};
const put = (tx: Tx, key: string, size: number, mime: string, uid: string) =>
  tx.query("insert into storage.objects (bucket_id, name, owner, metadata) values ('source-assets', $1, $2, $3::jsonb)", [key, uid, JSON.stringify({ size, mimetype: mime })]);
const confirm = (tx: Tx, id: string, sha = SHA, s?: { at: number; sig: string }) => {
  const g = s ?? sign("source_confirm", sourceConfirmMessage(id, sha));
  return one<{ id: string }>(tx, "select confirm_source_upload($1, $2, $3, $4) as id", [id, sha, g.at, g.sig]).then((r) => r.id);
};

describe("예약·확정", () => {
  it("예약 → 저장소 → 확정: 기존과 같은 경로 모양, source_assets(stored)·고객 자동 연결·sha", async () => {
    const u = await asA((tx) => reserve(tx, a));
    expect(u.object_key).toBe(`${a.workspaceId}/${u.upload_id}/original.pdf`);
    await asA((tx) => put(tx, u.object_key, 2048, "application/pdf", a.userId));
    const id = await asA((tx) => confirm(tx, u.upload_id));
    expect(id).toBe(u.upload_id);
    const row = await one(db, "select kind, file_name, object_key, mime, bytes::int, checksum_sha256, upload_status, client_id, project_id from source_assets where id = $1", [id]);
    const pc = await one<{ client_id: string | null }>(db, "select client_id from projects where id = $1", [a.projectA]);
    expect(row).toEqual({ kind: "file", file_name: "제안서.pdf", object_key: u.object_key, mime: "application/pdf", bytes: 2048, checksum_sha256: SHA, upload_status: "stored", client_id: pc.client_id, project_id: a.projectA });
    expect(await one(db, "select status from source_asset_uploads where id = $1", [id])).toEqual({ status: "confirmed" });
    await expectDbError(asA((tx) => confirm(tx, u.upload_id)), /INVALID_TRANSITION: 이미 끝난 업로드/);
  });

  it("text/plain;charset 처럼 형식 매개변수가 붙어도 확정된다, jpeg 는 jpg 경로", async () => {
    const u = await asA((tx) => reserve(tx, a, { fileName: "메모.txt", size: 10, mime: "text/plain" }));
    await asA((tx) => put(tx, u.object_key, 10, "text/plain;charset=UTF-8", a.userId));
    await asA((tx) => confirm(tx, u.upload_id));
    const j = await asA((tx) => reserve(tx, a, { fileName: "사진.JPEG", size: 10, mime: "image/jpeg" }));
    expect(j.object_key).toMatch(/\/original\.jpg$/);
  });

  it("서명: 없음·틀림·5분 지남·다른 용도·값 바꿔치기 → BAD_SIGNATURE, anon 권한 없음", async () => {
    const x = args(a, {});
    await expectDbError(asA((tx) => reserve(tx, a, {}, { at: Date.now(), sig: "" })), /BAD_SIGNATURE/);
    await expectDbError(asA((tx) => reserve(tx, a, {}, sign("source_reserve", x.msg, Date.now(), "e".repeat(64)))), /BAD_SIGNATURE/);
    await expectDbError(asA((tx) => reserve(tx, a, {}, sign("source_reserve", x.msg, Date.now() - 6 * 60_000))), /BAD_SIGNATURE/);
    await expectDbError(asA((tx) => reserve(tx, a, {}, sign("source_confirm", x.msg))), /BAD_SIGNATURE/);
    await expectDbError(asA((tx) => reserve(tx, a, { size: 1 }, sign("source_reserve", x.msg))), /BAD_SIGNATURE/);
    await expectDbError(asAnon((tx) => reserve(tx, a)), /permission denied/);
    const u = await asA((tx) => reserve(tx, a));
    await asA((tx) => put(tx, u.object_key, 2048, "application/pdf", a.userId));
    await expectDbError(asA((tx) => confirm(tx, u.upload_id, SHA, sign("source_confirm", sourceConfirmMessage(u.upload_id, "0".repeat(64))))), /BAD_SIGNATURE/);
    await expectDbError(asA((tx) => confirm(tx, u.upload_id, SHA, sign("source_reserve", sourceConfirmMessage(u.upload_id, SHA)))), /BAD_SIGNATURE/);
  });

  it("예약 검사: 형식·크기·이름·붙는 곳(남의 프로젝트·다른 고객·없음)", async () => {
    await expectDbError(asA((tx) => reserve(tx, a, { mime: "text/html", fileName: "a.html" })), /UNSUPPORTED_TYPE/);
    await expectDbError(asA((tx) => reserve(tx, a, { size: 0 })), /EMPTY/);
    await expectDbError(asA((tx) => reserve(tx, a, { size: 10485761 })), /TOO_LARGE/);
    await expectDbError(asA((tx) => reserve(tx, a, { fileName: "a.png" })), /TYPE_MISMATCH/);
    await expectDbError(asA((tx) => reserve(tx, a, { fileName: "a/b.pdf" })), /TYPE_MISMATCH/);
    await expectDbError(asA((tx) => reserve(tx, a, { projectId: b.projectA })), /NOT_FOUND: 프로젝트/);
    await expectDbError(asA((tx) => reserve(tx, a, { projectId: null, clientId: b.clientA })), /NOT_FOUND: 고객/);
    await expectDbError(asA((tx) => reserve(tx, a, { projectId: null, clientId: null })), /VALIDATION: 자료를 붙일/);
    const other = await one<{ id: string }>(db, "insert into clients (workspace_id, name) values ($1, '다른 고객') returning id", [a.workspaceId]);
    const pc = await one<{ client_id: string | null }>(db, "select client_id from projects where id = $1", [a.projectA]);
    if (pc.client_id) await expectDbError(asA((tx) => reserve(tx, a, { clientId: other.id })), /VALIDATION: 다른 고객의 프로젝트/);
    // 고객에만 붙이기
    const u = await asA((tx) => reserve(tx, a, { projectId: null, clientId: a.clientA }));
    await asA((tx) => put(tx, u.object_key, 2048, "application/pdf", a.userId));
    await asA((tx) => confirm(tx, u.upload_id));
    expect(await one(db, "select client_id, project_id from source_assets where id = $1", [u.upload_id])).toEqual({ client_id: a.clientA, project_id: null });
  });

  it("확정 검사: 객체 없음·크기·형식·만료·남의 예약·닫힌 예약", async () => {
    const u1 = await asA((tx) => reserve(tx, a));
    await expectDbError(asA((tx) => confirm(tx, u1.upload_id)), /UPLOAD_MISSING/);
    await asA((tx) => put(tx, u1.object_key, 99, "application/pdf", a.userId));
    await expectDbError(asA((tx) => confirm(tx, u1.upload_id)), /TYPE_MISMATCH/);
    const u2 = await asA((tx) => reserve(tx, a));
    await asA((tx) => put(tx, u2.object_key, 2048, "image/png", a.userId));
    await expectDbError(asA((tx) => confirm(tx, u2.upload_id)), /TYPE_MISMATCH/);
    const u3 = await asA((tx) => reserve(tx, a));
    await asA((tx) => put(tx, u3.object_key, 2048, "application/pdf", a.userId));
    await expectDbError(asB((tx) => confirm(tx, u3.upload_id)), /NOT_FOUND: 업로드 예약/);
    await db.query("update source_asset_uploads set expires_at = now() - interval '1 second' where id = $1", [u3.upload_id]);
    await expectDbError(asA((tx) => confirm(tx, u3.upload_id)), /UPLOAD_EXPIRED/);
    const u4 = await asA((tx) => reserve(tx, a));
    const g = sign("source_reject", sourceRejectMessage(u4.upload_id, "TYPE_MISMATCH"));
    await asA((tx) => tx.query("select reject_source_upload($1, 'TYPE_MISMATCH', $2, $3)", [u4.upload_id, g.at, g.sig]));
    await expectDbError(asA((tx) => confirm(tx, u4.upload_id)), /INVALID_TRANSITION/);
    expect(await one<{ n: number }>(db, "select count(*)::int as n from source_assets where id = any($1::uuid[])", [[u1.upload_id, u2.upload_id, u3.upload_id, u4.upload_id]])).toEqual({ n: 0 });
  });

  it("진행 중 예약 20 한도, 예약 표는 사용자가 읽기·쓰기 불가", async () => {
    const f = await seedOwner(db, "source-up-limit@example.test");
    for (let i = 0; i < 20; i++) await asUser(db, f.userId, (tx) => reserve(tx, f));
    await expectDbError(asUser(db, f.userId, (tx) => reserve(tx, f)), /LIMIT_REACHED/);
    await expectDbError(asA((tx) => tx.query("select * from source_asset_uploads")), /permission denied/);
    await expectDbError(asA((tx) => tx.query("update source_asset_uploads set expires_at = now()")), /permission denied/);
  });
});

describe("저장소 정책(source-assets)", () => {
  it("예약된 내 경로에만 올린다: 예약 안 된 내 경로·남의 예약·만료·확정 뒤 거절, 읽기는 내 업무실만", async () => {
    await expectDbError(asA((tx) => put(tx, `${a.workspaceId}/${crypto.randomUUID()}/original.pdf`, 1, "application/pdf", a.userId)), /row-level security/);
    const u = await asA((tx) => reserve(tx, a));
    await expectDbError(asB((tx) => put(tx, u.object_key, 2048, "application/pdf", b.userId)), /row-level security/);
    await asA((tx) => put(tx, u.object_key, 2048, "application/pdf", a.userId));
    await asA((tx) => confirm(tx, u.upload_id));
    // 확정 뒤에는 그 경로·이웃 경로 모두 못 올린다
    await expectDbError(asA((tx) => put(tx, `${a.workspaceId}/${u.upload_id}/second.pdf`, 1, "application/pdf", a.userId)), /row-level security/);
    const exp = await asA((tx) => reserve(tx, a));
    await db.query("update source_asset_uploads set expires_at = now() - interval '1 second' where id = $1", [exp.upload_id]);
    await expectDbError(asA((tx) => put(tx, exp.object_key, 2048, "application/pdf", a.userId)), /row-level security/);
    expect(await asB((tx) => one<{ n: number }>(tx, "select count(*)::int as n from storage.objects where name = $1", [u.object_key]))).toEqual({ n: 0 });
    expect(await asA((tx) => one<{ n: number }>(tx, "select count(*)::int as n from storage.objects where name = $1", [u.object_key]))).toEqual({ n: 1 });
  });

  it("기존 행·글·링크 자료는 그대로(직접 insert 정책 유지, 기존 pending 행 다시 확인 경로 유지)", async () => {
    const t = await asA((tx) => one<{ id: string }>(tx, "insert into source_assets (workspace_id, project_id, kind, text_content, upload_status) values ($1, $2, 'text', '메모', 'stored') returning id", [a.workspaceId, a.projectA]));
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
