import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P3D-BACKEND-IMPL-01: 영상 구성안 서버 함수 단위 시험. DB·저장소·fetch 는 호출을 기록하는 흉내로 바꾼다
 * (실제 RLS·RPC·저장소 정책 규칙은 tests/db/p3d-video-plans.test.ts 가 맡는다).
 */
const S = vi.hoisted(() => ({
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  storage: [] as Array<{ op: string; args: unknown[] }>,
  queries: [] as Array<{ table: string; ops: string[] }>,
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
      const rows = () => ((S.rows[table] ?? []) as Record<string, unknown>[]).filter((r) => filters.every(([k, v]) => k === "workspace_id" || !(k in r) || r[k] === v));
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "order"]) {
        chain[op] = (...args: unknown[]) => {
          q.ops.push(`${op}(${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(",")})`);
          if (op === "eq") filters.push([String(args[0]), args[1]]);
          return chain;
        };
      }
      chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
      chain.then = (res: (v: unknown) => unknown) => res({ data: rows(), error: null });
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      S.rpc.push({ fn, args });
      if (S.rpcError && fn !== "close_video_file_upload") return { data: null, error: S.rpcError };
      if (fn === "reserve_video_file_upload") return { data: [{ upload_id: "11111111-1111-4111-8111-111111111111", storage_key: "w1/video-files/11111111-1111-4111-8111-111111111111.mp4", expires_at: "2026-11-20T01:00:00Z" }], error: null };
      return { data: fn === "create_video_plan" ? "plan-new" : 7, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        async createSignedUploadUrl(path: string) {
          S.storage.push({ op: "createSignedUploadUrl", args: [bucket, path] });
          return { data: { token: "tok", path, signedUrl: "x" }, error: null };
        },
        async createSignedUrl(path: string, sec: number, opt?: unknown) {
          S.storage.push({ op: "createSignedUrl", args: [bucket, path, sec, opt] });
          return { data: { signedUrl: `https://st/${path}?token=t&download=` }, error: null };
        },
      }),
    },
  }),
}));

import { createVideoPlan, finishVideoUpload, getVideoFileUrl, getVideoPlanFor, saveVideoPlan, startVideoUpload } from "./server";

const KEY = "k".repeat(64);
const UP = "11111111-1111-4111-8111-111111111111";
const PATH = `w1/video-files/${UP}.mp4`;
let head: Uint8Array = new Uint8Array();
const fetchMock = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
  S.storage.push({ op: "fetch", args: [init?.headers?.Range] });
  return new Response(head as BlobPart, { status: 206 });
});

