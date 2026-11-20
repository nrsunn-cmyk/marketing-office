/**
 * P3-f 결과물 검수 체크리스트 — 화면 쪽 모델.
 * P3FG-UI-CONNECT-01: 보기 타입은 서버(src/features/qa-delivery/server.ts, Backend P3FG-BACKEND-IMPL-01) 것.
 * 대상은 산출물 하나(디자인 자산은 자산마다, Master ①), 승인 게이트는 서버 gate.blockedBy 로 고른다.
 * 'use client' 편집기가 가져오므로 zod 를 쓰는 도메인 값은 가져오지 않는다(한도·종류는 시험으로 서버와 대조).
 * 근거: AGY Design/p3-production/P3F-HANDOFF.md(회차·항목 한도·필드·판정·승인 게이트·보관 archived_at 분리),
 * qa-checklist.html(배치·라벨), P3-COPY-FINAL.md 4절 QA_COPY·0절 P3_COMMON_COPY(그대로 — 새 문구를 만들지 않는다).
 * 승인 게이트의 최종 판단은 서버 RPC 가 한다(인계표 3절 1). 화면은 저장된 판정으로 미리 알리기만 한다.
 */
import { briefTrim, charLength } from "@/domain/production-brief/constants";
import type { QaChecklistData, QaGateBlock, QaItemView, QaRoundView, QaTargetView } from "@/features/qa-delivery/server";
import { maxLengthMessage, requiredMessage } from "../../_components/josa";

export { P3_COMMON_COPY } from "./design-assets-model";

/** 한도(P3F-HANDOFF 1·2절, 글자 수는 코드 포인트) */
export const QA_LIMITS = {
  roundsPerTarget: 30,
  itemsMin: 1,
  itemsMax: 30,
  itemTitle: 120,
  memo: 500,
} as const;

/** 대상 결과물 종류(코드 = 인계표, 탭 이름 = 시안, 판 이름 = 각 단계 화면 제목) */
export const QA_TARGET_KINDS = {
  web_copy: { tab: "홈페이지", product: "홈페이지 구조·문구" },
  design_assets: { tab: "디자인 자산", product: "디자인 자산 관리" },
  video_plan: { tab: "영상", product: "영상 구성·파일 관리" },
  ppt_deck: { tab: "PPT", product: "PPT 구성·템플릿·내보내기" },
} as const;
export type QaTargetKind = keyof typeof QA_TARGET_KINDS;
export const QA_TARGET_KIND_KEYS = Object.keys(QA_TARGET_KINDS) as QaTargetKind[];

/** 회차 진행 상태(인계표 2절 가). 보관은 status 가 아니라 archivedAt */
export const QA_STATUSES = { drafting: "작성 중", fix_requested: "보완 요청됨", reviewed: "검토 완료" } as const;
export type QaStatus = keyof typeof QA_STATUSES;

/** 항목 판정(인계표 2절 나, 이름 = 시안) */
export const QA_VERDICTS = { pending: "미확인", passed: "통과", needs_fix: "보완 필요" } as const;
export type QaVerdict = keyof typeof QA_VERDICTS;
export const QA_VERDICT_KEYS = Object.keys(QA_VERDICTS) as QaVerdict[];

export type { QaChecklistData, QaGateBlock, QaItemView, QaRoundView, QaTargetView };

