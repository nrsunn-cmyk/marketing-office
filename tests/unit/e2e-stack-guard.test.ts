import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as mailpit from "../e2e/mailpit";
import { countMessagesTo, createMailpitForUnitTest, deleteMessagesTo, waitForMail, waitForMailLink } from "../e2e/mailpit";
import {
  checkContainers,
  checkStackEnv,
  parseStackConfig,
  preflight,
  readStackConfig,
  resolveMailpitBase,
  type PortLookup,
  type StackConfig,
} from "../e2e/stack-guard";

/**
 * MAIL-SAFETY-01: E2E 가 공유 543xx·원격·다른 스택으로 요청을 보내기 "전에" 멈추는지 확인한다.
 * 실제 네트워크는 쓰지 않는다. 가드가 막아야 하는 경우에는 fetch 가 한 번도 불리지 않아야 한다.
 */

const CFG: StackConfig = { projectId: "claude-qa-test", apiPort: 57321, inbucketPort: 57324, siteUrl: "http://127.0.0.1:4500" };
const GOOD = {
  E2E_SUPABASE_PROJECT_ID: "claude-qa-test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:57321",
  E2E_MAILPIT_URL: "http://127.0.0.1:57324/api/v1",
  E2E_BASE_URL: "http://127.0.0.1:4500",
};
const TOML = `
# 주석
project_id = "claude-qa-test"

[api]
enabled = true
port = 57321 # API

[db]
port = 57322

[local_smtp]
enabled = true
port = 57324

[auth]
site_url = "http://127.0.0.1:4500"
`;
const MATCHING: Record<string, number> = { "supabase_kong_claude-qa-test": 57321, "supabase_inbucket_claude-qa-test": 57324 };
const lookupOf = (map: Record<string, number | null>): PortLookup => vi.fn((c: string) => map[c] ?? null);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function failsBeforeNetwork(fn: () => unknown, pattern: RegExp) {
  const spy = vi.spyOn(globalThis, "fetch");
  let error: unknown = null;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  expect(error, "실패해야 함").not.toBeNull();
  expect((error as Error).message).toMatch(pattern);
  expect(spy).not.toHaveBeenCalled();
}

