import { describe, expect, it } from "vitest";
import {
  QA_COPY,
  QA_LIMITS,
  QA_STATUSES,
  QA_TARGET_KIND_KEYS,
  QA_VERDICTS,
  checkItemTitle,
  checkQaItems,
  currentRound,
  formatKstMinute,
  gateBadgeText,
  latestReviewedVersion,
  memoKey,
  qaGate,
  qaTabText,
  qaTargetState,
  toQaPayload,
  type QaItemView,
  type QaRoundView,
  type QaTargetView,
} from "./qa-checklist-model";

const item = (id: string, verdict: QaItemView["verdict"], isRequired = true, memo = ""): QaItemView => ({ id, itemTitle: `항목 ${id}`, isRequired, verdict, memo, checkedByName: null, checkedAt: null, sortOrder: Number(id.replace(/\D/g, "")) || 1 });
const round = (roundNo: number, items: QaItemView[], x: Partial<QaRoundView> = {}): QaRoundView => ({ id: `r${roundNo}`, roundNo, status: "drafting", archivedAt: null, revision: 1, targetVersionId: "v3", targetVersionNo: 3, stale: false, items, createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-20T00:00:00Z", ...x });
const target = (x: Partial<QaTargetView> = {}): QaTargetView => ({ kind: "web_copy", exists: true, baseArchived: false, versions: [{ id: "v2", versionNo: 2, status: "reviewed" }, { id: "v3", versionNo: 3, status: "reviewed" }, { id: "v4", versionNo: 4, status: "drafting" }], rounds: [], ...x });

describe("P3-f 검수 체크리스트 화면 모델(인계표 P3F-HANDOFF.md)", () => {
  it("한도·종류·상태·판정은 인계표와 같다(보관은 상태가 아님)", () => {
    expect(QA_LIMITS).toEqual({ roundsPerTarget: 30, itemsMin: 1, itemsMax: 30, itemTitle: 120, memo: 500 });
    expect(QA_TARGET_KIND_KEYS).toEqual(["web_copy", "design_assets", "video_plan", "ppt_deck"]);
    expect(Object.keys(QA_STATUSES)).toEqual(["drafting", "fix_requested", "reviewed"]);
    expect(QA_VERDICTS).toEqual({ pending: "미확인", passed: "통과", needs_fix: "보완 필요" });
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

  it("지금 회차 = 번호가 가장 큰 것, 고를 판 = 검토 완료 판 중 최신", () => {
    const t = target({ rounds: [round(2, []), round(1, []), round(3, [])] });
    expect(currentRound(t)?.roundNo).toBe(3);
    expect(latestReviewedVersion(t)?.id).toBe("v3");
    expect(latestReviewedVersion(target({ versions: [{ id: "a", versionNo: 1, status: "drafting" }] }))).toBeNull();
  });

  it("원인별 안내 우선순위: 권한 없음 → 바탕 보관 → 회차 보관 → 확정 전, 회차 한도 30", () => {
    const o = { canWrite: true, readOnly: false };
    expect(qaTargetState(target(), o)).toMatchObject({ notice: null, locked: false, canOpen: true });
    expect(qaTargetState(target(), { canWrite: false, readOnly: false })).toMatchObject({ notice: QA_COPY.noPermission, locked: true, canOpen: false });
    expect(qaTargetState(target({ baseArchived: true }), o)).toMatchObject({ notice: QA_COPY.baseArchivedNotice, locked: true });
    expect(qaTargetState(target({ rounds: [round(1, [], { archivedAt: "2026-11-20T00:00:00Z", stale: true })] }), o)).toMatchObject({ notice: QA_COPY.archivedNote, locked: true, archived: true, stale: false });
    expect(qaTargetState(target({ versions: [] }), o)).toMatchObject({ notice: QA_COPY.baseNotReadyNotice, canOpen: false });
    expect(qaTargetState(target({ exists: false, versions: [] }), o)).toMatchObject({ notice: QA_COPY.baseNotReadyNotice, canOpen: false });
    // 프로젝트 읽기 전용 안내는 영역 위에 한 번(대상마다 다시 쓰지 않음)
    expect(qaTargetState(target(), { canWrite: true, readOnly: true })).toMatchObject({ notice: null, locked: true, canOpen: false });
    const full = target({ rounds: Array.from({ length: 30 }, (_, i) => round(i + 1, [])) });
    expect(qaTargetState(full, o)).toMatchObject({ roundsFull: true, canOpen: false });
  });

  it("입력 점검: 보완 필요는 메모 필수, 메모 500자, 항목 제목 120자 — 확정 문구 그대로", () => {
    const issues = checkQaItems([
      { id: "a", verdict: "needs_fix", memo: "  " },
      { id: "b", verdict: "passed", memo: "가".repeat(501) },
      { id: "c", verdict: "needs_fix", memo: "CTA 문구 수정" },
      { id: "d", verdict: "pending", memo: "" },
    ]);
    expect(issues).toEqual({ [memoKey(0)]: "보완 필요 판정에는 검수 메모를 입력해 주세요.", [memoKey(1)]: "검수 메모는 500자까지 쓸 수 있습니다." });
    expect(checkItemTitle("")).toBe(QA_COPY.itemTitleRequired);
    expect(checkItemTitle("가".repeat(121))).toBe(QA_COPY.itemTitleMax);
    expect(checkItemTitle("모바일 넘침 확인")).toBeNull();
  });

  it("보낼 값: 판정·메모만, 항목 id 그대로, 값은 자르지 않음", () => {
    const p = toQaPayload([{ id: "i1", verdict: "needs_fix", memo: "가".repeat(600) }]);
    expect(p).toEqual({ items: [{ id: "i1", verdict: "needs_fix", memo: "가".repeat(600) }] });
  });

  it("문구: AGY P3-COPY-FINAL 4절 그대로(일부), 시각", () => {
    expect(QA_COPY.gateBlocked).toBe("보완 필요 또는 미확인 필수 항목이 남아 있어 승인할 수 없습니다.");
    expect(QA_COPY.roundLimitReached).toBe("검수 회차는 30회까지 기록할 수 있습니다.");
    expect(QA_COPY.archive).toBe("이 검수 기록 보관");
    expect(formatKstMinute("2026-11-19T18:10:00Z")).toBe("2026-11-20 03:10 KST");
    expect(formatKstMinute(null)).toBe("시각 알 수 없음");
  });
});
