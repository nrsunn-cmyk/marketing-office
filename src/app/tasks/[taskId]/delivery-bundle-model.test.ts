import { describe, expect, it } from "vitest";
import { DB_LIMITS as SERVER_LIMITS, DB_METHOD_KEYS as SERVER_METHODS, DB_STATUS_KEYS as SERVER_STATUSES } from "@/domain/qa-delivery";
import {
  DB_COPY,
  DB_LIMITS,
  DB_METHOD_KEYS,
  DB_STATUS_KEYS,
  bundleLine,
  checkLog,
  countText,
  deliveryState,
  includedDetail,
  kstLocalToIso,
  manifestHref,
  toLogPayload,
  type DbBundleView,
  type DeliveryBundleData,
} from "./delivery-bundle-model";

const bundle = (v: string, x: Partial<DbBundleView> = {}): DbBundleView => ({ id: `b-${v}`, bundleNo: Number(v.split(".")[1] ?? 0) + 1, bundleVersion: v, status: "drafting", archivedAt: null, revision: 1, createdAt: "2026-11-19T18:20:00Z", restoredFromVersion: null, itemCount: 1, itemsSummary: [], logs: [], ...x });
const INC = [{ kind: "web_copy", targetId: "w1", title: "홈페이지 구조·문구", versionNo: 2, stateLabel: "승인됨", qaRoundNo: 1, detail: "판 v2" }];
const data = (x: Partial<DeliveryBundleData> = {}): DeliveryBundleData => ({ projectId: "p1", included: INC, excluded: [], bundles: [bundle("v1.0")], stale: false, baseArchived: false, canWrite: true, canCreate: true, createBlockedCode: null, ...x });

