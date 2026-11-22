import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
const { PendingCountCards, ProductionEntryCard, UX_COUNT_COPY } = await import("./production-overview");

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const T = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const base = { briefsReady: 1, outputs: { drafting: 2, reviewed: 3 }, byKind: { web_copy: { drafting: 1, reviewed: 1 }, design_asset: { drafting: 1, reviewed: 0 }, video_plan: { drafting: 0, reviewed: 1 }, ppt_deck: { drafting: 0, reviewed: 1 } }, qaApproved: 2, deliveryBundles: 1, strategyTaskId: T };

describe("UX F4 현황 대기 카드(AGY DESIGN-UX-F245-01 2절)", () => {
  it("건수 2칸·보조 설명, 분수·% 없음, 목적지 없는 링크 단추는 두지 않음", () => {
    const h = renderToString(createElement(PendingCountCards, { counts: { qaPending: 3, executionPendingApproval: 0 } }));
    const t = text(h);
    expect(t).toContain("P3 검수 대기 3건");
    expect(t).toContain("P4 실행 승인 대기 0건"); // 0 도 그대로
    expect(t).toContain("승인·보완이 필요한 결과물");
    expect(h).not.toMatch(/<a |%|\d+\s*\/\s*\d+/);
  });
  it("못 읽으면 숫자 대신 안내(role=status)", () => {
    const h = renderToString(createElement(PendingCountCards, { counts: null }));
    expect((h.match(new RegExp(UX_COUNT_COPY.loadFail, "g")) ?? []).length).toBe(2);
    expect(h).toContain('role="status"');
  });
});

describe("UX F5 프로젝트 'P3 제작 · 납품' 카드(3절)", () => {
  it("4칸 건수(산출물 = 작성 중 + 검토 완료), 전략 작업의 기존 앵커 두 곳으로 링크", () => {
    const h = renderToString(createElement(ProductionEntryCard, { counts: base }));
    const t = text(h);
    for (const s of ["브리프 확정 1건", "산출물 작성·검토 5건", "검수 승인 2건", "납품 묶음 1건"]) expect(t).toContain(s);
    expect(h).toContain(`href="/tasks/${T}#production-brief"`);
    expect(h).toContain(`href="/tasks/${T}#delivery-bundle"`);
    expect(h).toContain('id="p3-production"');
    expect(h).not.toMatch(/%|<progress/);
  });
  it("전략 작업 없음: 링크 없이 안내 / 모두 0 도 0건 / 못 읽음: 안내만", () => {
    const none = renderToString(createElement(ProductionEntryCard, { counts: { ...base, strategyTaskId: null, briefsReady: 0, outputs: { drafting: 0, reviewed: 0 }, qaApproved: 0, deliveryBundles: 0 } }));
    expect(text(none)).toContain("전략 작업을 열면 제작·납품 단계를 시작할 수 있습니다.");
    expect(none).not.toContain("/tasks/");
    expect(text(none)).toContain("브리프 확정 0건");
    const fail = renderToString(createElement(ProductionEntryCard, { counts: null }));
    expect(text(fail)).toContain(UX_COUNT_COPY.loadFail);
    expect(fail).not.toContain("<dl");
  });
});

// 화면 점검용 HTML(4폭·테마는 별도 스크립트). UX_HARNESS 가 있을 때만
it.runIf(Boolean(process.env.UX_HARNESS))("화면 점검용 HTML 쓰기", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const out = process.env.UX_HARNESS!;
  mkdirSync(out, { recursive: true });
  const page = (h: string) => `<main class="page wide touchPage">${h}</main>`;
  writeFileSync(join(out, "대기카드.html"), page(renderToString(createElement(PendingCountCards, { counts: { qaPending: 3, executionPendingApproval: 12 } }))));
  writeFileSync(join(out, "대기카드실패.html"), page(renderToString(createElement(PendingCountCards, { counts: null }))));
  writeFileSync(join(out, "제작카드.html"), page(renderToString(createElement(ProductionEntryCard, { counts: base }))));
  writeFileSync(join(out, "제작카드전략없음.html"), page(renderToString(createElement(ProductionEntryCard, { counts: { ...base, strategyTaskId: null } }))));
});
