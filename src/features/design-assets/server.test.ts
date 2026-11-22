import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P3C-BACKEND-IMPL-01: 디자인 자산 서버 함수 단위 시험. DB·저장소는 호출을 기록하는 흉내 클라이언트로 바꾼다
 * (실제 RLS·RPC·저장소 정책 규칙은 tests/db/p3c-design-assets.test.ts 가 맡는다).
 */
const S = vi.hoisted(() => ({
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  storage: [] as Array<{ op: string; args: unknown[] }>,
  queries: [] as Array<{ table: string; ops: string[] }>,
  file: null as Uint8Array | null,
  rpcError: null as null | { code: string; message: string },
  rows: {} as Record<string, unknown[]>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "w1" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const q = { table, ops: [] as string[] };
      S.queries.push(q);
      const filters: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      const rows = () =>
        ((S.rows[table] ?? []) as Record<string, unknown>[]).filter(
          (r) => filters.every(([k, v]) => k === "workspace_id" || !(k in r) || r[k] === v) && ins.every(([k, vs]) => vs.includes(r[k])),
        );
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "order"]) {
        chain[op] = (...args: unknown[]) => {
          q.ops.push(`${op}(${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(",")})`);
          if (op === "eq") filters.push([String(args[0]), args[1]]);
          if (op === "in") ins.push([String(args[0]), args[1] as unknown[]]);
          return chain;
        };
      }
      chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
      chain.then = (res: (v: unknown) => unknown) => res({ data: rows(), error: null });
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      S.rpc.push({ fn, args });
      if (S.rpcError && fn !== "reject_design_asset_upload") return { data: null, error: S.rpcError };
      if (fn === "reserve_design_asset_upload") return { data: [{ upload_id: "u1", storage_key: "w1/design-assets/u1.svg", expires_at: "2026-11-20T01:00:00Z" }], error: null };
      return { data: fn === "create_design_asset" ? "a-new" : 7, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        async createSignedUploadUrl(path: string) {
          S.storage.push({ op: "createSignedUploadUrl", args: [bucket, path] });
          return { data: { token: "tok", path, signedUrl: "x" }, error: null };
        },
        async createSignedUrl(path: string, sec: number, opt: unknown) {
          S.storage.push({ op: "createSignedUrl", args: [bucket, path, sec, opt] });
          return { data: { signedUrl: `https://st/${path}?token=t&download=` }, error: null };
        },
        async download(path: string) {
          S.storage.push({ op: "download", args: [bucket, path] });
          return S.file ? { data: new Blob([S.file as BlobPart]), error: null } : { data: null, error: { message: "Object not found" } };
        },
      }),
    },
  }),
}));

import { confirmDesignAssetCreate, confirmDesignAssetReplace, getDesignAssetFileUrl, getDesignAssetsFor, prepareDesignAssetUpload, setDesignAssetUsages, updateDesignAsset } from "./server";

const KEY = "k".repeat(64);
const SAFE_SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#123"/></svg>');
const B = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const hmac = (purpose: string, msg: string, at: unknown) => createHmac("sha256", KEY).update(`${purpose}|${msg}|${at}`, "utf8").digest("hex");

beforeEach(() => {
  S.rpc.length = 0;
  S.storage.length = 0;
  S.queries.length = 0;
  S.file = SAFE_SVG;
  S.rpcError = null;
  S.rows = {};
  vi.stubEnv("DESIGN_ASSET_SIGNING_KEY", KEY);
});

const prep = { productionBriefId: B, assetId: null, kind: "logo", fileName: " 로고.svg ", size: 1234, mime: "image/svg+xml" };

