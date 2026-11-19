/**
 * DEC-08-R1(주인님 지시 2026-11-19 "OpenAI / Claude / Gemini 중 플랫폼을 선택하고 모델도 선택"): AI 문구 초안 허용 공급자·모델 목록.
 * 서버 고정이다. 사용자는 이 목록 안에서만 고른다(DB app.brief_copy_models 와 같아야 하며 tests/db 가 대조한다).
 * 이 파일은 런타임 import 가 없다(zod 없음) — 화면도 이름표를 가져다 쓸 수 있다.
 *
 * 요금: 100만 토큰당 달러(= 토큰당 마이크로달러). 소개 할인 기간이 있는 모델은 할인 뒤(높은) 요금으로 둔다(월 상한을 넘지 않게 보수적으로).
 * 출처·확인 날짜는 PRICE_SOURCES. 요금이 바뀌면 이 파일과 migration 의 app.brief_copy_models 를 함께 고친다.
 */
export const BRIEF_COPY_PROVIDERS = {
  anthropic: { label: "Claude (Anthropic)", envKey: "ANTHROPIC_API_KEY" },
  openai: { label: "ChatGPT (OpenAI)", envKey: "OPENAI_API_KEY" },
  google: { label: "Gemini (Google)", envKey: "GEMINI_API_KEY" },
} as const;
export type BriefCopyProvider = keyof typeof BRIEF_COPY_PROVIDERS;

export interface BriefCopyModelInfo {
  provider: BriefCopyProvider;
  /** API 에 넣는 모델 ID */
  id: string;
  label: string;
  /** 짧은 설명(화면 도움말용) */
  note: string;
  inputUsd: number;
  outputUsd: number;
  /** 공급자별 기본 모델 */
  isDefault?: boolean;
}

export const BRIEF_COPY_MODELS: readonly BriefCopyModelInfo[] = [
  { provider: "anthropic", id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "균형(추천)", inputUsd: 2, outputUsd: 10, isDefault: true },
  { provider: "anthropic", id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "가장 저렴·빠름", inputUsd: 0.1, outputUsd: 0.5 },
  { provider: "anthropic", id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "고품질·비쌈", inputUsd: 4, outputUsd: 20 },
  { provider: "openai", id: "gpt-6.2-sol", label: "GPT-6.2 Sol", note: "균형(추천)", inputUsd: 2, outputUsd: 10, isDefault: true },
  { provider: "openai", id: "gpt-6-luna", label: "GPT-6 Luna", note: "가장 저렴·빠름", inputUsd: 0.1, outputUsd: 0.5 },
  { provider: "openai", id: "gpt-6.2-astra", label: "GPT-6.2 Astra", note: "최고급·가장 비쌈", inputUsd: 8, outputUsd: 40 },
  { provider: "google", id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "균형(추천)", inputUsd: 1.5, outputUsd: 7.5, isDefault: true },
  { provider: "google", id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "가장 저렴·빠름", inputUsd: 0.3, outputUsd: 2.5 },
  { provider: "google", id: "gemini-4-argon", label: "Gemini 4 Argon", note: "고품질·비쌈", inputUsd: 4, outputUsd: 20 },
];

export const PRICE_SOURCES = {
  anthropic: { url: "https://platform.claude.com/docs/en/about-claude/pricing", checked: "2026-11-03" },
  openai: { url: "https://developers.openai.com/api/docs/pricing", checked: "2026-11-19" },
  google: { url: "https://ai.google.dev/gemini-api/docs/pricing", checked: "2026-11-19" },
} as const;

export function findBriefCopyModel(provider: string, model: string): BriefCopyModelInfo | undefined {
  return BRIEF_COPY_MODELS.find((m) => m.provider === provider && m.id === model);
}

export function defaultBriefCopyModel(provider: BriefCopyProvider): BriefCopyModelInfo {
  const m = BRIEF_COPY_MODELS.find((x) => x.provider === provider && x.isDefault);
  if (!m) throw new Error(`기본 모델이 없습니다: ${provider}`);
  return m;
}
