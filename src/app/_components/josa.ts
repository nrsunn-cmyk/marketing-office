/**
 * 한국어 조사 고르기(받침 있음/없음). "을(를)"·"은(는)" 같은 두 가지 표기를 화면에 보이지 않게 한다
 * (AGY DESIGN-REVIEW-P3C-UI-01 2절 1: "자산 이름을 입력해 주세요." · "라이선스·주의 메모는 500자까지…").
 * 마지막 글자가 한글 음절이 아니면(괄호·숫자·영문 등) 그 앞의 마지막 한글 음절로 판단하고, 한글이 없으면 받침 없음으로 본다.
 */
function lastHangul(word: string): number | null {
  const chars = Array.from(word);
  for (let i = chars.length - 1; i >= 0; i--) {
    const c = chars[i].codePointAt(0)!;
    if (c >= 0xac00 && c <= 0xd7a3) return c;
  }
  return null;
}

/** 받침이 있는지 */
export function hasBatchim(word: string): boolean {
  const c = lastHangul(word);
  return c !== null && (c - 0xac00) % 28 !== 0;
}

/** "이름을"·"메모를" */
export const eulReul = (word: string) => `${word}${hasBatchim(word) ? "을" : "를"}`;
/** "이름은"·"메모는" */
export const eunNeun = (word: string) => `${word}${hasBatchim(word) ? "은" : "는"}`;
/** "이름이"·"메모가" */
export const iGa = (word: string) => `${word}${hasBatchim(word) ? "이" : "가"}`;

/** 입력 점검 안내(받침에 맞춘 확정 형식) */
export const requiredMessage = (label: string) => `${eulReul(label)} 입력해 주세요.`;
export const maxLengthMessage = (label: string, max: number) => `${eunNeun(label)} ${max.toLocaleString("ko-KR")}자까지 쓸 수 있습니다.`;
