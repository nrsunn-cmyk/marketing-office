import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 자료 파일 올리기 서버 함수.
 * - SOURCE-UPLOAD-FIX-01: 예약(서버 서명) → 서명 업로드 URL → 올리기 → 서버가 받아 검사·sha256 → 확정(서버 서명).
 *   확정 RPC 가 자료 행을 한 번에 stored 로 만들므로 "파일은 저장됐는데 상태 기록 실패"(CR05) 상태가 새 흐름에는 생기지 않는다.
 * - CR05 복구(confirmPendingUpload): 예전 흐름이 남긴 '올리는 중' 행은 그대로 다시 확인한다.
 * Supabase 호출을 흉내 낸 가짜 클라이언트에 단계별 실패를 넣어 확인한다.
 */

interface Fake {
  rpc: Array<{ fn: string; args: Record<string, unknown> }>;
  rpcError: Record<string, { message: string } | undefined>;
  stored: Uint8Array | null;
  uploadError: unknown;
  signError: unknown;
  storageCalls: string[];
  updateError: unknown;
  updateRows: number;
  asset: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
  listed: Array<{ name: string }> | null;
  listError: unknown;
  updates: Array<Record<string, unknown>>;
}
const fake: Fake = {} as Fake;
const KEY = "s".repeat(64);
const ID = "11111111-1111-4111-8111-111111111111";
const PATH = `ws-1/${ID}/original.txt`;

function reset() {
  Object.assign(fake, {
    rpc: [],
    rpcError: {},
    stored: null,
    uploadError: null,
    signError: null,
    storageCalls: [],
    updateError: null,
    updateRows: 1,
    asset: null,
    project: { id: "p", client_id: "c" },
    listed: [],
    listError: null,
    updates: [],
  });
  vi.stubEnv("SOURCE_ASSET_SIGNING_KEY", KEY);
}

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "ws-1" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const chain = {
        update: (values: Record<string, unknown>) => {
          fake.updates.push(values);
          const q = {
            eq: () => q,
            select: async () =>
              fake.updateError ? { data: null, error: fake.updateError } : { data: Array.from({ length: fake.updateRows }, () => ({ id: "x" })), error: null },
          };
          return q;
        },
        select: () => {
          const q = { eq: () => q, maybeSingle: async () => ({ data: table === "projects" ? fake.project : fake.asset, error: null }) };
          return q;
        },
      };
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      fake.rpc.push({ fn, args });
      const err = fake.rpcError[fn];
      if (err) return { data: null, error: err };
      if (fn === "reserve_source_upload") return { data: [{ upload_id: ID, object_key: PATH, expires_at: "2026-11-20T01:00:00Z" }], error: null };
      if (fn === "confirm_source_upload") return { data: args.p_upload_id, error: null };
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        async createSignedUploadUrl(path: string) {
          fake.storageCalls.push(`sign ${path}`);
          return fake.signError ? { data: null, error: fake.signError } : { data: { token: "tok", path }, error: null };
        },
        async uploadToSignedUrl(path: string, _token: string, body: Uint8Array) {
          fake.storageCalls.push(`upload ${path}`);
          if (fake.uploadError) return { data: null, error: fake.uploadError };
          fake.stored = body;
          return { data: { path }, error: null };
        },
        async download(path: string) {
          fake.storageCalls.push(`download ${path}`);
          return fake.stored ? { data: new Blob([fake.stored as BlobPart]), error: null } : { data: null, error: { message: "Object not found" } };
        },
        async createSignedUrl(path: string, sec: number, opt: unknown) {
          fake.storageCalls.push(`url ${path} ${sec} ${JSON.stringify(opt)}`);
          return { data: { signedUrl: `https://st/${path}?token=t&download=` }, error: null };
        },
        list: async () => ({ data: fake.listed, error: fake.listError }),
      }),
    },
  }),
}));

const { uploadFileAsset, prepareSourceUpload, confirmSourceUpload, confirmPendingUpload, getAssetDownloadUrl } = await import("@/features/assets/server");
const TEXT = "회사 소개 메모";
const txt = () => new File([TEXT], "memo.txt", { type: "text/plain" });
const hmac = (purpose: string, msg: string, at: unknown) => createHmac("sha256", KEY).update(`${purpose}|${msg}|${at}`, "utf8").digest("hex");