describe("P3-g 납품 묶음 화면 모델(인계표 P3G-HANDOFF.md)", () => {
  it("한도·상태·전달 방식은 인계표와 같다(보관은 상태가 아님)", () => {
    expect(DB_LIMITS).toEqual({ bundlesMax: 50, itemsPerBundle: 100, logsPerBundle: 50, note: 300 });
    expect(DB_STATUS_KEYS).toEqual(["drafting", "reviewed"]);
    expect(DB_METHOD_KEYS).toEqual(["email", "cloud_link", "messenger", "in_person"]);
    // 화면은 zod 를 피하려고 값을 따로 둔다 — 서버 도메인과 같아야 한다
    expect(DB_LIMITS).toEqual(SERVER_LIMITS);
    expect(DB_STATUS_KEYS).toEqual([...SERVER_STATUSES]);
    expect(DB_METHOD_KEYS).toEqual([...SERVER_METHODS]);
  });

  it("원인별 안내 우선순위: 권한 없음 → 바탕 보관 → 최신 묶음 보관 → 승인 판 없음", () => {
    const o = { readOnly: false };
    expect(deliveryState(data(), o)).toMatchObject({ notice: null, locked: false, canCreate: true, canLog: true, canRestore: true });
    expect(deliveryState(data({ canWrite: false }), o)).toMatchObject({ notice: DB_COPY.noPermission, locked: true, canCreate: false, canLog: false });
    expect(deliveryState(data({ baseArchived: true }), o)).toMatchObject({ notice: DB_COPY.baseArchivedNotice, locked: true });
    // 최신 묶음 보관: 그 묶음은 잠기지만 새 묶음·복구는 된다(Master 결정, AGY 3번)
    expect(deliveryState(data({ bundles: [bundle("v1.0", { archivedAt: "2026-11-20T00:00:00Z" })], stale: true }), o)).toMatchObject({ notice: DB_COPY.archivedNote, locked: true, canLog: false, canCreate: true, archivedCanCreate: true, canRestore: true, stale: true });
    expect(deliveryState(data({ canCreate: false, createBlockedCode: "no_approved", bundles: [bundle("v1.0", { archivedAt: "2026-11-20T00:00:00Z" })] }), o)).toMatchObject({ archivedCanCreate: false, canCreate: false });
    expect(DB_COPY.archivedNote).toBe("보관한 납품 묶음입니다. 이 묶음은 조회와 내려받기만 할 수 있으며, 새 납품 묶음은 다시 만들 수 있습니다.");
    expect(DB_COPY.archivedCanCreateNotice).toBe("마지막 납품 묶음을 보관했습니다. 승인된 결과물 판이 있으면 새 납품 묶음을 만들 수 있습니다.");
    // 만들 수 있는지는 서버 canCreate·createBlockedCode
    expect(deliveryState(data({ canCreate: false, createBlockedCode: "no_approved" }), o)).toMatchObject({ notice: DB_COPY.baseNotApprovedNotice, canCreate: false, canLog: true });
    // 프로젝트 읽기 전용 안내는 영역 위에 한 번
    expect(deliveryState(data(), { readOnly: true })).toMatchObject({ notice: null, locked: true, canCreate: false });
    expect(deliveryState(data({ bundles: [] }), o)).toMatchObject({ canCreate: true, canLog: false });
  });

  it("한도: 묶음 50개면 새 묶음·복구 없음, 전달 기록 50건이면 기록 없음", () => {
    const full = data({ canCreate: false, createBlockedCode: "bundle_limit", bundles: Array.from({ length: 50 }, (_, i) => bundle(`v1.${i}`)) });
    expect(deliveryState(full, { readOnly: false })).toMatchObject({ bundlesFull: true, canCreate: false, canRestore: false });
    const logs = Array.from({ length: 50 }, (_, i) => ({ id: `l${i}`, method: "email" as const, deliveredAt: "2026-11-20T00:00:00Z", note: "", bundleVersion: "v1.0" }));
    expect(deliveryState(data({ bundles: [bundle("v1.0", { logs })] }), { readOnly: false })).toMatchObject({ logsFull: true, canLog: false });
  });

  it("표시: 개수 배지(진행률 대신), 검수 회차, 스냅샷 줄", () => {
    expect(countText(4, 2)).toBe("포함 승인본 4건 · 제외 2건");
    expect(includedDetail(INC[0])).toBe("검수 1회차 승인 · 판 v2");
    expect(includedDetail({ ...INC[0], qaRoundNo: null, detail: null })).toBeNull();
    expect(bundleLine(bundle("v1.2", { itemsSummary: ["브리프 v1", "로고 v1"], restoredFromVersion: "v1.0" }))).toBe("2026-11-20 03:20 KST · 포함: 브리프 v1, 로고 v1 · v1.0 기준 복구");
  });

  it("전달 기록 점검: 일시 필수, 메모 300자 — 확정 문구 그대로, 한국 시간 → +09:00", () => {
    expect(checkLog({ method: "email", deliveredAtLocal: "", note: "" })).toEqual({ deliveredAt: "전달 일시를 입력해 주세요.", note: undefined });
    expect(checkLog({ method: "email", deliveredAtLocal: "2026-11-20T03:25", note: "가".repeat(301) })).toEqual({ deliveredAt: undefined, note: "전달 메모·수신 확인은 300자까지 쓸 수 있습니다." });
    expect(kstLocalToIso("2026-11-20T03:25")).toBe("2026-11-20T03:25:00+09:00");
    expect(kstLocalToIso("2026-11-20")).toBeNull();
    // Backend 6절 addDeliveryLog: { method, deliveredAt, note } — 묶음 id·revision 은 숨은 칸, 메모 빈칸은 null
    expect(toLogPayload({ method: "messenger", deliveredAtLocal: "2026-11-20T03:25", note: "가".repeat(400) })).toEqual({ method: "messenger", deliveredAt: "2026-11-20T03:25:00+09:00", note: "가".repeat(400) });
    expect(toLogPayload({ method: "email", deliveredAtLocal: "2026-11-20T03:25", note: "  " }).note).toBeNull();
    expect(manifestHref("b 1")).toBe("/delivery-bundles/b%201/manifest");
    // 확정 문구('스냅샷' 정리·납품 목록 단추)
    expect(DB_COPY.emptyDesc).toBe("검수 체크리스트를 통과한 승인본이 1건 이상 있으면 첫 납품 묶음을 만들 수 있습니다.");
    expect(DB_COPY.bundleLimitReached).toBe("납품 묶음은 50개까지 만들 수 있습니다.");
    expect(DB_COPY.restoredOk).toBe("선택한 납품 묶음 기준으로 새 납품 묶음을 복구했습니다.");
    expect(DB_COPY.downloadManifest).toBe("납품 목록(.md) 내려받기");
  });
});
