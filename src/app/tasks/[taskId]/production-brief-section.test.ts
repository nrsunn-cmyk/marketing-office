import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProductionBriefBoard, ProductionBriefView } from "@/features/production-brief/server";

/**
 * P3A-UI-CONNECT-01 공통 제작 브리프 영역(가짜 보드, 서버·동작은 가짜).
 * AGY task-detail-entry.html 상태: 진행 중(목록) · 빈 상태 · P2 미승인 · 10개 한도 · 읽기 전용 + 보관 접기 + 불러오기 실패.
 */
vi.mock("@/features/production-brief/actions", () => {
  const noop = async () => ({});
  return { createProductionBriefAction: noop, updateProductionBriefAction: noop, rebaseProductionBriefAction: noop, archiveProductionBriefAction: noop };
});
vi.mock("@/features/production-brief/server", () => ({ getProductionBriefsFor: vi.fn() }));
vi.mock("@/features/projects/server", () => ({ getProject: vi.fn() }));
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./production-brief.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { ProductionBriefSection } = await import("./production-brief-section");

const id = (n: number) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`;
const PROJECT = id(900);
const STRAT = id(800);
const OTHER = id(801);
const brief = (n: number, extra: Partial<ProductionBriefView> = {}): ProductionBriefView => ({
  id: id(n),
  title: `제작 브리프 ${n}`,
  targetAudience: "외부 대행사 없이 직접 브랜드와 견적 기준을 정리하려는 1인·소규모 서비스 대표",
  coreMessage: "승인된 버전 기준으로 한 번에 정리해 납품까지 이어집니다.",
  deliverableTypes: ["web_copy", "design_assets"],
  scopeSummary: "포함: 홈페이지 5개 섹션 구조 및 최종 문구\n제외: 외부 광고 집행",
  brandToneConstraints: "쉬운 한국어, 과장 금지",
  referenceNotes: null,
  status: "drafting",
  displayStatus: "drafting",
  displayLabel: "작성 중",
  archived: false,
  archivedAt: null,
  revision: 2,
  strategyArtifactId: STRAT,
  strategyVersion: { id: id(703), version: 3 },
  stale: false,
  staleLabel: null,
  canRebase: false,
  readOnlyReason: null,
  createdAt: "2026-11-20T00:00:00Z",
  updatedAt: "2026-11-20T00:00:00Z",
  ...extra,
});
const READY = brief(1, { title: "나다음 브랜드 리뉴얼 · 홈페이지 및 디자인 제작 기준", status: "ready", displayStatus: "ready", displayLabel: "확정" });
const STALE = brief(2, {
  title: "하반기 신규 서비스 소개 영상·PPT 브리프",
  deliverableTypes: ["video_plan", "ppt_deck"],
  strategyVersion: { id: id(702), version: 2 },
  stale: true,
  staleLabel: "이전 전략 기준",
  canRebase: true,
});
const ARCH = brief(3, { title: "1차 파일럿 홍보 영상 브리프", status: "ready", displayStatus: "archived", displayLabel: "보관", archived: true, archivedAt: "2026-11-19T00:00:00Z", readOnlyReason: "보관한 제작 브리프입니다. 읽기만 할 수 있습니다." });
const strategies = (selectable = true, other = true) => [
  { artifactId: STRAT, approvedVersion: selectable ? 3 : null, approvedVersionId: selectable ? id(703) : null, cancelled: false, selectable },
  ...(other ? [{ artifactId: OTHER, approvedVersion: 1, approvedVersionId: id(701), cancelled: false, selectable: selectable }] : []),
];
const board = (briefs: ProductionBriefView[], extra: Partial<ProductionBriefBoard> = {}): ProductionBriefBoard => {
  const activeCount = briefs.filter((b) => !b.archived).length;
  return { projectId: PROJECT, briefs, strategies: strategies(), canCreate: activeCount < 10, createBlockedReason: activeCount >= 10 ? "한 프로젝트에는 제작 브리프를 10개까지 둘 수 있습니다. 쓰지 않는 것을 보관해 주세요." : null, activeCount, limit: 10, ...extra };
};

const STATES: Record<string, { board: ProductionBriefBoard | null; readOnly?: boolean }> = {
  진행중: { board: board([READY, STALE, ARCH]) },
  빈상태: { board: board([]) },
  P2미승인: { board: board([], { strategies: strategies(false), canCreate: false, createBlockedReason: "승인된 전략이 있어야 제작 브리프를 만들 수 있습니다. 전략을 먼저 승인해 주세요." }) },
  한도: { board: board(Array.from({ length: 10 }, (_, i) => brief(10 + i))) },
  읽기전용: { board: board([READY, STALE, ARCH], { canCreate: false, createBlockedReason: "보관한 프로젝트입니다." }), readOnly: true },
  불러오기실패: { board: null },
};
const render = (k: string) => renderToString(createElement(ProductionBriefSection, { board: STATES[k].board, readOnly: Boolean(STATES[k].readOnly), taskId: "t-1", strategyArtifactId: STRAT }));
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("공통 제작 브리프 영역(작업 상세)", () => {
  it("모든 상태: 제목·소개·영역 이름", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      expect(h, k).toContain('aria-labelledby="production-brief"');
      expect(text(h), k).toContain("승인된 전략을 바탕으로 홈페이지·디자인 자산·영상·PPT 제작 기준을 관리합니다.");
    }
  });

  it("진행 중: n / 10개, 1단계 요약, 만들기 접기, 카드 2개(확정·작성 중+이전 전략), 보관 접기 1개", () => {
    const h = render("진행중");
    expect(text(h)).toContain("2 / 10개");
    expect(text(h)).toContain("P3 1단계(공통 제작 브리프): 작성 중 1개 · 확정 1개.");
    expect(text(h)).toContain("+ 새 제작 브리프 만들기");
    expect(h).toContain(`name="projectId" value="${PROJECT}"`);
    // 승인 전략이 둘이라 고르는 칸, 이 작업의 전략이 기본(Tester I2)
    expect(h).toMatch(/<select[^>]*name="strategyArtifactId"/);
    expect(h).toMatch(new RegExp(`<option value="${STRAT}" selected="">이 작업의 전략 · 승인본 3번 버전</option>`));
    expect(text(h)).toContain("다른 전략 작업 · 승인본 1번 버전");
    expect(count(h, /<li class="pbCard/g)).toBe(3);
    expect(text(h)).toContain("산출물: 홈페이지 구조·문구, 디자인 자산 · 전략 3번 버전 기준");
    expect(text(h)).toContain("산출물: 영상 구성, PPT · 전략 2번 버전 기준");
    expect(h).toContain('class="pbStatus pbStatus_ready">확정</span>');
    expect(text(h)).toContain("보관한 제작 브리프 1개");
    // 만들기 폼에는 진행 상태가 없다(서버가 작성 중으로 만든다 — 고르는 칸은 바탕 전략 1개), 고치기 폼 2개에는 있다
    expect(count(h, /<select/g)).toBe(3);
    // 이전 전략: 안내 + 맞추기(고칠 수 있으니 끝 문장 있음)
    expect(text(h)).toContain("이전 전략 기준: 지금 승인본(3번 버전)보다 앞선 전략(2번 버전)으로 만든 제작 브리프입니다. 대상과 메시지가 지금 전략과 맞는지 확인해 주세요. 맞추지 않아도 고칠 수 있습니다.");
    expect(count(h, />지금 승인본 기준으로 맞추기</g)).toBe(1);
    // 확정 안내(AGY 확정 문구)
    expect(text(h)).toContain("확정한 제작 브리프는 이후 홈페이지·디자인 자산 단계의 기준본으로 씁니다.");
    // U3 보관은 한 번 더 확인: 접은 안에 '보관 확인' 단추 + 안내
    expect(count(h, /<summary>이 제작 브리프 보관<\/summary>/g)).toBe(2);
    expect(count(h, />보관 확인</g)).toBe(2);
    expect(text(h)).toContain("보관하면 내용만 볼 수 있고 고칠 수 없습니다. 보관은 되돌릴 수 없습니다.");
    // 보관한 카드: 폼 없음, 사유, 열어 보기
    expect(text(h)).toContain("보관한 제작 브리프입니다. 읽기만 할 수 있습니다.");
    expect(text(h)).toContain("열어 보기");
    expect(h).toContain('class="pbStatus pbStatus_archived">보관</span>');
  });

  it("글자 수 표시는 aria-live 가 아니고, 한도 근처일 때만 읽히는 숨은 글이 있다(R2)", () => {
    const h = render("진행중");
    expect(h).not.toMatch(/class="pbCount[^"]*" aria-live/);
    expect(count(h, /class="pbSrOnly" aria-live="polite"/g)).toBe(18); // 만들기 6 + 고치기 2×6
  });

  it("빈 상태: 만들기 접기와 안내(사실과 다른 '입력값을 채워 둡니다'는 없음)", () => {
    const h = render("빈상태");
    expect(text(h)).toContain("0 / 10개");
    expect(text(h)).toContain("아직 공통 제작 브리프가 없습니다.");
    expect(text(h)).toContain("승인된 전략이 있으면 바로 제작 브리프를 만들 수 있습니다.");
    expect(text(h)).not.toContain("채워 둡니다");
    expect(text(h)).toContain("+ 공통 제작 브리프 만들기");
    expect(count(h, /<form/g)).toBe(1);
  });

  it("승인 전략이 하나면 고르는 칸 없이 숨은 칸으로 자동 선택", () => {
    const h = renderToString(createElement(ProductionBriefSection, { board: board([], { strategies: strategies(true, false) }), readOnly: false, taskId: "t", strategyArtifactId: STRAT }));
    expect(h).toContain(`<input type="hidden" name="strategyArtifactId" value="${STRAT}"/>`);
    expect(h).not.toMatch(/<select/);
    // 이 작업의 전략이 승인 전이고 다른 전략만 승인됐으면 그 전략으로
    const other = renderToString(
      createElement(ProductionBriefSection, {
        board: board([], { strategies: [{ ...strategies(false, false)[0] }, { artifactId: OTHER, approvedVersion: 1, approvedVersionId: id(701), cancelled: false, selectable: true }] }),
        readOnly: false,
        taskId: "t",
        strategyArtifactId: STRAT,
      }),
    );
    expect(other).toContain(`<input type="hidden" name="strategyArtifactId" value="${OTHER}"/>`);
  });

  it("P2 미승인: 고를 승인 전략이 없으면 차단 안내, 만들기 없음", () => {
    const h = render("P2미승인");
    expect(text(h)).toContain("새 제작 브리프를 만들 수 없습니다: P2에서 승인된 전략이 아직 없습니다. 먼저 위 전략 구역에서 승인본을 확정해 주세요.");
    expect(count(h, /<form/g)).toBe(0);
    expect(text(h)).not.toContain("바로 제작 브리프를 만들 수 있습니다");
  });

  it("10개 한도: 서버 사유를 그대로, 만들기 없음", () => {
    const h = render("한도");
    expect(text(h)).toContain("10 / 10개");
    expect(text(h)).toContain("새 제작 브리프를 만들 수 없습니다: 한 프로젝트에는 제작 브리프를 10개까지 둘 수 있습니다.");
    expect(text(h)).not.toContain("+ 새 제작 브리프 만들기");
    expect(count(h, /<li class="pbCard/g)).toBe(10);
  });

  it("읽기 전용: 안내, 폼·맞추기 0개, 이전 전략 안내 끝 문장 없음(U2)", () => {
    const h = render("읽기전용");
    expect(text(h)).toContain("보관한 프로젝트이거나 취소한 작업이라 제작 브리프를 만들거나 고칠 수 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(count(h, /<(input|textarea|select)/g)).toBe(0);
    expect(text(h)).toContain("이전 전략 기준:");
    expect(text(h)).not.toContain("맞추지 않아도 고칠 수 있습니다");
    expect(text(h)).not.toContain("새 제작 브리프를 만들 수 없습니다"); // 읽기 전용 안내 하나로
    expect(count(h, /<summary>열어 보기<\/summary>/g)).toBe(3);
  });

  it("불러오기 실패: 알림과 다시 불러오기 링크", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("공통 제작 브리프를 불러오지 못했습니다.");
    expect(h).toContain('href="/tasks/t-1#production-brief"');
  });

  it("글은 이스케이프되어 HTML 로 들어가지 않는다", () => {
    const evil = '"><script>alert(1)</script>';
    const b = board([brief(1, { title: evil, scopeSummary: evil }), brief(2, { title: evil, archived: true, readOnlyReason: "보관" })]);
    const h = renderToString(createElement(ProductionBriefSection, { board: b, readOnly: false, taskId: "t", strategyArtifactId: STRAT }));
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  });
});

// 화면 점검용 HTML(4폭·2테마 점검은 별도 스크립트). PRODUCTION_BRIEF_HARNESS 가 있을 때만 쓴다. -펼침은 접은 내용을 연 상태
it.runIf(Boolean(process.env.PRODUCTION_BRIEF_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.PRODUCTION_BRIEF_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
  for (const k of ["진행중", "읽기전용"]) writeFileSync(join(out, `${k}-펼침.html`), render(k).replace(/<details class="([^"]*)">/g, '<details class="$1" open="">'));
});
