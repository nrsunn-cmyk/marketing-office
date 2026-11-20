import { beforeEach, describe, expect, it, vi } from "vitest";

/** P3FG-UI-CONNECT-01 검수·납품 동작: 형식 검사 → 서버 함수(차례로·revision 이어 쓰기) → refresh. 서버 함수는 가짜 */
const m = vi.hoisted(() => ({
  open: vi.fn(),
  set: vi.fn(),
  add: vi.fn(),
  fix: vi.fn(),
  approve: vi.fn(),
  rebase: vi.fn(),
  remove: vi.fn(),
  archiveQa: vi.fn(),
  create: vi.fn(),
  restore: vi.fn(),
  update: vi.fn(),
  archiveDb: vi.fn(),
  log: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./server", () => ({
  openQaReview: (...a: unknown[]) => m.open(...a),
  setQaItem: (...a: unknown[]) => m.set(...a),
  addQaItem: (...a: unknown[]) => m.add(...a),
  requestQaFix: (...a: unknown[]) => m.fix(...a),
  approveQaReview: (...a: unknown[]) => m.approve(...a),
  rebaseQaReview: (...a: unknown[]) => m.rebase(...a),
  removeQaItem: (...a: unknown[]) => m.remove(...a),
  archiveQaReview: (...a: unknown[]) => m.archiveQa(...a),
  createDeliveryBundle: (...a: unknown[]) => m.create(...a),
  restoreDeliveryBundle: (...a: unknown[]) => m.restore(...a),
  updateDeliveryBundle: (...a: unknown[]) => m.update(...a),
  archiveDeliveryBundle: (...a: unknown[]) => m.archiveDb(...a),
  addDeliveryLog: (...a: unknown[]) => m.log(...a),
}));
vi.mock("next/cache", () => ({ refresh: () => m.refresh() }));

const A = await import("./actions");
const R = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const T = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const B = "cccccccc-cccc-4ccc-8ccc-000000000001";
const P = "dddddddd-dddd-4ddd-8ddd-000000000001";
const I1 = "eeeeeeee-eeee-4eee-8eee-000000000001";
const I2 = "eeeeeeee-eeee-4eee-8eee-000000000002";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const rev = (n: number) => ({ ok: true, data: { revision: n } });

beforeEach(() => vi.clearAllMocks());

