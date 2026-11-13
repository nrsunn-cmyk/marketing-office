// Codex 검수 재현(CR05)을 옮긴 시험. 원본 가짜 클라이언트가 `.eq().select()` 연결을 지원하지 않아
// 같은 실패(상태 기록 오류 주입)를 내도록 호출 연결만 맞췄다. 원본: Plan/Codex-Review-M2-M8-20261113/repro/codex-assets.test.ts
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireWorkspace: async () => ({ workspace: { id: "review-workspace" } }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({
      insert: async () => ({ error: null }),
      update: () => {
        const q = { eq: () => q, select: async () => ({ data: null, error: { code: "08006", message: "Injected status write failure" } }) };
        return q;
      },
    }),
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }),
}));
import { uploadFileAsset } from "@/features/assets/server";
it("CR05: metadata completion failure must not report a completed upload", async () => {
  const result = await uploadFileAsset({ clientId: "review-client" }, new File(["review text"], "example.txt", { type: "text/plain" }));
  expect(result.ok).toBe(false);
});
