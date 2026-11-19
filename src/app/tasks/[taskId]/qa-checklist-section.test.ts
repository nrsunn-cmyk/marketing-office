import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { QaChecklistData, QaItemView, QaRoundView, QaTargetView } from "./qa-checklist-model";

/**
 * P3F-UI-PREP-01 검수 체크리스트 상태별 화면(가짜 데이터, 서버 없음).
 * 상태 6종(작성 중·보완 요청됨·검토 완료·이전 기준·보관·읽기 전용) + 예외(빈 상태·바탕 보관·확정 전·권한 없음·회차 한도·불러오기 실패·메모 넘침).
 * 탭은 첫 결과물만 그리므로 상태마다 확인할 결과물을 맨 앞에 둔다.
 */
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./qa-checklist.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { QaChecklistSection } = await import("./qa-checklist-section");

const item = (n: number, title: string, verdict: QaItemView["verdict"], x: Partial<QaItemView> = {}): QaItemView => ({
  id: `i${n}`,
  itemTitle: title,
  isRequired: true,
  verdict,
  memo: "",
  checkedByName: verdict === "pending" ? null : "김검수",
  checkedAt: verdict === "pending" ? null : `2026-11-19T18:1${n}:00Z`,
  sortOrder: n,
  ...x,
});
const ITEMS = [
  item(1, "공통 제작 브리프·승인 전략과 문구 일치", "passed"),
  item(2, "모바일(390px) 및 PC(1280px) 넘침·터치 크기 확인", "passed"),
  item(3, "근거 출처 연결 및 과장·금기 표현 점검", "needs_fix", { memo: "히어로 CTA 문구가 출처보다 과장됨" }),
];
const PASSED = ITEMS.map((i) => ({ ...i, verdict: "passed" as const, memo: "" }));
const round = (roundNo: number, items: QaItemView[], x: Partial<QaRoundView> = {}): QaRoundView => ({
  id: `r${roundNo}`,
  roundNo,
  status: "drafting",
  archivedAt: null,
  revision: 5,
  targetVersionId: "wc-v3",
  targetVersionNo: 3,
  stale: false,
  items,
  createdAt: "2026-11-19T12:00:00Z",
  updatedAt: "2026-11-19T18:15:00Z",
  ...x,
});
const R1 = round(1, ITEMS.map((i) => ({ ...i, id: `old-${i.id}` })), { status: "fix_requested", updatedAt: "2026-11-19T12:30:00Z", targetVersionNo: 2, targetVersionId: "wc-v2" });
const web = (x: Partial<QaTargetView> = {}): QaTargetView => ({
  kind: "web_copy",
  exists: true,
  baseArchived: false,
  versions: [
    { id: "wc-v2", versionNo: 2, status: "reviewed" },
    { id: "wc-v3", versionNo: 3, status: "reviewed" },
  ],
  rounds: [R1, round(2, ITEMS)],
  ...x,
});
const others: QaTargetView[] = [
  { kind: "design_assets", exists: true, baseArchived: false, versions: [{ id: "da-v1", versionNo: 1, status: "reviewed" }], rounds: [round(1, PASSED, { status: "reviewed" })] },
  { kind: "video_plan", exists: true, baseArchived: false, versions: [{ id: "vp-v2", versionNo: 2, status: "reviewed" }], rounds: [round(1, PASSED)] },
  { kind: "ppt_deck", exists: false, baseArchived: false, versions: [], rounds: [] },
];
const data = (first: QaTargetView, x: Partial<QaChecklistData> = {}): QaChecklistData => ({ targets: [first, ...others], canWrite: true, ...x });