/** 화면 문구 최종본(P3-COPY-FINAL.md 4절 QA_COPY — 그대로) */
export const QA_COPY = {
  heading: "검수 체크리스트",
  intro: "결과물별 모든 필수 항목이 통과해야 승인할 수 있습니다. 보완이 필요하면 보완 요청을 보내고 수정 후 재검수합니다.",
  gateBlocked: "보완 필요 또는 미확인 필수 항목이 남아 있어 승인할 수 없습니다.",
  gateReady: "모든 필수 항목이 통과되었습니다. 승인하면 납품 묶음에 포함될 수 있습니다.",
  emptyTitle: "아직 시작된 검수 체크리스트가 없습니다.",
  emptyDesc: "검토 완료 상태의 결과물이 준비되면 기본 검수 체크리스트를 시작할 수 있습니다.",
  create: "+ 검수 체크리스트 시작하기",
  roundLimitReached: "검수 회차는 30회까지 기록할 수 있습니다.",
  staleBanner: "검수 대상 결과물이 새 판으로 수정되었습니다. 새 판에 맞춰 재검수가 필요합니다.",
  rebase: "새 판 기준으로 재검수 시작",
  archivedNote: "보관한 검수 기록입니다. 조회만 할 수 있고 판정·보완 요청·승인은 할 수 없습니다.",
  noPermission: "검수 판정을 내리거나 승인할 권한이 없습니다.",
  loadError: "검수 체크리스트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  // 하나로 통합(AGY DESIGN-REVIEW-P3FG-UI-01 1번, 31자)
  memoRequired: "보완 필요로 판정한 항목은 검수 메모를 꼭 적어 주세요.",
  save: "검수 내용 저장",
  requestFix: "보완 요청 보내기",
  approve: "이 결과물 승인",
  archive: "이 검수 기록 보관",
  savedOk: "검수 판정과 메모를 저장했습니다.",
  fixRequestedOk: "보완 요청을 보내고 수정 단계로 넘겼습니다.",
  approvedOk: "모든 필수 항목이 통과되어 결과물을 승인했습니다.",
  baseArchivedNotice: "바탕이 된 결과물이나 작업이 보관되었습니다. 이 검수 기록은 조회만 할 수 있습니다.",
  baseNotReadyNotice: "대상 결과물이 아직 검토 완료 전이라 검수를 열거나 승인할 수 없습니다.",
  itemTitleRequired: "검수 항목 제목을 입력해 주세요.",
  itemTitleMax: "검수 항목 제목은 120자까지 쓸 수 있습니다.",
  memoMax: "검수 메모는 500자까지 쓸 수 있습니다.",
  // 검수 항목 추가(AGY DESIGN-REVIEW-P3FG-UI-01 2번)
  addItem: "+ 검수 항목 추가",
  itemTitlePlaceholder: "추가로 확인할 검수 항목 제목을 입력해 주세요.",
  itemLimitReached: "검수 항목은 30개까지 둘 수 있습니다. 불필요한 항목을 정리한 뒤 추가해 주세요.",
  // 선택 항목이 보완 필요여도 승인은 된다(Master ⑦) — 그때 경고
  optionalNeedsFixWarn: (n: number) => `보완 필요 선택 항목 ${n}개가 남아 있습니다.`,
  fixRequestedOnTarget: "검수에서 보완 요청됨",
  // 검수 항목 삭제(AGY DESIGN-REVIEW-P3FG-CONNECT-01 3절): 열린 회차의 추가 항목(기본 아님)만, 접힌 확인 단계
  removeItem: "항목 삭제",
  removeItemConfirm: "추가한 검수 항목을 삭제합니다. 기본 필수 항목은 삭제할 수 없습니다.",
  removeItemSubmit: "삭제 확인",
  itemRemovedOk: "추가 검수 항목을 삭제했습니다.",
} as const;

/** 시안 qa-checklist.html 의 라벨(AGY 문구 — 그대로) */
export const QA_LABELS = {
  targetVersion: "검수 대상 판:",
  gatePrefix: "승인 조건 미충족:",
  required: "[필수]",
  verdict: "판정",
  memo: "검수 메모",
  memoWhenFix: "검수 메모 (보완 시 필수)",
  checker: "검수자",
  lastChecked: "마지막 확인",
  historyHeading: "보완 요청 · 재검수 흐름 이력",
  currentRound: "현재 회차",
  fixed: "수정됨",
  staleBadge: "이전 기준",
  stalePrefix: "이전 기준:",
  archivedBadge: "보관",
  passed: "통과",
  approvable: "승인 가능",
  newItemPending: "새 항목은 저장한 뒤 판정할 수 있습니다(처음에는 미확인).",
} as const;

// ── 계산 ──
export const sortedItems = (items: readonly QaItemView[]) => [...items].sort((a, b) => a.sortOrder - b.sortOrder);
/** 지금 회차 = 회차 번호가 가장 큰 것(보관 포함) */
export const currentRound = (t: Pick<QaTargetView, "rounds">): QaRoundView | null => t.rounds.reduce<QaRoundView | null>((a, r) => (!a || r.roundNo > a.roundNo ? r : a), null);

