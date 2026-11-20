"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/app/_components/form-state";
import { QA_TARGET_KIND_KEYS } from "@/domain/qa-delivery";
import {
  addDeliveryLog,
  addQaItem,
  approveQaReview,
  archiveDeliveryBundle,
  archiveQaReview,
  createDeliveryBundle,
  openQaReview,
  rebaseQaReview,
  removeQaItem,
  requestQaFix,
  restoreDeliveryBundle,
  setQaItem,
  updateDeliveryBundle,
} from "./server";

/**
 * P3FG-UI-CONNECT-01 검수·납품 동작(서버 P3FG-BACKEND-IMPL-01 6절, 인계상 Front 몫 — Backend 검토 요청).
 * 모두 폼 동작(FormState). 값 검사는 서버 zod 계약과 DB 가 한다. 성공 문구는 QA_COPY·DB_COPY 그대로.
 * 납품 목록(.md)은 동작이 아니라 경로 처리기 링크(GET /delivery-bundles/[id]/manifest).
 */
const uuid = z.uuid();
const INT_MAX = 2_147_483_647;
const revision = z.coerce.number().int().positive().max(INT_MAX);
const BAD = { message: "잘못된 요청입니다." } as const;
const NO_CHANGE = { message: "바뀐 판정·메모가 없습니다." } as const;
// 항목 30개 × (메모 500자) + 새 항목 제목 — 이모지·이스케이프 여유
const MAX_PAYLOAD = 100_000;

function readJson(fd: FormData): unknown {
  const text = String(fd.get("payload") ?? "");
  if (!text || text.length > MAX_PAYLOAD) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function ids(fd: FormData, key: "roundId" | "bundleId"): { id: string; revision: number } | null {
  const id = uuid.safeParse(fd.get(key));
  const rev = revision.safeParse(fd.get("revision"));
  return id.success && rev.success ? { id: id.data, revision: rev.data } : null;
}

// ── 검수 ──
/** 검수 시작: 대상 = 산출물 하나(종류·id). 판은 서버가 지금 검토 완료 판으로 고른다 */
export async function openQaReviewAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const kind = z.enum(QA_TARGET_KIND_KEYS).safeParse(fd.get("targetKind"));
  const target = uuid.safeParse(fd.get("targetId"));
  if (!kind.success || !target.success) return BAD;
  const r = await openQaReview(kind.data, target.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "검수 체크리스트를 시작했습니다." };
}

/** 중간 실패 때 앞서 저장된 개수 한 줄(Backend 참고 1 — 문구는 AGY 확인 요청) */
const partialNote = (done: number) => (done > 0 ? ` (앞의 ${done}개 변경은 저장되었습니다.)` : "");

/**
 * 검수 내용 저장: payload { remove: [itemId], set: [{ itemId, verdict, memo }], add: [{ title, isRequired }] }.
 * 삭제를 먼저 한다(Backend P3FG-ACTIONS-REVIEW-01 2절 2 — 기본 항목은 DB 가 거절).
 * 항목마다 서버를 차례로 부르고, 각 호출이 돌려준 revision 을 다음 호출에 쓴다. 중간에 실패하면 거기서 멈추고 그 문구를 보인다
 * (앞선 항목은 저장된 채 — 화면을 새로 고쳐 이어서 고친다)
 */
