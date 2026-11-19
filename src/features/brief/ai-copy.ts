import "server-only";
import { createHash, createHmac } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { briefCopyRequestSchema, briefErrorFromDb, checkBriefCopy, type BriefCopyRequest } from "@/domain/brief";
import { BRIEF_COPY_OUTPUT_SCHEMA, BRIEF_COPY_SYSTEM, buildBriefCopyRequest, canonicalJson, estimateCostUsdMicro } from "@/domain/brief/ai-copy";
import {
  BRIEF_COPY_MODELS,
  BRIEF_COPY_PROVIDERS,
  defaultBriefCopyModel,
  findBriefCopyModel,
  type BriefCopyModelInfo,
  type BriefCopyProvider,
} from "@/domain/brief/ai-models";
import { fail, ok, type ErrorCode, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { getContentBrief } from "./server";

/**
 * DEC08-AI-COPY-01 + R1: 브리프 AI 문구 초안. 공급자(Claude·OpenAI·Gemini)와 모델을 서버 고정 목록(ai-models.ts)에서 고른다.
 * - 키는 서버 환경 변수(ANTHROPIC_API_KEY·OPENAI_API_KEY·GEMINI_API_KEY). 키가 있는 공급자만 선택지에 나오고, 없는 공급자는 서버도 거절한다.
 *   키가 하나도 없으면 기능이 꺼진다(외부 호출 없음).
 * - 외부로 보내는 것(공급자 무관): 브리프 제목·대상·훅·핵심 메시지·CTA·채널 항목, 근거가 연결된 주장 문장, 근거 이름.
 * - 순서(공급자 무관): 브리프 읽기(RLS) → 요청·계약 검사 → 예약 RPC(한도·모델 허용·재사용) → 호출(60초) → 계약 검사 → 마감 RPC.
 * - 호출: Anthropic 은 공식 SDK, OpenAI·Gemini 는 공급망을 줄이려고 fetch 로 직접 부른다(429·5xx·연결 오류 1번 재시도, 시간 초과는 재시도 없음).
 * - R2(QA-FINAL-E-01 D1): 예약·마감 RPC 는 서버만 아는 비밀값(BRIEF_COPY_SIGNING_KEY = DB app.server_secrets 의 값)으로 HMAC 서명해 부른다.
 *   사용자가 같은 로그인으로 RPC 를 직접 불러도 서명이 없어 거절된다. 서명 키가 없으면 기능이 꺼진다.
 */

export const BRIEF_COPY_DISABLED_MESSAGE = "AI 문구 만들기가 아직 켜져 있지 않습니다. 관리자가 API 키를 설정하면 쓸 수 있습니다.";
const TIMEOUT_MS = 60_000;

const keyOf = (p: BriefCopyProvider) => process.env[BRIEF_COPY_PROVIDERS[p].envKey]?.trim() || "";
const signingKey = () => process.env.BRIEF_COPY_SIGNING_KEY?.trim() || "";

/** 서버 서명(R2): HMAC-SHA256(키, "용도|메시지") — DB app.hmac_sha256 과 같은 값 */
export function signForDb(purpose: "reserve" | "finish", message: string, key = signingKey()): string {
  return createHmac("sha256", key).update(`${purpose}|${message}`, "utf8").digest("hex");
}

/** 키가 있는 공급자(서명 키가 없으면 하나도 없음 — 기능 꺼짐) */
export function enabledBriefCopyProviders(): BriefCopyProvider[] {
  if (!signingKey()) return [];
  return (Object.keys(BRIEF_COPY_PROVIDERS) as BriefCopyProvider[]).filter((p) => keyOf(p) !== "");
}

/** 화면에서 버튼을 보일지 정할 때 쓴다(키가 하나라도 있으면 true). 키 값은 돌려주지 않는다 */
export function isBriefCopyAiEnabled(): boolean {
  return enabledBriefCopyProviders().length > 0;
}

export interface BriefCopyChoice {
  provider: BriefCopyProvider;
  label: string;
  models: Pick<BriefCopyModelInfo, "id" | "label" | "note" | "inputUsd" | "outputUsd" | "isDefault">[];
}
/** 화면용 선택지: 키가 있는 공급자와 그 모델들(서버 고정 목록 순서). 키가 없으면 빈 배열 */
export function listBriefCopyChoices(): BriefCopyChoice[] {
  return enabledBriefCopyProviders().map((provider) => ({
    provider,
    label: BRIEF_COPY_PROVIDERS[provider].label,
    models: BRIEF_COPY_MODELS.filter((m) => m.provider === provider).map(({ id, label, note, inputUsd, outputUsd, isDefault }) => ({
      id, label, note, inputUsd, outputUsd, ...(isDefault ? { isDefault } : {}),
    })),
  }));
}

export interface BriefCopyUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}
/** 외부 호출 한 번의 결과(공급자 공통). 시험에서는 가짜 호출기로 바꿔 끼운다 */
export type BriefCopyCallResult =
  | ({ kind: "ok"; output: unknown } & BriefCopyUsage)
  | ({ kind: "refused" } & BriefCopyUsage)
  | ({ kind: "error"; code: string } & Partial<BriefCopyUsage>);
