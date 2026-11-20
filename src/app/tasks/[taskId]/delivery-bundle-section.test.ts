import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DbBundleView, DeliveryBundleData } from "./delivery-bundle-model";

/**
 * P3G-UI-PREP-01 납품 묶음 상태별 화면(가짜 데이터, 서버 없음).
 * 상태 6종(작성 중·검토 완료·이전 기준·보관·읽기 전용) + 예외(빈 상태·바탕 보관·승인 판 없음·권한 없음·묶음 한도·전달 한도·불러오기 실패).
 */
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./delivery-bundle.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { DeliveryBundleSection } = await import("./delivery-bundle-section");

const INCLUDED: DeliveryBundleData["included"] = [
  { kind: "production_brief", title: "공통 제작 브리프", versionNo: 2, stateLabel: "확정", qaRoundNo: null, detail: "납품 형식: PDF / Markdown 요약" },
  { kind: "web_copy", title: "홈페이지 구조·문구", versionNo: 2, stateLabel: "승인됨", qaRoundNo: 1, detail: "현재 편집 중인 v3는 미승인이므로 직전 승인본 v2가 포함됩니다." },
  { kind: "design_assets", title: "로고 심볼 & 워드마크 패키지", versionNo: 2, stateLabel: "승인됨", qaRoundNo: 1, detail: "파일: nadaum-logo-kit-v2.zip (2.4 MB)" },
  { kind: "video_plan", title: "영상 구성·파일 (메인 40초)", versionNo: 2, stateLabel: "승인됨", qaRoundNo: 1, detail: "파일: nadaum-intro-v2.mp4 (28.4 MB)" },
];
const EXCLUDED: DeliveryBundleData["excluded"] = [
  { kind: "web_copy", title: "홈페이지 구조·문구", versionNo: 3, stateLabel: "검수 보완 필요", reason: "검수 체크리스트 3번 항목(‘근거 출처 연결’)이 보완 필요 상태입니다." },
  { kind: "ppt_deck", title: "PPT 구성안 (제안서 덱 v1)", versionNo: null, stateLabel: "작성 중", reason: "아직 검수 승인이 완료되지 않았습니다." },
];
const bundle = (v: string, x: Partial<DbBundleView> = {}): DbBundleView => ({
  id: `b-${v}`,
  bundleVersion: v,
  status: "drafting",
  archivedAt: null,
  revision: 3,
  createdAt: "2026-11-19T18:20:00Z",
  restoredFromVersion: null,
  itemsSummary: ["브리프 v2", "홈페이지 v2", "로고 v2", "영상 v2"],
  logs: [],
  ...x,
});
const V11 = bundle("v1.1", { logs: [{ id: "l1", method: "email", deliveredAt: "2026-11-19T18:25:00Z", note: "1차 검수 완료본 우선 전달", bundleVersion: "v1.1" }] });
const V10 = bundle("v1.0", { createdAt: "2026-11-18T08:00:00Z", itemsSummary: ["브리프 v1", "로고 v1"] });
const data = (x: Partial<DeliveryBundleData> = {}): DeliveryBundleData => ({ included: INCLUDED, excluded: EXCLUDED, bundles: [V11, V10], stale: false, baseArchived: false, canWrite: true, ...x });

const STATES: Record<string, { data: DeliveryBundleData | null; readOnly?: boolean }> = {
  작성중: { data: data() },
  검토완료: { data: data({ bundles: [{ ...V11, status: "reviewed" }, V10] }) },
  이전기준: { data: data({ stale: true }) },
  보관: { data: data({ bundles: [{ ...V11, archivedAt: "2026-11-20T01:00:00Z" }, V10], stale: true }) },
  읽기전용: { data: data(), readOnly: true },
  빈상태: { data: data({ bundles: [], excluded: [] }) },
  바탕보관: { data: data({ baseArchived: true }) },
  승인판없음: { data: data({ included: [], bundles: [] }) },
  권한없음: { data: data({ canWrite: false }) },
  묶음한도: { data: data({ bundles: Array.from({ length: 50 }, (_, i) => bundle(`v1.${49 - i}`)) }) },
  전달한도: { data: data({ bundles: [bundle("v1.1", { logs: Array.from({ length: 50 }, (_, i) => ({ id: `l${i}`, method: "cloud_link" as const, deliveredAt: "2026-11-19T18:25:00Z", note: "", bundleVersion: "v1.1" })) }), V10] }) },
  불러오기실패: { data: null },
};
const render = (k: string) => renderToString(createElement(DeliveryBundleSection, { data: STATES[k].data, readOnly: Boolean(STATES[k].readOnly), taskId: "t-1" }));
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const DOWNLOAD = /class="secondaryButton">묶음 내려받기</g;

