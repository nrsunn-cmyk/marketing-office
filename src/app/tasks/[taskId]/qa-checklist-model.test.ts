import { describe, expect, it } from "vitest";
import { DEFAULT_QA_ITEMS, QA_LIMITS as SERVER_LIMITS, QA_TARGET_KIND_KEYS as SERVER_KINDS } from "@/domain/qa-delivery";
import {
  QA_COPY,
  QA_LIMITS,
  QA_STATUSES,
  QA_TARGET_KIND_KEYS,
  QA_VERDICTS,
  canAddQaItem,
  canRemoveQaItem,
  fixRequestedTargetIds,
  checkItemTitle,
  checkQaItems,
  currentRound,
  formatKstMinute,
  gateBadgeText,
  memoKey,
  newQaItem,
  titleKey,
  qaGate,
  qaGateText,
  qaTabName,
  qaTabText,
  qaTargetState,
  toQaPayload,
  type QaItemView,
  type QaRoundView,
  type QaTargetView,
} from "./qa-checklist-model";

const item = (id: string, verdict: QaItemView["verdict"], isRequired = true, memo = ""): QaItemView => ({ id, itemTitle: `항목 ${id}`, isRequired, isDefault: isRequired, verdict, memo, checkedByName: null, checkedAt: null, sortOrder: Number(id.replace(/\D/g, "")) || 1 });
const GATE = { requiredTotal: 0, requiredPassed: 0, optionalNeedsFix: 0, blockedBy: "pending" as const };
const round = (roundNo: number, items: QaItemView[], x: Partial<QaRoundView> = {}): QaRoundView => ({ id: `r${roundNo}`, roundNo, status: "drafting", archivedAt: null, approvedAt: null, revision: 1, targetVersionId: "v3", targetVersionNo: 3, stale: false, items, gate: GATE, createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-20T00:00:00Z", ...x });
const target = (x: Partial<QaTargetView> = {}): QaTargetView => ({ kind: "web_copy", targetId: "t1", title: "브랜드 홈페이지", exists: true, baseArchived: false, baseNotReady: false, currentVersionNo: 3, canOpen: true, rounds: [], ...x });

describe("P3-f 검수 체크리스트 화면 모델(인계표 P3F-HANDOFF.md)", () => {
  it("한도·종류·상태·판정은 인계표와 같다(보관은 상태가 아님)", () => {
    expect(QA_LIMITS).toEqual({ roundsPerTarget: 30, itemsMin: 1, itemsMax: 30, itemTitle: 120, memo: 500 });
    expect(QA_TARGET_KIND_KEYS).toEqual(["web_copy", "design_assets", "video_plan", "ppt_deck"]);
    expect(Object.keys(QA_STATUSES)).toEqual(["drafting", "fix_requested", "reviewed"]);
    expect(QA_VERDICTS).toEqual({ pending: "미확인", passed: "통과", needs_fix: "보완 필요" });
    // 화면은 zod 를 피하려고 값을 따로 둔다 — 서버 도메인과 같아야 한다
    expect(QA_LIMITS).toEqual(SERVER_LIMITS);
    expect(QA_TARGET_KIND_KEYS).toEqual([...SERVER_KINDS]);
    expect(Object.values(DEFAULT_QA_ITEMS).map((x) => x.length)).toEqual([4, 4, 4, 4]); // AGY DEFAULT_QA_ITEMS 4종 × 4(서버가 회차를 열 때 만든다)
  });

  it("승인 게이트: 필수 항목이 모두 통과여야 준비(선택 항목은 세지 않음), 개수만", () => {
    expect(qaGate([item("1", "passed"), item("2", "passed"), item("3", "needs_fix", false)])).toMatchObject({ required: 2, passed: 2, needsFix: 1, ready: true });
    const g = qaGate([item("1", "passed"), item("2", "needs_fix"), item("3", "pending")]);
    expect(g).toMatchObject({ required: 3, passed: 1, needsFix: 1, pending: 1, ready: false });
    expect(gateBadgeText(g)).toBe("승인 불가 (보완 1건)");
    expect(gateBadgeText(qaGate([item("1", "pending")]))).toBe("승인 불가 (미확인 1건)");
    expect(qaGate([]).ready).toBe(false); // 필수 항목이 없으면 승인 준비로 보지 않는다
  });

  it("탭 글: 통과 수, 승인 전 전체 통과면 '승인 가능', 회차가 없으면 이름만", () => {
    expect(qaTabText(target())).toBe("홈페이지");
    expect(qaTabText(target({ rounds: [round(1, [item("1", "passed"), item("2", "passed"), item("3", "needs_fix")])] }))).toBe("홈페이지 (2/3 통과)");
    expect(qaTabText(target({ kind: "video_plan", rounds: [round(1, [item("1", "passed"), item("2", "passed")])] }))).toBe("영상 (2/2 통과 · 승인 가능)");
    expect(qaTabText(target({ kind: "ppt_deck", rounds: [round(1, [item("1", "passed")], { status: "reviewed" })] }))).toBe("PPT (1/1 통과)");
    expect(qaTabText(target({ rounds: [round(1, [item("1", "passed")], { archivedAt: "2026-11-20T00:00:00Z" })] }))).toBe("홈페이지 (1/1 통과)");
  });

  it("지금 회차 = 번호가 가장 큰 것, 탭 이름은 같은 종류가 여럿일 때만 제목을 붙임(디자인 자산은 자산마다)", () => {
    const t = target({ rounds: [round(2, []), round(1, []), round(3, [])] });
    expect(currentRound(t)?.roundNo).toBe(3);
    expect(qaTabName(target({ kind: "design_assets", title: "로고 심볼" }), 2)).toBe("디자인 자산 · 로고 심볼");
    expect(qaTabName(target({ kind: "design_assets", title: "로고 심볼" }), 1)).toBe("디자인 자산");
    expect(qaTabText(target({ kind: "design_assets", title: "색상 토큰", rounds: [round(1, [item("1", "passed")])] }), 2)).toBe("디자인 자산 · 색상 토큰 (1/1 통과 · 승인 가능)");
  });

  it("승인 게이트 문구: 서버 gate.blockedBy → QA_COPY(Backend 6절)", () => {
    expect(qaGateText(null)).toBe(QA_COPY.gateReady);
    expect(qaGateText("pending")).toBe(QA_COPY.gateBlocked);
    expect(qaGateText("needs_fix")).toBe(QA_COPY.gateBlocked);
    expect(qaGateText("stale")).toBe(QA_COPY.staleBanner);
    expect(qaGateText("archived")).toBe(QA_COPY.baseArchivedNotice);
    expect(qaGateText("not_reviewed")).toBe(QA_COPY.baseNotReadyNotice);
    expect(QA_COPY.optionalNeedsFixWarn(2)).toBe("보완 필요 선택 항목 2개가 남아 있습니다.");
  });

  it("원인별 안내 우선순위: 권한 없음 → 바탕 보관 → 회차 보관 → 확정 전, 회차 한도 30", () => {
    const o = { canWrite: true, readOnly: false };
    expect(qaTargetState(target(), o)).toMatchObject({ notice: null, locked: false, canOpen: true, canRebase: true });
    // 열 수 있는지는 서버 canOpen
    expect(qaTargetState(target({ canOpen: false }), o)).toMatchObject({ canOpen: false });
    expect(qaTargetState(target(), { canWrite: false, readOnly: false })).toMatchObject({ notice: QA_COPY.noPermission, locked: true, canOpen: false });
    expect(qaTargetState(target({ baseArchived: true }), o)).toMatchObject({ notice: QA_COPY.baseArchivedNotice, locked: true });
    expect(qaTargetState(target({ rounds: [round(1, [], { archivedAt: "2026-11-20T00:00:00Z", stale: true })] }), o)).toMatchObject({ notice: QA_COPY.archivedNote, locked: true, archived: true, stale: false });
    expect(qaTargetState(target({ baseNotReady: true, canOpen: false }), o)).toMatchObject({ notice: QA_COPY.baseNotReadyNotice, canOpen: false, canRebase: false });
    expect(qaTargetState(target({ exists: false }), o)).toMatchObject({ canOpen: false });
    // 프로젝트 읽기 전용 안내는 영역 위에 한 번(대상마다 다시 쓰지 않음)
    expect(qaTargetState(target(), { canWrite: true, readOnly: true })).toMatchObject({ notice: null, locked: true, canOpen: false });
    const full = target({ rounds: Array.from({ length: 30 }, (_, i) => round(i + 1, [])) });
    expect(qaTargetState(full, o)).toMatchObject({ roundsFull: true, canOpen: false });
  });

  it("입력 점검: 보완 필요는 메모 필수, 메모 500자, 항목 제목 120자 — 확정 문구 그대로", () => {
    const issues = checkQaItems([
      { id: "a", itemTitle: "a", verdict: "needs_fix", memo: "  " },
      { id: "b", itemTitle: "b", verdict: "passed", memo: "가".repeat(501) },
      { id: "c", itemTitle: "c", verdict: "needs_fix", memo: "CTA 문구 수정" },
      { id: "d", itemTitle: "d", verdict: "pending", memo: "" },
      { id: null, itemTitle: "  ", verdict: "pending", memo: "" },
      { id: null, itemTitle: "가".repeat(121), verdict: "pending", memo: "" },
      { id: null, itemTitle: "모바일 넘침 확인", verdict: "pending", memo: "" },
    ]);
    // memoRequired 는 하나(AGY DESIGN-REVIEW-P3FG-UI-01 1번, 31자), 새 항목만 제목 점검
    expect(issues).toEqual({
      [memoKey(0)]: "보완 필요로 판정한 항목은 검수 메모를 꼭 적어 주세요.",
      [memoKey(1)]: "검수 메모는 500자까지 쓸 수 있습니다.",
      [titleKey(4)]: "검수 항목 제목을 입력해 주세요.",
      [titleKey(5)]: "검수 항목 제목은 120자까지 쓸 수 있습니다.",
    });
    expect(checkItemTitle("")).toBe(QA_COPY.itemTitleRequired);
    expect(checkItemTitle("가".repeat(121))).toBe(QA_COPY.itemTitleMax);
    expect(checkItemTitle("모바일 넘침 확인")).toBeNull();
  });

  it("보낼 값(Backend 6절): 바뀐 기존 항목만 { itemId, verdict, memo(빈칸 null) }, 새 항목은 { title, isRequired }, 값은 자르지 않음", () => {
    const saved = [item("i1", "pending"), item("i2", "passed"), item("i3", "pending")];
    const p = toQaPayload(
      [
        { id: "i1", itemTitle: "기존", verdict: "needs_fix", memo: "가".repeat(600) },
        { id: "i2", itemTitle: "그대로", verdict: "passed", memo: "" },
        { id: "i3", itemTitle: "메모 지움", verdict: "passed", memo: "  " },
        { id: null, itemTitle: "추가 항목", verdict: "pending", memo: "" },
      ],
      saved,
    );
    expect(p).toEqual({
      remove: [],
      set: [
        { itemId: "i1", verdict: "needs_fix", memo: "가".repeat(600) },
        { itemId: "i3", verdict: "passed", memo: null },
      ],
      add: [{ title: "추가 항목", isRequired: true }],
    });
    // 항목 추가: 30개까지(인계표 1~30), 새 항목은 미확인·빈 제목
    expect(canAddQaItem(29)).toBe(true);
    expect(canAddQaItem(30)).toBe(false);
    expect(newQaItem()).toEqual({ id: null, itemTitle: "", verdict: "pending", memo: "" });
    expect(QA_COPY.addItem).toBe("+ 검수 항목 추가");
    expect(QA_COPY.itemTitlePlaceholder).toBe("추가로 확인할 검수 항목 제목을 입력해 주세요.");
    expect(QA_COPY.itemLimitReached).toBe("검수 항목은 30개까지 둘 수 있습니다. 불필요한 항목을 정리한 뒤 추가해 주세요.");
    expect("memoRequiredNote" in QA_COPY).toBe(false);
  });

  it("문구: AGY P3-COPY-FINAL 4절 그대로(일부, '판' 통일), 시각", () => {
    expect(QA_COPY.staleBanner).toBe("검수 대상 결과물이 새 판으로 수정되었습니다. 새 판에 맞춰 재검수가 필요합니다.");
    expect(QA_COPY.rebase).toBe("새 판 기준으로 재검수 시작");
    expect(QA_COPY.fixRequestedOnTarget).toBe("검수에서 보완 요청됨");
    expect(QA_COPY.gateBlocked).toBe("보완 필요 또는 미확인 필수 항목이 남아 있어 승인할 수 없습니다.");
    expect(QA_COPY.roundLimitReached).toBe("검수 회차는 30회까지 기록할 수 있습니다.");
    expect(QA_COPY.archive).toBe("이 검수 기록 보관");
    expect(formatKstMinute("2026-11-19T18:10:00Z")).toBe("2026-11-20 03:10 KST");
    expect(formatKstMinute(null)).toBe("시각 알 수 없음");
  });
});

describe("R1: 항목 삭제·보완 요청 배지(AGY DESIGN-REVIEW-P3FG-CONNECT-01·Backend P3FG-ACTIONS-REVIEW-01)", () => {
  it("삭제는 열린 회차의 기본 아닌 항목만, 보낼 값은 remove 먼저(삭제한 항목은 set 에서 뺌)", () => {
    const open = round(1, []);
    expect(canRemoveQaItem(open, { isDefault: false })).toBe(true);
    expect(canRemoveQaItem(open, { isDefault: true })).toBe(false);
    expect(canRemoveQaItem({ ...open, status: "fix_requested" }, { isDefault: false })).toBe(true);
    expect(canRemoveQaItem({ ...open, status: "reviewed" }, { isDefault: false })).toBe(false);
    expect(canRemoveQaItem({ ...open, archivedAt: "2026-11-20T00:00:00Z" }, { isDefault: false })).toBe(false);
    const p = toQaPayload([{ id: "x1", itemTitle: "추가", verdict: "passed", memo: "" }], [item("x1", "pending", false)], ["x1"]);
    expect(p).toEqual({ remove: ["x1"], set: [], add: [] });
    for (const [s, n] of [
      [QA_COPY.removeItem, 5],
      [QA_COPY.removeItemConfirm, 39],
      [QA_COPY.removeItemSubmit, 5],
      [QA_COPY.itemRemovedOk, 17],
    ] as const)
      expect(Array.from(s).length, s).toBe(n);
  });

  it("보완 요청 배지 대상: 열린 회차가 fix_requested 인 산출물 id 만(보관 회차·다른 상태는 아님)", () => {
    const ids = fixRequestedTargetIds([
      target({ targetId: "a", rounds: [round(1, [], { status: "fix_requested" })] }),
      target({ targetId: "b", rounds: [round(1, [], { status: "fix_requested", archivedAt: "2026-11-20T00:00:00Z" }), round(2, [])] }),
      target({ targetId: "c", rounds: [round(1, [], { status: "reviewed" })] }),
      target({ targetId: null, rounds: [round(1, [], { status: "fix_requested" })] }),
    ]);
    expect(ids).toEqual(["a"]);
  });
});
