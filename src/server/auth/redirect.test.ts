import { describe, expect, it } from "vitest";
import { isAdminReturnPath, RETURN_PATH_ROOTS, safeNextPath, safeReturnPath } from "./redirect";

const U = "11111111-1111-4111-8111-111111111111";

/** 브라우저가 이 Location 을 다른 사이트로 읽는지(시험용 판정) */
const sameSite = (loc: string) => new URL(loc, "https://app.example").host === "app.example";

/** F0: 기존 함수가 정규화 뒤 "//evil.com" 으로 내보내던 입력(설계 0절 측정 7종 + 이중 인코딩) */
const F0 = [
  "/..//evil.com",
  "/.//evil.com",
  "/a/..//evil.com",
  "/admin/..//evil.com",
  "/admin/../..//evil.com",
  "/%2e%2e//evil.com",
  "/%2e//evil.com",
];

describe("safeNextPath (메일 콜백, F0 고침)", () => {
  it.each([
    ["/", "/"],
    ["/clients?q=a", "/clients?q=a"],
    ["/projects/1#x", "/projects/1#x"],
    ["/reset-password", "/reset-password"],
  ])("%s 허용", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([null, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/ok\nSet-Cookie: x", "evil"])(
    "%j 는 기본 주소로",
    (input) => {
      expect(safeNextPath(input)).toBe("/");
    },
  );

  it.each(F0)("F0 %s → 기본 주소(정규화 뒤 다른 사이트로 읽히지 않음)", (input) => {
    const out = safeNextPath(input);
    expect(out).toBe("/");
    expect(sameSite(out)).toBe(true);
  });
});

describe("safeReturnPath (로그인 next, R1~R9)", () => {
  // 1. 통과(정확한 출력)
  it.each([
    "/admin",
    `/admin/inquiries?id=${U}`,
    "/admin/p4",
    "/admin/usage",
    "/workspace",
    "/projects",
    `/projects/${U}`,
    `/projects/${U}/execution`,
    `/projects/${U}/execution#queue`,
    `/tasks/${U}`,
    `/tasks/${U}#qa-checklist`,
    `/clients/${U}`,
    "/assets",
    "/results",
    "/settings",
    "/admin/inquiries?id=//evil.com", // 쿼리 값은 이동할 곳을 바꾸지 못한다
  ])("%s 통과", (input) => {
    expect(safeReturnPath(input)).toBe(input);
    expect(sameSite(input)).toBe(true);
  });

  // 2~6. 거절
  it.each([
    // 2. 외부로 빠지는 주소
    "//evil.com",
    "https://evil.com",
    "http:evil.com",
    "javascript:alert(1)",
    "/\\evil.com",
    "/.\\\\evil.com",
    "/.\\/evil.com",
    // 3. F0(정규화 뒤 //)
    ...F0,
    "/%252e%252e//evil.com",
    // 4. 인코딩된 구분자
    "/%2F%2Fevil.com",
    "/%5C%5Cevil.com",
    "/admin%2F..%2F..",
    "/admin/%2e%2e",
    // 5. 글자
    "/admin@evil.com",
    "/admin:x",
    "/admin x",
    "/admin　",
    "/admin\t",
    "/admin\r\nSet-Cookie: x",
    "/admin%0d%0ax",
    "/admin\u0000",
    "/관리자",
    "/admin/<script>",
    "/admin\"onload",
    // 6. 허용 목록 밖
    "/",
    "/login",
    "/login?next=/admin",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/auth/callback?code=x",
    "/setup",
    "/_admin-not-found",
    "/_next/static/x",
    "/administrator",
    "/admin/evil.com",
    "/admin/../setup",
    "/admin/./usage",
    "/admin/",
    "/admin//usage",
    "admin",
  ])("%j 거절(null)", (input) => {
    expect(safeReturnPath(input)).toBeNull();
  });

  // 7. 경계
  it("길이 512 통과·513 거절, 조각 6개 통과·7개 거절, 쿼리 256자 통과·257자 거절, 문자열 아닌 값 거절", () => {
    const pathOf = (n: number) => "/projects/" + "a".repeat(n - "/projects/".length);
    // 조각 길이 64 제한이 있으므로 길이 경계는 쿼리로 맞춘다
    const withQuery = (total: number) => {
      const head = "/workspace?q=";
      return head + "a".repeat(total - head.length);
    };
    expect(withQuery(256 + "/workspace".length).length).toBe(266);
    expect(safeReturnPath(withQuery("/workspace".length + 256))).not.toBeNull(); // 쿼리 정확히 256자
    expect(safeReturnPath(withQuery("/workspace".length + 257))).toBeNull(); // 257자
    const long = "/projects/" + Array.from({ length: 5 }, () => "a".repeat(64)).join("/");
    expect(long.split("/").length - 1).toBe(6);
    expect(safeReturnPath(long)).toBe(long); // 조각 6개
    expect(safeReturnPath(long + "/b")).toBeNull(); // 조각 7개
    expect(safeReturnPath(pathOf(20) + "?" + "x".repeat(10))).not.toBeNull();
    const at512 = "/workspace?" + "q=" + "a".repeat(512 - "/workspace?q=".length);
    expect(at512.length).toBe(512);
    expect(safeReturnPath(at512)).toBeNull(); // 길이는 통과하지만 쿼리 256 초과 → 거절(R8)
    expect(safeReturnPath("/workspace#" + "a".repeat(502))).toBeNull(); // 해시 64자 초과
    expect(safeReturnPath("/" + "a".repeat(513))).toBeNull(); // R1 길이
    expect(safeReturnPath("/admin#" + "x".repeat(64))).toBe("/admin#" + "x".repeat(64));
    expect(safeReturnPath("/admin#x.y")).toBeNull();
    for (const bad of [undefined, null, 1, ["/admin"], { p: "/admin" }, ""]) expect(safeReturnPath(bad)).toBeNull();
  });

  it("허용 첫 조각은 Master 확정 8개", () => {
    expect([...RETURN_PATH_ROOTS]).toEqual(["admin", "workspace", "projects", "tasks", "clients", "assets", "results", "settings"]);
  });

  it("통과한 값은 모두 같은 사이트 안이다(거절 입력 전부 포함 재확인)", () => {
    for (const input of [...F0, "//evil.com", "/%2e%2e//evil.com", `/admin/inquiries?id=${U}`]) {
      const out = safeReturnPath(input);
      if (out !== null) expect(sameSite(out)).toBe(true);
    }
  });
});

describe("isAdminReturnPath", () => {
  it.each([
    ["/admin", true],
    ["/admin/usage", true],
    ["/admin?x=1", true],
    ["/admin#top", true],
    ["/administrator", false],
    ["/workspace", false],
    ["/projects/admin", false],
  ])("%s → %s", (p, expected) => {
    expect(isAdminReturnPath(p)).toBe(expected);
  });
});