describe("uploadFileAsset (서버 액션 경로, 기존 화면 호환)", () => {
  beforeEach(reset);

  it("정상: 예약(서명) → 예약 경로로 올리기 → 서버가 받아 sha256 → 확정(서명)", async () => {
    const r = await uploadFileAsset({ clientId: "c" }, txt());
    expect(r).toEqual({ ok: true, data: { id: ID } });
    const bytes = Buffer.from(TEXT, "utf8");
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(fake.rpc.map((x) => x.fn)).toEqual(["reserve_source_upload", "confirm_source_upload"]);
    const res = fake.rpc[0].args;
    expect(res).toMatchObject({ p_client_id: "c", p_project_id: null, p_file_name: "memo.txt", p_size: bytes.length, p_mime: "text/plain" });
    expect(res.p_signature).toBe(hmac("source_reserve", `c||${bytes.length}|text/plain|memo.txt`, res.p_signed_at));
    const con = fake.rpc[1].args;
    expect(con).toMatchObject({ p_upload_id: ID, p_sha256: sha });
    expect(con.p_signature).toBe(hmac("source_confirm", `${ID}|${sha}`, con.p_signed_at));
    expect(fake.storageCalls).toEqual([`sign ${PATH}`, `upload ${PATH}`, `download ${PATH}`]);
  });

  it("파일 저장 실패: 확정하지 않고 실패 안내(자료 행이 생기지 않는다)", async () => {
    fake.uploadError = { message: "storage down" };
    const r = await uploadFileAsset({ clientId: "c" }, txt());
    expect(r).toMatchObject({ ok: false, code: "UPLOAD_FAILED", message: expect.stringContaining("저장하지 못했습니다") });
    expect(fake.rpc.map((x) => x.fn)).toEqual(["reserve_source_upload"]);
  });

  it("확정 실패(만료 등)는 성공으로 안내하지 않는다", async () => {
    fake.rpcError.confirm_source_upload = { message: "UPLOAD_EXPIRED: 올리기 유효 시간이 지났습니다" };
    const r = await uploadFileAsset({ clientId: "c" }, txt());
    expect(r).toMatchObject({ ok: false, code: "UPLOAD_FAILED", errors: { uploadCode: "UPLOAD_EXPIRED" } });
  });

  it("내용 검사에 걸리면 예약 없이 거절(이름은 PDF, 내용은 글자)", async () => {
    const r = await uploadFileAsset({ clientId: "c" }, new File(["글자"], "가짜.pdf"));
    expect(r).toMatchObject({ ok: false, code: "UPLOAD_FAILED", errors: { uploadCode: "TYPE_MISMATCH" } });
    expect(fake.rpc).toEqual([]);
  });

  it("서명 키가 없으면 올리기가 꺼진다", async () => {
    vi.stubEnv("SOURCE_ASSET_SIGNING_KEY", "");
    const r = await uploadFileAsset({ clientId: "c" }, txt());
    expect(r).toMatchObject({ ok: false, code: "ERROR", message: expect.stringContaining("켜져 있지 않습니다") });
    expect(fake.rpc).toEqual([]);
  });
});

