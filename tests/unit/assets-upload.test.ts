import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CR05: 파일 저장·상태 기록 실패를 구분하고, 성공처럼 안내하지 않으며, 다시 확인으로 복구한다.
 * Supabase 호출을 흉내 낸 가짜 클라이언트에 단계별 실패를 넣어 확인한다.
 */

interface Fake {
  insertError: unknown;
  uploadError: unknown;
  updateError: unknown;
  updateRows: number;
  asset: Record<string, unknown> | null;
  listed: Array<{ name: string }> | null;
  listError: unknown;
  calls: { uploads: number; inserts: number; updates: Array<Record<string, unknown>> };
}

const fake: Fake = {} as Fake;

function reset() {
  Object.assign(fake, {
    insertError: null,
    uploadError: null,
    updateError: null,
    updateRows: 1,
    asset: null,
    listed: [],
    listError: null,
    calls: { uploads: 0, inserts: 0, updates: [] },
  });
}

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "ws-1" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => {
      const chain = {
        insert: async () => {
          fake.calls.inserts += 1;
          return { error: fake.insertError };
        },
        update: (values: Record<string, unknown>) => {
          fake.calls.updates.push(values);
          const q = {
            eq: () => q,
            select: async () =>
              fake.updateError
                ? { data: null, error: fake.updateError }
                : { data: Array.from({ length: fake.updateRows }, () => ({ id: "x" })), error: null },
          };
          return q;
        },
        select: () => {
          const q = { eq: () => q, maybeSingle: async () => ({ data: fake.asset, error: null }) };
          return q;
        },
      };
      return chain;
    },
    storage: {
      from: () => ({
        upload: async () => {
          fake.calls.uploads += 1;
          return { error: fake.uploadError };
        },
        list: async () => ({ data: fake.listed, error: fake.listError }),
      }),
    },
  }),
}));

const { uploadFileAsset, confirmPendingUpload } = await import("@/features/assets/server");
const txt = () => new File(["회사 소개 메모"], "memo.txt", { type: "text/plain" });

describe("uploadFileAsset (CR05)", () => {
  beforeEach(reset);

  it("정상: 저장 후 보관됨으로 표시되면 성공", async () => {
    const r = await uploadFileAsset({ clientId: "c" }, txt());
    expect(r.ok).toBe(true);
    expect(fake.calls.updates).toEqual([{ upload_status: "stored" }]);
  });

  it("파일 저장 실패: 실패로 표시하고 실패 안내", async () => {
    fake.uploadError = { message: "storage down" };
    const r = await uploadFileAsset({ clientId: "c" }, txt());
    expect(r).toMatchObject({ ok: false, code: "UPLOAD_FAILED", message: expect.stringContaining("저장하지 못했습니다") });
    expect(fake.calls.updates).toEqual([{ upload_status: "failed" }]);
  });

  it("파일은 저장됐지만 상태 기록 오류: 성공으로 안내하지 않고 다시 확인 안내", async () => {
    fake.updateError = { code: "08006", message: "connection lost" };
    const r = await uploadFileAsset({ clientId: "c" }, txt());
    expect(r).toMatchObject({ ok: false, code: "UPLOAD_FAILED", message: expect.stringContaining("저장 다시 확인") });
  });

  it("상태 갱신 대상이 0행이어도 성공으로 안내하지 않는다", async () => {
    fake.updateRows = 0;
    const r = await uploadFileAsset({ clientId: "c" }, txt());
    expect(r.ok).toBe(false);
  });
});

describe("confirmPendingUpload (CR05 복구)", () => {
  beforeEach(reset);
  const pending = { id: "a1", kind: "file", object_key: "ws-1/a1/original.txt", upload_status: "pending" };

  it("저장소에 파일이 있으면 보관됨으로, 다시 올리지 않는다", async () => {
    fake.asset = pending;
    fake.listed = [{ name: "original.txt" }];
    const r = await confirmPendingUpload("a1");
    expect(r).toEqual({ ok: true, data: { status: "stored" } });
    expect(fake.calls.uploads).toBe(0);
    expect(fake.calls.inserts).toBe(0);
  });

  it("저장소에 파일이 없으면 실패로 표시", async () => {
    fake.asset = pending;
    fake.listed = [{ name: "other.txt" }];
    expect(await confirmPendingUpload("a1")).toEqual({ ok: true, data: { status: "failed" } });
    expect(fake.calls.updates).toEqual([{ upload_status: "failed" }]);
  });

  it("저장소 확인 자체가 실패하면 상태를 바꾸지 않는다", async () => {
    fake.asset = pending;
    fake.listError = { message: "timeout" };
    const r = await confirmPendingUpload("a1");
    expect(r.ok).toBe(false);
    expect(fake.calls.updates).toEqual([]);
  });

  it("이미 보관된 파일은 그대로 성공", async () => {
    fake.asset = { ...pending, upload_status: "stored" };
    expect(await confirmPendingUpload("a1")).toEqual({ ok: true, data: { status: "stored" } });
    expect(fake.calls.updates).toEqual([]);
  });

  it("상태 기록이 0행이면(다른 곳에서 이미 바뀜) 실패 안내", async () => {
    fake.asset = pending;
    fake.listed = [{ name: "original.txt" }];
    fake.updateRows = 0;
    expect((await confirmPendingUpload("a1")).ok).toBe(false);
  });
});
