import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FunnelBoard, FunnelItemView } from "@/features/funnel/server";
import type { LeadMagnetView } from "@/features/lead-magnet/server";

/**
 * P2E-UI-01 리드마그넷 영역의 상태별 화면(시안 lead-magnet.html R1: 기본·이전 전략 기준·빈 상태·읽기 전용 + 오류·한도·보관됨),
 * 퍼널 카드의 리드마그넷 연결 칸, 새 카드에서 '리드마그넷' 유형 숨김(AGY 결정).
 * 서버 동작은 가짜로 둔다(외부 호출 없음). CSS 모듈은 원래 클래스 이름 그대로(점검용 HTML 에 원래 CSS 를 붙이기 위해).
 */
vi.mock("@/features/lead-magnet/actions", () => {
  const noop = async () => ({});
  return { createLeadMagnetAction: noop, updateLeadMagnetAction: noop, rebaseLeadMagnetAction: noop, archiveLeadMagnetAction: noop, setFunnelItemLeadMagnetAction: noop };
});
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./lead-magnet.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { LeadMagnetSection } = await import("./lead-magnet-section");
const { CardLeadMagnet } = await import("./card-lead-magnet");
const { FunnelItemForm } = await import("./funnel-item-form");
const { EMPTY_FUNNEL_ITEM } = await import("./funnel-form");

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const KEYS = [
  ["inflow", "유입"],
  ["awareness", "인지"],
  ["consideration", "고려"],
  ["conversion", "전환"],
  ["retention", "유지"],
] as const;
const V2 = { id: id(902), version: 2 };
const V1 = { id: id(901), version: 1 };
const board = {
  state: "board",
  stages: KEYS.map(([key, label], i) => ({ id: id(10 + i), key, label, position: i + 1, focus: null, revision: 1, items: [] })),
  strategy: { approvedVersion: V2, basis: { goals: [], offers: [], audiences: [] } },
  funnel: { id: id(1), revision: 1, stale: false, strategyVersion: V2 },
  warnings: [],
} as unknown as FunnelBoard;

const lm = (n: number, over: Partial<LeadMagnetView> = {}): LeadMagnetView => ({
  id: id(100 + n),
  stageId: id(12),
  stageKey: "consideration",
  stageLabel: "고려",
  title: `원두 고르는 법 체크리스트 ${n}`,
  format: "checklist",
  audience: "출근길에 커피를 사는 동네 직장인",
  promise: "5분 안에 내 입맛에 맞는 원두를 고르는 기준을 알려 드립니다.",
  delivery: "email",
  leadFields: ["이메일", "회사명"],
  outline: ["1. 산지별 맛", "2. 로스팅 정도"],
  status: "live",
  revision: 3,
  updatedAt: "2026-11-19T00:00:00Z",
  archived: false,
  strategyVersion: V2,
  stale: false,
  linkedItems: [],
  ...over,
});
const LONG = "아주긴리드마그넷제목".repeat(18);
const BASE: LeadMagnetView[] = [
  lm(1, { linkedItems: [{ id: id(301), title: "정기 배송 첫 달 할인 신청", kind: "cta", stageId: id(13) }] }),
  lm(2, { title: LONG, format: "template", stageId: id(11), stageKey: "awareness", stageLabel: "인지", audience: null, promise: null, delivery: null, leadFields: [], outline: [], status: "planned" }),
];

