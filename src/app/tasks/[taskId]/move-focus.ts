/**
 * 순서 옮기기(위로·아래로) 뒤 초점을 둘 단추(P3D-UI-A11Y-01, Tester QA-P3D-E2E-01 O1).
 * 옮긴 항목의 새 자리에서 같은 쪽 단추. 맨 위·맨 아래로 가서 그 단추가 꺼지면 반대쪽 단추.
 * 영상 장면·PPT 슬라이드 편집기가 함께 쓴다.
 */
export function focusSideAfterMove(from: number, dir: -1 | 1, length: number): { index: number; side: "up" | "down" } {
  const index = Math.min(Math.max(from + dir, 0), Math.max(length - 1, 0));
  const side = dir < 0 ? (index === 0 ? "down" : "up") : index === length - 1 ? "up" : "down";
  return { index, side };
}
