/**
 * AI 문구 초안 1회 대략 비용(화면 표시용 어림, DEC08-UI-01). 실제 과금은 업체 콘솔이 기준이다.
 * - 한 번에 쓰는 토큰: 입력 3,000·출력 5,000(Backend 서버 시험의 예시 값, DEC08-AI-COPY-01 '확인' 절)
 * - 환율: 1달러 ≈ 1,450원(같은 보고서 '월 20달러 ≈ 2.9만 원'과 같은 기준)
 * - 요금(100만 토큰당 달러)은 서버 고정 목록(@/domain/brief/ai-models)의 값을 그대로 받는다
 * 예: Claude Sonnet 5.5(2/10) → 0.056달러 ≈ 81원 → '약 80원'(AGY 시안 BRIEF-AI-UI-01 의 예시와 같다)
 */
export const TYPICAL_TOKENS = { input: 3_000, output: 5_000 } as const;
export const KRW_PER_USD = 1_450;

export function estimateWon(model: { inputUsd: number; outputUsd: number }): number {
  const usd = (TYPICAL_TOKENS.input * model.inputUsd + TYPICAL_TOKENS.output * model.outputUsd) / 1_000_000;
  return usd * KRW_PER_USD;
}

/** '약 80원' · '10원 미만'(10원 단위 반올림) */
export function costText(model: { inputUsd: number; outputUsd: number }): string {
  const won = estimateWon(model);
  if (won < 10) return "10원 미만";
  return `약 ${(Math.round(won / 10) * 10).toLocaleString("ko-KR")}원`;
}

/** 전송 안내의 {공급자} 자리에 넣는 이름(AGY 확정 COPY-DEC08-01: Claude·OpenAI·Gemini) */
export const PROVIDER_SHORT_NAMES = { anthropic: "Claude", openai: "OpenAI", google: "Gemini" } as const;