const STATES: Record<string, { list: LeadMagnetView[] | null; readOnly?: boolean }> = {
  기본: { list: BASE },
  "이전 전략 기준": { list: BASE.map((x) => ({ ...x, stale: true, strategyVersion: V1 })) },
  빈: { list: [] },
  "읽기 전용": { list: BASE, readOnly: true },
  오류: { list: null },
  한도: { list: Array.from({ length: 20 }, (_, i) => lm(i + 1)) },
  보관됨: { list: [...BASE, lm(3, { archived: true, title: "보관한 가이드", linkedItems: [{ id: id(302), title: "옛 전환 오퍼", kind: "cta", stageId: id(13) }] })] },
};
const render = (k: string) => {
  const s = STATES[k]!;
  return renderToString(createElement(LeadMagnetSection, { board, list: s.list, readOnly: s.readOnly ?? false, taskId: id(2) }));
};
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("리드마그넷 영역 상태(P2E-UI-01)", () => {
  it("기본: 제목·개수 2/20, 카드마다 형식·단계·상태 배지와 값, 연결 카드, 추가·고치기·보관", () => {
    const t = text(render("기본"));
    expect(t).toContain("리드마그넷 2/20개");
    expect(t).toContain("+ 리드마그넷 추가");
    expect(t).toMatch(/체크리스트 단계: 고려 배포 중/);
    expect(t).toContain("수집할 정보 이메일, 회사명 (2/10개)");
    expect(t).toContain("2/20줄 보기");
    expect(t).toContain("전환 오퍼 · 정기 배송 첫 달 할인 신청");
    expect(t).toContain("연결된 카드 없음");
    expect(t).toContain("대상 적지 않음");
    expect(t).toContain("전달 방식 선택 안 함");
    expect(t).toContain("없음 (0/20줄)");
    expect(t.match(/고치기·보관/g)).toHaveLength(2);
    expect(t).not.toContain("이전 전략 기준");
    expect(t).not.toContain("지금 승인본 기준으로 맞추기");
  });

  it("이전 전략 기준: 안내(지금 승인본 2번)와 카드마다 배지·맞추기 단추, 편집은 그대로", () => {
    const t = text(render("이전 전략 기준"));
    expect(t).toContain("이전 전략 기준: 리드마그넷 2개가 지금 승인본(2번 버전)보다 앞선 전략을 기준으로 합니다.");
    expect(t.match(/지금 승인본 기준으로 맞추기/g)!.length).toBe(3); // 안내 1 + 단추 2
    expect(t).toContain("기준 전략 1번 버전");
    expect(t.match(/고치기·보관/g)).toHaveLength(2);
  });

  it("O2: 퍼널 보드는 이전 기준이어도 리드마그넷이 지금 승인본을 가리키면 리드마그넷에는 '이전 전략 기준'이 없다(따로 표시)", () => {
    const staleBoard = { ...board, funnel: { ...(board as unknown as { funnel: object }).funnel, stale: true, strategyVersion: V1 } } as unknown as FunnelBoard;
    const html = renderToString(createElement(LeadMagnetSection, { board: staleBoard, list: BASE, readOnly: false, taskId: id(2) }));
    expect(text(html)).not.toContain("이전 전략 기준");
    expect(text(html)).toContain("기준 전략 2번 버전");
  });

  it("빈 상태: 0/20, 안내, 첫 리드마그넷 추가", () => {
    const t = text(render("빈"));
    expect(t).toContain("0/20개");
    expect(t).toContain("등록된 리드마그넷이 없습니다.");
    expect(t).toContain("+ 첫 리드마그넷 추가");
  });

  it("읽기 전용: 안내만, 추가·고치기·보관·맞추기 없음(목록은 보인다)", () => {
    const t = text(render("읽기 전용"));
    expect(t).toContain("읽기 전용이라 리드마그넷을 추가·수정·보관할 수 없습니다.");
    expect(t).toContain("원두 고르는 법 체크리스트 1");
    for (const x of ["리드마그넷 추가", "고치기·보관", "맞추기", "<form"]) expect(render("읽기 전용")).not.toContain(x);
  });

  it("오류: 알림과 다시 불러오기 링크, 개수 배지·목록·추가 없음", () => {
    const html = render("오류");
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("리드마그넷 목록을 불러오지 못했습니다.");
    expect(html).toContain(`href="/tasks/${id(2)}#lead-magnets"`);
    expect(text(html)).not.toContain("/20개");
    expect(html).not.toContain("<form");
  });

  it("한도: 20/20 이면 추가 대신 보관 안내", () => {
    const t = text(render("한도"));
    expect(t).toContain("20/20개");
    expect(t).toContain("보관하지 않은 리드마그넷이 20개라 더 추가할 수 없습니다.");
    expect(t).not.toContain("+ 리드마그넷 추가");
  });

  it("보관됨: 개수에 넣지 않고 따로 읽기 전용으로 보인다", () => {
    const html = render("보관됨");
    const t = text(html);
    expect(t).toContain("2/20개");
    expect(t).toContain("보관된 리드마그넷 1개");
    expect(t).toContain("보관한 가이드");
    expect(t.match(/고치기·보관/g)).toHaveLength(2);
  });

  it("추가 폼: 연결 단계 기본값은 고려, 형식 8·전달 방식 6(+선택 안 함)·상태 4", () => {
    const html = render("빈");
    expect(html).toMatch(new RegExp(`<option value="${id(12)}" selected="">3단계 · 고려</option>`));
    const sel = (label: string) => {
      const m = new RegExp(`<label for="([^"]+)">${label}</label>`).exec(html);
      const s = new RegExp(`<select id="${m![1]}"[^>]*>(.*?)</select>`).exec(html);
      return s![1]!.match(/<option /g)!.length;
    };
    expect(sel("형식 \\(필수\\)")).toBe(8);
    expect(sel("전달 방식")).toBe(7);
    expect(sel("진행 상태")).toBe(4);
    expect(text(html)).toContain("0/10개");
    expect(text(html)).toContain("0/20줄");
  });
});

const item = (over: Partial<FunnelItemView> = {}) =>
  ({ id: id(301), kind: "cta", title: "정기 배송 첫 달 할인 신청", revision: 4, leadMagnetId: null, ...over }) as FunnelItemView;
const card = (it: FunnelItemView, list: LeadMagnetView[] | null, readOnly = false) => renderToString(createElement(CardLeadMagnet, { item: it, leadMagnets: list, readOnly }));

