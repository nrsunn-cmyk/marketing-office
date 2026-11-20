/**
 * P3G-UI-PREP-01 납품 묶음 — 화면 쪽 모델(서버 없이 먼저 만든 자리).
 * 근거: AGY Design/p3-production/P3G-HANDOFF.md(스냅샷·포함 항목·전달 기록 한도, 승인본만 포함, 비파괴 복구, 외부 발송 없음, archived_at 분리),
 * delivery-bundle.html(배치·라벨), P3-COPY-FINAL.md 5절 DB_COPY·0절 P3_COMMON_COPY(그대로 — 새 문구를 만들지 않는다).
 * 포함·제외 목록은 서버가 계산해 내려준다(인계표 3절 1). 화면은 받은 대로 보여 주기만 한다.
 */
import { briefTrim, charLength } from "@/domain/production-brief/constants";

export { P3_COMMON_COPY } from "./design-assets-model";

/** 한도(P3G-HANDOFF 1·2절, 글자 수는 코드 포인트) */
export const DB_LIMITS = {
  bundlesMax: 50,
  itemsPerBundle: 100,
  logsPerBundle: 50,
  note: 300,
} as const;

/** 묶음 진행 상태(인계표 2절 가). 보관은 status 가 아니라 archivedAt */
export const DB_STATUSES = { drafting: "작성 중", reviewed: "검토 완료" } as const;
export type DbStatus = keyof typeof DB_STATUSES;
export const DB_STATUS_KEYS = Object.keys(DB_STATUSES) as DbStatus[];

/** 전달 방식(코드 = 인계표, 이름 = 시안) */
export const DB_METHODS = {
  email: "이메일 직접 발송",
  cloud_link: "공유 폴더 링크 전달",
  messenger: "메신저 파일 전달",
  in_person: "오프라인·USB 직접 전달",
} as const;
export type DbMethod = keyof typeof DB_METHODS;
export const DB_METHOD_KEYS = Object.keys(DB_METHODS) as DbMethod[];

// ── 자리용 보기 타입(서버 보기 타입이 오면 바꾼다) ──
/** 승인본(포함) — 서버가 검수 통과·승인된 판만 모은다 */
export interface DbIncludedItem {
  kind: string;
  /** 결과물 이름(예: 홈페이지 구조·문구) */
  title: string;
  versionNo: number;
  /** 상태 글(예: 승인됨, 확정) — 서버가 준 글 */
  stateLabel: string;
  /** 검수 회차(공통 제작 브리프처럼 검수 대상이 아니면 null) */
  qaRoundNo: number | null;
  /** 덧붙이는 설명(파일·형식 등, 서버가 준 글) */
  detail: string | null;
}
/** 자동 제외(서버가 사유와 함께 계산) */
export interface DbExcludedItem {
  kind: string;
  title: string;
  versionNo: number | null;
  stateLabel: string;
  reason: string;
}
export interface DbLogView {
  id: string;
  method: DbMethod;
  deliveredAt: string;
  note: string;
  bundleVersion: string;
}
export interface DbBundleView {
  id: string;
  /** 서버 채번(v1.0, v1.1 …) */
  bundleVersion: string;
  status: DbStatus;
  archivedAt: string | null;
  revision: number;
  createdAt: string;
  /** 복구로 만든 묶음이면 원본 묶음 버전 */
  restoredFromVersion: string | null;
  /** 포함 요약(예: 브리프 v2, 홈페이지 v2) — 서버가 준 글 */
  itemsSummary: string[];
  logs: DbLogView[];
}
export interface DeliveryBundleData {
  included: DbIncludedItem[];
  excluded: DbExcludedItem[];
  /** 최신이 위 */
  bundles: DbBundleView[];
  /** 마지막 묶음 이후 새 승인본이 있음 */
  stale: boolean;
  /** 바탕 프로젝트 보관됨 */
  baseArchived: boolean;
  canWrite: boolean;
}

