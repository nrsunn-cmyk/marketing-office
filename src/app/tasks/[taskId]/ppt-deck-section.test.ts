import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PptDeckData, PptDeckView } from "./ppt-deck-model";

/**
 * P3E-UI-PREP-01 PPT 구성·템플릿·내보내기 상태별 화면(가짜 데이터, 서버·실제 .pptx 생성 없음).
 * 시안 ppt-deck.html 상태 6종(작성 중·검토 완료·이전 기준·보관·읽기 전용·빈 상태) + 만들 수 없음·권한 없음·한도·불러오기 실패.
 */
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./ppt-deck.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./production-brief.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { PptDeckSection } = await import("./ppt-deck-section");

const ASSETS = [
  { id: "as1", label: "로고 심볼 패키지 (v2)" },
  { id: "as2", label: "로열 블루 색상 토큰 (v2)" },
];
const DECK: PptDeckView = {
  id: "pppppppp-pppp-4ppp-8ppp-000000000001",
  title: "나다음 서비스 소개서",
  templateKey: "royal_grid",
  status: "drafting",
  archivedAt: null,
  revision: 4,
  stale: false,
  slides: [
    { id: "s1", slideTitle: "표지", bulletPoints: "- 1인·소규모 사업자를 위한 기준 기반 마케팅 업무실\n- 작성 날짜: 2026-11-20 · 승인 전략 v2 기준", speakerNotes: "", assetIds: ["as1", "as2"], sortOrder: 1 },
    { id: "s2", slideTitle: "문제와 해결 흐름", bulletPoints: "- 브리프 → 홈페이지 문구 → 디자인 자산 → 검수 체크리스트 → 납품 묶음", speakerNotes: "처음 30초 안에 흐름을 보여 준다", assetIds: [], sortOrder: 2 },
  ],
};
const data = (deck: PptDeckView | null, extra: Partial<PptDeckData> = {}): PptDeckData => ({ deck, canWrite: true, canCreate: true, createBlockedReason: null, assets: ASSETS, ...extra });

const STATES: Record<string, { data: PptDeckData | null; readOnly?: boolean }> = {
  작성중: { data: data(DECK) },
  검토완료: { data: data({ ...DECK, status: "reviewed" }) },
  이전기준: { data: data({ ...DECK, stale: true }) },
  보관: { data: data({ ...DECK, status: "reviewed", archivedAt: "2026-11-20T00:00:00Z" }) },
  읽기전용: { data: data({ ...DECK, stale: true }), readOnly: true },
  빈상태: { data: data(null) },
  만들수없음: { data: data(null, { canCreate: false, createBlockedReason: "확정된 공통 제작 브리프가 있어야 PPT 구성안을 만들 수 있습니다." }) },
  권한없음: { data: data(DECK, { canWrite: false }) },
  한도: { data: data({ ...DECK, slides: Array.from({ length: 40 }, (_, i) => ({ ...DECK.slides[1], id: `x${i}`, slideTitle: `슬라이드 ${i + 1}`, sortOrder: i + 1 })) }) },
  불러오기실패: { data: null },
};
const render = (k: string) => renderToString(createElement(PptDeckSection, { data: STATES[k].data, readOnly: Boolean(STATES[k].readOnly), taskId: "t-1" }));
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/\s+/g, " ");