describe("설정 읽기", () => {
  it("project_id·[api].port·[local_smtp].port·[auth].site_url 만 정확히 읽는다", () => {
    expect(parseStackConfig(TOML)).toEqual(CFG);
  });

  it("예전 CLI 의 [inbucket] 절 이름도 읽는다", () => {
    expect(parseStackConfig(TOML.replace("[local_smtp]", "[inbucket]"))).toEqual(CFG);
  });

  it("실제 저장소 설정 파일을 읽는다(공유 정의: marketing-office·54321·54324·3000)", () => {
    expect(readStackConfig()).toEqual({ projectId: "marketing-office", apiPort: 54321, inbucketPort: 54324, siteUrl: "http://127.0.0.1:3000" });
  });

  it("값이 빠지면 실패", () => {
    expect(() => parseStackConfig('project_id = "x"\n[api]\nport = 1\n[inbucket]\nport = 2')).toThrow(/읽지 못했습니다/);
  });

  it("원본 저장소 설정(공유 marketing-office)은 project_id 를 맞춰 줘도 거절", () => {
    const shared = readStackConfig(); // 이 worktree 의 supabase/config.toml = 공유 스택 정의
    expect(shared.projectId).toBe("marketing-office");
    expect(() =>
      checkStackEnv(
        { ...GOOD, E2E_SUPABASE_PROJECT_ID: "marketing-office", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${shared.apiPort}`, E2E_BASE_URL: shared.siteUrl },
        shared,
      ),
    ).toThrow(/공유 스택/);
  });

  it("원본 저장소에서 preflight(=playwright.config 단계)는 시험·webServer 전에 실패한다", () => {
    const lookup = lookupOf({});
    expect(() => preflight({ ...GOOD, E2E_SUPABASE_PROJECT_ID: "marketing-office" }, process.cwd(), lookup)).toThrow(/공유 스택/);
    expect(lookup).not.toHaveBeenCalled(); // 환경 확인에서 먼저 멈춘다
  });
});

describe("주소·프로젝트 확인", () => {
  it("모두 맞으면 메일함 주소와 앱 주소를 돌려준다", () => {
    expect(resolveMailpitBase(GOOD, CFG)).toBe("http://127.0.0.1:57324/api/v1");
    expect(checkStackEnv(GOOD, CFG)).toBe("http://127.0.0.1:4500");
    expect(checkStackEnv({ ...GOOD, NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:4500/" }, CFG)).toBe("http://127.0.0.1:4500");
  });

  it.each([
    ["메일 주소 없음", { E2E_MAILPIT_URL: undefined }, /E2E_MAILPIT_URL 가 없습니다/],
    ["메일 원격 주소", { E2E_MAILPIT_URL: "https://mail.example.com/api/v1" }, /로컬 http/],
    ["메일 공유 포트 54324", { E2E_MAILPIT_URL: "http://127.0.0.1:54324/api/v1" }, /공유 스택 포트/],
    ["메일 설정과 다른 포트", { E2E_MAILPIT_URL: "http://127.0.0.1:57325/api/v1" }, /설정의 포트\(57324\)와 다릅니다/],
    ["메일 경로가 api/v1 아님", { E2E_MAILPIT_URL: "http://127.0.0.1:57324/" }, /api\/v1/],
    ["메일 주소에 자격증명", { E2E_MAILPIT_URL: "http://u:p@127.0.0.1:57324/api/v1" }, /자격증명·query·hash/],
    ["메일 주소에 query", { E2E_MAILPIT_URL: "http://127.0.0.1:57324/api/v1?x=1" }, /자격증명·query·hash/],
    ["메일 주소에 hash", { E2E_MAILPIT_URL: "http://127.0.0.1:57324/api/v1#a" }, /자격증명·query·hash/],
    ["프로젝트 없음", { E2E_SUPABASE_PROJECT_ID: undefined }, /E2E_SUPABASE_PROJECT_ID 가 없습니다/],
    ["프로젝트 불일치", { E2E_SUPABASE_PROJECT_ID: "someone-else" }, /설정\(claude-qa-test\)과 다릅니다/],
    ["공유 프로젝트 이름", { E2E_SUPABASE_PROJECT_ID: "marketing-office" }, /공유 스택/],
    ["API 공유 포트", { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, /공유 스택 포트/],
    ["API 원격", { NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }, /로컬 http/],
    ["API 없음", { NEXT_PUBLIC_SUPABASE_URL: undefined }, /NEXT_PUBLIC_SUPABASE_URL 가 없습니다/],
    ["앱 주소 없음", { E2E_BASE_URL: undefined }, /E2E_BASE_URL 가 없습니다/],
    ["앱 주소가 site_url 과 다른 포트(3000)", { E2E_BASE_URL: "http://127.0.0.1:3000" }, /설정의 포트\(4500\)와 다릅니다/],
    ["앱 주소 호스트가 site_url 과 다름", { E2E_BASE_URL: "http://localhost:4500" }, /auth\.site_url/],
    ["앱 주소에 경로", { E2E_BASE_URL: "http://127.0.0.1:4500/login" }, /경로 없이/],
    ["앱 사이트 주소 불일치", { NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000" }, /NEXT_PUBLIC_SITE_URL/],
  ])("%s → 거절", (_name, patch, pattern) => {
    expect(() => resolveMailpitBase({ ...GOOD, ...patch }, CFG)).toThrow(pattern);
  });

  it("설정 자체가 543xx 포트면 거절", () => {
    expect(() => resolveMailpitBase({ ...GOOD, E2E_MAILPIT_URL: "http://127.0.0.1:54324/api/v1" }, { ...CFG, inbucketPort: 54324 })).toThrow(/543xx|공유/);
  });
});

describe("실제 컨테이너 대조(포트 차이만으로 소유를 인정하지 않음)", () => {
  it("그 project_id 의 kong·inbucket 컨테이너가 설정 포트를 열고 있으면 통과", () => {
    const lookup = lookupOf(MATCHING);
    checkContainers(CFG, lookup);
    expect(lookup).toHaveBeenCalledWith("supabase_kong_claude-qa-test", "8000/tcp");
    expect(lookup).toHaveBeenCalledWith("supabase_inbucket_claude-qa-test", "8025/tcp");
  });

  it("컨테이너가 없으면(꺼짐·다른 스택) 거절", () => {
    expect(() => checkContainers(CFG, lookupOf({}))).toThrow(/찾지 못했습니다/);
  });

  it("컨테이너가 다른 포트를 열고 있으면 거절", () => {
    expect(() => checkContainers(CFG, lookupOf({ ...MATCHING, "supabase_inbucket_claude-qa-test": 54324 }))).toThrow(/설정\(57324\)과 다릅니다/);
  });

  it("preflight: 임시 설정 폴더 + 맞는 컨테이너면 통과, 하나라도 틀리면 실패", () => {
    const dir = mkdtempSync(join(tmpdir(), "stack-guard-"));
    mkdirSync(join(dir, "supabase"));
    writeFileSync(join(dir, "supabase", "config.toml"), TOML);
    expect(preflight(GOOD, dir, lookupOf(MATCHING))).toEqual({ config: CFG, baseURL: "http://127.0.0.1:4500", mailpitBase: "http://127.0.0.1:57324/api/v1" });
    expect(() => preflight(GOOD, dir, lookupOf({}))).toThrow(/찾지 못했습니다/);
    expect(() => preflight({ ...GOOD, E2E_MAILPIT_URL: undefined }, dir, lookupOf(MATCHING))).toThrow(/E2E_MAILPIT_URL/);
    expect(() => preflight({ ...GOOD, E2E_BASE_URL: "http://127.0.0.1:3000" }, dir, lookupOf(MATCHING))).toThrow(/E2E_BASE_URL/);
  });
});

describe("시험이 쓰는 메일함 함수: 가드를 통과하지 못하면 fetch 0회", () => {
  const calls: Array<() => unknown> = [
    () => countMessagesTo("a@x.test"),
    () => waitForMail("a@x.test", 10),
    () => waitForMailLink("a@x.test", 10),
    () => deleteMessagesTo(["a@x.test"]),
  ];

  it("E2E_MAILPIT_URL 이 없으면 네 함수 모두 요청 전에 실패", async () => {
    vi.stubEnv("E2E_SUPABASE_PROJECT_ID", "claude-qa-test");
    vi.stubEnv("E2E_MAILPIT_URL", undefined as unknown as string);
    for (const call of calls) await failsBeforeNetwork(call, /E2E_MAILPIT_URL|공유 스택/);
  });

  it("공유 기본값(54324·54321)을 직접 줘도 요청 전에 실패", async () => {
    vi.stubEnv("E2E_SUPABASE_PROJECT_ID", "claude-qa-test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("E2E_MAILPIT_URL", "http://127.0.0.1:54324/api/v1");
    for (const call of calls) await failsBeforeNetwork(call, /공유/);
  });

  it("원격 주소면 요청 전에 실패", async () => {
    vi.stubEnv("E2E_SUPABASE_PROJECT_ID", "claude-qa-test");
    vi.stubEnv("E2E_MAILPIT_URL", "https://mail.example.com/api/v1");
    for (const call of calls) await failsBeforeNetwork(call, /공유|로컬 http/);
  });

  it("모듈이 내보내는 것: 전체 삭제 함수 없음, 직접 생성 함수는 단위 시험 전용 이름", () => {
    expect(Object.keys(mailpit).sort()).toEqual(["countMessagesTo", "createMailpitForUnitTest", "deleteMessagesTo", "waitForMail", "waitForMailLink"]);
  });
});

describe("수신자별 정리(전체 삭제 없음, 받는 사람 정확 일치)", () => {
  type Call = { url: string; method: string; body?: string };
  type Msg = { ID: string; To: string[] };
  const BASE = "http://127.0.0.1:57324/api/v1";
  /** 검색어와 상관없이 주어진 메시지를 돌려주는 가짜 Mailpit(검색이 부정확해도 클라이언트가 다시 거르는지 본다) */
  function fakeFetch(messages: Msg[]) {
    const calls: Call[] = [];
    const impl = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body });
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: messages.map((m) => ({ ID: m.ID, Created: "", Subject: "", To: m.To.map((Address) => ({ Address })) })) }),
      };
    });
    return { calls, impl };
  }
  const deletes = (calls: Call[]) => calls.filter((c) => c.method === "DELETE");

  it("지울 메시지가 없으면 DELETE 를 보내지 않는다(빈 ID 목록 = 전체 삭제 방지)", async () => {
    const f = fakeFetch([]);
    expect(await createMailpitForUnitTest(BASE, f.impl).deleteMessagesTo(["a@x.test", "b@x.test"])).toBe(0);
    expect(f.calls.map((c) => c.method)).toEqual(["GET", "GET"]);
  });

  it("받는 사람이 정확히 그 주소 하나인 메시지만 지운다(다른 사람·여러 수신자·부분 일치는 남김)", async () => {
    const f = fakeFetch([
      { ID: "m1", To: ["a@x.test"] }, // 지움
      { ID: "m2", To: ["A@X.test"] }, // 대소문자만 다름 → 지움
      { ID: "m3", To: ["a@x.test", "other@x.test"] }, // 다른 사람과 함께 → 남김
      { ID: "m4", To: ["xa@x.test"] }, // 부분 일치 → 남김
      { ID: "m5", To: ["other@x.test"] }, // 남의 메일 → 남김
    ]);
    expect(await createMailpitForUnitTest(BASE, f.impl).deleteMessagesTo(["a@x.test"])).toBe(2);
    const del = deletes(f.calls);
    expect(del).toHaveLength(1);
    expect(del[0]!.url).toBe(`${BASE}/messages`);
    expect(JSON.parse(del[0]!.body!)).toEqual({ IDs: ["m1", "m2"] });
  });

  it("ID 가 비었거나 형식이 이상하면 지우지 않는다", async () => {
    const f = fakeFetch([
      { ID: "", To: ["a@x.test"] },
      { ID: "../all", To: ["a@x.test"] },
      { ID: "x y", To: ["a@x.test"] },
    ]);
    expect(await createMailpitForUnitTest(BASE, f.impl).deleteMessagesTo(["a@x.test"])).toBe(0);
    expect(deletes(f.calls)).toHaveLength(0);
  });

  it("세기·기다리기도 받는 사람 정확 일치만 본다", async () => {
    const f = fakeFetch([
      { ID: "m1", To: ["xa@x.test"] },
      { ID: "m2", To: ["a@x.test", "b@x.test"] },
    ]);
    expect(await createMailpitForUnitTest(BASE, f.impl).countMessagesTo("a@x.test")).toBe(1);
  });

  it.each([['a"@x.test'], ["a@x.test to:other"], [""], ["a@x"], ["a@x.test)"]])("이상한 수신자(%j)는 요청 없이 거절(검색어 탈출 방지)", async (bad) => {
    const f = fakeFetch([{ ID: "m1", To: ["a@x.test"] }]);
    const mp = createMailpitForUnitTest(BASE, f.impl);
    await expect(mp.deleteMessagesTo([bad])).rejects.toThrow(/메일 주소 형식/);
    await expect(mp.countMessagesTo(bad)).rejects.toThrow(/메일 주소 형식/);
    expect(f.calls).toHaveLength(0);
  });

  it("수신자 없이 정리를 부르면 요청 없이 실패(전체 삭제 경로 없음)", async () => {
    const f = fakeFetch([]);
    await expect(createMailpitForUnitTest(BASE, f.impl).deleteMessagesTo([])).rejects.toThrow(/전체 삭제는 하지 않습니다/);
    expect(f.calls).toHaveLength(0);
  });
});