export async function saveQaItemsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r0 = ids(fd, "roundId");
  if (!r0) return BAD;
  const raw = readJson(fd);
  const p = z
    .object({ remove: z.array(uuid).max(30).default([]), set: z.array(z.unknown()).max(30), add: z.array(z.unknown()).max(30) })
    .safeParse(raw);
  if (!p.success) return { message: "입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요." };
  const { remove, set, add } = p.data;
  if (remove.length === 0 && set.length === 0 && add.length === 0) return NO_CHANGE;
  let rev = r0.revision;
  let done = 0;
  for (const itemId of remove) {
    const r = await removeQaItem(r0.id, rev, itemId);
    if (!r.ok) {
      if (done) refresh();
      return { message: r.message + partialNote(done) };
    }
    rev = r.data.revision;
    done++;
  }
  for (const item of set) {
    const r = await setQaItem(r0.id, rev, item);
    if (!r.ok) {
      if (done) refresh();
      return { message: r.message + partialNote(done) };
    }
    rev = r.data.revision;
    done++;
  }
  for (const item of add) {
    const r = await addQaItem(r0.id, rev, item);
    if (!r.ok) {
      if (done) refresh();
      return { message: r.message + partialNote(done) };
    }
    rev = r.data.revision;
    done++;
  }
  refresh();
  // 삭제만 했으면 QA_COPY.itemRemovedOk, 그 밖은 savedOk
  return { ok: true, message: set.length === 0 && add.length === 0 ? "추가 검수 항목을 삭제했습니다." : "검수 판정과 메모를 저장했습니다." };
}

export async function requestQaFixAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r0 = ids(fd, "roundId");
  if (!r0) return BAD;
  const r = await requestQaFix(r0.id, r0.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "보완 요청을 보내고 수정 단계로 넘겼습니다." };
}

export async function approveQaReviewAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r0 = ids(fd, "roundId");
  if (!r0) return BAD;
  const r = await approveQaReview(r0.id, r0.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "모든 필수 항목이 통과되어 결과물을 승인했습니다." };
}

/** 새 판 기준 재검수: 앞 회차를 보관하고 새 회차를 연다(서버) */
export async function rebaseQaReviewAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r0 = ids(fd, "roundId");
  if (!r0) return BAD;
  const r = await rebaseQaReview(r0.id, r0.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "새 판 기준으로 재검수를 시작했습니다." };
}

export async function archiveQaReviewAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r0 = ids(fd, "roundId");
  if (!r0) return BAD;
  const r = await archiveQaReview(r0.id, r0.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "검수 기록을 보관했습니다." };
}

// ── 납품 ──
/** 새 납품 묶음: 화면은 projectId 만 보낸다. 승인본 목록은 서버가 모은다(클라이언트 목록을 받지 않음) */
export async function createDeliveryBundleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const project = uuid.safeParse(fd.get("projectId"));
  if (!project.success) return BAD;
  const r = await createDeliveryBundle(project.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "승인본으로 새 납품 묶음을 만들었습니다." };
}

/** 옛 묶음 기준 복구 = 새 묶음(지금도 승인 상태인 항목만, 서버) */
export async function restoreDeliveryBundleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(fd.get("bundleId"));
  if (!id.success) return BAD;
  const r = await restoreDeliveryBundle(id.data);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "선택한 납품 묶음 기준으로 새 납품 묶음을 복구했습니다." };
}

export async function updateDeliveryBundleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const b = ids(fd, "bundleId");
  if (!b) return BAD;
  const r = await updateDeliveryBundle(b.id, b.revision, String(fd.get("status") ?? ""));
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "묶음 상태를 저장했습니다." };
}

export async function archiveDeliveryBundleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const b = ids(fd, "bundleId");
  if (!b) return BAD;
  const r = await archiveDeliveryBundle(b.id, b.revision);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "납품 묶음을 보관했습니다." };
}

/** 고객 전달 기록(실제 발송 없음): payload { method, deliveredAt(ISO), note } */
export async function addDeliveryLogAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const b = ids(fd, "bundleId");
  if (!b) return BAD;
  const raw = readJson(fd);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { message: "입력을 읽을 수 없습니다. 화면을 새로 고쳐 주세요." };
  if ((raw as { deliveredAt?: unknown }).deliveredAt == null) return { message: "전달 일시를 입력해 주세요." };
  const r = await addDeliveryLog(b.id, b.revision, raw);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: "고객 전달 기록을 남겼습니다." };
}

/** 최신 승인본 목록 다시 불러오기(서버 계산을 새로 받는다) */
export async function refreshDeliveryAction(): Promise<FormState> {
  refresh();
  return { ok: true, message: "최신 승인본 목록을 다시 불러왔습니다." };
}
