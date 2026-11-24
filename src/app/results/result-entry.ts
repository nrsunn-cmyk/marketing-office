import { isResultEntryType, type DeliveryBundleResultItem, type ResultEntry, type ResultEntryType } from "@/features/library/server";

/**
 * UX-F1-RESULTS-FRONT-01 결과물 목록의 한 줄(결과물 또는 납품 묶음) — Backend listResultEntries(35b8576) 계약 그대로.
 * 근거: Plan/Claude-Backend-20261123/UX-F1-RESULTS-BACKEND-01-CONTRACT.md
 */
export type { ResultEntry, ResultEntryType };
export type DeliveryBundleEntry = DeliveryBundleResultItem;

/** 주소의 type 값 → 허용 값만(그 밖은 전체) */
export function parseResultType(v: unknown): ResultEntryType | null {
  return isResultEntryType(v) ? v : null;
}

/** 링크는 같은 앱 안의 작업 상세 납품 묶음 앵커일 때만 쓴다(그 밖은 링크 없이 표시) */
export function safeBundleHref(e: Pick<DeliveryBundleEntry, "href" | "task_id">): string | null {
  if (!e.href || !e.task_id) return null;
  return e.href === `/tasks/${e.task_id}#delivery-bundle` ? e.href : null;
}