export type BriefCopyCaller = (req: BriefCopyRequest) => Promise<BriefCopyCallResult>;

const httpCode = (status: number) =>
  status === 401 ? "AUTH" : status === 403 ? "PERMISSION" : status === 400 ? "BAD_REQUEST" : status === 429 ? "RATE_LIMIT" : `HTTP_${status}`;

// ───────────────────────── Anthropic(공식 SDK) ─────────────────────────
const anthropicErrorCode = (e: unknown): string => {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "TIMEOUT";
  if (e instanceof Anthropic.APIConnectionError) return "CONNECTION";
  if (e instanceof Anthropic.APIError) return httpCode(e.status ?? 0);
  return "UNKNOWN";
};

const ANTHROPIC_FALLBACK = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);

/** 60초 제한, 429·5xx·연결 오류는 SDK 가 1번만 다시 시도한다. 거절(refusal)이면 서버 쪽 대체 모델("default")로 넘긴다(Sonnet·Opus) */
export function anthropicCaller(apiKey: string, model: string, fetchImpl?: typeof fetch): BriefCopyCaller {
  // fetchImpl: 시험에서 네트워크 없이 요청 모양을 확인할 때만 쓴다
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  return async (req) => {
    try {
      const res = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        // 서버 쪽 대체 모델은 Sonnet·Opus 만 있다(Haiku 5.5 는 없음, QA-FINAL-E-01 O2)
        ...(ANTHROPIC_FALLBACK.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        output_config: { effort: "low", format: { type: "json_schema", schema: BRIEF_COPY_OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
        system: BRIEF_COPY_SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(req) }],
      });
      const u = res.usage;
      const usage: BriefCopyUsage = {
        model: res.model,
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
      };
      if (res.stop_reason === "refusal") return { kind: "refused", ...usage };
      if (res.stop_reason === "max_tokens") return { kind: "error", code: "MAX_TOKENS", ...usage };
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return parseJsonOutput(text, usage);
    } catch (e) {
      const code = anthropicErrorCode(e);
      console.error("[briefCopy.anthropic]", code);
      return { kind: "error", code };
    }
  };
}

// ───────────────────────── fetch 공통(OpenAI·Gemini) ─────────────────────────
type PostResult = { ok: true; status: number; json: Record<string, unknown> } | { ok: false; code: string };

/** JSON POST. 60초 제한. 429·5xx·연결 오류만 1번 다시 시도한다(시간 초과는 다시 하지 않음 — 함수 실행 시간 보호) */
async function postJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: unknown): Promise<PostResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError") return { ok: false, code: "TIMEOUT" };
      if (attempt === 0) continue;
      return { ok: false, code: "CONNECTION" };
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0) continue;
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      if (res.ok) return { ok: false, code: "BAD_JSON" };
    }
    if (!res.ok) return { ok: false, code: httpCode(res.status) };
    return { ok: true, status: res.status, json };
  }
  return { ok: false, code: "CONNECTION" };
}

