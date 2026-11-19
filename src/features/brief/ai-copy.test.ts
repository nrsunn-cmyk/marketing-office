import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefCopyRequest } from "@/domain/brief";

/**
 * DEC08-AI-COPY-01 + R1 서버 흐름(가짜 호출기·가짜 fetch·흉내 DB). 실제 외부 호출은 하지 않는다.
 * DB 규칙(한도·모델 허용·권한)은 tests/db/p2-brief-ai.test.ts 가 맡는다.
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

const { generateBriefCopy, acceptBriefCopy, isBriefCopyAiEnabled, listBriefCopyChoices, anthropicCaller, openaiCaller, geminiCaller, BRIEF_COPY_DISABLED_MESSAGE, BRIEF_COPY_MISCONFIGURED_MESSAGE } =
  await import("./ai-copy");
const SIGN_KEY = "synthetic-signing-key-0123456789abcdef";
const hmac = (purpose: string, message: string) => createHmac("sha256", SIGN_KEY).update(`${purpose}|${message}`, "utf8").digest("hex");

const DETAIL = {
  brief: {
    id: "b1", funnelItemId: "i1", stageLabel: "인지", channel: "instagram", title: "합성 브리프", audience: "합성 타깃", hook: null,
    coreMessage: "핵심 요지", cta: "무료 진단", channelSpec: { format: "carousel" }, copyDraft: null, copyOrigin: "manual", copyOriginAi: false,
    imageGuide: null, status: "drafting", revision: 3, archived: false, stale: false,
  },
  claims: [
    {
      id: C1, text: "고객 만족도 92% 조사", kind: "statistic", revision: 1, sources: [],
      sourceRows: [
        { id: "s1", kind: "asset", label: "자료 · 2026 고객 조사.pdf", aiLabel: "파일 · 2026 고객 조사.pdf", note: "비공개 메모" },
        { id: "s2", kind: "asset", label: "자료 · 김철수 010-1234-5678 견적 300만원", aiLabel: "메모 자료 1", note: null },
        { id: "s3", kind: "asset", label: "자료 · https://example.com/p?utm_source=x&email=a@b.c", aiLabel: "링크 · example.com", note: null },
      ],
    },
    { id: C2, text: "근거 없는 주장", kind: "other", revision: 1, sources: [], sourceRows: [] },
  ],
  warnings: [],
  options: { profile: null, assets: [], research: [] },
  markdown: "",
};
const REQ = {
  channel: "blog", title: "제목", audience: null, hook: null, coreMessage: null, cta: null, channelSpec: {},
  claims: [{ id: C1, text: "주장", sourceLabels: ["자료 · A"] }], constraints: { language: "ko", maxChars: 200, variants: 1 },
} as BriefCopyRequest;
const OUT = { variants: [{ text: "문구", usedClaimIds: [C1] }] };
const finishOf = () => st.rpc.find((r) => r.fn === "finish_brief_copy_run")?.args;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls 의 형을 정하려고 인자를 둔다
const okCaller = (output: unknown) => vi.fn(async (_req: BriefCopyRequest) => ({ kind: "ok" as const, output, model: "claude-sonnet-5-5", inputTokens: 3000, outputTokens: 5000 }));
const keys = (o: { anthropic?: string; openai?: string; google?: string; signing?: string }) => {
  vi.stubEnv("BRIEF_COPY_SIGNING_KEY", o.signing ?? SIGN_KEY);
  vi.stubEnv("ANTHROPIC_API_KEY", o.anthropic ?? "");
  vi.stubEnv("OPENAI_API_KEY", o.openai ?? "");
  vi.stubEnv("GEMINI_API_KEY", o.google ?? "");
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_synthetic" } });
type Seen = { url: string; headers: Headers; body: Record<string, unknown> };
const recorder = (responses: Array<() => Response | Promise<Response>>) => {
  const seen: Seen[] = [];
  let i = 0;
  const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const r = responses[Math.min(i++, responses.length - 1)];
    return r();
  }) as typeof fetch;
  return { f, seen };
};

beforeEach(() => {
  vi.stubEnv("BRIEF_COPY_SIGNING_KEY", SIGN_KEY);
  st.rpc.length = 0;
  st.reserve = { data: [{ run_id: "run-1", reused: false }], error: null };
  st.detail = structuredClone(DETAIL);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("켜짐·꺼짐·선택지", () => {
  it("키가 하나도 없으면 꺼짐: 선택지 없음, 생성은 외부 호출·DB 기록 없이 거절", async () => {
    keys({});
    expect(isBriefCopyAiEnabled()).toBe(false);
    expect(listBriefCopyChoices()).toEqual([]);
    expect(await generateBriefCopy("t1", "b1", 3)).toEqual({ ok: false, code: "VALIDATION", message: BRIEF_COPY_DISABLED_MESSAGE });
    expect(st.rpc).toEqual([]);
  });

  it("서명 키(BRIEF_COPY_SIGNING_KEY)가 없으면 공급자 키가 있어도 꺼짐", async () => {
    keys({ anthropic: "sk-synthetic", signing: "" });
    expect(isBriefCopyAiEnabled()).toBe(false);
    expect(listBriefCopyChoices()).toEqual([]);
    expect(await generateBriefCopy("t1", "b1", 3)).toMatchObject({ ok: false, message: BRIEF_COPY_DISABLED_MESSAGE });
    expect(st.rpc).toEqual([]);
  });

  it("키가 있는 공급자만 선택지(모델·요금·기본 표시), 키 값은 내보내지 않음", () => {
    keys({ openai: " sk-synthetic-openai ", google: "g-synthetic" });
    expect(isBriefCopyAiEnabled()).toBe(true);
    const c = listBriefCopyChoices();
    expect(c.map((x) => x.provider)).toEqual(["openai", "google"]);
    expect(c[0]).toEqual({
      provider: "openai",
      label: "ChatGPT (OpenAI)",
      models: [
        { id: "gpt-6.2-sol", label: "GPT-6.2 Sol", note: "균형(추천)", inputUsd: 2, outputUsd: 10, isDefault: true },
        { id: "gpt-6-luna", label: "GPT-6 Luna", note: "가장 저렴·빠름", inputUsd: 0.1, outputUsd: 0.5 },
        { id: "gpt-6.2-astra", label: "GPT-6.2 Astra", note: "최고급·가장 비쌈", inputUsd: 8, outputUsd: 40 },
      ],
    });
    expect(JSON.stringify(c)).not.toContain("synthetic");
  });

  it("고르기: 키 없는 공급자·목록 밖 공급자·목록 밖 모델·섞인 조합은 예약 전에 거절", async () => {
    keys({ openai: "sk-synthetic" });
    expect(await generateBriefCopy("t1", "b1", 3, { provider: "anthropic" })).toMatchObject({ ok: false, message: expect.stringMatching(/Claude \(Anthropic\)는 아직 켜져 있지 않습니다/) });
    expect(await generateBriefCopy("t1", "b1", 3, { provider: "mistral" })).toMatchObject({ ok: false, message: "고를 수 없는 AI 플랫폼입니다." });
    expect(await generateBriefCopy("t1", "b1", 3, { provider: "openai", model: "gpt-4o" })).toMatchObject({ ok: false, message: "고를 수 없는 AI 모델입니다." });
    expect(await generateBriefCopy("t1", "b1", 3, { provider: "openai", model: "claude-sonnet-5-5" })).toMatchObject({ ok: false, message: "고를 수 없는 AI 모델입니다." });
    expect(st.rpc).toEqual([]);
  });
});

describe("생성 흐름(공급자 공통)", () => {
  it("성공: 근거 있는 주장·근거 이름만 보내고, 예약(공급자·모델) → 호출 → 계약 검사 → 성공 마감", async () => {
    const caller = okCaller({ variants: [{ text: "만족도 92%의 이유", usedClaimIds: [C1] }, { text: "지금 무료 진단", usedClaimIds: [] }] });
    const r = await generateBriefCopy("t1", "b1", 3, {}, caller);
    expect(r).toEqual({
      ok: true,
      data: { runId: "run-1", provider: "anthropic", model: "claude-sonnet-5-5", reused: false, variants: [{ text: "만족도 92%의 이유", usedClaimIds: [C1] }, { text: "지금 무료 진단", usedClaimIds: [] }] },
    });
    const req = caller.mock.calls[0][0];
    // R2 D3·O5: 근거 이름은 전송용 이름만(메모 원문·전체 주소·근거 메모 없음)
    expect(req.claims).toEqual([{ id: C1, text: "고객 만족도 92% 조사", sourceLabels: ["파일 · 2026 고객 조사.pdf", "메모 자료 1", "링크 · example.com"] }]);
    for (const leak of ["비공개 메모", "김철수", "010-1234", "300만원", "utm_source", "a@b.c"]) expect(JSON.stringify(req)).not.toContain(leak);
    expect(req.constraints).toEqual({ language: "ko", maxChars: 600, variants: 2 });
    expect(st.rpc[0]).toMatchObject({ fn: "reserve_brief_copy_run", args: { p_brief_id: "b1", p_expected_revision: 3, p_provider: "anthropic", p_model: "claude-sonnet-5-5", p_claim_ids: [C1] } });
    const h1 = st.rpc[0].args.p_input_hash;
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    // R2 D1: 예약 서명 = HMAC(서명 키, reserve|브리프|revision|확인값|공급자|모델|주장id|서명시각)
    const a = st.rpc[0].args;
    expect(a.p_signature).toBe(hmac("reserve", ["b1", 3, h1, "anthropic", "claude-sonnet-5-5", C1, a.p_signed_at].join("|")));
    expect(Math.abs(Date.now() - (a.p_signed_at as number))).toBeLessThan(10_000);
    // 같은 입력·다른 모델이면 확인값이 다르다(재사용은 같은 모델만)
    st.rpc.length = 0;
    await generateBriefCopy("t1", "b1", 3, { provider: "openai", model: "gpt-6-luna" }, okCaller(OUT));
    expect(st.rpc[0].args).toMatchObject({ p_provider: "openai", p_model: "gpt-6-luna" });
    expect(st.rpc[0].args.p_input_hash).not.toBe(h1);
  });

  it("마감 인자: 변형·토큰·비용은 고른 모델 요금(Sonnet 3000×2 + 5000×10 = 56,000)", async () => {
    await generateBriefCopy("t1", "b1", 3, { variants: 1 }, okCaller({ variants: [{ text: "문구", usedClaimIds: [C1] }] }));
    const vt = JSON.stringify([{ text: "문구", usedClaimIds: [C1] }]);
    expect(finishOf()).toEqual({
      p_run_id: "run-1", p_status: "succeeded", p_variants: vt, p_problems: null, p_error_code: null,
      p_input_tokens: 3000, p_output_tokens: 5000, p_cost_usd_micro: 56000,
      p_signature: hmac("finish", ["run-1", "succeeded", vt, "", "", 3000, 5000, 56000].join("|")),
    });
  });

  it("재사용: 예약이 reused 면 외부 호출 없이 저장된 변형", async () => {
    st.reserve = { data: [{ run_id: "run-0", reused: true }], error: null };
    const caller = okCaller({ variants: [] });
    expect(await generateBriefCopy("t1", "b1", 3, {}, caller)).toEqual({ ok: true, data: { runId: "run-0", provider: "anthropic", model: "claude-sonnet-5-5", reused: true, variants: st.prevVariants } });
    expect(caller).not.toHaveBeenCalled();
  });

  it("계약 검사 탈락: rejected 마감·문제 목록", async () => {
    const r = await generateBriefCopy("t1", "b1", 3, {}, okCaller({ variants: [{ text: "할인율 50%", usedClaimIds: [C2] }] }));
    expect(r.ok).toBe(false);
    expect(finishOf()).toMatchObject({ p_status: "rejected", p_variants: null });
    expect(JSON.parse(finishOf()!.p_problems as string)).toEqual(expect.arrayContaining(["1번 변형이 근거 없는 주장을 썼습니다.", "1번 변형에 근거 없는 수치가 있습니다: 50%"]));
  });

  it("거절·시간 초과·키 오류 문구, revision·보관·한도", async () => {
    expect((await generateBriefCopy("t1", "b1", 3, {}, vi.fn(async () => ({ kind: "refused" as const, model: "claude-sonnet-5-5", inputTokens: 100, outputTokens: 0 })))).ok).toBe(false);
    expect(finishOf()).toMatchObject({ p_status: "refused", p_cost_usd_micro: 200 });
    st.rpc.length = 0;
    expect(await generateBriefCopy("t1", "b1", 3, {}, vi.fn(async () => ({ kind: "error" as const, code: "TIMEOUT" })))).toEqual({ ok: false, code: "ERROR", message: "AI 응답이 늦어 멈췄습니다. 잠시 후 다시 시도해 주세요." });
    // R2 O1: 사용량을 모르는 시간 초과는 예약 추정치(Sonnet 12,000×2 + 20,000×10)로 기록한다
    expect(finishOf()).toMatchObject({ p_status: "failed", p_error_code: "TIMEOUT", p_cost_usd_micro: 224000 });
    st.rpc.length = 0;
    await generateBriefCopy("t1", "b1", 3, { provider: "openai", model: "gpt-6-luna" }, vi.fn(async () => ({ kind: "error" as const, code: "AUTH" })));
    expect(finishOf()).toMatchObject({ p_status: "failed", p_error_code: "AUTH", p_cost_usd_micro: 0 });
    expect(await generateBriefCopy("t1", "b1", 3, { provider: "google" }, vi.fn(async () => ({ kind: "error" as const, code: "AUTH" })))).toMatchObject({ message: expect.stringMatching(/Gemini \(Google\) 키가 올바르지 않거나/) });
    st.rpc.length = 0;
    expect((await generateBriefCopy("t1", "b1", 2, {}, okCaller({}))).ok).toBe(false);
    (st.detail as typeof DETAIL).brief.archived = true;
    expect(await generateBriefCopy("t1", "b1", 3, {}, okCaller({}))).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(st.rpc).toEqual([]);
    st.detail = structuredClone(DETAIL);
    st.reserve = { data: null, error: { code: "P0001", message: "BUDGET_EXCEEDED: 이번 달 AI 문구 생성 비용 상한에 닿았습니다. 다음 달에 다시 쓸 수 있습니다" } };
    expect(await generateBriefCopy("t1", "b1", 3, {}, okCaller({}))).toEqual({ ok: false, code: "VALIDATION", message: "이번 달 AI 문구 생성 비용 상한에 닿았습니다. 다음 달에 다시 쓸 수 있습니다." });
    // 서명 키가 DB 와 다르거나 DB 에 없으면 외부 호출 전에 설정 오류 문구
    for (const message of ["BAD_SIGNATURE: 서버 서명이 맞지 않습니다", "NOT_CONFIGURED: AI 문구 만들기 서명 키가 DB 에 없습니다"]) {
      st.reserve = { data: null, error: { code: "42501", message } };
      const caller = okCaller({});
      expect(await generateBriefCopy("t1", "b1", 3, {}, caller)).toEqual({ ok: false, code: "ERROR", message: BRIEF_COPY_MISCONFIGURED_MESSAGE });
      expect(caller).not.toHaveBeenCalled();
    }
  });

  it("키만 있고 호출기를 안 주면 그 공급자의 실제 호출기(fetch)를 쓴다 — OpenAI 기본 모델로 끝까지", async () => {
    keys({ openai: "sk-synthetic" });
    const { f, seen } = recorder([() => reply({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(OUT) }] }], usage: { input_tokens: 1000, output_tokens: 200 } })]);
    vi.stubGlobal("fetch", f);
    const r = await generateBriefCopy("t1", "b1", 3);
    expect(r).toMatchObject({ ok: true, data: { provider: "openai", model: "gpt-6.2-sol", variants: OUT.variants } });
    expect(seen[0].url).toBe("https://api.openai.com/v1/responses");
    expect(finishOf()).toMatchObject({ p_status: "succeeded", p_input_tokens: 1000, p_output_tokens: 200, p_cost_usd_micro: 1000 * 2 + 200 * 10 });
  });

  it("채택: accept_brief_copy 를 부르고 새 revision", async () => {
    expect(await acceptBriefCopy("run-1", 2, 3)).toEqual({ ok: true, data: { revision: 7 } });
    expect(st.rpc).toEqual([{ fn: "accept_brief_copy", args: { p_run_id: "run-1", p_variant: 2, p_expected_revision: 3 } }]);
  });
});

describe("Anthropic 호출기(공식 SDK) — 가짜 fetch", () => {
  const message = (o: { stop?: string; text?: string }) => ({
    id: "msg_synthetic", type: "message", role: "assistant", model: "claude-sonnet-5-5",
    content: o.text === undefined ? [] : [{ type: "text", text: o.text }], stop_reason: o.stop ?? "end_turn", stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: null, cache_read_input_tokens: 100 },
  });

  it("요청 모양(모델·대체 모델 default·구조화 출력·effort low·지시문·키), 성공 해석", async () => {
    const { f, seen } = recorder([() => reply(message({ text: JSON.stringify(OUT) }))]);
    expect(await anthropicCaller("sk-synthetic", "claude-haiku-5-5", f)(REQ)).toEqual({ kind: "ok", output: OUT, model: "claude-sonnet-5-5", inputTokens: 1300, outputTokens: 300 });
    expect(seen[0].url).toMatch(/\/v1\/messages(\?|$)/);
    // SDK 판에 따라 x-api-key 또는 authorization 으로 보낸다
    expect(seen[0].headers.get("x-api-key") ?? seen[0].headers.get("authorization") ?? "").toContain("sk-synthetic");
    // R2 O2: Haiku 5.5 에는 서버 쪽 대체 모델이 없어 보내지 않는다
    expect(seen[0].headers.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
    expect(seen[0].body).not.toHaveProperty("fallbacks");
    expect(seen[0].body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 16000, output_config: { effort: "low", format: { type: "json_schema" } } });
    const s2 = recorder([() => reply(message({ text: JSON.stringify(OUT) }))]);
    await anthropicCaller("sk-synthetic", "claude-sonnet-5-5", s2.f)(REQ);
    expect(s2.seen[0].headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(s2.seen[0].body).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default" });
    expect(seen[0].body).not.toHaveProperty("thinking");
    expect(seen[0].body.messages).toEqual([{ role: "user", content: JSON.stringify(REQ) }]);
  });

  it("refusal → refused, max_tokens → error, JSON 아님 → BAD_JSON, 401 → AUTH(재시도 없음)", async () => {
    const one = (res: () => Response) => anthropicCaller("sk-synthetic", "claude-sonnet-5-5", (async () => res()) as typeof fetch)(REQ);
    expect(await one(() => reply(message({ stop: "refusal" })))).toMatchObject({ kind: "refused" });
    expect(await one(() => reply(message({ stop: "max_tokens", text: "{" })))).toMatchObject({ kind: "error", code: "MAX_TOKENS" });
    expect(await one(() => reply(message({ text: "그냥 글" })))).toMatchObject({ kind: "error", code: "BAD_JSON" });
    const { f, seen } = recorder([() => reply({ type: "error", error: { type: "authentication_error", message: "invalid" } }, 401)]);
    expect(await anthropicCaller("sk-synthetic", "claude-sonnet-5-5", f)(REQ)).toEqual({ kind: "error", code: "AUTH" });
    expect(seen).toHaveLength(1);
  });
});

describe("OpenAI 호출기(fetch, Responses API)", () => {
  const ok = (o: { content?: unknown[]; status?: string; incomplete?: string }) =>
    reply({
      id: "resp_synthetic", object: "response", model: "gpt-6.2-sol-2026-11-01", status: o.status ?? "completed",
      ...(o.incomplete ? { incomplete_details: { reason: o.incomplete } } : {}),
      output: [{ type: "reasoning", summary: [] }, { type: "message", role: "assistant", content: o.content ?? [] }],
      usage: { input_tokens: 900, output_tokens: 150, output_tokens_details: { reasoning_tokens: 50 } },
    });

  it("요청 모양: 주소·Bearer 키·instructions·input(JSON)·reasoning low·json_schema strict·store false", async () => {
    const { f, seen } = recorder([() => ok({ content: [{ type: "output_text", text: JSON.stringify(OUT) }] })]);
    expect(await openaiCaller("sk-synthetic", "gpt-6.2-sol", f)(REQ)).toEqual({ kind: "ok", output: OUT, model: "gpt-6.2-sol", inputTokens: 900, outputTokens: 150 });
    expect(seen[0].url).toBe("https://api.openai.com/v1/responses");
    expect(seen[0].headers.get("authorization")).toBe("Bearer sk-synthetic");
    expect(seen[0].body).toMatchObject({
      model: "gpt-6.2-sol", input: JSON.stringify(REQ), reasoning: { effort: "low" }, max_output_tokens: 16000, store: false,
      text: { format: { type: "json_schema", name: "brief_copy", strict: true } },
    });
    expect(typeof seen[0].body.instructions).toBe("string");
  });

  it("refusal 부분·content_filter → refused, max_output_tokens → MAX_TOKENS, JSON 아님 → BAD_JSON", async () => {
    const one = (r: () => Response) => openaiCaller("sk", "gpt-6-luna", (async () => r()) as typeof fetch)(REQ);
    expect(await one(() => ok({ content: [{ type: "refusal", refusal: "거절" }] }))).toMatchObject({ kind: "refused", inputTokens: 900 });
    expect(await one(() => ok({ status: "incomplete", incomplete: "content_filter" }))).toMatchObject({ kind: "refused" });
    expect(await one(() => ok({ status: "incomplete", incomplete: "max_output_tokens", content: [{ type: "output_text", text: "{" }] }))).toMatchObject({ kind: "error", code: "MAX_TOKENS" });
    expect(await one(() => ok({ content: [{ type: "output_text", text: "글" }] }))).toMatchObject({ kind: "error", code: "BAD_JSON" });
  });

  it("500 다음 성공이면 1번 재시도로 성공, 401 은 재시도 없이 AUTH, 시간 초과는 재시도 없이 TIMEOUT, 연결 오류 2번이면 CONNECTION", async () => {
    let r = recorder([() => reply({ error: {} }, 500), () => ok({ content: [{ type: "output_text", text: JSON.stringify(OUT) }] })]);
    expect((await openaiCaller("sk", "gpt-6.2-sol", r.f)(REQ)).kind).toBe("ok");
    expect(r.seen).toHaveLength(2);
    r = recorder([() => reply({ error: { message: "bad key" } }, 401)]);
    expect(await openaiCaller("sk", "gpt-6.2-sol", r.f)(REQ)).toEqual({ kind: "error", code: "AUTH" });
    expect(r.seen).toHaveLength(1);
    let calls = 0;
    const timeout = (async () => {
      calls++;
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    }) as typeof fetch;
    expect(await openaiCaller("sk", "gpt-6.2-sol", timeout)(REQ)).toEqual({ kind: "error", code: "TIMEOUT" });
    expect(calls).toBe(1);
    calls = 0;
    const down = (async () => {
      calls++;
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await openaiCaller("sk", "gpt-6.2-sol", down)(REQ)).toEqual({ kind: "error", code: "CONNECTION" });
    expect(calls).toBe(2);
  });
});

describe("Gemini 호출기(fetch, generateContent)", () => {
  const ok = (o: { parts?: unknown[]; finish?: string; block?: string }) =>
    reply({
      ...(o.block ? { promptFeedback: { blockReason: o.block } } : {}),
      candidates: o.block ? [] : [{ content: { role: "model", parts: o.parts ?? [] }, finishReason: o.finish ?? "STOP" }],
      usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 120, thoughtsTokenCount: 30, totalTokenCount: 950 },
      modelVersion: "gemini-3.8-flash",
    });

  it("요청 모양: 모델 주소·x-goog-api-key·systemInstruction·JSON 스키마(additionalProperties 뺌)·thinkingLevel(Flash 는 low, Flash-Lite 는 없음)", async () => {
    let r = recorder([() => ok({ parts: [{ text: "생각", thought: true }, { text: JSON.stringify(OUT) }] })]);
    expect(await geminiCaller("g-synthetic", "gemini-3.8-flash", r.f)(REQ)).toEqual({ kind: "ok", output: OUT, model: "gemini-3.8-flash", inputTokens: 800, outputTokens: 150 });
    expect(r.seen[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(r.seen[0].headers.get("x-goog-api-key")).toBe("g-synthetic");
    const b = r.seen[0].body as { systemInstruction: unknown; contents: unknown; generationConfig: Record<string, unknown> };
    expect(b.contents).toEqual([{ role: "user", parts: [{ text: JSON.stringify(REQ) }] }]);
    expect(b.generationConfig).toMatchObject({ responseMimeType: "application/json", maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: "low" } });
    expect(JSON.stringify(b.generationConfig.responseJsonSchema)).not.toContain("additionalProperties");
    expect(b.systemInstruction).toMatchObject({ parts: [{ text: expect.any(String) }] });
    r = recorder([() => ok({ parts: [{ text: JSON.stringify(OUT) }] })]);
    await geminiCaller("g", "gemini-3.5-flash-lite", r.f)(REQ);
    expect(r.seen[0].body.generationConfig).not.toHaveProperty("thinkingConfig");
  });

  it("차단(blockReason)·SAFETY → refused, MAX_TOKENS → error, 후보 없음 → EMPTY, 429 두 번 → RATE_LIMIT(재시도 1번)", async () => {
    const one = (res: () => Response) => geminiCaller("g", "gemini-4-argon", (async () => res()) as typeof fetch)(REQ);
    expect(await one(() => ok({ block: "SAFETY" }))).toMatchObject({ kind: "refused", inputTokens: 800 });
    expect(await one(() => ok({ finish: "SAFETY" }))).toMatchObject({ kind: "refused" });
    expect(await one(() => ok({ finish: "MAX_TOKENS", parts: [{ text: "{" }] }))).toMatchObject({ kind: "error", code: "MAX_TOKENS" });
    expect(await one(() => reply({ candidates: [], usageMetadata: {} }))).toMatchObject({ kind: "error", code: "EMPTY" });
    const r = recorder([() => reply({ error: { code: 429 } }, 429)]);
    expect(await geminiCaller("g", "gemini-4-argon", r.f)(REQ)).toEqual({ kind: "error", code: "RATE_LIMIT" });
    expect(r.seen).toHaveLength(2);
  });
});