describe("PPT 구성·템플릿·내보내기 상태별 화면", () => {
  it("모든 상태: 제목·소개·영역 이름, SVG 는 장식, 진행률 막대 없음", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      expect(h, k).toContain('aria-labelledby="ppt-deck"');
      expect(text(h), k).toContain("슬라이드별 제목·요점·사용 디자인 자산을 구성하고 템플릿을 골라 내보냅니다.");
      expect(h, k).not.toMatch(/<svg(?![^>]*aria-hidden="true")/);
      expect(h, k).not.toMatch(/role="progressbar"|<progress/);
    }
  });

  it("작성 중: 배지·슬라이드 수·제목·템플릿 3개(라디오)·슬라이드 카드·내보내기 자리·보관 확인", () => {
    const h = render("작성중");
    expect(h).toContain('class="ppBadge ppBadge_drafting"');
    expect(text(h)).toContain("슬라이드 2 / 40장");
    expect(text(h)).toContain("발표 자료(PPT) 제목 (필수)");
    expect(text(h)).toContain("템플릿 선택 (16:9 기본)");
    expect(count(h, /type="radio"/g)).toBe(3);
    expect(count(h, /type="radio"[^>]*checked=""/g)).toBe(1);
    for (const t of ["테크 그리드 로열 블루", "밝은 그리드 바탕 + 로열 블루 강조", "미니멀 보고서형", "브랜드 소개서형", "큰 이미지와 핵심 숫자 강조"]) expect(text(h)).toContain(t);
    expect(text(h)).toContain("슬라이드 목록 (2 / 40장)");
    expect(text(h)).toContain("슬라이드 1 · 표지");
    expect(h).toMatch(/disabled=""[^>]*aria-label="슬라이드 1 · 표지 위로"/);
    for (const l of ["슬라이드 제목", "핵심 요점", "발표자 메모", "사용 디자인 자산 연결 (0~10개)"]) expect(text(h)).toContain(l);
    expect(count(h, /type="checkbox"/g)).toBe(4);
    expect(count(h, /type="checkbox" checked=""/g)).toBe(2);
    expect(text(h)).toContain("+ 슬라이드 추가");
    expect(text(h)).toContain("내보내기 자리");
    expect(text(h)).toContain("실제 .pptx 생성 방식과 템플릿 렌더링은 서버 기준을 따릅니다.");
    expect(text(h)).toContain(".pptx 내보내기");
    expect(text(h)).toContain(".md 구성안 내려받기");
    expect(text(h)).toContain("구성안 저장");
    expect(count(h, /<summary>이 구성안 보관<\/summary>/g)).toBe(1);
    expect(text(h)).toContain("보관하면 내용만 볼 수 있고 고칠 수 없습니다. 보관은 되돌릴 수 없습니다.");
    expect(h).toContain(`name="deckId" value="${DECK.id}"`);
    expect(h).not.toMatch(/class="ppCount[^"]*" aria-live/);
  });

  it("검토 완료: 배지·선택값", () => {
    const h = render("검토완료");
    expect(h).toContain('class="ppBadge ppBadge_reviewed"');
    expect(h).toMatch(/<option value="reviewed" selected="">/);
  });

  it("이전 기준: 배지·안내·맞추기", () => {
    const h = render("이전기준");
    expect(text(h)).toContain("이전 기준: 공통 제작 브리프 또는 연결된 디자인 자산이 새 버전으로 바뀌었습니다. 슬라이드 요점과 연결 자산을 확인해 주세요.");
    expect(count(h, />최신 기준으로 맞추기</g)).toBe(1);
  });

  it("보관: 안내, 고치기 폼 0개이지만 내보내기는 남는다(인계표 3절 2)", () => {
    const h = render("보관");
    expect(h).toContain('class="ppBadge ppBadge_archived"');
    expect(text(h)).toContain("보관한 PPT 구성안입니다. 조회와 내보내기만 할 수 있고 고치기·추가는 할 수 없습니다.");
    expect(count(h, /<(input|textarea|select)(?![^>]*type="hidden")/g)).toBe(0);
    expect(count(h, /<form/g)).toBe(2); // 내보내기 두 단추만
    expect(text(h)).toContain(".pptx 내보내기");
    expect(text(h)).not.toContain("이 구성안 보관");
    expect(text(h)).toContain("테크 그리드 로열 블루 · 밝은 그리드 바탕 + 로열 블루 강조");
    expect(text(h)).toContain("로고 심볼 패키지 (v2), 로열 블루 색상 토큰 (v2)");
  });

  it("읽기 전용·권한 없음: 안내, 고치기 폼 0개(내보내기만)", () => {
    const r = render("읽기전용");
    expect(text(r)).toContain("보관한 프로젝트이거나 취소한 작업이라 고칠 수 없습니다.");
    expect(count(r, /<form/g)).toBe(2);
    expect(text(r)).not.toContain("최신 기준으로 맞추기");
    const p = render("권한없음");
    expect(text(p)).toContain("PPT 구성안을 고칠 권한이 없습니다.");
    expect(count(p, /<form/g)).toBe(2);
  });

  it("빈 상태: 그림·안내·만들기, 만들 수 없으면 서버 사유만", () => {
    const h = render("빈상태");
    expect(text(h)).toContain("아직 PPT 구성안이 없습니다.");
    expect(text(h)).toContain("확정된 공통 제작 브리프를 바탕으로 기본 표지·목차·본문 슬라이드 뼈대를 바로 만들 수 있습니다.");
    expect(h).toContain('viewBox="0 0 96 72"');
    expect(text(h)).toContain("+ PPT 구성안 만들기");
    const b = render("만들수없음");
    expect(text(b)).toContain("확정된 공통 제작 브리프가 있어야 PPT 구성안을 만들 수 있습니다.");
    expect(count(b, /<form/g)).toBe(0);
  });

  it("한도: 40장이면 추가 대신 안내", () => {
    const h = render("한도");
    expect(text(h)).toContain("슬라이드 목록 (40 / 40장)");
    expect(text(h)).toContain("슬라이드는 40장까지 둘 수 있습니다. 불필요한 슬라이드를 제외한 뒤 추가해 주세요.");
    expect(text(h)).not.toContain("+ 슬라이드 추가");
  });

  it("불러오기 실패: 알림과 다시 불러오기", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("PPT 구성안을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    expect(h).toContain('href="/tasks/t-1#ppt-deck"');
  });

  it("글은 이스케이프되어 HTML 로 들어가지 않는다", () => {
    const evil = '"><script>alert(1)</script>';
    for (const archivedAt of [null, "2026-11-20T00:00:00Z"]) {
      const h = renderToString(createElement(PptDeckSection, { data: data({ ...DECK, archivedAt, title: evil, slides: [{ ...DECK.slides[0], slideTitle: evil, bulletPoints: evil, speakerNotes: evil }] }), readOnly: false, taskId: "t" }));
      expect(h).not.toContain("<script>");
      expect(h).toContain("&lt;script&gt;");
    }
  });
});

// 화면 점검용 HTML(4폭·2테마 점검은 별도 스크립트). PPT_DECK_HARNESS 가 있을 때만 쓴다
it.runIf(Boolean(process.env.PPT_DECK_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.PPT_DECK_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
  writeFileSync(join(out, "작성중-펼침.html"), render("작성중").replace(/<details class="([^"]*)">/g, '<details class="$1" open="">'));
});