/** 승인 게이트(인계표 3절 1): 필수 항목이 모두 통과여야 승인 가능. 근거 없는 %가 아니라 실제 개수만 */
export function qaGate(items: readonly Pick<QaItemView, "isRequired" | "verdict">[]) {
  const required = items.filter((i) => i.isRequired);
  const passed = required.filter((i) => i.verdict === "passed").length;
  const needsFix = items.filter((i) => i.verdict === "needs_fix").length;
  const pending = required.filter((i) => i.verdict === "pending").length;
  return { required: required.length, passed, needsFix, pending, ready: required.length > 0 && passed === required.length };
}
/** 탭 이름: 종류(같은 종류가 여럿이면 산출물 제목을 붙임 — 디자인 자산은 자산마다) */
export const qaTabName = (t: Pick<QaTargetView, "kind" | "title">, sameKind: number) => (sameKind > 1 && t.title ? `${QA_TARGET_KINDS[t.kind].tab} · ${t.title}` : QA_TARGET_KINDS[t.kind].tab);
/** 탭 글 "홈페이지 (2/3 통과)" · 승인 전 전체 통과면 " · 승인 가능"(시안) */
export function qaTabText(t: QaTargetView, sameKind = 1): string {
  const r = currentRound(t);
  const name = qaTabName(t, sameKind);
  if (!r) return name;
  const g = qaGate(r.items);
  const ok = g.ready && r.status !== "reviewed" && !r.archivedAt ? ` · ${QA_LABELS.approvable}` : "";
  return `${name} (${g.passed}/${g.required} ${QA_LABELS.passed}${ok})`;
}
/** 시안 배지 "승인 불가 (보완 1건)" — 보완 필요가 없으면 미확인 수 */
export function gateBadgeText(g: ReturnType<typeof qaGate>): string {
  return g.needsFix > 0 ? `승인 불가 (보완 ${g.needsFix}건)` : `승인 불가 (미확인 ${g.pending}건)`;
}
export const versionText = (kind: QaTargetKind, versionNo: number) => `${QA_TARGET_KINDS[kind].product} v${versionNo}`;

/**
 * 대상 하나의 상태 판정(인계표 3절 3 원인별 안내). 우선순위: 불러오기 → 권한 없음 → 바탕 보관 → 확정 전 → 회차 보관 → …
 * locked 이면 폼 없이 조회만.
 */
export function qaTargetState(t: QaTargetView, opts: { canWrite: boolean; readOnly: boolean }) {
  const round = currentRound(t);
  const archived = round?.archivedAt != null;
  const notice: string | null = opts.readOnly
    ? null // 프로젝트 읽기 전용 안내는 영역 위에 한 번
    : !opts.canWrite
      ? QA_COPY.noPermission
      : t.baseArchived
        ? QA_COPY.baseArchivedNotice
        : archived
          ? QA_COPY.archivedNote
          : t.baseNotReady
            ? QA_COPY.baseNotReadyNotice
            : null;
  const locked = opts.readOnly || !opts.canWrite || t.baseArchived || archived;
  const roundsFull = t.rounds.length >= QA_LIMITS.roundsPerTarget;
  /** 새 회차를 열 수 있는지 — 서버 canOpen(열린 회차 없음·검토 완료·보관 안 됨·30회차 미만) */
  const canOpen = !locked && t.exists && t.canOpen && !roundsFull;
  /** 재검수(새 판 기준 새 회차)는 지금 회차가 이전 기준이고 바탕이 검토 완료일 때 */
  const canRebase = !locked && !t.baseNotReady && !roundsFull;
  return { round, archived, notice, locked, roundsFull, canOpen, canRebase, stale: Boolean(round?.stale) && !archived };
}

