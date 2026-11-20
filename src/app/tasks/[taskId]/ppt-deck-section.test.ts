import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PptDeckData, PptDeckView } from "./ppt-deck-model";
import type { PptDeckBoard } from "./ppt-deck-section";

/**
 * P3E-UI-CONNECT-01 PPT 구성·템플릿·내보내기 상태별 화면(서버 보기 모양의 가짜 보드).
 * 시안 ppt-deck.html 상태 + 원인별 이전 기준·맞추기 막힘·자산 보관 경고·판 20·판 이력·구성안 한도·불러오기 실패.
 */
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("@/features/ppt-decks/actions", () => ({
  archivePptDeckAction: vi.fn(),
  createPptDeckAction: vi.fn(),
  rebasePptDeckAction: vi.fn(),
  restorePptDeckVersionAction: vi.fn(),
  savePptDeckAction: vi.fn(),
}));
vi.mock("@/features/ppt-decks/server", () => ({}));
vi.mock("@/features/production-brief/server", () => ({}));
vi.mock("@/features/projects/server", () => ({}));
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./ppt-deck.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./design-assets.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { PptDeckSection } = await import("./ppt-deck-section");

const ASSETS = [
  { id: "as1", label: "로고 심볼 패키지 (v2)" },
  { id: "as2", label: "로열 블루 색상 토큰 (v2)" },
];
const DECK: PptDeckView = {
  id: "dddddddd-dddd-4ddd-8ddd-000000000001",
  title: "나다음 서비스 제안서",
  templateKey: "royal_grid",
  status: "drafting",
  archivedAt: null,
  revision: 4,
  versionNo: 3,
  stale: false,
  staleReasons: [],
  staleAssetCount: 0,
  archivedAssetCount: 0,
  rebaseBlockedReason: null,
  versionLimitReached: false,
  slides: [
    { id: "s1", slideTitle: "브랜드 리뉴얼 제안", bulletPoints: "대상 고객: 지역 세무회계 사무소\n작성: 2026-11-20", speakerNotes: "발표 목적을 짧게 소개합니다.", assetIds: ["as1"], sortOrder: 1 },
    { id: "s2", slideTitle: "발표 순서", bulletPoints: "1. 현황\n2. 제안\n3. 일정", speakerNotes: "", assetIds: [], sortOrder: 2 },
  ],
  deckVersions: [
    { version: 3, kind: "save", status: "drafting", savedAt: "2026-11-20T02:40:00Z", slideCount: 2, restoredFromVersion: null, current: true },
    { version: 2, kind: "save", status: "drafting", savedAt: "2026-11-20T02:10:00Z", slideCount: 3, restoredFromVersion: null, current: false },
    { version: 1, kind: "create", status: "drafting", savedAt: "2026-11-20T01:00:00Z", slideCount: 3, restoredFromVersion: null, current: false },
  ],
};
const BRIEF = { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", title: "브랜드 리뉴얼 제작 브리프" };
const data = (deck: PptDeckView | null, x: Partial<PptDeckData> = {}): PptDeckData => ({
  deck,
  canWrite: deck !== null,
  readOnlyReason: null,
  canCreate: deck === null,
  createBlockedReason: null,
  createBlockedCode: null,
  canExport: deck !== null,
  assets: ASSETS,
  activeDeckCount: deck === null ? 0 : 1,
  briefTitle: BRIEF.title,
  ...x,
});
const board = (d: PptDeckData): PptDeckBoard => ({ brief: BRIEF, data: d });
const stale = (x: Partial<PptDeckView>): PptDeckView => ({ ...DECK, stale: true, ...x });
const ARCHIVED_REASON = "보관한 PPT 구성안입니다. 조회와 내보내기만 할 수 있고 고치기·추가는 할 수 없습니다.";

const STATES: Record<string, { boards: PptDeckBoard[] | null; readOnly?: boolean }> = {
  작성중: { boards: [board(data(DECK))] },
  검토완료: { boards: [board(data({ ...DECK, status: "reviewed", templateKey: "brand_deck" }))] },
  이전기준: { boards: [board(data(stale({ staleReasons: ["brief", "asset"], staleAssetCount: 1 })))] },
  맞추기막힘: { boards: [board(data(stale({ staleReasons: ["brief"], rebaseBlockedReason: "rebaseBlockedBriefDraft" })))] },
  자산보관: { boards: [board(data({ ...DECK, archivedAssetCount: 2 }))] },
  판20: { boards: [board(data(stale({ staleReasons: ["asset"], staleAssetCount: 1, versionNo: 20, versionLimitReached: true, rebaseBlockedReason: "rebaseBlockedVersionLimit" })))] },
  보관: { boards: [board(data({ ...DECK, status: "reviewed", archivedAt: "2026-11-20T03:00:00Z", rebaseBlockedReason: "archivedNote" }, { canWrite: false, readOnlyReason: ARCHIVED_REASON }))] },
  읽기전용: { boards: [board(data(stale({ staleReasons: ["brief"] })))], readOnly: true },
  빈상태: { boards: [board(data(null))] },
  구성안한도: { boards: [board(data(null, { canCreate: false, createBlockedCode: "deck_limit", createBlockedReason: "PPT 구성안은 브리프당 활성 5개(전체 10개)까지 둘 수 있습니다." }))] },
  브리프없음: { boards: [] },
  불러오기실패: { boards: null },
};
const render = (k: string) => renderToString(createElement(PptDeckSection, { boards: STATES[k].boards, readOnly: Boolean(STATES[k].readOnly), taskId: "t-1" }));
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const REBASE = "최신 기준으로 맞추기";
const EXPORT_PPTX = `href="/ppt-decks/${DECK.id}/export?format=pptx"`;
const EXPORT_MD = `href="/ppt-decks/${DECK.id}/export?format=md"`;

describe("PPT 구성·템플릿·내보내기 상태별 화면(서버 연결)", () => {
  it("모든 상태: 제목·소개·영역 이름, SVG 는 장식, 진행률 막대 없음", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      expect(h, k).toContain('id="ppt-deck"');
      expect(text(h), k).toContain("PPT 구성·템플릿·내보내기");
      expect(h, k).not.toMatch(/<progress|role="progressbar"/);
      expect(count(h, /<svg/g), k).toBe(count(h, /<svg[^>]*aria-hidden="true"/g));
    }
  });

  it("작성 중: 배지(상태·슬라이드 수·대표 구성안), 편집기·템플릿 3종, 저장 값에 sortOrder 없음, 내보내기 링크·판 이력·보관", () => {
    const h = render("작성중");
    const t = text(h);
    expect(t).toContain("기준 제작 브리프: 브랜드 리뉴얼 제작 브리프");
    expect(t).toContain("슬라이드 2 / 40장");
    expect(t).toContain("대표 구성안 · 활성 1 / 5개");
    for (const n of ["테크 그리드 로열 블루", "미니멀 보고서형", "브랜드 소개서형"]) expect(t).toContain(n);
    expect(count(h, /type="radio"/g)).toBe(3);
    expect(h).toContain('name="deckId"');
    expect(h).not.toContain("sortOrder");
    expect(t).toContain("구성안 저장");
    expect(t).toContain("진행 상태");
    expect(h).toContain(EXPORT_PPTX);
    expect(h).toContain(EXPORT_MD);
    expect(t).toContain("구성안 판 이력 · 되돌리기 (3 / 20판 · 빼기 슬라이드 복구)");
    expect(t).toContain("v3 (현재) · 저장");
    expect(count(h, />이 판으로 되돌리기</g)).toBe(2);
    expect(h).toContain(`href="/ppt-decks/${DECK.id}/export?format=pptx&amp;version=2"`);
    expect(h).toContain('aria-label="v1 .md 구성안 내려받기"');
    expect(t).toContain("이 구성안 보관");
    expect(t).not.toContain(REBASE);
  });

  it("이전 기준(원인별): 브리프·자산 n개 안내 둘 + 맞추기", () => {
    const t = text(render("이전기준"));
    expect(t).toContain("이전 기준: 공통 제작 브리프가 새 판으로 바뀌었습니다. 슬라이드 제목과 요점을 확인해 주세요.");
    expect(t).toContain("이전 기준: 연결된 디자인 자산 1개가 새 판으로 바뀌었습니다. 사용 자산을 확인해 주세요.");
    expect(t).toContain(REBASE);
  });

  it("맞추기 막힘: 서버 문구 키 → AGY 문구, 맞추기 단추 없음", () => {
    const t = text(render("맞추기막힘"));
    expect(t).toContain("바탕 제작 브리프가 아직 확정 전이라 최신 기준으로 맞출 수 없습니다.");
    expect(t).not.toContain(REBASE);
  });

  it("자산 보관: 이전 기준과 별도 경고", () => {
    const t = text(render("자산보관"));
    expect(t).toContain("연결된 디자인 자산 2개가 보관되었습니다. 필요하면 다른 자산으로 바꿔 주세요.");
    expect(t).not.toContain("이전 기준:");
  });

  it("판 20: 안내 + 편집기·되돌리기·맞추기 없음, 막힘 문구, 내보내기·보관은 남음", () => {
    const h = render("판20");
    const t = text(h);
    expect(t).toContain("판 20개 도달: PPT 구성안 판 이력이 20개에 도달해 더 저장하거나 되돌릴 수 없습니다. 보관한 뒤 새 구성안으로 만들어 주세요.");
    expect(t).toContain("PPT 구성안 판 이력이 20개에 도달해 최신 기준으로 맞출 수 없습니다.");
    expect(h).not.toContain("<form class=\"form ppForm\"");
    expect(t).not.toContain("구성안 저장");
    expect(t).not.toContain("이 판으로 되돌리기");
    expect(t).not.toContain(REBASE);
    expect(h).toContain(EXPORT_PPTX);
    expect(t).toContain("이 구성안 보관");
  });

  it("보관: 보관 배지·안내, 폼·되돌리기·보관 0, 내보내기(현재·옛 판)는 남음", () => {
    const h = render("보관");
    const t = text(h);
    expect(t).toContain("보관한 PPT 구성안입니다. 조회와 내보내기만 할 수 있고 고치기·추가는 할 수 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(t).not.toContain("이 판으로 되돌리기");
    expect(t).not.toContain("이 구성안 보관");
    expect(t).not.toContain("이전 기준:");
    expect(h).toContain(EXPORT_PPTX);
    expect(h).toContain(EXPORT_MD);
    expect(h).toContain("version=2");
  });

  it("읽기 전용: 프로젝트 안내 한 번, 폼 0, 이전 기준 안내는 보이되 맞추기 없음, 내보내기 남음", () => {
    const h = render("읽기전용");
    const t = text(h);
    expect(count(h, /<form/g)).toBe(0);
    expect(t).toContain("이전 기준:");
    expect(t).not.toContain(REBASE);
    expect(t).not.toContain("+ PPT 구성안 만들기");
    expect(h).toContain(EXPORT_PPTX);
  });

  it("빈 상태: 그림·안내·만들기 폼(펼침, productionBriefId, 기본 뼈대 3장·표지 제목 = 브리프 제목) / 구성안 한도: AGY planLimitReached / 브리프 없음", () => {
    const h = render("빈상태");
    const t = text(h);
    expect(t).toContain("아직 PPT 구성안이 없습니다.");
    expect(t).toContain("확정된 공통 제작 브리프를 바탕으로 기본 표지·목차·본문 슬라이드 뼈대를 바로 만들 수 있습니다.");
    expect(h).toMatch(/<details[^>]* open/);
    expect(h).toContain(`name="productionBriefId" value="${BRIEF.id}"`);
    expect(h).not.toContain('name="deckId"');
    expect(t).not.toContain("진행 상태"); // 만들 때는 작성 중으로 시작(서버가 status 를 받지 않음)
    expect(t).toContain("슬라이드 목록 (3 / 40장)");
    expect(t).toContain("슬라이드 1 · 브랜드 리뉴얼 제작 브리프");
    expect(t).toContain("슬라이드 2 · 발표 순서");
    expect(h).not.toContain("/export?");
    const lim = text(render("구성안한도"));
    expect(lim).toContain("PPT 구성안은 브리프당 활성 5개(전체 10개)까지 둘 수 있습니다.");
    expect(lim).not.toContain("+ PPT 구성안 만들기");
    expect(text(render("브리프없음"))).toContain("제작 브리프를 확정해야 PPT 구성안을 만들 수 있습니다.");
  });

  it("불러오기 실패: 알림 + 다시 불러오기", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("PPT 구성안을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    expect(h).toContain('href="/tasks/t-1#ppt-deck"');
  });
});

// 화면 점검용 HTML(4폭·테마 점검은 별도 스크립트). PPT_HARNESS 가 있을 때만 쓴다
it.runIf(Boolean(process.env.PPT_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.PPT_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
});