describe("검수 동작", () => {
  it("시작: 종류·산출물 id(판은 서버가 고름), 틀린 값은 서버 전에 거절", async () => {
    m.open.mockResolvedValue({ ok: true, data: { id: R } });
    expect(await A.openQaReviewAction({}, fd({ targetKind: "design_assets", targetId: T }))).toEqual({ ok: true, message: "검수 체크리스트를 시작했습니다." });
    expect(m.open).toHaveBeenCalledWith("design_assets", T);
    expect(await A.openQaReviewAction({}, fd({ targetKind: "logo", targetId: T }))).toEqual({ message: "잘못된 요청입니다." });
    expect(await A.openQaReviewAction({}, fd({ targetKind: "web_copy", targetId: "x" }))).toEqual({ message: "잘못된 요청입니다." });
    expect(m.open).toHaveBeenCalledTimes(1);
  });

  it("저장: 바뀐 항목 set → 새 항목 add 를 차례로, 앞 호출이 돌려준 revision 을 다음에 쓴다", async () => {
    m.set.mockResolvedValueOnce(rev(6)).mockResolvedValueOnce(rev(7));
    m.add.mockResolvedValueOnce(rev(8));
    const payload = JSON.stringify({ set: [{ itemId: I1, verdict: "needs_fix", memo: "CTA 과장" }, { itemId: I2, verdict: "passed", memo: null }], add: [{ title: "모바일 넘침", isRequired: true }] });
    expect(await A.saveQaItemsAction({}, fd({ roundId: R, revision: "5", payload }))).toEqual({ ok: true, message: "검수 판정과 메모를 저장했습니다." });
    expect(m.set.mock.calls).toEqual([
      [R, 5, { itemId: I1, verdict: "needs_fix", memo: "CTA 과장" }],
      [R, 6, { itemId: I2, verdict: "passed", memo: null }],
    ]);
    expect(m.add).toHaveBeenCalledWith(R, 7, { title: "모바일 넘침", isRequired: true });
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("저장: 중간 실패면 거기서 멈추고 서버 문구, 앞서 저장된 것이 있으면 새로 고침 / 바뀐 것 없음 / 틀린 입력", async () => {
    m.set.mockResolvedValueOnce(rev(6)).mockResolvedValueOnce({ ok: false, code: "CONFLICT", message: "다른 곳에서 먼저 고쳤습니다." });
    const payload = JSON.stringify({ set: [{ itemId: I1, verdict: "passed", memo: null }, { itemId: I2, verdict: "passed", memo: null }, { itemId: I1, verdict: "pending", memo: null }], add: [] });
    // 앞서 저장된 개수 한 줄(Backend 참고 1)
    expect(await A.saveQaItemsAction({}, fd({ roundId: R, revision: "5", payload }))).toEqual({ message: "다른 곳에서 먼저 고쳤습니다. 앞의 1건은 이미 저장되었습니다. 화면을 새로 고친 뒤 남은 변경 내용만 다시 저장해 주세요." });
    expect(m.set).toHaveBeenCalledTimes(2);
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect(await A.saveQaItemsAction({}, fd({ roundId: R, revision: "5", payload: JSON.stringify({ set: [], add: [] }) }))).toEqual({ message: "바뀐 판정·메모가 없습니다." });
    expect((await A.saveQaItemsAction({}, fd({ roundId: R, revision: "5", payload: "[1]" }))).message).toBe("입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요.");
    expect(await A.saveQaItemsAction({}, fd({ roundId: "x", revision: "5", payload }))).toEqual({ message: "잘못된 요청입니다." });
  });

  it("보완 요청·승인·재검수·보관: QA_COPY 성공 문구, roundId·revision", async () => {
    for (const k of ["fix", "approve", "archiveQa"] as const) m[k].mockResolvedValue(rev(6));
    m.rebase.mockResolvedValue({ ok: true, data: { id: R } });
    const f = () => fd({ roundId: R, revision: "5" });
    expect(await A.requestQaFixAction({}, f())).toEqual({ ok: true, message: "보완 요청을 보내고 수정 단계로 넘겼습니다." });
    expect(await A.approveQaReviewAction({}, f())).toEqual({ ok: true, message: "모든 필수 항목이 통과되어 결과물을 승인했습니다." });
    expect(m.approve).toHaveBeenCalledWith(R, 5);
    expect((await A.rebaseQaReviewAction({}, f())).ok).toBe(true);
    expect((await A.archiveQaReviewAction({}, f())).ok).toBe(true);
    m.approve.mockResolvedValueOnce({ ok: false, code: "INVALID_TRANSITION", message: "보완 필요 또는 미확인 필수 항목이 남아 있어 승인할 수 없습니다." });
    expect(await A.approveQaReviewAction({}, f())).toEqual({ message: "보완 필요 또는 미확인 필수 항목이 남아 있어 승인할 수 없습니다." });
  });
});

describe("납품 동작", () => {
  it("새 묶음은 projectId 만(서버가 승인본을 모음), 복구는 묶음 id", async () => {
    m.create.mockResolvedValue({ ok: true, data: { id: B } });
    m.restore.mockResolvedValue({ ok: true, data: { id: B } });
    expect(await A.createDeliveryBundleAction({}, fd({ projectId: P, items: "[]" }))).toEqual({ ok: true, message: "승인본으로 새 납품 묶음을 만들었습니다." });
    expect(m.create).toHaveBeenCalledWith(P);
    expect(await A.restoreDeliveryBundleAction({}, fd({ bundleId: B }))).toEqual({ ok: true, message: "선택한 납품 묶음 기준으로 새 납품 묶음을 복구했습니다." });
    expect(await A.createDeliveryBundleAction({}, fd({ projectId: "x" }))).toEqual({ message: "잘못된 요청입니다." });
  });

  it("전달 기록: bundleId·revision + payload 그대로, 일시 없으면 서버 전에 안내 / 상태·보관", async () => {
    m.log.mockResolvedValue(rev(4));
    const payload = JSON.stringify({ method: "email", deliveredAt: "2026-11-20T03:25:00+09:00", note: null });
    expect(await A.addDeliveryLogAction({}, fd({ bundleId: B, revision: "3", payload }))).toEqual({ ok: true, message: "고객 전달 기록을 남겼습니다." });
    expect(m.log).toHaveBeenCalledWith(B, 3, JSON.parse(payload));
    expect(await A.addDeliveryLogAction({}, fd({ bundleId: B, revision: "3", payload: JSON.stringify({ method: "email", deliveredAt: null, note: null }) }))).toEqual({ message: "전달 일시를 입력해 주세요." });
    expect(m.log).toHaveBeenCalledTimes(1);
    m.update.mockResolvedValue(rev(4));
    m.archiveDb.mockResolvedValue(rev(4));
    expect(await A.updateDeliveryBundleAction({}, fd({ bundleId: B, revision: "3", status: "reviewed" }))).toEqual({ ok: true, message: "묶음 상태를 저장했습니다." });
    expect(m.update).toHaveBeenCalledWith(B, 3, "reviewed");
    expect(await A.archiveDeliveryBundleAction({}, fd({ bundleId: B, revision: "3" }))).toEqual({ ok: true, message: "납품 묶음을 보관했습니다." });
    expect(await A.refreshDeliveryAction()).toEqual({ ok: true, message: "최신 승인본 목록을 다시 불러왔습니다." });
  });
});

describe("R1: 저장의 삭제(remove → set → add 차례)", () => {
  it("삭제를 먼저, revision 을 이어 쓰고, 삭제만이면 itemRemovedOk / 틀린 id 는 서버 전에 거절", async () => {
    m.remove.mockResolvedValueOnce(rev(6));
    m.set.mockResolvedValueOnce(rev(7));
    const payload = JSON.stringify({ remove: [I2], set: [{ itemId: I1, verdict: "passed", memo: null }], add: [] });
    expect(await A.saveQaItemsAction({}, fd({ roundId: R, revision: "5", payload }))).toEqual({ ok: true, message: "검수 판정과 메모를 저장했습니다." });
    expect(m.remove).toHaveBeenCalledWith(R, 5, I2);
    expect(m.set).toHaveBeenCalledWith(R, 6, { itemId: I1, verdict: "passed", memo: null });
    m.remove.mockResolvedValueOnce(rev(6));
    expect(await A.saveQaItemsAction({}, fd({ roundId: R, revision: "5", payload: JSON.stringify({ remove: [I2], set: [], add: [] }) }))).toEqual({ ok: true, message: "추가 검수 항목을 삭제했습니다." });
    m.remove.mockResolvedValueOnce({ ok: false, code: "INVALID_TRANSITION", message: "기본 필수 항목은 삭제할 수 없습니다." });
    expect(await A.saveQaItemsAction({}, fd({ roundId: R, revision: "5", payload: JSON.stringify({ remove: [I1], set: [], add: [] }) }))).toEqual({ message: "기본 필수 항목은 삭제할 수 없습니다." });
    const before = m.remove.mock.calls.length;
    expect((await A.saveQaItemsAction({}, fd({ roundId: R, revision: "5", payload: JSON.stringify({ remove: ["x"], set: [], add: [] }) }))).message).toBe("입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요.");
    expect(m.remove.mock.calls.length).toBe(before);
  });
});

describe("중간 실패 문구는 AGY 확정 QA_COPY.partialSavedNotice 와 같다", () => {
  it("같은 문장·54자({n} 세 글자 기준)", async () => {
    const { QA_COPY } = await import("@/app/tasks/[taskId]/qa-checklist-model");
    const { partialSavedNotice } = await import("./copy");
    expect(partialSavedNotice(3)).toBe(QA_COPY.partialSavedNotice(3));
    expect(Array.from(QA_COPY.partialSavedNotice(3)).length).toBe(52); // 표의 {n}(3자) → 숫자 1자
  });
});
