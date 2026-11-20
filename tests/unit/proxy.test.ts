import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * ADMIN-404-01: Proxy 의 관리자 화면 404. Supabase 클라이언트를 흉내 낸다.
 * - 비로그인 → 지금처럼 /login 으로(307)
 * - 로그인 + 관리자 아님·확인 오류 → 404(쿠키 그대로)
 * - 로그인 + 관리자 → 통과
 * - /admin* 가 아닌 경로는 관리자 확인 RPC 를 부르지 않는다(요청마다 RPC 가 늘지 않음)
 */
const S = vi.hoisted(() => ({ sub: null as string | null, whoami: { data: false as unknown, error: null as unknown }, rpcCalls: [] as string[], setCookie: false }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opt: { cookies: { setAll: (c: Array<{ name: string; value: string; options?: object }>, h?: Record<string, string>) => void } }) => ({
    auth: {
      async getClaims() {
        // 세션 갱신 흉내: 쿠키를 새로 실어 보낸다
        if (S.setCookie) opt.cookies.setAll([{ name: "sb-x-auth-token", value: "새값", options: { path: "/" } }]);
        return { data: S.sub ? { claims: { sub: S.sub } } : null };
      },
    },
    async rpc(fn: string) {
      S.rpcCalls.push(fn);
      return S.whoami;
    },
  }),
}));

const { proxy } = await import("@/proxy");
const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "공개키");
  Object.assign(S, { sub: null, whoami: { data: false, error: null }, rpcCalls: [], setCookie: false });
});

describe("Proxy 관리자 화면 404", () => {
  it("비로그인 /admin → 지금처럼 /login 으로, 관리자 확인 RPC 없음", async () => {
    const r = await proxy(req("/admin"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("http://localhost:3000/login");
    expect(S.rpcCalls).toEqual([]);
  });

  it("로그인 + 관리자 아님 → /admin·/admin/usage·/admin/p3 모두 404, 앱 not-found 화면으로 rewrite, 갱신 쿠키 실림", async () => {
    S.sub = "u1";
    S.setCookie = true;
    for (const p of ["/admin", "/admin/usage", "/admin/p3", "/admin/audit?x=1"]) {
      const r = await proxy(req(p));
      expect(r.status, p).toBe(404);
      // 앱의 not-found 화면을 그리도록 없는 내부 주소로 rewrite(QA-ADMIN-404-01 D1). 주소창 주소는 그대로
      expect(new URL(r.headers.get("x-middleware-rewrite") ?? "").pathname, p).toBe("/_admin-not-found");
      expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      expect(r.cookies.get("sb-x-auth-token")?.value).toBe("새값");
    }
    expect(S.rpcCalls).toEqual(["admin_whoami", "admin_whoami", "admin_whoami", "admin_whoami"]);
  });

  it("관리자 확인 RPC 오류·true 아닌 값 → 404(관리자 화면을 보여 주지 않는 쪽)", async () => {
    S.sub = "u1";
    for (const w of [{ data: null, error: { message: "boom" } }, { data: null, error: null }, { data: "true", error: null }, { data: 1, error: null }]) {
      S.whoami = w;
      expect((await proxy(req("/admin"))).status).toBe(404);
    }
  });

  it("로그인 + 관리자 → 통과(다음 단계로), 페이지 가드는 그대로", async () => {
    S.sub = "admin";
    S.whoami = { data: true, error: null };
    const r = await proxy(req("/admin/usage"));
    expect(r.status).toBe(200);
    expect(r.headers.get("x-middleware-next")).toBe("1");
  });

  it("관리자 화면이 아닌 경로는 RPC 를 부르지 않는다(/administrator·/projects·/ 포함)", async () => {
    S.sub = "u1";
    for (const p of ["/", "/projects/abc", "/administrator", "/adminx", "/tasks/1"]) {
      const r = await proxy(req(p));
      expect(r.status, p).toBe(200);
    }
    expect(S.rpcCalls).toEqual([]);
  });
});
