/**
 * P2-PROFILE-APP-01: 회사 프로필 버전 검토(순수 함수).
 * - profileDiff: 이전 버전과 비교해 바뀐 항목만 돌려준다(목록 항목은 더해진·빠진 것으로 나눈다).
 * - profileHashInput: 승인할 때 "화면에서 본 내용"을 확인하는 해시의 입력(정렬된 JSON 문자열). 해시 계산은 서버에서 한다.
 * - profileStatusOf: 버전별 마지막 결정 → 화면 상태.
 * 모두 텍스트만 다룬다. HTML 을 만들지 않는다.
 */
import { canonicalJson } from "@/domain/canonical";

export interface ProfileFields {
  id: string;
  version: number;
  products: string | null;
  audience: string | null;
  strengths: string[];
  brand_rules: string | null;
  channel_urls: string[];
}

export const PROFILE_FIELD_LABELS = {
  products: "상품·서비스",
  audience: "주요 고객(타깃)",
  strengths: "강점",
  brand_rules: "브랜드 규칙·금지 표현",
  channel_urls: "채널 주소",
} as const;
export type ProfileFieldKey = keyof typeof PROFILE_FIELD_LABELS;

export type ProfileChange =
  | { key: ProfileFieldKey; label: string; kind: "text"; before: string; after: string }
  | { key: ProfileFieldKey; label: string; kind: "list"; added: string[]; removed: string[] };

const norm = (s: string | null) => (s ?? "").trim();
const normList = (l: string[]) => l.map((x) => x.trim()).filter(Boolean);

/** 이전 버전(없으면 null) 대비 바뀐 항목. 이전 버전이 없으면 값이 있는 항목을 모두 "새로 생김"으로 본다 */
export function profileDiff(prev: ProfileFields | null, cur: ProfileFields): ProfileChange[] {
  const changes: ProfileChange[] = [];
  for (const key of ["products", "audience", "brand_rules"] as const) {
    const before = prev ? norm(prev[key]) : "";
    const after = norm(cur[key]);
    if (before !== after) changes.push({ key, label: PROFILE_FIELD_LABELS[key], kind: "text", before, after });
  }
  for (const key of ["strengths", "channel_urls"] as const) {
    const before = prev ? normList(prev[key]) : [];
    const after = normList(cur[key]);
    const added = after.filter((x) => !before.includes(x));
    const removed = before.filter((x) => !after.includes(x));
    if (added.length || removed.length) changes.push({ key, label: PROFILE_FIELD_LABELS[key], kind: "list", added, removed });
  }
  return changes;
}

/** 승인 확인 해시의 입력. id·version·내용이 하나라도 다르면 달라진다 */
export function profileHashInput(p: ProfileFields): string {
  return canonicalJson({
    id: p.id,
    version: p.version,
    products: norm(p.products),
    audience: norm(p.audience),
    strengths: normList(p.strengths),
    brand_rules: norm(p.brand_rules),
    channel_urls: normList(p.channel_urls),
  });
}

export type ProfileReviewStatus = "approved" | "revoked" | "pending";
export const PROFILE_STATUS_LABELS: Record<ProfileReviewStatus, string> = {
  approved: "승인됨(잠금)",
  revoked: "승인 철회됨",
  pending: "검토 전",
};

export interface ProfileDecision {
  versionId: string;
  decision: string;
  seq: number;
  createdAt: string;
  actorId: string;
  /** 결정할 때 남긴 메모(없으면 null). 텍스트로만 표시한다 */
  comment: string | null;
}

/** 버전별 마지막 결정(seq 가 가장 큰 것) */
export function lastDecisions(decisions: ProfileDecision[]): Map<string, ProfileDecision> {
  const m = new Map<string, ProfileDecision>();
  for (const d of decisions) {
    const cur = m.get(d.versionId);
    if (!cur || d.seq > cur.seq) m.set(d.versionId, d);
  }
  return m;
}

export function profileStatusOf(last: ProfileDecision | undefined): ProfileReviewStatus {
  return last?.decision === "approved" ? "approved" : last?.decision === "revoked" ? "revoked" : "pending";
}