function parseJsonOutput(text: string, usage: BriefCopyUsage): BriefCopyCallResult {
  try {
    return { kind: "ok", output: JSON.parse(text), ...usage };
  } catch {
    return { kind: "error", code: "BAD_JSON", ...usage };
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

// ───────────────────────── OpenAI(Responses API, fetch) ─────────────────────────
/**
 * POST https://api.openai.com/v1/responses — instructions(지시문) + input(브리프 JSON), text.format json_schema(strict), reasoning.effort low.
 * 응답: output[].content[] 의 output_text / refusal, status incomplete(max_output_tokens·content_filter), usage.input_tokens·output_tokens.
 * 확인: developers.openai.com structured-outputs·reasoning 안내(2026-11-19).
 */
export function openaiCaller(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): BriefCopyCaller {
  return async (req) => {
    const r = await postJson(fetchImpl, "https://api.openai.com/v1/responses", { authorization: `Bearer ${apiKey}` }, {
      model,
      instructions: BRIEF_COPY_SYSTEM,
      input: JSON.stringify(req),
      reasoning: { effort: "low" },
      max_output_tokens: 16000,
      store: false,
      text: { format: { type: "json_schema", name: "brief_copy", schema: BRIEF_COPY_OUTPUT_SCHEMA, strict: true } },
    });
    if (!r.ok) {
      console.error("[briefCopy.openai]", r.code);
      return { kind: "error", code: r.code };
    }
    const j = r.json;
    const u = (j.usage ?? {}) as Record<string, unknown>;
    const usage: BriefCopyUsage = { model, inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens) };
    const parts = ((j.output ?? []) as Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>)
      .filter((o) => o.type === "message")
      .flatMap((o) => o.content ?? []);
    if (parts.some((p) => p.type === "refusal")) return { kind: "refused", ...usage };
    if (j.status === "incomplete") {
      const reason = (j.incomplete_details as { reason?: string } | undefined)?.reason;
      if (reason === "content_filter") return { kind: "refused", ...usage };
      return { kind: "error", code: reason === "max_output_tokens" ? "MAX_TOKENS" : "INCOMPLETE", ...usage };
    }
    const text = parts.filter((p) => p.type === "output_text").map((p) => p.text ?? "").join("");
    return parseJsonOutput(text, usage);
  };
}

// ───────────────────────── Gemini(generateContent, fetch) ─────────────────────────
/** Gemini 는 JSON 스키마의 additionalProperties 를 받지 않을 수 있어 뺀다(남는 키는 계약 검사 checkBriefCopy 가 거절한다) */
function stripAdditional(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripAdditional);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "additionalProperties").map(([k, x]) => [k, stripAdditional(x)]));
  return v;
}
/** thinkingLevel 을 지원하는 모델(Flash-Lite 는 기본 minimal 이라 넣지 않는다) */
const GEMINI_THINKING_LOW = new Set(["gemini-3.8-flash", "gemini-4-argon"]);
const GEMINI_REFUSAL = new Set(["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"]);

/**
 * POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent (헤더 x-goog-api-key).
 * Google 은 새 Interactions API 를 권장하지만 문서에 사용량·차단 응답 형식이 없어, "계속 완전 지원"으로 적힌 generateContent 를 쓴다(2026-11-19 확인).
 * 응답: candidates[0].content.parts[].text(thought 부분 제외), finishReason, promptFeedback.blockReason, usageMetadata(prompt·candidates·thoughts 토큰).
 */
