import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADMIN-LOGIN-NEXT-IMPL-01(H1): 로그인 뒤 돌아갈 곳 결정(resolveSignedInDestination)과 loginAction 의 next 처리.
 * Supabase·관리자 확인은 흉내. 검사 규칙 자체는 src/server/auth/redirect.test.ts 가 본다.
 */
const S = vi.hoisted(() => ({
  admin: false as boolean | "throw",
  adminCalls: 0,
  signIn: { error: null as null | { code?: string; status?: number } },
  redirects: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    S.redirects.push(to);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/features/admin/server", () => ({
  isAdmin: async () => {
    S.adminCalls++;
    // 실제 isAdmin 은 확인 오류를 false 로 돌려준다(src/features/admin/server.ts). 던지는 경우도 관리자로 보지 않는지 본다
    if (S.admin === "throw") throw new Error("확인 실패");
    return S.admin;
  },
}));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithPassword: async () => S.signIn, getClaims: async () => ({ data: null }) } }),
}));
vi.mock("@/server/auth/allowlist", () => ({ allowedEmailsFromEnv: () => [], isAllowedEmail: () => true }));
vi.mock("@/server/env", () => ({ siteUrl: () => "http://localhost:3000" }));

const { resolveSignedInDestination } = await import("@/server/auth/session");
const { loginAction } = await import("./actions");

const U = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  Object.assign(S, { admin: false, adminCalls: 0, signIn: { error: null }, redirects: [] });
});

describe("resolveSignedInDestination", () => {
  it.each([
    [true, `/admin/inquiries?id=${U}`, `/admin/inquiries?id=${U}`],
    [true, undefined, "/admin"],
    [true, "", "/admin"],
    [true, `/projects/${U}`, `/projects/${U}`],
    [true, "/..//evil.com", "/admin"],
    [false, "/admin/inquiries", "/workspace"], // 404 가 아니라 업무실(next 없을 때와 같음)
    [false, "/admin", "/workspace"],
    [false, `/projects/${U}/execution`, `/projects/${U}/execution`],
    [false, "//evil.com", "/workspace"],
    [false, "/setup", "/workspace"],
    [false, undefined, "/workspace"],
  ] as const)("관리자 %s · next %j → %s", async (admin, next, expected) => {
    S.admin = admin;
    expect(await resolveSignedInDestination(next)).toBe(expected);
    expect(S.adminCalls).toBe(1);
  });

  it("관리자 확인이 던지면 관리자로 보지 않는다(관리자 화면으로 보내지 않음)", async () => {
    S.admin = "throw";
    await expect(resolveSignedInDestination("/admin")).rejects.toThrow();
    // 실제 isAdmin 은 오류를 false 로 바꾸므로 /workspace — 아래는 false 흉내
    S.admin = false;
    expect(await resolveSignedInDestination("/admin/usage")).toBe("/workspace");
  });
});

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};
const login = (o: Record<string, string>) => loginAction({}, form({ email: "a@example.test", password: "password123", ...o }));

describe("loginAction next", () => {
  it("성공 + 숨은 칸 next → 서버가 다시 검사한 곳으로(관리자)", async () => {
    S.admin = true;
    await expect(login({ next: `/admin/inquiries?id=${U}` })).rejects.toThrow("NEXT_REDIRECT");
    expect(S.redirects).toEqual([`/admin/inquiries?id=${U}`]);
  });

  it("성공 + 관리자 아님 + /admin next → /workspace", async () => {
    await expect(login({ next: "/admin/inquiries" })).rejects.toThrow("NEXT_REDIRECT");
    expect(S.redirects).toEqual(["/workspace"]);
  });

  it("성공 + 나쁜 next(F0·외부·인증 화면) → 역할별 첫 화면", async () => {
    for (const next of ["/..//evil.com", "https://evil.com", "/login", "/%2e%2e//evil.com"]) {
      S.redirects = [];
      await expect(login({ next })).rejects.toThrow("NEXT_REDIRECT");
      expect(S.redirects).toEqual(["/workspace"]);
    }
  });

  it("next 없음 → 지금처럼 역할별 첫 화면", async () => {
    S.admin = true;
    await expect(login({})).rejects.toThrow("NEXT_REDIRECT");
    expect(S.redirects).toEqual(["/admin"]);
  });

  it("실패면 이동하지 않고 문구는 그대로, 오류 로그에 next 값이 없다", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    S.signIn = { error: { code: "invalid_credentials" } };
    expect(await login({ next: `/admin/inquiries?id=${U}` })).toEqual({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    S.signIn = { error: { code: "unexpected", status: 500 } };
    expect((await login({ next: `/admin/inquiries?id=${U}` })).message).toContain("로그인하지 못했습니다");
    expect(S.redirects).toEqual([]);
    expect(JSON.stringify(err.mock.calls)).not.toContain(U);
    expect(JSON.stringify(err.mock.calls)).not.toContain("/admin/inquiries");
    err.mockRestore();
  });
});
