import { existsSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** NADAUM-PORTFOLIO-WORKS-FRONT-01: #works 사례 데이터 계약·분류 칩·카드·상세 dialog 뼈대(AGY PORTFOLIO-WORKS-SPEC-01) */
vi.mock("./nadaum.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { PortfolioWorks } = await import("./brand-works");
const { NadaumHome } = await import("./nadaum-home");
const { SERVICE_OPTIONS } = await import("./brand-copy");
const { PORTFOLIO_COPY, PORTFOLIO_ITEMS, filterItems, hasVerifiedWorks, safeLiveUrl, showFilters } = await import("./portfolio-data");
type Item = import("./portfolio-data").PortfolioItem;

/** 시험 전용 합성 사례(화면 데이터에는 넣지 않는다) */
const sample = (id: string, kind: Item["kind"], category: Item["category"]): Item => ({
  id,
  kind,
  category,
  categoryLabel: category === "website" ? "홈페이지 제작" : category === "detail" ? "상세페이지 제작" : "AI 영상·비주얼",
  title: `합성 사례 ${id}`,
  summary: `합성 요약 ${id}`,
  thumbnailSrc: `/brand/nadaum/works/${id}.webp`,
  thumbnailAlt: `합성 사례 ${id} 대표 화면`,
  deliverables: ["반응형 홈페이지"],
  challenge: "합성 과제",
  solution: "합성 해결",
  presetServices: ["홈페이지 제작"],
});
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("사례 데이터(콘셉트 시안 3건, NADAUM-PORTFOLIO-CONCEPT3-FRONT-01)", () => {
  it("자체 콘셉트 시안 3건만 공개: 모두 concept·링크 없음, 실제 사례 0건이라 검색 노출 안전장치 유지", () => {
    expect(PORTFOLIO_ITEMS.map((w) => w.id)).toEqual(["website-brand-concept", "detail-commerce-concept", "ai-visual-motion-concept"]);
    expect(PORTFOLIO_ITEMS.map((w) => w.category)).toEqual(["website", "detail", "ai-visual"]);
    for (const w of PORTFOLIO_ITEMS) {
      expect(w.kind).toBe("concept");
      expect(w.liveUrl).toBeUndefined();
      expect(w.industry?.startsWith("자체 제작 쇼케이스")).toBe(true);
    }
    expect(hasVerifiedWorks(PORTFOLIO_ITEMS)).toBe(false);
  });

  it("첫 화면: 준비 중 세 칸 대신 카드 3장(칩 없음·닫힌 dialog), 배지는 모두 '콘셉트 시안'", () => {
    const html = renderToString(createElement(NadaumHome));
    expect(html).not.toContain("프로젝트 준비 중");
    expect((html.match(/<button type="button" class="workCard" aria-haspopup="dialog"/g) ?? []).length).toBe(3);
    expect(html).not.toContain("aria-pressed"); // 3건이라 분류 칩 없음
    expect(html).toMatch(/<dialog class="workDialog"(?![^>]*\sopen)[^>]*>/);
    expect((html.match(new RegExp(`>${PORTFOLIO_COPY.kind.concept}</span>`, "g")) ?? []).length).toBe(3); // 배지만(사진 대체 글자 제외)
    expect(html).not.toContain(PORTFOLIO_COPY.kind.verified);
    expect(html).not.toContain(PORTFOLIO_COPY.live);
  });

  it("넣는 사례는 계약을 지킨다(공개 허락 사례·콘셉트 시안만, 실제 있는 사진·https 링크·폼 서비스 이름, id 중복 없음)", () => {
    const ids = new Set<string>();
    for (const w of PORTFOLIO_ITEMS) {
      expect(["verified", "concept"]).toContain(w.kind);
      expect(w.thumbnailSrc.startsWith("/brand/nadaum/")).toBe(true);
      expect(existsSync(join(process.cwd(), "public", w.thumbnailSrc))).toBe(true);
      expect(w.thumbnailAlt.trim()).not.toBe("");
      if (w.liveUrl) expect(safeLiveUrl(w.liveUrl)).toBe(w.liveUrl);
      expect(w.presetServices.length).toBeGreaterThan(0);
      for (const p of w.presetServices) expect(SERVICE_OPTIONS).toContain(p);
      expect(ids.has(w.id)).toBe(false);
      ids.add(w.id);
    }
  });
});

describe("규칙", () => {
  it("분류 칩은 4건 이상일 때만", () => {
    const three = ["a", "b", "c"].map((id) => sample(id, "verified", "website"));
    expect(showFilters(three)).toBe(false);
    expect(showFilters([...three, sample("d", "concept", "detail")])).toBe(true);
  });

  it("분류로 거른다(전체는 그대로)", () => {
    const items = [sample("a", "verified", "website"), sample("b", "concept", "detail"), sample("c", "verified", "ai-visual")];
    expect(filterItems(items, "all").map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(filterItems(items, "detail").map((i) => i.id)).toEqual(["b"]);
  });

  it("외부 링크는 https 만", () => {
    expect(safeLiveUrl("https://example.com/")).toBe("https://example.com/");
    expect(safeLiveUrl("http://example.com/")).toBeNull();
    expect(safeLiveUrl("javascript:alert(1)")).toBeNull();
    expect(safeLiveUrl("/상대경로")).toBeNull();
    expect(safeLiveUrl(undefined)).toBeNull();
  });

  it("검색 노출 조건은 실제 사례 1건 이상(콘셉트 시안만으로는 부족)", () => {
    expect(hasVerifiedWorks([sample("a", "concept", "website")])).toBe(false);
    expect(hasVerifiedWorks([sample("a", "concept", "website"), sample("b", "verified", "detail")])).toBe(true);
  });
});

describe("카드·dialog 뼈대(합성 사례로 그려 봄)", () => {
  it("1~3건: 칩 없음, 카드는 button, 구분 배지·분류·제목·요약·'사례 보기 →', 닫힌 dialog", () => {
    const html = renderToString(createElement(PortfolioWorks, { items: [sample("a", "verified", "website"), sample("b", "concept", "detail")] }));
    const t = text(html);
    expect(html).not.toContain("aria-pressed");
    expect((html.match(/<button type="button" class="workCard" aria-haspopup="dialog"/g) ?? []).length).toBe(2);
    for (const s of ["실제 사례", "콘셉트 시안", "홈페이지 제작", "합성 사례 a", "합성 요약 b", PORTFOLIO_COPY.viewHint]) expect(t).toContain(s);
    expect(html).toContain('alt="합성 사례 a 대표 화면"');
    expect(html).toMatch(/<dialog class="workDialog"(?![^>]*\sopen)[^>]*>/); // 처음엔 닫힘
  });

  it("4건 이상: '전체·홈페이지·상세페이지·AI 영상·비주얼' 칩, 처음엔 '전체'만 눌림", () => {
    const items = ["a", "b", "c", "d"].map((id, i) => sample(id, "verified", (["website", "detail", "ai-visual", "website"] as const)[i]));
    const html = renderToString(createElement(PortfolioWorks, { items }));
    expect(html).toContain('role="group" aria-label="작업물 분류"');
    const chips = [...html.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((m) => [m[2], m[1]]);
    expect(chips).toEqual([
      ["전체", "true"],
      ["홈페이지", "false"],
      ["상세페이지", "false"],
      ["AI 영상·비주얼", "false"],
    ]);
  });

  it("문구는 AGY 명세 그대로", () => {
    expect(PORTFOLIO_COPY).toMatchObject({
      kind: { verified: "실제 사례", concept: "콘셉트 시안" },
      viewHint: "사례 보기 →",
      close: "사례 상세 닫기",
      live: "새 창으로 사이트 보기 ↗",
      cta: "비슷한 프로젝트 상담하기",
      challenge: "과제",
      solution: "해결 방향",
      output: "산출물",
    });
  });
});
