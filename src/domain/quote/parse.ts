/**
 * 화면 입력 문자열을 견적 계산용 정수로 바꾼다.
 * 빈 입력은 null(미입력)로, 잘못된 입력은 오류로 돌려준다. 빈 값을 0으로 바꾸지 않는다.
 */

export type ParseResult =
  | { ok: true; value: number | null }
  | { ok: false; reason: "INVALID" | "TOO_PRECISE" | "NEGATIVE" | "TOO_LARGE" };

const QTY_RE = /^(\d{1,3}(,\d{3})+|\d+)(\.(\d+))?$/;
const WON_RE = /^(\d{1,3}(,\d{3})+|\d+)$/;

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, "").replace(/원$/, "");
}

/** "1.5" → 150, "1,000" → 100000, "" → null */
export function parseQuantity(text: string): ParseResult {
  const s = normalize(text);
  if (s === "") return { ok: true, value: null };
  if (s.startsWith("-")) return { ok: false, reason: "NEGATIVE" };
  const m = QTY_RE.exec(s);
  if (!m) return { ok: false, reason: "INVALID" };
  const frac = m[4] ?? "";
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) return { ok: false, reason: "TOO_PRECISE" };
  const whole = m[1].replace(/,/g, "");
  const value = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(value)) return { ok: false, reason: "TOO_LARGE" };
  return { ok: true, value };
}

/** "50,000" → 50000, "50000원" → 50000, "" → null. 소수는 허용하지 않는다. */
export function parseWon(text: string): ParseResult {
  const s = normalize(text);
  if (s === "") return { ok: true, value: null };
  if (s.startsWith("-")) return { ok: false, reason: "NEGATIVE" };
  if (!WON_RE.test(s)) return { ok: false, reason: "INVALID" };
  const value = Number(s.replace(/,/g, ""));
  if (!Number.isSafeInteger(value)) return { ok: false, reason: "TOO_LARGE" };
  return { ok: true, value };
}

/** "10" 또는 "10%" → 1000 (만분율). 소수 둘째 자리까지. */
export function parseTaxRatePercent(text: string): ParseResult {
  const s = normalize(text).replace(/%$/, "");
  const q = parseQuantity(s);
  return q;
}

/** 원 단위 정수를 "110,000"처럼 표시한다. */
export function formatWon(value: number): string {
  return value.toLocaleString("ko-KR");
}