beforeEach(() => {
  Object.assign(S, { rpc: [], storage: [], queries: [], rpcError: null, rows: {} });
  vi.stubEnv("DESIGN_ASSET_SIGNING_KEY", KEY);
  vi.stubGlobal("fetch", fetchMock);
  head = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sc = (o: Record<string, unknown> = {}) => ({ id: null, sceneTitle: " 첫 장면 ", durationSec: 10, narration: "대사", subtitle: "", assetIds: [], ...o });

describe("구성안 쓰기", () => {
  it("만들기: 정리한 값을 snake_case 장면으로 넘긴다, 입력 오류는 RPC 를 부르지 않는다", async () => {
    expect(await createVideoPlan({ productionBriefId: "00000000-0000-4000-8000-000000000001", title: " 봄 ", aspectRatio: "9:16", scenes: [sc()] })).toEqual({ ok: true, data: { planId: "plan-new" } });
    expect(S.rpc[0]).toEqual({
      fn: "create_video_plan",
      args: { p_production_brief_id: "00000000-0000-4000-8000-000000000001", p_title: "봄", p_aspect_ratio: "9:16", p_scenes: [{ id: null, title: "첫 장면", duration_sec: 10, narration: "대사", subtitle: null, asset_ids: [] }] },
    });
    S.rpc = [];
    expect(await createVideoPlan({ productionBriefId: "x", title: "봄", aspectRatio: "16:9", scenes: [sc()] })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await saveVideoPlan("p1", 1, { title: "봄", aspectRatio: "16:9", status: "drafting", scenes: [sc({ durationSec: 1.5 })] })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(S.rpc).toEqual([]);
  });
  it("DB 오류는 한글 안내로", async () => {
    S.rpcError = { code: "P0001", message: "CONFLICT: 다른 곳에서 먼저 수정되었습니다" };
    expect(await saveVideoPlan("p1", 1, { title: "봄", aspectRatio: "16:9", status: "drafting", scenes: [sc()] })).toMatchObject({ ok: false, code: "CONFLICT" });
  });
});

describe("파일 첨부(3단계)", () => {
  it("예약은 video_file_reserve 용도 서명(공유 키), 서명 업로드 URL", async () => {
    const r = await startVideoUpload({ planId: "00000000-0000-4000-8000-000000000002", fileName: "최종.mp4", size: 5000, mime: "video/mp4" });
    expect(r).toMatchObject({ ok: true, data: { uploadId: UP, path: PATH, token: "tok", mime: "video/mp4" } });
    const a = S.rpc[0].args;
    const want = createHmac("sha256", KEY).update(`video_file_reserve|00000000-0000-4000-8000-000000000002|5000|video/mp4|최종.mp4|${a.p_signed_at}`).digest("hex");
    expect(a.p_signature).toBe(want);
    expect(S.storage).toEqual([{ op: "createSignedUploadUrl", args: ["video-files", PATH] }]);
  });
  it("키가 없으면 첨부만 꺼진다, 50MB 초과는 RPC 전 거절", async () => {
    expect(await startVideoUpload({ planId: "00000000-0000-4000-8000-000000000002", fileName: "a.mp4", size: 50 * 1024 * 1024 + 1, mime: "video/mp4" })).toMatchObject({ ok: false, code: "UPLOAD_FAILED" });
    vi.stubEnv("DESIGN_ASSET_SIGNING_KEY", "");
    expect(await startVideoUpload({ planId: "00000000-0000-4000-8000-000000000002", fileName: "a.mp4", size: 1, mime: "video/mp4" })).toMatchObject({ ok: false, code: "ERROR" });
    expect(S.rpc).toEqual([]);
  });
  it("확정: 앞 4KB 만(Range) 받아 표식 확인 → video_file_confirm 서명", async () => {
    expect(await finishVideoUpload("p1", 3, PATH, { uploadId: UP, changeNote: " 첫 편집 " })).toEqual({ ok: true, data: { revision: 7 } });
    expect(S.storage.find((x) => x.op === "fetch")?.args).toEqual(["bytes=0-4095"]);
    const c = S.rpc.find((x) => x.fn === "confirm_video_file_upload")!.args;
    expect(c).toMatchObject({ p_upload_id: UP, p_expected_revision: 3, p_change_note: "첫 편집" });
    expect(c.p_signature).toBe(createHmac("sha256", KEY).update(`video_file_confirm|${UP}|${c.p_signed_at}`).digest("hex"));
  });
  it("표식이 다르면(.mp4 인데 HTML) 예약을 닫고 확정하지 않는다(DS5)", async () => {
    head = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    expect(await finishVideoUpload("p1", 3, PATH, { uploadId: UP, changeNote: null })).toMatchObject({ ok: false, code: "UPLOAD_FAILED" });
    expect(S.rpc.map((x) => [x.fn, x.args.p_reason])).toEqual([["close_video_file_upload", "TYPE_MISMATCH"]]);
  });
  it("예약 모양이 아닌 경로(남의 업무실·다른 예약·다른 버킷)는 받지 않는다", async () => {
    for (const p of [`w2/video-files/${UP}.mp4`, `w1/video-files/22222222-2222-4222-8222-222222222222.mp4`, `w1/design-assets/${UP}.mp4`, `w1/video-files/${UP}.html`])
      expect(await finishVideoUpload("p1", 3, p, { uploadId: UP, changeNote: null }), p).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(S.rpc).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("w2/"), expect.anything());
  });
});

describe("읽기", () => {
  const base = () => ({
    production_briefs: [{ id: "b1", revision: 5, status: "ready", archived_at: null, project_id: "p1", strategy_artifact_id: "s1", deliverable_types: ["video_plan"] }],
    projects: [{ id: "p1", status: "active" }],
    artifacts: [{ id: "s1", task_id: "t1" }],
    tasks: [{ id: "t1", status: "in_progress" }],
    design_assets: [
      { id: "a1", title: "로고", current_version_no: 2, archived_at: null },
      { id: "a2", title: "옛 배경", current_version_no: 1, archived_at: "t" },
    ],
  });
  it("대표 = 보관 안 된 것 중 최근 고친 것, 자산 새 판이면 stale(asset), 판 목록·파일·합계", async () => {
    S.rows = {
      ...base(),
      video_plans: [
        { id: "vp2", title: "최근", aspect_ratio: "9:16", status: "drafting", archived_at: null, revision: 4, current_version_no: 2, current_file_version_no: 1, source_brief_revision: 5, updated_at: "2" },
        { id: "vp1", title: "예전", aspect_ratio: "16:9", status: "drafting", archived_at: null, revision: 1, current_version_no: 1, current_file_version_no: null, source_brief_revision: 5, updated_at: "1" },
      ],
      video_plan_versions: [
        { plan_id: "vp2", version_no: 2, kind: "save", status: "drafting", total_duration_sec: 38, restored_from_version_no: null, created_at: "t2",
          scenes: [{ id: "s1", title: "하나", duration_sec: 10, narration: null, subtitle: "자막", assets: [{ asset_id: "a1", version_no: 1 }, { asset_id: "a2", version_no: 1 }] }, { id: "s2", title: "둘", duration_sec: 28, narration: "대사", subtitle: null, assets: [] }] },
        { plan_id: "vp2", version_no: 1, kind: "create", status: "drafting", total_duration_sec: 10, restored_from_version_no: null, created_at: "t1", scenes: [{ id: "s1", title: "하나", duration_sec: 10, narration: null, subtitle: null, assets: [] }] },
      ],
      video_file_versions: [{ plan_id: "vp2", version_no: 1, kind: "upload", file_name: "최종.mp4", file_size_bytes: "5000", change_note: null, restored_from_version_no: null, created_at: "t3" }],
    };
    const r = await getVideoPlanFor("b1");
    if (!r.ok) throw new Error(r.message);
    for (const q of S.queries) expect(q.ops, q.table).toContain("eq(workspace_id,w1)");
    expect(r.data).toMatchObject({ canWrite: true, canCreate: true, canAttach: true, activePlanCount: 2, assets: [{ id: "a1", label: "로고" }] });
    expect(r.data.plan).toMatchObject({ id: "vp2", stale: true, staleReasons: ["asset"], staleAssetCount: 1, rebaseBlockedReason: null, rebaseBlockedCode: null, archivedAssetCount: 1, totalSec: 38 });
    expect(r.data.createBlockedCode).toBeNull();
    expect(r.data.plan!.scenes).toEqual([
      { id: "s1", sceneTitle: "하나", durationSec: 10, narration: "", subtitle: "자막", assetIds: ["a1", "a2"], sortOrder: 1 },
      { id: "s2", sceneTitle: "둘", durationSec: 28, narration: "대사", subtitle: "", assetIds: [], sortOrder: 2 },
    ]);
    expect(r.data.plan!.planVersions.map((v) => [v.version, v.sceneCount, v.current])).toEqual([[2, 2, true], [1, 1, false]]);
    expect(r.data.plan!.files).toEqual([{ version: 1, fileName: "최종.mp4", fileSizeBytes: 5000, savedAt: "t3", note: null, current: true, kind: "upload", restoredFromVersion: null }]);
  });
  it("구성안 없음·브리프 작성 중이면 만들기 막힘, 보관 구성안은 읽기 전용", async () => {
    S.rows = { ...base(), production_briefs: [{ ...base().production_briefs[0], status: "drafting", revision: 6 }] };
    const r = await getVideoPlanFor("b1");
    expect(r).toMatchObject({ ok: true, data: { plan: null, canWrite: false, canCreate: false, createBlockedCode: "brief_drafting", createBlockedReason: "확정된 공통 제작 브리프가 있어야 영상 구성안을 만들 수 있습니다." } });
    S.rows = {
      ...base(),
      video_plans: [{ id: "vp1", title: "보관", aspect_ratio: "16:9", status: "reviewed", archived_at: "t", revision: 3, current_version_no: 1, current_file_version_no: null, source_brief_revision: 4, updated_at: "1" }],
      video_plan_versions: [{ plan_id: "vp1", version_no: 1, kind: "create", status: "reviewed", total_duration_sec: 10, restored_from_version_no: null, created_at: "t1", scenes: [{ id: "s1", title: "하나", duration_sec: 10, narration: null, subtitle: null, assets: [] }] }],
    };
    const a = await getVideoPlanFor("b1");
    if (!a.ok) throw new Error(a.message);
    expect(a.data).toMatchObject({ canWrite: false, canAttach: false, activePlanCount: 0, canCreate: true });
    expect(a.data.readOnlyReason).toMatch(/보관한 영상 구성안/);
    expect(a.data.plan).toMatchObject({ stale: false, staleReasons: ["brief"], staleAssetCount: 0, rebaseBlockedCode: "plan_archived", rebaseBlockedReason: "보관한 영상 구성안은 맞출 수 없습니다." });
  });
  it("내려받기: 본인 업무실 판만, 60초 attachment", async () => {
    S.rows = { video_file_versions: [{ plan_id: "vp1", version_no: 2, storage_key: "w1/video-files/u.mp4", file_name: "최종 편집.mp4" }] };
    const r = await getVideoFileUrl("vp1", 2);
    expect(r).toMatchObject({ ok: true, data: { expiresIn: 60 } });
    if (r.ok) expect(r.data.url).toContain(`download=${encodeURIComponent("최종 편집.mp4")}`);
    expect(S.storage[0]).toEqual({ op: "createSignedUrl", args: ["video-files", "w1/video-files/u.mp4", 60, { download: true }] });
    expect(await getVideoFileUrl("vp1", 9)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
