/**
 * 금액 한글 표기 (견적서 합계금액 "일금 일십일만 원정" 관행).
 * 고쳐 쓰기 어렵게 각 자리의 '일'도 적는다(일십·일백·일천).
 */

const DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL_UNITS = ["", "십", "백", "천"];
const BIG_UNITS = ["", "만", "억", "조", "경"];

/** 0 이상 정수를 한글 숫자로 (예: 110000 → "일십일만") */
export function koreanNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("0 이상 정수만 한글로 바꿀 수 있습니다.");
  if (value === 0) return "영";
  const groups: string[] = [];
  let rest = value;
  let big = 0;
  while (rest > 0) {
    const chunk = rest % 10000;
    if (chunk > 0) {
      let text = "";
      const digits = String(chunk).padStart(4, "0").split("").map(Number);
      digits.forEach((d, i) => {
        if (d > 0) text += DIGITS[d] + SMALL_UNITS[3 - i];
      });
      groups.unshift(text + BIG_UNITS[big]);
    }
    rest = Math.floor(rest / 10000);
    big += 1;
  }
  return groups.join(" ");
}

/** 견적서 합계금액 표기: "일금 일십일만 원정" */
export function koreanWonPhrase(value: number): string {
  return `일금 ${koreanNumber(value)} 원정`;
}