describe("퍼널 카드 → 리드마그넷 연결(P2E-UI-01)", () => {
  it("연결 없음: '없음'과 연결 폼(연결 안 함 + 보관하지 않은 것만)", () => {
    const html = card(item(), STATES["보관됨"]!.list);
    expect(text(html)).toContain("연결 리드마그넷: 없음");
    expect(text(html)).toContain("리드마그넷 연결");
    expect(html.match(/<option /g)).toHaveLength(3); // 연결 안 함 + 2개(보관한 것 제외)
    expect(html).not.toContain("보관한 가이드");
  });

  it("연결됨: 제목을 보이고 지금 것이 골라져 있다", () => {
    const html = card(item({ leadMagnetId: id(101) }), BASE);
    expect(text(html)).toContain("연결 리드마그넷: 원두 고르는 법 체크리스트 1");
    expect(html).toMatch(new RegExp(`<option value="${id(101)}" selected="">`));
    expect(text(html)).toContain("리드마그넷 바꾸기·풀기");
  });

  it("보관된 것에 연결됨: '(보관됨)'과 다시 고를 수 없다는 안내", () => {
    const html = card(item({ leadMagnetId: id(103) }), STATES["보관됨"]!.list);
    expect(text(html)).toContain("보관한 가이드 (보관됨)");
    expect(text(html)).toContain("다시 고를 수 없습니다");
    expect(html).toMatch(/<option value="" selected="">연결 안 함<\/option>/);
  });

  it("리드마그넷이 없으면 영역 링크, 읽기 전용이면 폼 없음, 목록 오류면 짧은 안내", () => {
    expect(text(card(item(), []))).toContain("연결할 리드마그넷이 없습니다. 리드마그넷 영역 에서 먼저 만들어 주세요.");
    expect(card(item(), [])).toContain('href="#lead-magnets"');
    expect(card(item({ leadMagnetId: id(101) }), BASE, true)).not.toContain("<form");
    expect(text(card(item(), null))).toContain("리드마그넷 연결을 불러오지 못했습니다.");
  });
});

const kinds = (html: string) => [...html.matchAll(/<option value="(content|lead_magnet|cta)"/g)].map((m) => m[1]);
const form = (initial = EMPTY_FUNNEL_ITEM, linked = false) =>
  renderToString(createElement(FunnelItemForm, { action: async () => ({}), hidden: {}, initial, submitLabel: "카드 추가", linked }));

describe("퍼널 카드 폼의 카드 유형(AGY 결정)", () => {
  it("새 카드: '리드마그넷'을 숨기고 리드마그넷 영역 안내", () => {
    const html = form();
    expect(kinds(html)).toEqual(["content", "cta"]);
    expect(text(html)).toContain("리드마그넷은 리드마그넷 영역에서 만들고 전환(CTA) 카드로 연결하세요.");
  });

  it("원래 리드마그넷 카드: 유형을 그대로 보이고 기획 칸도 남는다", () => {
    const html = form({ ...EMPTY_FUNNEL_ITEM, kind: "lead_magnet" });
    expect(kinds(html)).toEqual(["content", "lead_magnet", "cta"]);
    expect(text(html)).toContain("리드마그넷 기획");
    expect(text(html)).not.toContain("리드마그넷 영역에서 만들고");
  });

  it("리드마그넷이 연결된 카드: '콘텐츠'를 숨기고 이유를 알린다", () => {
    const html = form({ ...EMPTY_FUNNEL_ITEM, kind: "cta" }, true);
    expect(kinds(html)).toEqual(["cta"]);
    expect(text(html)).toContain("리드마그넷이 연결된 카드는 콘텐츠로 바꿀 수 없습니다");
  });
});

// 화면 점검용 HTML(4폭·2테마 브라우저 점검은 별도 스크립트). LEAD_MAGNET_HARNESS 가 있을 때만 파일을 쓴다
it.runIf(Boolean(process.env.LEAD_MAGNET_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.LEAD_MAGNET_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
  // 카드 연결 칸(퍼널 카드 모양으로 감싼다)
  const wrap = (inner: string) => `<section class="section funnel"><ul class="cards"><li class="card"><span class="tag tag_cta">전환 오퍼</span><h4 class="cardTitle">정기 배송 첫 달 할인 신청</h4>${inner}</li></ul></section>`;
  writeFileSync(join(out, "카드-연결없음.html"), wrap(card(item(), BASE)).replace(/<details class="inlineDetails">/g, '<details class="inlineDetails" open="">'));
  writeFileSync(join(out, "카드-보관됨.html"), wrap(card(item({ leadMagnetId: id(103) }), STATES["보관됨"]!.list)).replace(/<details class="inlineDetails">/g, '<details class="inlineDetails" open="">'));
  writeFileSync(join(out, "카드-폼.html"), `<section class="section funnel">${form()}</section>`);
  // 추가 폼을 펼친 모양
  writeFileSync(join(out, "기본-폼펼침.html"), render("기본").replace(/<details class="inlineDetails lmAddBox">/, '<details class="inlineDetails lmAddBox" open="">'));
});