describe("납품 묶음 상태별 화면", () => {
  it("모든 상태: 제목·아이콘·안내, 진행률 막대·% 없음", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      expect(h, k).toContain('aria-labelledby="delivery-bundle"');
      expect(text(h), k).toContain("검수 체크리스트를 모두 통과해 승인된 결과물만 납품 묶음에 담습니다.");
      expect(h, k).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"');
      expect(h, k).not.toMatch(/progressbar|<progress|%/);
    }
  });

  it("작성 중: 배지·개수, 포함 4건·제외 2건(사유), 스냅샷 이력(내려받기·복구), 전달 기록 폼·목록, 상태·보관", () => {
    const h = render("작성중");
    const t = text(h);
    expect(t).toContain("작성 중");
    expect(t).toContain("포함 승인본 4건 · 제외 2건");
    expect(t).toContain("1. 이번 묶음 포함 목록 (승인본만 · 4건)");
    expect(t).toContain("홈페이지 구조·문구 승인됨 (v2)");
    expect(t).toContain("검수 1회차 승인 · 현재 편집 중인 v3는 미승인이므로 직전 승인본 v2가 포함됩니다.");
    expect(t).toContain("공통 제작 브리프 확정 (v2)");
    expect(count(h, />포함됨</g)).toBe(4);
    expect(t).toContain("2. 자동 제외 목록 및 사유 (2건)");
    expect(t).toContain("홈페이지 구조·문구 (v3) 검수 보완 필요");
    expect(t).toContain("제외 사유: 아직 검수 승인이 완료되지 않았습니다.");
    expect(count(h, />제외됨</g)).toBe(2);
    expect(t).toContain("3. 납품 묶음 스냅샷 이력 (2 / 50개)");
    expect(t).toContain("+ 새 납품 묶음 만들기");
    expect(t).toContain("납품 묶음 v1.1 (최신)");
    expect(t).toContain("2026-11-20 03:20 KST · 포함: 브리프 v2, 홈페이지 v2, 로고 v2, 영상 v2");
    expect(count(h, DOWNLOAD)).toBe(2);
    expect(count(h, />이 판 기준으로 복구</g)).toBe(1); // 최신 묶음에는 복구 없음
    expect(h).toContain('name="bundleId" value="b-v1.0"');
    expect(t).toContain("4. 고객 전달 기록 (수동 기록 · 자동 발송 없음)");
    expect(t).toContain("이 화면에서 이메일이나 메신저로 직접 발송하지 않습니다.");
    expect(count(h, /<option /g)).toBe(4 + 2); // 전달 방식 4 + 묶음 상태 2
    expect(h).toContain('type="datetime-local"');
    expect(t).toContain("전달 일시 (한국 시간)");
    expect(t).toContain("0 / 300자");
    expect(t).toContain("+ 전달 기록 남기기");
    expect(t).toContain("이메일 직접 발송 · 묶음 v1.1");
    expect(t).toContain("2026-11-20 03:25 KST · 메모: 1차 검수 완료본 우선 전달");
    expect(t).toContain("기록됨");
    expect(t).toContain("상태 저장");
    expect(h).toMatch(/<details[^>]*><summary>이 납품 묶음 보관<\/summary>/);
    expect(t).toContain("보관하면 내용만 볼 수 있고 고칠 수 없습니다. 보관은 되돌릴 수 없습니다.");
  });

  it("검토 완료: 배지와 선택값", () => {
    const h = render("검토완료");
    expect(text(h)).toContain("검토 완료");
    expect(h).toMatch(/<option value="reviewed" selected="">/);
  });

  it("이전 기준: 배지·staleBanner·다시 불러오기", () => {
    const t = text(render("이전기준"));
    expect(t).toContain("이전 기준: 마지막 납품 묶음 이후 새로 승인된 결과물이 있습니다. 최신 승인본을 반영해 새 납품 묶음을 만들 수 있습니다.");
    expect(t).toContain("최신 승인본 목록 다시 불러오기");
  });

  it("최신 묶음 보관(Master 결정): 새 안내 둘 + 새 묶음 만들기·복구·이전 기준은 되고, 그 묶음의 전달 기록·상태·보관은 없음", () => {
    const h = render("보관");
    const t = text(h);
    expect(t).toContain("보관한 납품 묶음입니다. 이 묶음은 조회와 내려받기만 할 수 있으며, 새 납품 묶음은 다시 만들 수 있습니다.");
    expect(t).toContain("마지막 납품 묶음을 보관했습니다. 승인된 결과물 판이 있으면 새 납품 묶음을 만들 수 있습니다.");
    expect(t).toContain("+ 새 납품 묶음 만들기");
    expect(t).toContain("이 판 기준으로 복구");
    expect(t).toContain("최신 승인본 목록 다시 불러오기");
    expect(count(h, DOWNLOAD)).toBe(2);
    for (const no of ["전달 기록 남기기", "상태 저장", "이 납품 묶음 보관"]) expect(t, no).not.toContain(no);
    expect(t).toContain("이메일 직접 발송 · 묶음 v1.1"); // 기록은 조회
  });

  it("읽기 전용·권한 없음·바탕 보관: 안내 하나, 내려받기만", () => {
    for (const [k, msg] of [
      ["읽기전용", "보관한 프로젝트이거나 취소한 작업이라 고칠 수 없습니다."],
      ["권한없음", "납품 묶음을 만들거나 전달 기록을 남길 권한이 없습니다."],
      ["바탕보관", "바탕 프로젝트가 보관되어 새 납품 묶음이나 전달 기록을 추가할 수 없습니다. 조회와 내려받기만 할 수 있습니다."],
    ] as const) {
      const h = render(k);
      expect(text(h), k).toContain(msg);
      expect(count(h, /<form/g), k).toBe(2); // 내려받기 2개
      expect(count(h, DOWNLOAD), k).toBe(2);
    }
  });

  it("빈 상태: 그림·첫 묶음 단추 / 승인 판 없음: 안내만", () => {
    const h = render("빈상태");
    expect(text(h)).toContain("아직 생성된 납품 묶음이 없습니다.");
    expect(text(h)).toContain("검수 체크리스트를 통과한 승인본이 1건 이상 있으면 첫 납품 묶음 스냅샷을 만들 수 있습니다.");
    expect(h).toContain('class="button">+ 첫 납품 묶음 만들기</button>');
    expect(text(h)).not.toContain("고객 전달 기록");
    const n = render("승인판없음");
    expect(text(n)).toContain("P3-f 검수를 통과해 승인된 결과물 판이 1건 이상 있어야 납품 묶음을 만들 수 있습니다.");
    expect(text(n)).toContain("1. 이번 묶음 포함 목록 (승인본만 · 0건)");
    expect(count(n, /<form/g)).toBe(0);
  });

  it("한도: 묶음 50개(새 묶음·복구 없음), 전달 기록 50건(폼 없음)", () => {
    const b = text(render("묶음한도"));
    expect(b).toContain("납품 묶음 스냅샷은 50개까지 만들 수 있습니다.");
    expect(b).toContain("(50 / 50개)");
    expect(b).not.toContain("새 납품 묶음 만들기");
    expect(b).not.toContain("이 판 기준으로 복구");
    const l = render("전달한도");
    expect(text(l)).toContain("고객 전달 기록은 묶음당 50건까지 남길 수 있습니다.");
    expect(text(l)).not.toContain("+ 전달 기록 남기기");
  });

  it("불러오기 실패: 알림과 다시 불러오기", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("납품 묶음을 불러오지 못했습니다.");
    expect(h).toContain('href="/tasks/t-1#delivery-bundle"');
  });

  it("글은 이스케이프되어 HTML 로 들어가지 않는다", () => {
    const evil = '"><script>alert(1)</script>';
    const d = data({ included: [{ ...INCLUDED[0], title: evil, detail: evil }], excluded: [{ ...EXCLUDED[0], reason: evil }], bundles: [{ ...V11, itemsSummary: [evil], logs: [{ ...V11.logs[0], note: evil }] }] });
    const h = renderToString(createElement(DeliveryBundleSection, { data: d, readOnly: false, taskId: "t" }));
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  });
});

// 화면 점검용 HTML(4폭·테마 브라우저 점검은 별도 스크립트). DB_HARNESS 가 있을 때만 쓴다
it.runIf(Boolean(process.env.DB_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.DB_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
});