describe("브라우저 직접 업로드(준비·확정)", () => {
  beforeEach(reset);

  it("준비: 이름·크기만으로 예약, 10MB 초과·빈 파일·형식은 RPC 없이 거절", async () => {
    expect(await prepareSourceUpload({ projectId: "p" }, { name: "큰 파일.pdf", size: 9_000_000 })).toEqual({
      ok: true,
      data: { uploadId: ID, path: PATH, token: "tok", mime: "application/pdf", expiresAt: "2026-11-20T01:00:00Z" },
    });
    expect(fake.rpc[0].args).toMatchObject({ p_client_id: null, p_project_id: "p", p_size: 9_000_000, p_mime: "application/pdf", p_file_name: "큰 파일.pdf" });
    fake.rpc.length = 0;
    expect(await prepareSourceUpload({ projectId: "p" }, { name: "a.pdf", size: 10 * 1024 * 1024 + 1 })).toMatchObject({ errors: { uploadCode: "TOO_LARGE" } });
    expect(await prepareSourceUpload({ projectId: "p" }, { name: "a.pdf", size: 0 })).toMatchObject({ errors: { uploadCode: "EMPTY" } });
    expect(await prepareSourceUpload({ projectId: "p" }, { name: "a.exe", size: 10 })).toMatchObject({ errors: { uploadCode: "UNSUPPORTED_TYPE" } });
    expect(fake.rpc).toEqual([]);
  });

  it("확정: 경로 조작은 내려받기 전에 거절, 내용이 다르면 예약을 닫는다(서명)", async () => {
    for (const p of [`ws-2/${ID}/original.txt`, `ws-1/22222222-2222-4222-8222-222222222222/original.txt`, `ws-1/${ID}/original.html`, `ws-1/${ID}/x.txt`])
      expect(await confirmSourceUpload(ID, p)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(fake.storageCalls).toEqual([]);
    fake.stored = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = await confirmSourceUpload(ID, PATH);
    expect(r).toMatchObject({ ok: false, errors: { uploadCode: "TYPE_MISMATCH" } });
    expect(fake.rpc.map((x) => x.fn)).toEqual(["reject_source_upload"]);
    expect(fake.rpc[0].args.p_signature).toBe(hmac("source_reject", `${ID}|TYPE_MISMATCH`, fake.rpc[0].args.p_signed_at));
  });

  it("확정: 객체가 없으면 예약을 닫지 않고 다시 올리라고 안내", async () => {
    const r = await confirmSourceUpload(ID, PATH);
    expect(r).toMatchObject({ ok: false, errors: { uploadCode: "UPLOAD_MISSING" } });
    expect(fake.rpc).toEqual([]);
  });
});

describe("내려받기 주소(F2)", () => {
  beforeEach(reset);
  it("한글 이름을 한 번만 인코딩해 붙인다(download=true 로 서명)", async () => {
    fake.asset = { object_key: PATH, file_name: "회사 소개.txt", upload_status: "stored", kind: "file" };
    expect(await getAssetDownloadUrl(ID)).toEqual({ ok: true, data: { url: `https://st/${PATH}?token=t&download=%ED%9A%8C%EC%82%AC%20%EC%86%8C%EA%B0%9C.txt` } });
    expect(fake.storageCalls).toEqual([`url ${PATH} 60 {"download":true}`]);
  });
});

describe("confirmPendingUpload (CR05 복구, 예전 흐름이 남긴 행)", () => {
  beforeEach(reset);
  const pending = { id: "a1", kind: "file", object_key: "ws-1/a1/original.txt", upload_status: "pending" };

  it("저장소에 파일이 있으면 보관됨으로, 다시 올리지 않는다", async () => {
    fake.asset = pending;
    fake.listed = [{ name: "original.txt" }];
    const r = await confirmPendingUpload("a1");
    expect(r).toEqual({ ok: true, data: { status: "stored" } });
    expect(fake.storageCalls.filter((c) => c.startsWith("upload"))).toEqual([]);
  });

  it("저장소에 파일이 없으면 실패로 표시", async () => {
    fake.asset = pending;
    fake.listed = [{ name: "other.txt" }];
    expect(await confirmPendingUpload("a1")).toEqual({ ok: true, data: { status: "failed" } });
    expect(fake.updates).toEqual([{ upload_status: "failed" }]);
  });

  it("저장소 확인 자체가 실패하면 상태를 바꾸지 않는다", async () => {
    fake.asset = pending;
    fake.listError = { message: "timeout" };
    const r = await confirmPendingUpload("a1");
    expect(r.ok).toBe(false);
    expect(fake.updates).toEqual([]);
  });

  it("이미 보관된 파일은 그대로 성공", async () => {
    fake.asset = { ...pending, upload_status: "stored" };
    expect(await confirmPendingUpload("a1")).toEqual({ ok: true, data: { status: "stored" } });
    expect(fake.updates).toEqual([]);
  });

  it("상태 기록이 0행이면(다른 곳에서 이미 바뀜) 실패 안내", async () => {
    fake.asset = pending;
    fake.listed = [{ name: "original.txt" }];
    fake.updateRows = 0;
    expect((await confirmPendingUpload("a1")).ok).toBe(false);
  });
});
