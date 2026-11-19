import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefCopyRequest } from "@/domain/brief";

/**
 * DEC08-AI-COPY-01 서버 흐름(가짜 호출기·흉내 DB). 실제 외부 호출은 하지 않는다.
 * DB 규칙(한도·검사·권한)은 tests/db/p2-brief-ai.test.ts 가 맡는다.
 */
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const st = vi.hoisted(() => ({
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  reserve: { data: [{ run_id: "run-1", reused: false }], error: null } as { data: unknown; error: unknown },
  prevVariants: [{ text: "이전 문구", usedClaimIds: [] }] as unknown,
  detail: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("./server", () => ({ getContentBrief: async () => structuredClone(st.detail) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      st.rpc.push({ fn, args });
      if (fn === "reserve_brief_copy_run") return st.reserve;
      if (fn === "accept_brief_copy") return { data: 7, error: null };
      return { data: null, error: null };
    },
    from: () => {
      const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: { variants: st.prevVariants }, error: null }) };
      return chain;
    },
  }),
}));

const { generateBriefCopy, acceptBriefCopy, isBriefCopyAiEnabled, anthropicCaller, BRIEF_COPY_DISABLED_MESSAGE } = await import("./ai-copy");

const DETAIL = {
  brief: {
    id: "b1", funnelItemId: "i1", stageLabel: "인지", channel: "instagram", title: "합성 브리프", audience: "합성 타깃", hook: null,
    coreMessage: "핵심 요지", cta: "무료 진단", channelSpec: { format: "carousel" }, copyDraft: null, copyOrigin: "manual",
    imageGuide: null, status: "drafting", revision: 3, archived: false, stale: false,
  },
  claims: [
    { id: C1, text: "고객 만족도 92% 조사", kind: "statistic", revision: 1, sources: [], sourceRows: [{ id: "s1", kind: "asset", label: "자료 · 2026 고객 조사.pdf", note: "비공개 메모" }] },
    { id: C2, text: "근거 없는 주장", kind: "other", revision: 1, sources: [], sourceRows: [] },
  ],
  warnings: [],
  options: { profile: null, assets: [], research: [] },
  markdown: "",
};
const finishOf = () => st.rpc.find((r) => r.fn === "finish_brief_copy_run")?.args;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls 의 형을 정하려고 인자를 둔다
const okCaller = (output: unknown) => vi.fn(async (_req: BriefCopyRequest) => ({ kind: "ok" as const, output, model: "claude-sonnet-5-5", inputTokens: 3000, outputTokens: 5000 }));

beforeEach(() => {
  st.rpc.length = 0;
  st.reserve = { data: [{ run_id: "run-1", reused: false }], error: null };
  st.detail = structuredClone(DETAIL);
});
afterEach(() => vi.unstubAllEnvs());

describe("켜짐·꺼짐", () => {
  it("키가 없으면 꺼짐: 화면용 false, 생성은 외부 호출·DB 기록 없이 거절", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(isBriefCopyAiEnabled()).toBe(false);
    expect(await generateBriefCopy("t1", "b1", 3)).toEqual({ ok: false, code: "VALIDATION", message: BRIEF_COPY_DISABLED_MESSAGE });
    expect(st.rpc).toEqual([]);
    vi.stubEnv("ANTHROPIC_API_KEY", "  sk-synthetic  ");
    expect(isBriefCopyAiEnabled()).toBe(true);
  });
});