export function geminiCaller(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): BriefCopyCaller {
  return async (req) => {
    const r = await postJson(
      fetchImpl,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": apiKey },
      {
        systemInstruction: { parts: [{ text: BRIEF_COPY_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(req) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: stripAdditional(BRIEF_COPY_OUTPUT_SCHEMA),
          maxOutputTokens: 16000,
          ...(GEMINI_THINKING_LOW.has(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
        },
      },
    );
    if (!r.ok) {
      console.error("[briefCopy.gemini]", r.code);
      return { kind: "error", code: r.code };
    }
    const j = r.json;
    const m = (j.usageMetadata ?? {}) as Record<string, unknown>;
    const usage: BriefCopyUsage = { model, inputTokens: num(m.promptTokenCount), outputTokens: num(m.candidatesTokenCount) + num(m.thoughtsTokenCount) };
    if ((j.promptFeedback as { blockReason?: string } | undefined)?.blockReason) return { kind: "refused", ...usage };
    const cand = ((j.candidates ?? []) as Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>)[0];
    if (!cand) return { kind: "error", code: "EMPTY", ...usage };
    const reason = cand.finishReason ?? "STOP";
    if (GEMINI_REFUSAL.has(reason)) return { kind: "refused", ...usage };
    if (reason === "MAX_TOKENS") return { kind: "error", code: "MAX_TOKENS", ...usage };
    if (reason !== "STOP") return { kind: "error", code: `FINISH_${reason}`.slice(0, 100), ...usage };
    const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    return parseJsonOutput(text, usage);
  };
}

function callerFor(provider: BriefCopyProvider, model: string, apiKey: string): BriefCopyCaller {
  if (provider === "openai") return openaiCaller(apiKey, model);
  if (provider === "google") return geminiCaller(apiKey, model);
  return anthropicCaller(apiKey, model);
}

export const BRIEF_COPY_MISCONFIGURED_MESSAGE = "AI 문구 만들기 설정이 맞지 않습니다. 관리자에게 알려 주세요.";

function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
  if (/NOT_CONFIGURED|BAD_SIGNATURE/.test(error.message)) {
    console.error(`[${where}]`, error.code, error.message.slice(0, 120));
    return fail("ERROR", BRIEF_COPY_MISCONFIGURED_MESSAGE);
  }
  const e = briefErrorFromDb(error.message);
  if (e.code === "ERROR") console.error(`[${where}]`, error.code, error.message);
  const map: Record<string, ErrorCode> = { CONFLICT: "CONFLICT", NOT_FOUND: "NOT_FOUND", INVALID_TRANSITION: "INVALID_TRANSITION", ERROR: "ERROR" };
  return fail(map[e.code] ?? "VALIDATION", e.message);
}

export interface BriefCopyVariant {
  text: string;
  usedClaimIds: string[];
}
export interface BriefCopyOutcome {
  runId: string;
  provider: BriefCopyProvider;
  model: string;
  /** 같은 입력·같은 모델의 10분 안 성공 결과를 다시 쓴 경우(외부 호출 없음) */
  reused: boolean;
  variants: BriefCopyVariant[];
}
export interface BriefCopyOptions {
  provider?: string;
  model?: string;
  variants?: number;
  maxChars?: number;
}

/**
 * 공급자·모델 고르기. 공급자를 안 주면 Claude(키 있으면) → 키 있는 첫 공급자. 모델을 안 주면 공급자 기본 모델.
 * 목록 밖 공급자·모델, 키 없는 공급자는 거절.
 */
function resolveChoice(opts: BriefCopyOptions, hasCaller: boolean): Result<{ provider: BriefCopyProvider; model: BriefCopyModelInfo; key: string }> {
  const enabled = enabledBriefCopyProviders();
  if (!hasCaller && enabled.length === 0) return fail("VALIDATION", BRIEF_COPY_DISABLED_MESSAGE);
  const raw = opts.provider ?? (enabled.includes("anthropic") ? "anthropic" : (enabled[0] ?? "anthropic"));
  if (!(raw in BRIEF_COPY_PROVIDERS)) return fail("VALIDATION", "고를 수 없는 AI 플랫폼입니다.");
  const provider = raw as BriefCopyProvider;
  if (!hasCaller && !enabled.includes(provider)) return fail("VALIDATION", `${BRIEF_COPY_PROVIDERS[provider].label}는 아직 켜져 있지 않습니다. 다른 플랫폼을 골라 주세요.`);
  const model = opts.model === undefined ? defaultBriefCopyModel(provider) : findBriefCopyModel(provider, opts.model);
  if (!model) return fail("VALIDATION", "고를 수 없는 AI 모델입니다.");
  return ok({ provider, model, key: keyOf(provider) });
}

/**
 * 생성. 실패해도 예약 행은 마감한다(감사 copy_generate 1행). 성공이면 변형 목록을 돌려준다(아직 브리프에 저장하지 않음).
 * caller 를 주면(시험) 그 호출기를 쓰고 키 확인을 건너뛴다. 공급자·모델 허용 확인은 그대로 한다.
 */
export async function generateBriefCopy(
  taskId: string,
  briefId: string,
  expectedRevision: number,
  opts: BriefCopyOptions = {},
  caller?: BriefCopyCaller,
): Promise<Result<BriefCopyOutcome>> {
  const choice = resolveChoice(opts, !!caller);
  if (!choice.ok) return choice;
  const { provider, model } = choice.data;
  const call = caller ?? callerFor(provider, model.id, choice.data.key);

  const detail = await getContentBrief(taskId, briefId);
  if (!detail) return fail("NOT_FOUND", "브리프를 찾을 수 없습니다.");
  if (detail.brief.archived) return fail("INVALID_TRANSITION", "보관한 브리프는 고칠 수 없습니다.");
  if (detail.brief.revision !== expectedRevision) return fail("CONFLICT", "다른 곳에서 먼저 수정되었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.");

  const req = buildBriefCopyRequest(
    {
      channel: detail.brief.channel,
      title: detail.brief.title,
      audience: detail.brief.audience,
      hook: detail.brief.hook,
      coreMessage: detail.brief.coreMessage,
      cta: detail.brief.cta,
      channelSpec: detail.brief.channelSpec as Record<string, unknown>,
      // R2 D3: 외부로는 전송용 이름(aiLabel)만. 메모 원문·전체 주소는 보내지 않는다
      claims: detail.claims.map((c) => ({ id: c.id, text: c.text, sourceLabels: c.sourceRows.map((s) => s.aiLabel) })),
    },
    opts,
  );
  const parsedReq = briefCopyRequestSchema.safeParse(req);
  if (!parsedReq.success) return fail("VALIDATION", "브리프 내용이 AI 문구 만들기 조건에 맞지 않습니다. 제목과 주장을 확인해 주세요.");
  const inputHash = createHash("sha256").update(canonicalJson({ provider, model: model.id, req: parsedReq.data })).digest("hex");

  const sb = await createSupabaseServerClient();
  const claimIds = parsedReq.data.claims.map((c) => c.id);
  const signedAt = Date.now();
  const rsv = await sb.rpc("reserve_brief_copy_run", {
    p_brief_id: briefId,
    p_expected_revision: expectedRevision,
    p_input_hash: inputHash,
    p_provider: provider,
    p_model: model.id,
    p_claim_ids: claimIds,
    p_signed_at: signedAt,
    p_signature: signForDb("reserve", [briefId, expectedRevision, inputHash, provider, model.id, claimIds.join(","), signedAt].join("|")),
  });
  if (rsv.error) return rpcFail("generateBriefCopy.reserve", rsv.error);
  const row = rsv.data?.[0];
  if (!row) return fail("ERROR", "AI 문구를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
  if (row.reused) {
    const prev = await sb.from("brief_copy_runs").select("variants").eq("id", row.run_id).single();
    if (prev.error || !Array.isArray(prev.data.variants)) return fail("ERROR", "이전 결과를 불러오지 못했습니다.");
    return ok({ runId: row.run_id, provider, model: model.id, reused: true, variants: prev.data.variants as unknown as BriefCopyVariant[] });
  }

  const res = await call(parsedReq.data);
  const usage = { model: res.model ?? model.id, inputTokens: res.inputTokens ?? 0, outputTokens: res.outputTokens ?? 0 };
  // 사용량을 모르는 실패(시간 초과·연결 끊김 등)는 업체가 처리분을 청구할 수 있어 예약 추정치(최대치)로 기록한다(QA-FINAL-E-01 O1)
  const unknownUsage = res.kind === "error" && res.inputTokens === undefined;
  const httpRejected = res.kind === "error" && /^(AUTH|PERMISSION|BAD_REQUEST|RATE_LIMIT)$/.test(res.code);
  const cost = unknownUsage ? (httpRejected ? 0 : estimateCostUsdMicro(model.id, { inputTokens: 12_000, outputTokens: 20_000 })) : estimateCostUsdMicro(usage.model, usage);
  const finish = (status: "succeeded" | "rejected" | "refused" | "failed", extra: { variants?: BriefCopyVariant[]; problems?: string[]; error?: string }) => {
    const variantsText = extra.variants ? JSON.stringify(extra.variants) : null;
    const problemsText = extra.problems ? JSON.stringify(extra.problems) : null;
    const costMicro = Math.min(cost, 5_000_000);
    const message = [row.run_id, status, variantsText ?? "", problemsText ?? "", extra.error ?? "", usage.inputTokens, usage.outputTokens, costMicro].join("|");
    return sb.rpc("finish_brief_copy_run", {
      p_run_id: row.run_id,
      p_status: status,
      // RPC 인자는 null 을 받는다(생성 타입은 null 을 표시하지 않음)
      p_variants: variantsText as unknown as string,
      p_problems: problemsText as unknown as string,
      p_error_code: (extra.error ?? null) as unknown as string,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
      p_cost_usd_micro: costMicro,
      p_signature: signForDb("finish", message),
    });
  };

  if (res.kind === "refused") {
    await finish("refused", {});
    return fail("VALIDATION", "AI 가 이 브리프로는 문구를 만들지 않았습니다. 주장과 문장을 확인한 뒤 다시 시도해 주세요.");
  }
  if (res.kind === "error") {
    await finish("failed", { error: res.code });
    if (res.code === "AUTH" || res.code === "PERMISSION") return fail("ERROR", `${BRIEF_COPY_PROVIDERS[provider].label} 키가 올바르지 않거나 권한이 없습니다. 관리자에게 알려 주세요.`);
    return fail("ERROR", res.code === "TIMEOUT" ? "AI 응답이 늦어 멈췄습니다. 잠시 후 다시 시도해 주세요." : "AI 문구를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  const checked = checkBriefCopy(parsedReq.data, {
    ...(res.output && typeof res.output === "object" ? res.output : {}),
    model: usage.model.slice(0, 100),
    generatedAt: new Date().toISOString(),
  });
  if (!checked.ok) {
    await finish("rejected", { problems: checked.problems.slice(0, 20) });
    return fail("VALIDATION", `AI 결과가 검사를 통과하지 못했습니다: ${checked.problems[0] ?? "형식 오류"}`);
  }
  const variants = checked.data.variants.map((v) => ({ text: v.text, usedClaimIds: v.usedClaimIds }));
  const fin = await finish("succeeded", { variants });
  if (fin.error) return rpcFail("generateBriefCopy.finish", fin.error);
  return ok({ runId: row.run_id, provider, model: model.id, reused: false, variants });
}

/** 채택: n번째 변형(1부터)을 브리프 카피 초안으로 저장한다(copy_origin = 'ai'). 새 revision 을 돌려준다 */
export async function acceptBriefCopy(runId: string, variant: number, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("accept_brief_copy", { p_run_id: runId, p_variant: variant, p_expected_revision: expectedRevision });
  if (error) return rpcFail("acceptBriefCopy", error);
  return ok({ revision: data as number });
}
