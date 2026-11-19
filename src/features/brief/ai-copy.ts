import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { briefCopyRequestSchema, briefErrorFromDb, checkBriefCopy, type BriefCopyRequest } from "@/domain/brief";
import {
  BRIEF_COPY_MODEL,
  BRIEF_COPY_OUTPUT_SCHEMA,
  BRIEF_COPY_SYSTEM,
  buildBriefCopyRequest,
  canonicalJson,
  estimateCostUsdMicro,
} from "@/domain/brief/ai-copy";
import { fail, ok, type ErrorCode, type Result } from "@/server/result";
import type { Json } from "@/server/supabase/database.types";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { getContentBrief } from "./server";

/**
 * DEC08-AI-COPY-01: 브리프 AI 문구 초안(주인님 DEC-08 B).
 * - 키(ANTHROPIC_API_KEY, 서버 환경 변수)가 없으면 기능이 꺼진다: isBriefCopyAiEnabled() = false, 생성은 거절(외부 호출 없음).
 * - 외부로 보내는 것: 브리프 제목·대상·훅·핵심 메시지·CTA·채널 항목, 근거가 연결된 주장 문장, 근거 이름. 자료 원문·파일·고객 연락처는 보내지 않는다.
 * - 순서: 브리프 읽기(RLS) → 요청 만들기·계약 검사 → 예약 RPC(한도·재사용) → 호출(60초, 재시도 1번) → 계약 검사(checkBriefCopy) → 마감 RPC.
 * - 결과는 초안일 뿐이다. 사람이 고른 변형만 accept RPC 로 브리프에 저장된다(copy_origin = 'ai').
 */

export const BRIEF_COPY_DISABLED_MESSAGE = "AI 문구 만들기가 아직 켜져 있지 않습니다. 관리자가 API 키를 설정하면 쓸 수 있습니다.";

/** 화면에서 버튼을 보일지 정할 때 쓴다. 키 값 자체는 돌려주지 않는다 */
export function isBriefCopyAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

export interface BriefCopyUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}
/** 외부 호출 한 번의 결과. 시험에서는 가짜 호출기로 바꿔 끼운다 */
export type BriefCopyCallResult =
  | ({ kind: "ok"; output: unknown } & BriefCopyUsage)
  | ({ kind: "refused" } & BriefCopyUsage)
  | ({ kind: "error"; code: string } & Partial<BriefCopyUsage>);
export type BriefCopyCaller = (req: BriefCopyRequest) => Promise<BriefCopyCallResult>;

const errorCode = (e: unknown): string => {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "TIMEOUT";
  if (e instanceof Anthropic.APIConnectionError) return "CONNECTION";
  if (e instanceof Anthropic.RateLimitError) return "RATE_LIMIT";
  if (e instanceof Anthropic.AuthenticationError) return "AUTH";
  if (e instanceof Anthropic.PermissionDeniedError) return "PERMISSION";
  if (e instanceof Anthropic.BadRequestError) return "BAD_REQUEST";
  if (e instanceof Anthropic.APIError) return `HTTP_${e.status ?? "?"}`;
  return "UNKNOWN";
};

