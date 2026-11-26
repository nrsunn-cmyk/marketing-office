import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renameWorkspace = vi.fn();
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh }));
vi.mock("@/features/settings/server", () => ({
  renameWorkspace,
  saveSupplierVersion: vi.fn(),
  supplierInputSchema: { safeParse: vi.fn() },
}));

const { renameWorkspaceAction } = await import("@/features/settings/actions");
const { WORKSPACE_RENAME_SAVED } = await import("./workspace-name-copy");

function fd(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

describe("업무실 이름 바꾸기 서버 동작 (WORKSPACE-RENAME-FRONT-01, AUDIT-05 C3)", () => {
  beforeEach(() => {
    renameWorkspace.mockReset();
    refresh.mockReset();
  });

  it("이름과 읽어 온 revision 을 그대로 넘기고, 성공하면 새로 그린다", async () => {
    renameWorkspace.mockResolvedValue({ ok: true, data: { revision: 4 } });
    const r = await renameWorkspaceAction({}, fd({ workspaceName: "새 이름", revision: "3" }));
    expect(renameWorkspace).toHaveBeenCalledWith("새 이름", 3);
    expect(refresh).toHaveBeenCalledOnce();
    expect(r).toEqual({ ok: true, message: WORKSPACE_RENAME_SAVED });
  });

  it("revision 이 숫자가 아니면 0 을 보내 서버가 충돌로 막게 한다", async () => {
    renameWorkspace.mockResolvedValue({ ok: false, code: "CONFLICT", message: "충돌" });
    const r = await renameWorkspaceAction({}, fd({ workspaceName: "x", revision: "abc" }));
    expect(renameWorkspace).toHaveBeenCalledWith("x", 0);
    expect(refresh).not.toHaveBeenCalled();
    expect(r).toEqual({ message: "충돌" });
  });

  it("입력 오류는 칸 오류로, 그 밖의 실패는 폼 안내로", async () => {
    renameWorkspace.mockResolvedValue({ ok: false, code: "VALIDATION", message: "업무실 이름을 입력해 주세요." });
    expect(await renameWorkspaceAction({}, fd({ workspaceName: " ", revision: "1" }))).toEqual({ errors: { workspaceName: "업무실 이름을 입력해 주세요." } });
    renameWorkspace.mockResolvedValue({ ok: false, code: "ERROR", message: "저장하지 못했습니다." });
    expect(await renameWorkspaceAction({}, fd({ workspaceName: "a", revision: "1" }))).toEqual({ message: "저장하지 못했습니다." });
  });

  it("설정 화면은 revision 을 숨은 칸으로 보내고, 못 읽으면 입력 칸을 숨긴다", () => {
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(page).toContain('<input type="hidden" name="revision" value={ws.revision} />');
    expect(page).toContain('name="workspaceName"');
    expect(page).toMatch(/if \(!ws\) \{[\s\S]*WORKSPACE_NAME_COPY\.loadError/);
  });
});
