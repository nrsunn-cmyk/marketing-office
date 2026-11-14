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

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (rest.length > 0 || !at || !id || !ISO_TIME.test(at) || !UUID.test(id)) return null;
  return { at, id };
}

/** 쪽 번호 (화면 표시용). 1 이상 정수가 아니면 1. */
export function parsePage(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 1;
}
