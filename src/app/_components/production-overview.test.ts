import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./overview-shortcuts.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
const { FollowupDueCard, PendingCountCards, ProductionEntryCard, UX_COUNT_COPY } = await import("./production-overview");

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

const P = (i: number) => `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${i}`;
const wp = (i: number, count: number, href: string) => ({ projectId: P(i), projectName: `합성 프로젝트 ${i}`, count, targetHref: href });

describe("UX G1 현황 대기 프로젝트 바로가기(AGY UX-G1-G4-OVERVIEW-HANDOFF 1절)", () => {
  const waiting = {
    qa: { projects: [wp(1, 2, `/tasks/${T}#qa-checklist`), wp(2, 1, `/projects/${P(2)}`)], totalProjectCount: 2 },
    execution: { projects: [wp(3, 4, `/projects/${P(3)}/execution#queue`), wp(4, 1, `/projects/${P(4)}/execution#queue`), wp(5, 1, `/projects/${P(5)}/execution#queue`)], totalProjectCount: 5 },
  };
  it("1건 이상이면 프로젝트 이름·건수 배지·바로가기(서버 링크 그대로, 프로젝트 이름이 든 aria-label)", () => {
    const h = renderToString(createElement(PendingCountCards, { counts: { qaPending: 3, executionPendingApproval: 6 }, waiting }));
    expect(h).toContain(`href="/tasks/${T}#qa-checklist"`);
    expect(h).toContain(`href="/projects/${P(2)}"`); // 전략 작업이 없는 프로젝트는 서버가 정한 폴백 그대로
    expect(h).toContain(`href="/projects/${P(3)}/execution#queue"`);
    expect(h).toContain('aria-label="합성 프로젝트 1 검수 열기"');
    expect(h).toContain('aria-label="합성 프로젝트 3 실행 대기열 열기"');
    expect((h.match(/>검수 열기</g) ?? []).length).toBe(2);
    expect((h.match(/>대기열 열기</g) ?? []).length).toBe(3);
    expect(text(h)).toContain("합성 프로젝트 3 4건");
    expect(h).not.toMatch(/%|<progress|\d+\s*\/\s*\d+/);
  });
  it("4개 이상이면 '외 n개 프로젝트 더 있음'과 프로젝트 목록 링크, 3개 이하면 없음", () => {
    const h = renderToString(createElement(PendingCountCards, { counts: { qaPending: 3, executionPendingApproval: 6 }, waiting }));
    expect((h.match(/외 2개 프로젝트 더 있음/g) ?? []).length).toBe(1); // 실행 카드만(5 - 3)
    expect((h.match(/href="\/projects"/g) ?? []).length).toBe(1);
  });
  it("0건이면 안내만(링크 없음), 대기 목록을 못 읽으면 건수만", () => {
    const zero = renderToString(createElement(PendingCountCards, { counts: { qaPending: 0, executionPendingApproval: 0 }, waiting: { qa: { projects: [], totalProjectCount: 0 }, execution: { projects: [], totalProjectCount: 0 } } }));
    expect((zero.match(/대기 중인 항목이 없습니다\./g) ?? []).length).toBe(2);
    expect(zero).not.toContain("<a ");
    const noList = renderToString(createElement(PendingCountCards, { counts: { qaPending: 3, executionPendingApproval: 1 }, waiting: null }));
    expect(text(noList)).toContain("P3 검수 대기 3건");
    expect(noList).not.toContain("<a ");
  });
  it("카드 안 span 순서(0 = 이름, 1 = 숫자) E2E 계약 유지", () => {
    const h = renderToString(createElement(PendingCountCards, { counts: { qaPending: 3, executionPendingApproval: 6 }, waiting }));
    const first = h.match(/<li class="tile">([\s\S]*?)<\/li>/)?.[1] ?? "";
    const spans = [...first.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(spans.slice(0, 2)).toEqual(["P3 검수 대기", "3건"]);
  });
});

describe("UX G4 현황 '후속 연락 기한 (7일 내)'(2절)", () => {
  const f = (i: number, count: number, d: string) => ({ ...wp(i, count, `/projects/${P(i)}/execution#p4b-ops`), earliestDueDate: d });
  it("총 건수·기한 지남 배지·가장 빠른 기한 MM-DD·후속 열기(#p4b-ops)", () => {
    const h = renderToString(createElement(FollowupDueCard, { summary: { totalDueWithin7Days: 5, overdueCount: 2, projects: [f(1, 3, "2026-11-20"), f(2, 2, "2026-11-27")], totalProjectCount: 2 } }));
    const t = text(h);
    expect(t).toContain("후속 연락 기한 (7일 내) 5건 기한 지남 2건");
    expect(h).toContain("pillWarning");
    expect(h).toContain(`href="/projects/${P(1)}/execution#p4b-ops"`);
    expect(h).toContain('aria-label="합성 프로젝트 1 후속 열기"'); // 보이는 글자가 이름 안에(WCAG 2.5.3)
    expect(h).toContain('<time class="due" dateTime="2026-11-20">11-20</time>');
    expect(h).toContain('aria-labelledby="followup-due"');
  });
  it("지난 건이 없으면 경고 배지 없음, 4개 이상이면 '외 n개'", () => {
    const h = renderToString(createElement(FollowupDueCard, { summary: { totalDueWithin7Days: 6, overdueCount: 0, projects: [f(1, 2, "2026-11-25"), f(2, 2, "2026-11-26"), f(3, 1, "2026-11-28")], totalProjectCount: 4 } }));
    expect(h).not.toContain("기한 지남");
    expect(text(h)).toContain("외 1개 프로젝트 더 있음");
  });
  it("0건: 안내만, 못 읽음: 카드 안 안내(role=status)", () => {
    const zero = renderToString(createElement(FollowupDueCard, { summary: { totalDueWithin7Days: 0, overdueCount: 0, projects: [], totalProjectCount: 0 } }));
    expect(text(zero)).toContain("0건");
    expect(text(zero)).toContain(UX_COUNT_COPY.followNone);
    expect(zero).not.toContain("<a ");
    const fail = renderToString(createElement(FollowupDueCard, { summary: null }));
    expect(text(fail)).toContain("정보를 불러오지 못했습니다.");
    expect(fail).toContain('role="status"');
    expect(fail).not.toContain("countBadge");
  });
});
