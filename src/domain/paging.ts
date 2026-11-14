/**
 * 목록 페이지 나누기 기준 (CR07).
 * '어디까지 봤는지'를 (시각, 고유번호) 짝으로 기억한다. 같은 시각인 행도 고유번호로 순서가 정해져
 * 다음 쪽에서 빠지거나 겹치지 않는다. 주소창에 들어가므로 형식을 엄격히 검사한다.
 */

export const PAGE_SIZE = 50;

export interface Cursor {
  at: string;
  id: string;
}

const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 형식뿐 아니라 실제로 있는 날짜·시각인지 본다(CR11). 2026-99-99T25:00:00Z 같은 값이 DB까지 가면
 * 'date/time field value out of range' 오류로 화면이 멈춘다. 윤년·월말, 시 0–23, 분·초 0–59,
 * 시간대 ±14:00 이내(분 0–59)만 받는다. 소수 초는 PostgreSQL처럼 6자리(마이크로초)까지.
 */
export function isValidTimestamp(value: string): boolean {
  const m = ISO_TIME.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  if (day > days || hour > 23 || minute > 59 || second > 59) return false;
  if (m[8] !== "Z") {
    const offH = Number(m[9]);
    const offM = Number(m[10]);
    if (offM > 59 || offH > 14 || (offH === 14 && offM > 0)) return false;
  }
  return true;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.at}|${c.id}`, "utf8").toString("base64url");
}

/** 잘못된 값이면 null (처음 쪽부터 보여 준다). */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let text: string;
  try {
    text = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [at, id, ...rest] = text.split("|");
  if (rest.length > 0 || !at || !id || !isValidTimestamp(at) || !UUID.test(id)) return null;
  return { at, id };
}

/** 쪽 번호 (화면 표시용). 1 이상 정수가 아니면 1. */
export function parsePage(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 1;
}
