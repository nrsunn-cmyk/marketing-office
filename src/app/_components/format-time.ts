/**
 * 업무실 시간대 기준 날짜·시각 표시 (UI-TIME-01).
 * 서버에서 그리는 화면은 서버 시간대(Vercel은 UTC)를 따르므로, 시간대를 꼭 넘겨서 표시한다.
 * 표시 모양은 기존 toLocaleString("ko-KR")와 같다(예: 2026. 11. 16. 오전 1:19:00).
 */
export function formatDateTimeIn(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("ko-KR", { timeZone });
}