describe("생성 흐름", () => {
  it("성공: 근거 있는 주장만·근거 이름만 보내고, 예약 → 호출 → 계약 검사 → 성공 마감(비용 계산)", async () => {
    const caller = okCaller({ variants: [{ text: "만족도 92%의 이유", usedClaimIds: [C1] }, { text: "지금 무료 진단", usedClaimIds: [] }] });
    const r = await generateBriefCopy("t1", "b1", 3, {}, caller);
    expect(r).toEqual({ ok: true, data: { runId: "run-1", reused: false, variants: [{ text: "만족도 92%의 이유", usedClaimIds: [C1] }, { text: "지금 무료 진단", usedClaimIds: [] }] } });
    // 외부로 나간 요청: 근거 없는 주장(C2)·근거 메모·근거 id 는 없다
    const req = caller.mock.calls[0][0];
    expect(req.claims).toEqual([{ id: C1, text: "고객 만족도 92% 조사", sourceLabels: ["자료 · 2026 고객 조사.pdf"] }]);
    expect(JSON.stringify(req)).not.toContain("비공개 메모");
    expect(req.constraints).toEqual({ language: "ko", maxChars: 600, variants: 2 });
    const reserve = st.rpc[0];
    expect(reserve.fn).toBe("reserve_brief_copy_run");
    expect(reserve.args).toMatchObject({ p_brief_id: "b1", p_expected_revision: 3, p_model: "claude-sonnet-5-5", p_claim_ids: [C1] });
    expect(reserve.args.p_input_hash).toMatch(/^[0-9a-f]{64}$/);
    // 같은 입력이면 같은 확인값(재사용 판단용)
    st.rpc.length = 0;
    await generateBriefCopy("t1", "b1", 3, {}, okCaller({ variants: [{ text: "x", usedClaimIds: [] }] }));
    expect(st.rpc[0].args.p_input_hash).toBe(reserve.args.p_input_hash);
  });

  it("성공 마감 인자: 변형·토큰·비용(3000×2 + 5000×10 = 56,000 마이크로달러)", async () => {
    await generateBriefCopy("t1", "b1", 3, { variants: 1 }, okCaller({ variants: [{ text: "문구", usedClaimIds: [C1] }] }));
    expect(finishOf()).toEqual({
      p_run_id: "run-1", p_status: "succeeded", p_variants: [{ text: "문구", usedClaimIds: [C1] }], p_problems: null, p_error_code: null,
      p_input_tokens: 3000, p_output_tokens: 5000, p_cost_usd_micro: 56000,
    });
  });

  it("재사용: 예약이 reused 면 외부 호출 없이 저장된 변형을 돌려준다", async () => {
    st.reserve = { data: [{ run_id: "run-0", reused: true }], error: null };
    const caller = okCaller({ variants: [] });
    expect(await generateBriefCopy("t1", "b1", 3, {}, caller)).toEqual({ ok: true, data: { runId: "run-0", reused: true, variants: st.prevVariants } });
    expect(caller).not.toHaveBeenCalled();
    expect(finishOf()).toBeUndefined();
  });

  it("계약 검사 탈락(요청에 없는 수치·보내지 않은 주장): 변형 없이 rejected 마감, 문제 목록 기록", async () => {
    const r = await generateBriefCopy("t1", "b1", 3, {}, okCaller({ variants: [{ text: "할인율 50%", usedClaimIds: [C2] }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/AI 결과가 검사를 통과하지 못했습니다/);
    const f = finishOf()!;
    expect(f.p_status).toBe("rejected");
    expect(f.p_variants).toBeNull();
    expect(f.p_problems).toEqual(expect.arrayContaining(["1번 변형이 근거 없는 주장을 썼습니다.", "1번 변형에 근거 없는 수치가 있습니다: 50%"]));
  });

  it("거절(refusal): refused 마감·비용 기록, 실패(시간 초과): failed 마감·사용량 없으면 비용 0", async () => {
    const refused = vi.fn(async () => ({ kind: "refused" as const, model: "claude-sonnet-5-5", inputTokens: 100, outputTokens: 0 }));
    expect((await generateBriefCopy("t1", "b1", 3, {}, refused)).ok).toBe(false);
    expect(finishOf()).toMatchObject({ p_status: "refused", p_cost_usd_micro: 200, p_variants: null });
    st.rpc.length = 0;
    const timeout = vi.fn(async () => ({ kind: "error" as const, code: "TIMEOUT" }));
    const r = await generateBriefCopy("t1", "b1", 3, {}, timeout);
    expect(r).toEqual({ ok: false, code: "ERROR", message: "AI 응답이 늦어 멈췄습니다. 잠시 후 다시 시도해 주세요." });
    expect(finishOf()).toMatchObject({ p_status: "failed", p_error_code: "TIMEOUT", p_cost_usd_micro: 0, p_input_tokens: 0 });
  });

  it("revision 이 다르거나 보관이면 예약 전에 거절, 한도 오류는 DB 문구 그대로", async () => {
    expect((await generateBriefCopy("t1", "b1", 2, {}, okCaller({}))).ok).toBe(false);
    (st.detail as typeof DETAIL).brief.archived = true;
    expect(await generateBriefCopy("t1", "b1", 3, {}, okCaller({}))).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(st.rpc).toEqual([]);
    st.detail = structuredClone(DETAIL);
    st.reserve = { data: null, error: { code: "P0001", message: "RATE_LIMITED: 같은 브리프는 1분에 한 번만 만들 수 있습니다. 잠시 뒤 다시 시도해 주세요" } };
    const caller = okCaller({});
    expect(await generateBriefCopy("t1", "b1", 3, {}, caller)).toEqual({
      ok: false, code: "VALIDATION", message: "같은 브리프는 1분에 한 번만 만들 수 있습니다. 잠시 뒤 다시 시도해 주세요.",
    });
    expect(caller).not.toHaveBeenCalled();
  });

  it("채택: accept_brief_copy 를 부르고 새 revision", async () => {
    expect(await acceptBriefCopy("run-1", 2, 3)).toEqual({ ok: true, data: { revision: 7 } });
    expect(st.rpc).toEqual([{ fn: "accept_brief_copy", args: { p_run_id: "run-1", p_variant: 2, p_expected_revision: 3 } }]);
  });
});

describe("실제 호출기(Anthropic SDK) 요청 모양 — 네트워크 없음", () => {
  const REQ = {
    channel: "blog", title: "제목", audience: null, hook: null, coreMessage: null, cta: null, channelSpec: {},
    claims: [{ id: C1, text: "주장", sourceLabels: ["자료 · A"] }], constraints: { language: "ko", maxChars: 200, variants: 1 },
  } as BriefCopyRequest;
  const reply = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_synthetic" } });
  const message = (o: { stop?: string; text?: string; model?: string }) => ({
    id: "msg_synthetic", type: "message", role: "assistant", model: o.model ?? "claude-sonnet-5-5",
    content: o.text === undefined ? [] : [{ type: "text", text: o.text }], stop_reason: o.stop ?? "end_turn", stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: null, cache_read_input_tokens: 100 },
  });

  it("모델·베타(대체 모델 default)·구조화 출력·지시문·사용자 메시지(JSON)·키 헤더, 성공 응답 해석", async () => {
    const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const fake = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return reply(message({ text: JSON.stringify({ variants: [{ text: "문구", usedClaimIds: [C1] }] }) }));
    }) as typeof fetch;
    const r = await anthropicCaller("sk-synthetic", fake)(REQ);
    expect(r).toEqual({ kind: "ok", output: { variants: [{ text: "문구", usedClaimIds: [C1] }] }, model: "claude-sonnet-5-5", inputTokens: 1300, outputTokens: 300 });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toMatch(/\/v1\/messages(\?|$)/);
    // SDK 판에 따라 x-api-key 또는 authorization 으로 보낸다
    expect(seen[0].headers.get("x-api-key") ?? seen[0].headers.get("authorization") ?? "").toContain("sk-synthetic");
    expect(seen[0].headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    const b = seen[0].body;
    expect(b).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 16000, fallbacks: "default", output_config: { effort: "low", format: { type: "json_schema" } } });
    expect(b).not.toHaveProperty("thinking");
    expect(b).not.toHaveProperty("temperature");
    expect(typeof b.system).toBe("string");
    expect(b.messages).toEqual([{ role: "user", content: JSON.stringify(REQ) }]);
  });

  it("refusal → refused, max_tokens → error, JSON 아님 → BAD_JSON, 401 → AUTH(재시도 없음)", async () => {
    const one = (res: () => Response) => anthropicCaller("sk-synthetic", (async () => res()) as typeof fetch)(REQ);
    expect(await one(() => reply(message({ stop: "refusal" })))).toMatchObject({ kind: "refused", inputTokens: 1300 });
    expect(await one(() => reply(message({ stop: "max_tokens", text: "{" })))).toMatchObject({ kind: "error", code: "MAX_TOKENS" });
    expect(await one(() => reply(message({ text: "그냥 글" })))).toMatchObject({ kind: "error", code: "BAD_JSON" });
    let calls = 0;
    const auth = await anthropicCaller("sk-synthetic", (async () => {
      calls++;
      return reply({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401);
    }) as typeof fetch)(REQ);
    expect(auth).toEqual({ kind: "error", code: "AUTH" });
    expect(calls).toBe(1);
  });
});
