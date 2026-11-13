/**
 * 화면 입력 문자열을 견적 계산용 정수로 바꾼다.
 * 빈 입력은 null(미입력)로, 잘못된 입력은 오류로 돌려준다. 빈 값을 0으로 바꾸지 않는다.
 *
 * 허용 형식 (Codex 검수 CR01 반영)
 * - 앞뒤 공백·탭·줄바꿈만 무시한다. 숫자 안의 공백·탭·줄바꿈은 오류다 ("1 0" ≠ 10).
 * - 천 단위 쉼표는 세 자리마다 정확히 있을 때만 허용한다 ("1,000" O, "1,00" X).
 * - 단위는 칸마다 따로 정한다.
 *   - 금액: 끝에 "원" 허용, 앞에 공백 한 칸까지 ("50,000원", "50,000 원")
 *   - 세율: 끝에 "%" 허용, 앞에 공백 한 칸까지 ("10%", "10 %")
 *   - 수량: 단위 없음
 */

export type ParseResult =
  | { ok: true; value: number | null }
  | { ok: false; reason: "INVALID" | "TOO_PRECISE" | "NEGATIVE" | "TOO_LARGE" };

const INTEGER_PART = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)`;
const DECIMAL_RE = new RegExp(String.raw`^(${INTEGER_PART})(?:\.(\d+))?$`);
const WON_RE = new RegExp(String.raw`^(${INTEGER_PART})(?: ?원)?$`);
const PERCENT_RE = new RegExp(String.raw`^(${INTEGER_PART}(?:\.\d+)?)(?: ?%)?$`);

/** 소수 둘째 자리까지의 숫자 문자열을 100배 정수로 바꾼다. 단위·부호가 없는 문자열만 받는다. */
function parseHundredths(s: string): ParseResult {
  const m = DECIMAL_RE.exec(s);
  if (!m) return { ok: false, reason: "INVALID" };
  const frac = m[2] ?? "";
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) return { ok: false, reason: "TOO_PRECISE" };
  const value = Number(m[1].replace(/,/g, "")) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(value)) return { ok: false, reason: "TOO_LARGE" };
  return { ok: true, value };
}

/** "1.5" → 150, "1,000" → 100000, "" → null */
export function parseQuantity(text: string): ParseResult {
  const s = text.trim();
  if (s === "") return { ok: true, value: null };
  if (s.startsWith("-")) return { ok: false, reason: "NEGATIVE" };
  return parseHundredths(s);
}

/** "50,000" → 50000, "50,000원" → 50000, "" → null. 소수는 허용하지 않는다. */
export function parseWon(text: string): ParseResult {
  const s = text.trim();
  if (s === "") return { ok: true, value: null };
  if (s.startsWith("-")) return { ok: false, reason: "NEGATIVE" };
  const m = WON_RE.exec(s);
  if (!m) return { ok: false, reason: "INVALID" };
  const value = Number(m[1].replace(/,/g, ""));
  if (!Number.isSafeInteger(value)) return { ok: false, reason: "TOO_LARGE" };
  return { ok: true, value };
}

/** "10" 또는 "10%" → 1000 (만분율). 소수 둘째 자리까지. */
export function parseTaxRatePercent(text: string): ParseResult {
  const s = text.trim();
  if (s === "") return { ok: true, value: null };
  if (s.startsWith("-")) return { ok: false, reason: "NEGATIVE" };
  const m = PERCENT_RE.exec(s);
  if (!m) return { ok: false, reason: "INVALID" };
  return parseHundredths(m[1]);
}

/** 100배 정수 수량을 "1.5", "1,000", "0.01"처럼 표시한다 (뒤의 0은 뺀다). */
export function formatQuantity(hundredths: number): string {
  const whole = Math.trunc(hundredths / 100);
  const frac = hundredths % 100;
  const w = whole.toLocaleString("ko-KR");
  if (frac === 0) return w;
  return `${w}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** 만분율 세율을 "10", "3.3"처럼 표시한다. */
export function formatTaxRate(basisPoints: number): string {
  return formatQuantity(basisPoints).replace(/,/g, "");
}

/** 원 단위 정수를 "110,000"처럼 표시한다. */
export function formatWon(value: number): string {
  return value.toLocaleString("ko-KR");
}