const STATES: Record<string, { data: QaChecklistData | null; readOnly?: boolean }> = {
  작성중: { data: data(web()) },
  보완요청됨: { data: data(web({ rounds: [R1] })) },
  검토완료: { data: data(web({ rounds: [round(1, PASSED, { status: "reviewed" })] })) },
  승인가능: { data: data(web({ rounds: [round(1, PASSED)] })) },
  이전기준: { data: data(web({ rounds: [R1, round(2, ITEMS, { stale: true })], versions: [...web().versions, { id: "wc-v4", versionNo: 4, status: "reviewed" }] })) },
  보관: { data: data(web({ rounds: [R1, round(2, ITEMS, { archivedAt: "2026-11-20T01:00:00Z", stale: true })] })) },
  읽기전용: { data: data(web()), readOnly: true },
  빈상태: { data: data(web({ rounds: [] })) },
  바탕보관: { data: data(web({ baseArchived: true })) },
  확정전: { data: data(web({ rounds: [], versions: [{ id: "wc-v1", versionNo: 1, status: "drafting" }] })) },
  권한없음: { data: data(web(), { canWrite: false }) },
  회차한도: { data: data(web({ rounds: Array.from({ length: 30 }, (_, i) => round(i + 1, ITEMS, { stale: i === 29 })) })) },
  불러오기실패: { data: null },
  메모넘침: { data: data(web({ rounds: [round(1, [item(1, "문구 점검", "needs_fix", { memo: "가".repeat(501) }), item(2, "넘침 점검", "needs_fix")])] })) },
};
const render = (k: string) => renderToString(createElement(QaChecklistSection, { data: STATES[k].data, readOnly: Boolean(STATES[k].readOnly), taskId: "t-1" }));
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("검수 체크리스트 상태별 화면", () => {
  it("모든 상태: 제목·아이콘·안내, 진행률 막대·% 없음", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      expect(h, k).toContain('aria-labelledby="qa-checklist"');
      expect(text(h), k).toContain("결과물별 모든 필수 항목이 통과해야 승인할 수 있습니다.");
      expect(h, k).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"');
      expect(h, k).not.toMatch(/progressbar|<progress|%/);
    }
  });

  it("탭: 결과물 4종, 통과 수, 첫 탭 선택(44px 단추)", () => {
    const t = text(render("작성중"));
    for (const s of ["홈페이지 (2/3 통과)", "디자인 자산 (3/3 통과)", "영상 (3/3 통과 · 승인 가능)", "PPT"]) expect(t).toContain(s);
    const h = render("작성중");
    expect(count(h, /class="qaTab"/g)).toBe(4);
    expect(count(h, /aria-pressed="true"/g)).toBe(1);
  });

  it("작성 중: 배지·대상 판, 항목 3개(필수·판정·검수자·메모), 승인 차단 + 보완 요청, 저장·보관 확인, 이력", () => {
    const h = render("작성중");
    const t = text(h);
    expect(t).toContain("작성 중");
    expect(t).toContain("승인 불가 (보완 1건)");
    expect(t).toContain("2차 · 2/3 통과");
    expect(t).toContain("검수 대상 판: 홈페이지 구조·문구 v3");
    expect(t).toContain("1. [필수] 공통 제작 브리프·승인 전략과 문구 일치");
    expect(t).toContain("검수자: 김검수 · 마지막 확인: 2026-11-20 03:11 KST");
    expect(count(h, /type="radio"/g)).toBe(9);
    expect(count(h, /type="radio"[^>]*checked=""/g)).toBe(3);
    expect(count(h, /<textarea/g)).toBe(3);
    expect(t).toContain("검수 메모 (보완 시 필수)");
    expect(t).toContain(`${Array.from("히어로 CTA 문구가 출처보다 과장됨").length} / 500자`);
    expect(t).toContain("승인 조건 미충족: 보완 필요 또는 미확인 필수 항목이 남아 있어 승인할 수 없습니다.");
    expect(t).toContain("보완 요청 보내기");
    expect(t).not.toContain("이 결과물 승인");
    expect(t).toContain("검수 내용 저장");
    expect(h).toMatch(/<details[^>]*><summary>이 검수 기록 보관<\/summary>/);
    expect(t).toContain("보관하면 내용만 볼 수 있고 고칠 수 없습니다. 보관은 되돌릴 수 없습니다.");
    expect(h).toContain('name="roundId" value="r2"');
    expect(h).toContain('name="revision" value="5"');
    expect(h).toContain('name="payload"');
    // 이력: 최신 회차가 위, 보완 요청 회차는 '수정됨'
    expect(t).toContain("보완 요청 · 재검수 흐름 이력");
    expect(t.indexOf("2차 작성 중")).toBeLessThan(t.indexOf("1차 보완 요청됨"));
    expect(t).toContain("1차 보완 요청됨 · 2026-11-19 21:30 KST · 홈페이지 구조·문구 v2 (보완 1건) 수정됨");
    expect(t).toContain("현재 회차");
  });

  it("저장 payload: 판정·메모만, 항목 id 그대로", () => {
    const h = render("작성중");
    const m = /name="payload" value="([^"]*)"/.exec(h);
    const p = JSON.parse(m![1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    expect(p.items.map((x: { id: string }) => x.id)).toEqual(["i1", "i2", "i3"]);
    expect(p.items[2]).toEqual({ id: "i3", verdict: "needs_fix", memo: "히어로 CTA 문구가 출처보다 과장됨" });
  });

  it("보완 요청됨: 배지, 보완 요청 단추는 다시 보이지 않음", () => {
    const t = text(render("보완요청됨"));
    expect(t).toContain("보완 요청됨");
    expect(t).not.toContain("보완 요청 보내기");
    expect(t).toContain("승인 조건 미충족:");
  });

  it("승인 가능: gateReady + 승인 단추", () => {
    const t = text(render("승인가능"));
    expect(t).toContain("모든 필수 항목이 통과되었습니다. 승인하면 납품 묶음에 포함될 수 있습니다.");
    expect(t).toContain("이 결과물 승인");
    expect(t).not.toContain("승인 불가");
  });

  it("검토 완료: 배지, 폼·승인·보완 요청 없음, 판정·메모 조회", () => {
    const h = render("검토완료");
    expect(text(h)).toContain("검토 완료");
    expect(count(h, /<textarea|type="radio"/g)).toBe(0);
    expect(text(h)).not.toContain("이 결과물 승인");
    expect(text(h)).toContain("검수 메모 적지 않음");
  });

  it("이전 기준: 배지·staleBanner·재검수 시작(검토 완료 판 고르기, 최신 기본)", () => {
    const h = render("이전기준");
    const t = text(h);
    expect(t).toContain("이전 기준: 검수 대상 결과물이 새 버전으로 수정되었습니다. 새 버전에 맞춰 재검수가 필요합니다.");
    expect(t).toContain("새 버전 기준으로 재검수 시작");
    expect(h).toMatch(/<select[^>]*name="targetVersionId"/);
    expect(count(h, /<option /g)).toBe(3);
    expect(h).toMatch(/<option value="wc-v4" selected="">홈페이지 구조·문구 v4<\/option>/);
  });

  it("보관: 배지·archivedNote, 폼·단추·재검수 0개", () => {
    const h = render("보관");
    expect(text(h)).toContain("보관한 검수 기록입니다. 조회만 할 수 있고 판정·보완 요청·승인은 할 수 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(count(h, /<(input|textarea|select)/g)).toBe(0);
    expect(text(h)).not.toContain("재검수 시작");
    expect(text(h)).toContain("히어로 CTA 문구가 출처보다 과장됨");
  });

  it("읽기 전용·권한 없음·바탕 보관: 안내 하나, 폼 0개", () => {
    for (const [k, msg] of [
      ["읽기전용", "보관한 프로젝트이거나 취소한 작업이라 고칠 수 없습니다."],
      ["권한없음", "검수 판정을 내리거나 승인할 권한이 없습니다."],
      ["바탕보관", "바탕이 된 결과물이나 작업이 보관되었습니다. 이 검수 기록은 조회만 할 수 있습니다."],
    ] as const) {
      const h = render(k);
      expect(text(h), k).toContain(msg);
      expect(count(h, /<form/g), k).toBe(0);
    }
  });

  it("빈 상태: 그림·시작 단추 + 판 고르기 / 확정 전: 안내만", () => {
    const h = render("빈상태");
    expect(text(h)).toContain("아직 시작된 검수 체크리스트가 없습니다.");
    expect(text(h)).toContain("검토 완료 상태의 결과물이 준비되면 기본 검수 체크리스트를 시작할 수 있습니다.");
    expect(h).toContain('class="button">+ 검수 체크리스트 시작하기</button>');
    expect(h).toContain('name="targetKind" value="web_copy"');
    expect(h).toMatch(/<option value="wc-v3" selected="">/);
    const n = render("확정전");
    expect(text(n)).toContain("대상 결과물이 아직 검토 완료 전이라 검수를 열거나 승인할 수 없습니다.");
    expect(count(n, /<form/g)).toBe(0);
  });

  it("회차 한도 30: 안내, 재검수 시작 없음", () => {
    const t = text(render("회차한도"));
    expect(t).toContain("검수 회차는 30회까지 기록할 수 있습니다.");
    expect(t).not.toContain("새 버전 기준으로 재검수 시작");
  });

  it("불러오기 실패: 알림과 다시 불러오기", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("검수 체크리스트를 불러오지 못했습니다.");
    expect(h).toContain('href="/tasks/t-1#qa-checklist"');
    expect(text(h)).toContain("다시 불러오기");
  });

  it("메모 넘침·보완 메모 없음: 폼 위 안내, 넘침은 바로, 값은 자르지 않음", () => {
    const h = render("메모넘침");
    expect(text(h)).toContain("보완 필요로 판정한 항목은 검수 메모를 꼭 적어 주세요.");
    expect(text(h)).toContain("501 / 500자");
    expect(text(h)).toContain("검수 메모는 500자까지 쓸 수 있습니다.");
    expect(h).toContain('class="qaCount qaCountOver"');
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain("가".repeat(501));
  });

  it("글은 이스케이프되어 HTML 로 들어가지 않는다", () => {
    const evil = '"><script>alert(1)</script>';
    for (const k of ["작성중", "보관"]) {
      const base = STATES[k].data!;
      const t0 = base.targets[0];
      const r = t0.rounds.map((x) => ({ ...x, items: x.items.map((i) => ({ ...i, itemTitle: evil, memo: evil, checkedByName: evil })) }));
      const h = renderToString(createElement(QaChecklistSection, { data: { ...base, targets: [{ ...t0, rounds: r }, ...base.targets.slice(1)] }, readOnly: false, taskId: "t" }));
      expect(h).not.toContain("<script>");
      expect(h).toContain("&lt;script&gt;");
    }
  });
});

// 화면 점검용 HTML(4폭·2테마 브라우저 점검은 별도 스크립트). QA_HARNESS 가 있을 때만 쓴다
it.runIf(Boolean(process.env.QA_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.QA_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
});