describe("1단계 준비", () => {
  it("선언 검사 → 서명한 예약 RPC → 예약 경로로 서명 업로드 URL", async () => {
    const r = await prepareDesignAssetUpload(prep);
    expect(r).toEqual({ ok: true, data: { uploadId: "u1", path: "w1/design-assets/u1.svg", token: "tok", mime: "image/svg+xml", expiresAt: "2026-11-20T01:00:00Z" } });
    const a = S.rpc[0].args;
    expect(S.rpc[0].fn).toBe("reserve_design_asset_upload");
    expect(a).toMatchObject({ p_file_name: "로고.svg", p_asset_id: null, p_kind: "logo", p_size: 1234 });
    expect(a.p_signature).toBe(hmac("design_reserve", `${B}||logo|1234|image/svg+xml|로고.svg`, a.p_signed_at));
    expect(S.storage).toEqual([{ op: "createSignedUploadUrl", args: ["design-assets", "w1/design-assets/u1.svg"] }]);
  });

  it("서명 키가 없으면 꺼짐, 선언 위반은 RPC 없이 DA_COPY 문구 키로", async () => {
    vi.stubEnv("DESIGN_ASSET_SIGNING_KEY", "");
    expect(await prepareDesignAssetUpload(prep)).toMatchObject({ ok: false, code: "ERROR" });
    vi.stubEnv("DESIGN_ASSET_SIGNING_KEY", KEY);
    expect(await prepareDesignAssetUpload({ ...prep, fileName: "로고.png" })).toMatchObject({ ok: false, code: "UPLOAD_FAILED", errors: { uploadCode: "TYPE_MISMATCH", copyKey: "uploadErrMismatch" } });
    expect(await prepareDesignAssetUpload({ ...prep, kind: "color", mime: "application/json", fileName: "t.json", size: 2_000_000 })).toMatchObject({ errors: { copyKey: "uploadErrSize" } });
    expect(await prepareDesignAssetUpload({ ...prep, mime: "text/html" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(S.rpc).toHaveLength(0);
  });

  it("DB 오류(만료·한도)는 문구 키·원인 문구로", async () => {
    S.rpcError = { code: "P0001", message: "QUOTA_EXCEEDED: 업무실 디자인 자산 저장 용량을 넘습니다. 쓰지 않는 자산을 정리한 뒤 다시 올려 주세요" };
    expect(await prepareDesignAssetUpload(prep)).toMatchObject({ ok: false, code: "UPLOAD_FAILED", message: "업무실 디자인 자산 저장 용량을 넘습니다. 쓰지 않는 자산을 정리한 뒤 다시 올려 주세요" });
  });
});

describe("3단계 확정", () => {
  const body = { uploadId: U, title: "메인 로고", licenseNote: "", origin: "external_upload" };
  const path = `w1/design-assets/${U}.svg`;

  it("저장소에서 받아 검사 → sha256 을 잰 값으로 서명한 확정 RPC", async () => {
    const r = await confirmDesignAssetCreate(path, body);
    expect(r).toEqual({ ok: true, data: { assetId: "a-new" } });
    const sha = createHash("sha256").update(SAFE_SVG).digest("hex");
    const a = S.rpc[0].args;
    expect(S.rpc[0].fn).toBe("create_design_asset");
    expect(a).toMatchObject({ p_upload_id: U, p_sha256: sha, p_license_note: null, p_origin_type: "external_upload" });
    expect(a.p_signature).toBe(hmac("design_confirm", `${U}|${sha}`, a.p_signed_at));
  });

  it("위험한 SVG 는 예약을 닫고(UNSAFE_SVG) 확정하지 않는다", async () => {
    S.file = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    const r = await confirmDesignAssetCreate(path, body);
    expect(r).toMatchObject({ ok: false, code: "UPLOAD_FAILED", errors: { uploadCode: "UNSAFE_SVG", copyKey: "unsafeSvg" } });
    expect(S.rpc.map((x) => x.fn)).toEqual(["reject_design_asset_upload"]);
    expect(S.rpc[0].args.p_signature).toBe(hmac("design_reject", `${U}|UNSAFE_SVG`, S.rpc[0].args.p_signed_at));
  });

  it("내용이 다른 형식(SVG 경로에 PNG)은 TYPE_MISMATCH, 객체 없음은 예약을 닫지 않고 네트워크 문구", async () => {
    S.file = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    expect(await confirmDesignAssetCreate(path, body)).toMatchObject({ errors: { uploadCode: "TYPE_MISMATCH", copyKey: "uploadErrMismatch" } });
    S.rpc.length = 0;
    S.file = null;
    expect(await confirmDesignAssetCreate(path, body)).toMatchObject({ errors: { uploadCode: "UPLOAD_MISSING", copyKey: "uploadErrNetwork" } });
    expect(S.rpc).toHaveLength(0);
  });

  it("경로 조작(다른 업무실·다른 예약 id·모르는 확장자)은 내려받기 전에 거절", async () => {
    for (const p of [`w2/design-assets/${U}.svg`, `w1/design-assets/${B}.svg`, `w1/design-assets/${U}.html`, `w1/source-assets/${U}.svg`])
      expect(await confirmDesignAssetCreate(p, body)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(S.storage).toHaveLength(0);
  });

  it("만료는 DA_COPY uploadErrExpired, 교체는 replace RPC", async () => {
    S.rpcError = { code: "P0001", message: "UPLOAD_EXPIRED: 올리기 링크 유효 시간이 지났습니다" };
    expect(await confirmDesignAssetCreate(path, body)).toMatchObject({ errors: { copyKey: "uploadErrExpired" } });
    S.rpcError = null;
    S.rpc.length = 0;
    expect(await confirmDesignAssetReplace("a1", 3, path, { uploadId: U, changeNote: " 색 보정 " })).toEqual({ ok: true, data: { revision: 7 } });
    expect(S.rpc[0]).toMatchObject({ fn: "replace_design_asset_file", args: { p_asset_id: "a1", p_expected_revision: 3, p_change_note: "색 보정" } });
  });
});

describe("읽기·그 밖의 쓰기", () => {
  it("파일 주소는 늘 attachment(download 옵션), 내려받기 60초·미리보기 300초", async () => {
    S.rows.design_asset_versions = [{ asset_id: "a1", version_no: 2, storage_key: "w1/design-assets/x.svg", file_name: "로고.svg" }];
    expect(await getDesignAssetFileUrl("a1", 2, "download")).toEqual({ ok: true, data: { url: "https://st/w1/design-assets/x.svg?token=t&download=%EB%A1%9C%EA%B3%A0.svg", expiresIn: 60 } });
    expect(await getDesignAssetFileUrl("a1", 2, "preview")).toMatchObject({ ok: true, data: { expiresIn: 300 } });
    expect(S.storage.map((x) => x.args)).toEqual([
      ["design-assets", "w1/design-assets/x.svg", 60, { download: true }],
      ["design-assets", "w1/design-assets/x.svg", 300, { download: true }],
    ]);
    expect(await getDesignAssetFileUrl("a1", 9, "download")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("목록: 본인 업무실 조건, 지난 기준·사라진 섹션이면 stale, 사용처 이름표", async () => {
    S.rows = {
      production_briefs: [{ id: "b1", title: "봄", revision: 5, status: "ready", archived_at: null, project_id: "p1", strategy_artifact_id: "s1", deliverable_types: ["design_assets"] }],
      projects: [{ id: "p1", status: "active" }],
      artifacts: [{ id: "s1", task_id: "t1" }],
      tasks: [{ id: "t1", status: "in_progress" }],
      design_assets: [
        { id: "a1", production_brief_id: "b1", project_id: "p1", title: "로고", asset_kind: "logo", origin_type: "external_upload", license_note: null, status: "drafting", archived_at: null, revision: 2, current_version_no: 2, source_brief_revision: 5 },
      ],
      design_asset_versions: [
        { id: "v3", asset_id: "a9", version_no: 3, storage_key: "w1/design-assets/k1.svg", file_size_bytes: 10 }, // 다른 브리프 자산의 되돌리기 판(같은 파일, 한 번만 셈)
        { id: "v2", asset_id: "a1", version_no: 2, kind: "replace", change_note: "색", storage_key: "w1/design-assets/k2.png", file_name: "b.png", file_size_bytes: 20, mime_type: "image/png", restored_from_version_no: null, created_at: "t2" },
        { id: "v1", asset_id: "a1", version_no: 1, kind: "create", change_note: null, storage_key: "w1/design-assets/k1.svg", file_name: "a.svg", file_size_bytes: 10, mime_type: "image/svg+xml", restored_from_version_no: null, created_at: "t1" },
      ],
      design_asset_usages: [
        { id: "us1", asset_id: "a1", web_copy_doc_id: "d1", section_id: "s1" },
        { id: "us2", asset_id: "a1", web_copy_doc_id: "d1", section_id: "gone" },
      ],
      web_copy_docs: [{ id: "d1", current_version_no: 3, archived_at: null }],
      web_copy_versions: [{ doc_id: "d1", version_no: 3, content: { pages: [{ title: "홈", sections: [{ id: "s1", section_name: "첫 화면" }] }] } }],
    };
    const r = await getDesignAssetsFor("b1");
    if (!r.ok) throw new Error(r.message);
    for (const q of S.queries) expect(q.ops, q.table).toContain("eq(workspace_id,w1)");
    expect(r.data).toMatchObject({ stale: true, canWrite: true, canCreate: true, count: 1, limit: 50, usageOptions: [{ docId: "d1", sectionId: "s1", label: "홈 · 첫 화면" }] });
    expect(r.data.assets[0]).toMatchObject({ fileName: "b.png", mimeType: "image/png", version: 2, stale: false, usages: [{ label: "홈 · 첫 화면" }, { label: null }] });
    expect(r.data.assets[0].versions.map((v) => [v.version, v.current])).toEqual([[2, true], [1, false]]);
    // 저장 용량(Master O4): 업무실 전체 판의 서로 다른 파일 합 10 + 20, 상한은 DB 와 같은 500MB
    expect(r.data.storage).toEqual({ usedBytes: 30, limitBytes: 524288000 });
    vi.stubEnv("DESIGN_ASSET_SIGNING_KEY", "");
    const off = await getDesignAssetsFor("b1");
    expect(off).toMatchObject({ ok: true, data: { canWrite: false, canCreate: false } });
  });

  it("정보 저장·사용처는 계약 검사 뒤 RPC(camelCase → snake)", async () => {
    expect(await updateDesignAsset("a1", 2, { title: " 새 이름 ", licenseNote: null, status: "reviewed" })).toEqual({ ok: true, data: { revision: 7 } });
    expect(S.rpc[0].args).toMatchObject({ p_title: "새 이름", p_license_note: null, p_status: "reviewed" });
    expect(await setDesignAssetUsages("a1", 7, [{ docId: B, sectionId: U }])).toEqual({ ok: true, data: { revision: 7 } });
    expect(S.rpc[1].args.p_usages).toEqual([{ doc_id: B, section_id: U }]);
    expect(await setDesignAssetUsages("a1", 7, [{ docId: "x", sectionId: U }])).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("저장 용량 상수", () => {
  it("앱 상한 = migration 31 app.design_asset_quota_bytes() 값(한쪽만 바꾸지 않게)", async () => {
    const { readFileSync } = await import("node:fs");
    const { DESIGN_ASSET_LIMITS } = await import("@/domain/design-assets");
    const sql = readFileSync("supabase/migrations/20261121004000_p3c_design_assets.sql", "utf8");
    const m = /design_asset_quota_bytes\(\) returns bigint\s+language sql immutable set search_path = '' as \$\$ select (\d+)::bigint/.exec(sql);
    expect(Number(m?.[1])).toBe(DESIGN_ASSET_LIMITS.workspaceQuotaBytes);
  });
  it("distinctBytes: 같은 파일은 한 번만", async () => {
    const { distinctBytes } = await import("./server");
    expect(distinctBytes([{ storage_key: "a", file_size_bytes: 5 }, { storage_key: "a", file_size_bytes: 5 }, { storage_key: "b", file_size_bytes: 7 }])).toBe(12);
    expect(distinctBytes([])).toBe(0);
  });
});