/** 실제 호출기(Anthropic SDK). 60초 제한, 429·5xx·연결 오류는 SDK 가 1번만 다시 시도한다. 거절(refusal)이면 서버 쪽 대체 모델("default")로 넘긴다 */
export function anthropicCaller(apiKey: string, fetchImpl?: typeof fetch): BriefCopyCaller {
  // fetchImpl: 시험에서 네트워크 없이 요청 모양을 확인할 때만 쓴다
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  return async (req) => {
    try {
      const res = await client.beta.messages.create({
        model: BRIEF_COPY_MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
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
      try {
        return { kind: "ok", output: JSON.parse(text), ...usage };
      } catch {
        return { kind: "error", code: "BAD_JSON", ...usage };
      }
    } catch (e) {
      const code = errorCode(e);
      console.error("[briefCopy.call]", code);
      return { kind: "error", code };
    }
  };
}

function rpcFail<T>(where: string, error: { code?: string; message: string }): Result<T> {
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
  /** 같은 입력의 10분 안 성공 결과를 다시 쓴 경우(외부 호출 없음) */
  reused: boolean;
  variants: BriefCopyVariant[];
}

/**
 * 생성. 실패해도 예약 행은 마감한다(감사 copy_generate 1행). 성공이면 변형 목록을 돌려준다(아직 브리프에 저장하지 않음).
 * caller 를 주지 않으면 환경 변수 키로 실제 호출기를 만든다. 키가 없으면 외부 호출 없이 거절.
 */
export async function generateBriefCopy(
  taskId: string,
  briefId: string,
  expectedRevision: number,
  opts: { variants?: number; maxChars?: number } = {},
  caller?: BriefCopyCaller,
): Promise<Result<BriefCopyOutcome>> {
  let call = caller;
  if (!call) {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) return fail("VALIDATION", BRIEF_COPY_DISABLED_MESSAGE);
    call = anthropicCaller(key);
  }
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
      claims: detail.claims.map((c) => ({ id: c.id, text: c.text, sourceLabels: c.sourceRows.map((s) => s.label) })),
    },
    opts,
  );
  const parsedReq = briefCopyRequestSchema.safeParse(req);
  if (!parsedReq.success) return fail("VALIDATION", "브리프 내용이 AI 문구 만들기 조건에 맞지 않습니다. 제목과 주장을 확인해 주세요.");
  const inputHash = createHash("sha256").update(canonicalJson({ model: BRIEF_COPY_MODEL, req: parsedReq.data })).digest("hex");

  const sb = await createSupabaseServerClient();
  const rsv = await sb.rpc("reserve_brief_copy_run", {
    p_brief_id: briefId,
    p_expected_revision: expectedRevision,
    p_input_hash: inputHash,
    p_model: BRIEF_COPY_MODEL,
    p_claim_ids: parsedReq.data.claims.map((c) => c.id),
  });
  if (rsv.error) return rpcFail("generateBriefCopy.reserve", rsv.error);
  const row = rsv.data?.[0];
  if (!row) return fail("ERROR", "AI 문구를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
  if (row.reused) {
    const prev = await sb.from("brief_copy_runs").select("variants").eq("id", row.run_id).single();
    if (prev.error || !Array.isArray(prev.data.variants)) return fail("ERROR", "이전 결과를 불러오지 못했습니다.");
    return ok({ runId: row.run_id, reused: true, variants: prev.data.variants as unknown as BriefCopyVariant[] });
  }

  const res = await call(parsedReq.data);
  const usage = { model: res.model ?? BRIEF_COPY_MODEL, inputTokens: res.inputTokens ?? 0, outputTokens: res.outputTokens ?? 0 };
  const cost = res.kind === "error" && res.inputTokens === undefined ? 0 : estimateCostUsdMicro(usage.model, usage);
  const finish = (status: "succeeded" | "rejected" | "refused" | "failed", extra: { variants?: BriefCopyVariant[]; problems?: string[]; error?: string }) =>
    sb.rpc("finish_brief_copy_run", {
      p_run_id: row.run_id,
      p_status: status,
      // RPC 인자는 null 을 받는다(생성 타입은 null 을 표시하지 않음)
      p_variants: (extra.variants ?? null) as unknown as Json,
      p_problems: (extra.problems ?? null) as unknown as Json,
      p_error_code: (extra.error ?? null) as unknown as string,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
      p_cost_usd_micro: Math.min(cost, 5_000_000),
    });

  if (res.kind === "refused") {
    await finish("refused", {});
    return fail("VALIDATION", "AI 가 이 브리프로는 문구를 만들지 않았습니다. 주장과 문장을 확인한 뒤 다시 시도해 주세요.");
  }
  if (res.kind === "error") {
    await finish("failed", { error: res.code });
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
  return ok({ runId: row.run_id, reused: false, variants });
}

/** 채택: n번째 변형(1부터)을 브리프 카피 초안으로 저장한다(copy_origin = 'ai'). 새 revision 을 돌려준다 */
export async function acceptBriefCopy(runId: string, variant: number, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("accept_brief_copy", { p_run_id: runId, p_variant: variant, p_expected_revision: expectedRevision });
  if (error) return rpcFail("acceptBriefCopy", error);
  return ok({ revision: data as number });
}