/** 화면 문구 최종본(P3-COPY-FINAL.md 5절 DB_COPY — 그대로) */
export const DB_COPY = {
  heading: "납품 묶음",
  intro: "검수 체크리스트를 모두 통과해 승인된 결과물만 납품 묶음에 담습니다. 고객 전달은 직접 진행한 뒤 기록만 남깁니다.",
  emptyTitle: "아직 생성된 납품 묶음이 없습니다.",
  emptyDesc: "검수 체크리스트를 통과한 승인본이 1건 이상 있으면 첫 납품 묶음 스냅샷을 만들 수 있습니다.",
  create: "+ 첫 납품 묶음 만들기",
  createNext: "+ 새 납품 묶음 만들기",
  bundleLimitReached: "납품 묶음 스냅샷은 50개까지 만들 수 있습니다.",
  deliveryLimitReached: "고객 전달 기록은 묶음당 50건까지 남길 수 있습니다.",
  staleBanner: "마지막 납품 묶음 이후 새로 승인된 결과물이 있습니다. 최신 승인본을 반영해 새 납품 묶음을 만들 수 있습니다.",
  rebase: "최신 승인본 목록 다시 불러오기",
  // Master 결정: 최신 묶음을 보관해도 새 묶음은 만들 수 있다(AGY DESIGN-REVIEW-P3FG-UI-01 3번)
  archivedNote: "보관한 납품 묶음입니다. 이 묶음은 조회와 내려받기만 할 수 있으며, 새 납품 묶음은 다시 만들 수 있습니다.",
  archivedCanCreateNotice: "마지막 납품 묶음을 보관했습니다. 승인된 결과물 판이 있으면 새 납품 묶음을 만들 수 있습니다.",
  noPermission: "납품 묶음을 만들거나 전달 기록을 남길 권한이 없습니다.",
  loadError: "납품 묶음을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  deliveryHint: "이 화면에서 이메일이나 메신저로 직접 발송하지 않습니다. 직접 전달한 뒤 방식·일시·메모만 남깁니다.",
  downloadBundle: "묶음 내려받기",
  restoreBundle: "이 판 기준으로 복구",
  addDelivery: "+ 전달 기록 남기기",
  archive: "이 납품 묶음 보관",
  createdOk: "승인본으로 새 납품 묶음을 만들었습니다.",
  restoredOk: "선택한 스냅샷 기준으로 새 납품 묶음을 복구했습니다.",
  deliveryAddedOk: "고객 전달 기록을 남겼습니다.",
  archivedOk: "납품 묶음을 보관했습니다.",
  baseNotApprovedNotice: "P3-f 검수를 통과해 승인된 결과물 판이 1건 이상 있어야 납품 묶음을 만들 수 있습니다.",
  baseArchivedNotice: "바탕 프로젝트가 보관되어 새 납품 묶음이나 전달 기록을 추가할 수 없습니다. 조회와 내려받기만 할 수 있습니다.",
  deliveredAtRequired: "전달 일시를 입력해 주세요.",
  noteMax: "전달 메모·수신 확인은 300자까지 쓸 수 있습니다.",
} as const;

/** 시안 delivery-bundle.html 의 라벨(AGY 문구 — 그대로) */
export const DB_LABELS = {
  stalePrefix: "이전 기준:",
  staleBadge: "이전 기준",
  archivedBadge: "보관",
  includedHeading: (n: number) => `1. 이번 묶음 포함 목록 (승인본만 · ${n}건)`,
  excludedHeading: (n: number) => `2. 자동 제외 목록 및 사유 (${n}건)`,
  historyHeading: (n: number) => `3. 납품 묶음 스냅샷 이력 (${n} / ${DB_LIMITS.bundlesMax}개)`,
  historyHint: "스냅샷은 생성 시점의 승인본 버전을 고정해 보관하며, 과거 스냅샷 기준으로 새 묶음을 복구할 수 있습니다.",
  logsHeading: "4. 고객 전달 기록 (수동 기록 · 자동 발송 없음)",
  included: "포함됨",
  excluded: "제외됨",
  reasonPrefix: "제외 사유:",
  latest: "(최신)",
  bundleName: (v: string) => `납품 묶음 ${v}`,
  method: "전달 방식",
  deliveredAt: "전달 일시 (한국 시간)",
  note: "전달 메모·수신 확인 (선택, 0~300자)",
  notePlaceholder: "예: 대표님 메일로 v1.1 전달 및 확인 답장 받음",
  logged: "기록됨",
  status: "묶음 상태",
  saveStatus: "상태 저장",
} as const;

