import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryBundleEntry, ResultEntry } from "./result-entry";

/** UX-F1-RESULTS-FRONT-01 결과물 목록: Backend 계약(listResultEntries) 모양의 합성 데이터로 그린다(DB·외부 API 없음) */
vi.mock("../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../_components/pager.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
// 서버 전용 모듈은 시험에서 가짜로(타입은 진짜 계약 35b8576, 값 검사만 같은 규칙)
vi.mock("@/features/library/server", () => ({
  isResultEntryType: (v: unknown) => typeof v === "string" && ["logo_brief", "quote", "strategy", "delivery_bundle"].includes(v),
}));

const { ResultsView } = await import("./results-view");
const { parseResultType, safeBundleHref } = await import("./result-entry");
const { RESULTS_COPY: C, bundleTitle } = await import("./results-copy");

const P = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const T = "cccccccc-cccc-4ccc-8ccc-000000000001";
const artifact = (x: Partial<Extract<ResultEntry, { kind: "artifact" }>> = {}): ResultEntry => ({
  kind: "artifact",
  id: "a1",
  type: "quote",
  task_id: "t-quote",
  task_status: "completed",
  project_id: P,
  project_title: "봄 캠페인",
  client_name: "가나 상사",
  current_version: 2,
  approved_version: 2,
  updated_at: "2026-11-23T01:00:00Z",
  ...x,
});
const bundle = (x: Partial<DeliveryBundleEntry> = {}): DeliveryBundleEntry => ({
  kind: "delivery_bundle",
  id: "b1",
  type: "delivery_bundle",
  project_id: P,
  project_title: "봄 캠페인",
  client_name: "가나 상사",
  bundle_no: 1,
  status: "reviewed",
  item_count: 3,
  restored_from_bundle_no: null,
  created_at: "2026-11-23T02:00:00Z",
  updated_at: "2026-11-23T02:00:00Z",
  task_id: T,
  href: `/tasks/${T}#delivery-bundle`,
  ...x,
});
type Props = Parameters<typeof ResultsView>[0];
const render = (p: Partial<Props> = {}) =>
  renderToString(
    createElement(ResultsView, { items: [], total: 0, nextCursor: null, type: null, approvedOnly: false, page: 1, timeZone: "Asia/Seoul", ...p }),
  ).replaceAll("<!-- -->", "");

describe("결과물 목록 — 납품 묶음(F1)", () => {
  it("종류 필터에 '납품 묶음'이 있고, 고른 값이 유지된다", () => {
    const h = render({ type: "delivery_bundle" });
    expect(h).toContain('<option value="delivery_bundle" selected="">납품 묶음</option>');
    for (const v of ["", "logo_brief", "quote", "strategy"]) expect(h).toContain(`<option value="${v}"`);
    expect(h).not.toContain("스냅샷");
  });

  it("납품 묶음 줄: 판 이름·포함 건수·상태·복구 표시, 유효한 링크만 작업 상세 납품 묶음으로", () => {
    const h = render({
      items: [bundle(), bundle({ id: "b3", bundle_no: 3, status: "drafting", item_count: 1, restored_from_bundle_no: 1 })],
      total: 2,
    });
    expect(h).toContain(`<a class="rowLink" title="납품 묶음 v1.0" href="/tasks/${T}#delivery-bundle">납품 묶음 v1.0</a>`);
    expect(h).toContain("납품 묶음 v1.2");
    expect(h).toContain("포함 3건");
    expect(h).toContain(">검토 완료<");
    expect(h).toContain(">작성 중<");
    expect(h).toContain(">v1.0에서 복구<");
    expect(h).toContain(`href="/projects/${P}"`);
    expect(h).not.toMatch(/%|<progress|\d+\/\d+건/);
  });

  it("전략 작업이 없거나(href null) 계약과 다른 주소면 링크 없이 제목만", () => {
    const none = render({ items: [bundle({ task_id: null, href: null })], total: 1 });
    expect(none).toContain('<strong class="rowLink" title="납품 묶음 v1.0">납품 묶음 v1.0</strong>');
    expect(none).not.toContain("#delivery-bundle");
    expect(safeBundleHref({ task_id: T, href: "https://evil.example/x" })).toBeNull();
    expect(safeBundleHref({ task_id: T, href: `/tasks/other#delivery-bundle` })).toBeNull();
    expect(safeBundleHref({ task_id: T, href: `/tasks/${T}#delivery-bundle` })).toBe(`/tasks/${T}#delivery-bundle`);
  });

  it("결과물 줄은 그대로(작업 링크·초안·승인본·상태), 계약 순서대로 섞어 그린다", () => {
    const h = render({ items: [bundle(), artifact(), artifact({ id: "a2", type: "logo_brief", approved_version: null, current_version: 1, task_status: "review" })], total: 3 });
    expect(h).toContain('<a class="rowLink" title="견적" href="/tasks/t-quote">견적</a>');
    expect(h).toContain("현재 초안 2번");
    expect(h).toContain(">승인본 2번<");
    expect(h).toContain(">완료(승인)<");
    expect(h).toContain(">승인 전<");
    const list = h.slice(h.indexOf('aria-label="결과물 목록"'));
    expect(list.indexOf("납품 묶음 v1.0")).toBeLessThan(list.indexOf(">견적<"));
    expect(list.indexOf(">견적<")).toBeLessThan(list.indexOf(">로고 브리프·프롬프트<"));
  });

  it("빈 상태 3가지: 전체(AGY 새 문구)·납품 묶음 필터·그 밖 필터(기존 문구)", () => {
    const all = render();
    expect(all).toContain(C.emptyTitle);
    expect(all).toContain(C.emptyDesc);
    expect(all).toContain('href="/projects"');
    const b = render({ type: "delivery_bundle" });
    expect(b).toContain(C.bundleFilterEmptyTitle);
    expect(b).toContain(C.bundleFilterEmptyDesc);
    expect(b).toContain('href="/results"');
    const a = render({ approvedOnly: true });
    expect(a).toContain(C.filterEmptyTitle);
    expect(a).toContain(C.filterEmptyDesc);
    expect(a).not.toContain(C.bundleFilterEmptyTitle);
  });

  it("P4-UX-POLISH A7: 승인본 체크 이름에 납품 묶음 기준, 승인본만 보기로 비었으면 끄는 안내", () => {
    expect(render()).toContain(`/> ${C.approvedOnlyLabel}</label>`);
    expect(render()).not.toContain(C.approvedOnlyEmptyHint);
    expect(render({ approvedOnly: true })).toContain(C.approvedOnlyEmptyHint);
    expect(render({ type: "delivery_bundle", approvedOnly: true })).toContain(C.approvedOnlyEmptyHint);
    expect(render({ type: "delivery_bundle" })).not.toContain(C.approvedOnlyEmptyHint);
  });

  it("쪽 넘김은 종류·승인 조건과 커서를 그대로 이어 간다", () => {
    const h = render({ items: [bundle()], total: 120, nextCursor: "CUR", type: "delivery_bundle", approvedOnly: true });
    expect(h).toContain('href="/results?type=delivery_bundle&amp;approved=1&amp;cursor=CUR&amp;page=2"');
  });

  it("주소의 type 은 허용 값만(그 밖은 전체), 판 이름은 v1.{n-1}", () => {
    expect(parseResultType("delivery_bundle")).toBe("delivery_bundle");
    expect(parseResultType("quote")).toBe("quote");
    expect(parseResultType("x")).toBeNull();
    expect(parseResultType(["quote"])).toBeNull();
    expect(bundleTitle(1)).toBe("납품 묶음 v1.0");
    expect(bundleTitle(11)).toBe("납품 묶음 v1.10");
  });
});

// 화면 점검용 HTML(4폭·테마 점검은 별도 스크립트). F1_HARNESS 가 있을 때만
it.runIf(Boolean(process.env.F1_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.F1_HARNESS!;
  mkdirSync(out, { recursive: true });
  const long = bundle({ id: "b9", bundle_no: 12, project_title: "아주 긴 프로젝트 이름이 들어가서 한 줄을 넘는 경우를 확인합니다 2026 봄 시즌", client_name: "긴 고객 이름 주식회사", restored_from_bundle_no: 4, status: "drafting", task_id: null, href: null });
  const states: Record<string, string> = {
    섞인목록: render({ items: [bundle(), artifact(), long, artifact({ id: "a2", type: "strategy", approved_version: null })], total: 120, nextCursor: "CUR" }),
    빈전체: render(),
    빈납품묶음: render({ type: "delivery_bundle" }),
  };
  for (const [k, v] of Object.entries(states)) writeFileSync(join(out, `${k}.html`), `<main class="page wide touchPage"><h1 class="title">결과물</h1>${v}</main>`);
});