// ── 입력 점검(미리 알림만, 값은 자르지 않음) ──
export const countChars = (s: string) => charLength(briefTrim(s));
export function counterText(n: number, max: number): string {
  return `${n.toLocaleString("ko-KR")} / ${max.toLocaleString("ko-KR")}자`;
}
/** 편집 값. 새로 추가한 항목은 id = null 이고 제목을 받는다(인계표 2절 나: is_required 기본 true) */
export interface QaItemDraft {
  id: string | null;
  itemTitle: string;
  verdict: QaVerdict;
  memo: string;
}
export const titleKey = (i: number) => `item:${i}:title`;
export const canAddQaItem = (n: number) => n < QA_LIMITS.itemsMax;
export const newQaItem = (): QaItemDraft => ({ id: null, itemTitle: "", verdict: "pending", memo: "" });
export type QaIssues = Record<string, string>;
export const memoKey = (i: number) => `item:${i}:memo`;
export function checkQaItems(items: readonly QaItemDraft[]): QaIssues {
  const out: QaIssues = {};
  items.forEach((it, i) => {
    const n = countChars(it.memo);
    if (n > QA_LIMITS.memo) out[memoKey(i)] = QA_COPY.memoMax;
    else if (it.verdict === "needs_fix" && n === 0) out[memoKey(i)] = QA_COPY.memoRequired;
    if (it.id === null) {
      const t = checkItemTitle(it.itemTitle);
      if (t) out[titleKey(i)] = t;
    }
  });
  return out;
}
/** 새 항목 제목 점검(확정 문구 itemTitleRequired·itemTitleMax 와 같은지 시험으로 확인) */
export function checkItemTitle(title: string): string | null {
  const n = countChars(title);
  if (n === 0) return requiredMessage("검수 항목 제목");
  if (n > QA_LIMITS.itemTitle) return maxLengthMessage("검수 항목 제목", QA_LIMITS.itemTitle);
  return null;
}

/**
 * 서버로 보낼 값(Backend 6절: 항목마다 setQaItem·addQaItem). 바뀐 기존 항목만 { itemId, verdict, memo },
 * 새 항목은 { title, isRequired: true }(판정은 저장 뒤 — 서버가 미확인으로 만든다). 메모는 빈칸이면 null. 값은 자르지 않는다
 */
export function toQaPayload(items: readonly QaItemDraft[], saved: readonly Pick<QaItemView, "id" | "verdict" | "memo">[] = [], removed: readonly string[] = []) {
  const before = new Map(saved.map((s) => [s.id, s]));
  const gone = new Set(removed);
  const set = items
    .filter((it) => it.id === null || !gone.has(it.id))
    .filter((it): it is QaItemDraft & { id: string } => it.id !== null)
    .filter((it) => {
      const b = before.get(it.id);
      return !b || b.verdict !== it.verdict || b.memo !== it.memo;
    })
    .map((it) => ({ itemId: it.id, verdict: it.verdict, memo: it.memo.trim() ? it.memo : null }));
  const add = items.filter((it) => it.id === null).map((it) => ({ title: it.itemTitle, isRequired: true }));
  // 삭제는 set·add 보다 먼저 처리한다(Backend P3FG-ACTIONS-REVIEW-01 2절 2). 기본 항목은 DB 가 거절한다
  return { remove: [...gone], set, add };
}

/** 삭제 단추를 보일 항목: 열린 회차(보관 안 됨·검토 완료 전)의 기본 아닌 추가 항목만(AGY 3절 2) */
export const canRemoveQaItem = (round: Pick<QaRoundView, "status" | "archivedAt">, item: Pick<QaItemView, "isDefault">) =>
  round.archivedAt === null && round.status !== "reviewed" && !item.isDefault;

/** 검수에서 보완 요청된 산출물 id(열린 회차가 fix_requested). 각 단계 화면 배지용 — 서버 추가 없이 검수 읽기로 계산 */
export function fixRequestedTargetIds(targets: readonly Pick<QaTargetView, "targetId" | "rounds">[]): string[] {
  return targets.flatMap((t) => (t.targetId && t.rounds.some((r) => r.status === "fix_requested" && r.archivedAt === null) ? [t.targetId] : []));
}

/** 승인 게이트 안내: 서버 gate.blockedBy → QA_COPY(Backend 6절). null 이면 승인 가능 */
export function qaGateText(block: QaGateBlock): string {
  switch (block) {
    case null:
      return QA_COPY.gateReady;
    case "stale":
      return QA_COPY.staleBanner;
    case "archived":
      return QA_COPY.baseArchivedNotice;
    case "not_reviewed":
      return QA_COPY.baseNotReadyNotice;
    default:
      return QA_COPY.gateBlocked;
  }
}

/** "2026-11-20 03:10 KST" */
export function formatKstMinute(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "시각 알 수 없음";
  const d = new Date(t + 9 * 3600 * 1000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} KST`;
}