// ── 표시 도우미 ──
/** 시안 머리 배지 "포함 승인본 4건 · 제외 2건"(진행률 대신 실제 개수) */
export const countText = (inc: number, exc: number) => `포함 승인본 ${inc}건 · 제외 ${exc}건`;
export const includedVersionText = (it: Pick<DbIncludedItem, "stateLabel" | "versionNo">) => `${it.stateLabel} (v${it.versionNo})`;
export function includedDetail(it: DbIncludedItem): string | null {
  const parts = [it.qaRoundNo ? `검수 ${it.qaRoundNo}회차 승인` : null, it.detail].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
export const excludedTitle = (it: DbExcludedItem) => (it.versionNo ? `${it.title} (v${it.versionNo})` : it.title);

/** "2026-11-20 03:20 KST" */
export function formatKstMinute(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "시각 알 수 없음";
  const d = new Date(t + 9 * 3600 * 1000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} KST`;
}
export const bundleLine = (b: DbBundleView) => `${formatKstMinute(b.createdAt)}${b.itemsSummary.length ? ` · 포함: ${b.itemsSummary.join(", ")}` : ""}${b.restoredFromVersion ? ` · ${b.restoredFromVersion} 기준 복구` : ""}`;
export const logLine = (l: DbLogView) => `${formatKstMinute(l.deliveredAt)}${l.note.trim() ? ` · 메모: ${l.note.trim()}` : ""}`;

/**
 * 원인별 안내(인계표 3절 4). 우선순위: 권한 없음 → 바탕 보관 → 최신 묶음 보관 → 승인 판 없음.
 * baseLocked(읽기 전용·권한 없음·바탕 보관)면 아무것도 못 한다. 최신 묶음만 보관이면 그 묶음의 전달 기록·상태·보관은 막고,
 * 새 묶음 만들기·복구는 된다(Master 결정, AGY archivedCanCreateNotice). 조회·내려받기는 늘 된다.
 */
export function deliveryState(d: DeliveryBundleData, opts: { readOnly: boolean }) {
  const latest = d.bundles[0] ?? null;
  const archived = latest?.archivedAt != null;
  const baseLocked = opts.readOnly || !d.canWrite || d.baseArchived;
  const bundlesFull = d.bundles.length >= DB_LIMITS.bundlesMax;
  const canCreate = !baseLocked && d.included.length > 0 && !bundlesFull;
  const notice: string | null = opts.readOnly
    ? null // 프로젝트 읽기 전용 안내는 영역 위에 한 번
    : !d.canWrite
      ? DB_COPY.noPermission
      : d.baseArchived
        ? DB_COPY.baseArchivedNotice
        : archived
          ? DB_COPY.archivedNote
          : d.included.length === 0
            ? DB_COPY.baseNotApprovedNotice
            : null;
  /** 최신 묶음 보관 뒤 새로 만들 수 있으면 한 줄 더(archivedCanCreateNotice) */
  const archivedCanCreate = archived && canCreate;
  /** 최신 묶음을 고칠 수 없는지(전달 기록·상태 저장·보관) */
  const locked = baseLocked || archived;
  const logsFull = (latest?.logs.length ?? 0) >= DB_LIMITS.logsPerBundle;
  return { latest, archived, notice, locked, baseLocked, bundlesFull, canCreate, archivedCanCreate, canRestore: !baseLocked && !bundlesFull, logsFull, canLog: !locked && latest !== null && !logsFull, stale: d.stale && !baseLocked };
}

// ── 전달 기록 입력 점검·보낼 값 ──
export interface DbLogDraft {
  method: DbMethod;
  /** <input type="datetime-local"> 값(한국 시간, 예: 2026-11-20T03:25) */
  deliveredAtLocal: string;
  note: string;
}
export const countChars = (s: string) => charLength(briefTrim(s));
export function counterText(n: number, max: number): string {
  return `${n.toLocaleString("ko-KR")} / ${max.toLocaleString("ko-KR")}자`;
}
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export function checkLog(d: DbLogDraft): Record<"deliveredAt" | "note", string | undefined> {
  return {
    deliveredAt: LOCAL_RE.test(d.deliveredAtLocal) ? undefined : DB_COPY.deliveredAtRequired,
    note: countChars(d.note) > DB_LIMITS.note ? DB_COPY.noteMax : undefined,
  };
}
/** 한국 시간 입력 → 서버로 보낼 ISO(+09:00). 형식이 틀리면 null */
export const kstLocalToIso = (v: string) => (LOCAL_RE.test(v) ? `${v}:00+09:00` : null);
/** 서버로 보낼 값(자리용 이름 — 서버 계약이 오면 맞춘다). 값은 자르지 않는다 */
export function toLogPayload(bundleId: string, d: DbLogDraft) {
  return { bundleId, method: d.method, deliveredAt: kstLocalToIso(d.deliveredAtLocal), note: d.note };
}
