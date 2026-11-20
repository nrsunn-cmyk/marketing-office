import { describe, expect, it } from "vitest";
import {
  PPT_COPY,
  PPT_DECK_LIMITS,
  PPT_TEMPLATE_KEYS,
  addSlide,
  canAddSlide,
  checkPptDeck,
  emptySlide,
  moveSlide,
  removeSlide,
  slideCountText,
  slideKey,
  toPptDeckPayload,
  toggleAsset,
  type PptSlideView,
} from "./ppt-deck-model";

const sl = (name: string, sortOrder: number, extra: Partial<PptSlideView> = {}): PptSlideView => ({ ...emptySlide(sortOrder), id: `s-${name}`, slideTitle: name, ...extra });

describe("P3-e PPT 구성 화면 모델(P3E-HANDOFF·P3-COPY-FINAL)", () => {
  it("한도·템플릿 코드는 인계표와 같다", () => {
    expect(PPT_DECK_LIMITS).toEqual({ slidesMax: 40, assetsPerSlide: 10, title: 120, slideTitle: 100, bulletPoints: 1000, speakerNotes: 1000 });
    expect(PPT_TEMPLATE_KEYS).toEqual(["royal_grid", "minimal_report", "brand_deck"]);
  });

  it("문구는 최종본 그대로(글자 수 표와 대조)", () => {
    const expected: Array<[string, number]> = [
      [PPT_COPY.heading, 15],
      [PPT_COPY.intro, 42],
      [PPT_COPY.exportNotice, 37],
      [PPT_COPY.emptyTitle, 17],
      [PPT_COPY.emptyDesc, 54],
      [PPT_COPY.create, 13],
      [PPT_COPY.slideLimitReached, 47],
      [PPT_COPY.staleBanner, 64],
      [PPT_COPY.archivedNote, 50],
      [PPT_COPY.noPermission, 21],
      [PPT_COPY.loadError, 37],
      [PPT_COPY.exportPptx, 10],
      [PPT_COPY.exportMd, 12],
    ];
    for (const [s, n] of expected) expect(Array.from(s).length, s).toBe(n);
  });

  it("슬라이드 순서·빼기·추가(40장까지, 마지막 1장은 못 뺌), 개수 표시", () => {
    const list = [sl("A", 1), sl("B", 2), sl("C", 3)];
    expect(moveSlide(list, 2, -1).map((s) => `${s.sortOrder}${s.slideTitle}`)).toEqual(["1A", "2C", "3B"]);
    expect(removeSlide(list, 0).map((s) => `${s.sortOrder}${s.slideTitle}`)).toEqual(["1B", "2C"]);
    expect(removeSlide([sl("A", 1)], 0)).toHaveLength(1);
    expect(addSlide(list).at(-1)).toMatchObject({ id: null, sortOrder: 4, slideTitle: "" });
    const forty = Array.from({ length: 40 }, (_, i) => sl(`S${i}`, i + 1));
    expect(canAddSlide(forty)).toBe(false);
    expect(addSlide(forty)).toHaveLength(40);
    expect(slideCountText(2)).toBe("슬라이드 2 / 40장");
  });

  it("자산 연결: 목록에 있는 것만", () => {
    expect(toggleAsset(["x"], "b", true, ["a", "b"])).toEqual(["b"]);
  });

  it("점검: 받침 맞춘 확정 형식(을/를·은/는 자동), 정리 뒤 셈", () => {
    expect(checkPptDeck(" 제목 ", [sl("A", 1)], [])).toEqual({});
    const issues = checkPptDeck("", [sl(" ", 1, { bulletPoints: "가".repeat(1001), speakerNotes: "a".repeat(1001), assetIds: ["zz"] })], []);
    expect(issues.title).toBe("발표 자료(PPT) 제목을 입력해 주세요.");
    expect(issues[slideKey(0, "slideTitle")]).toBe("슬라이드 제목을 입력해 주세요.");
    expect(issues[slideKey(0, "bulletPoints")]).toBe("핵심 요점은 1,000자까지 쓸 수 있습니다.");
    expect(issues[slideKey(0, "speakerNotes")]).toBe("발표자 메모는 1,000자까지 쓸 수 있습니다.");
    expect(issues[slideKey(0, "assetIds")]).toBe("목록에 없는 자산 1개가 연결되어 있습니다.");
    expect(checkPptDeck("가".repeat(121), [sl("A", 1)], []).title).toBe("발표 자료(PPT) 제목은 120자까지 쓸 수 있습니다.");
    expect(JSON.stringify(issues)).not.toMatch(/을\(를\)|은\(는\)/);
  });

  it("보낼 값: 정렬·번호 다시 매김, 값은 자르지 않음", () => {
    const p = toPptDeckPayload({ title: "t", templateKey: "brand_deck", status: "reviewed", slides: [sl("B", 2), sl("A", 1, { bulletPoints: "가".repeat(1100) })] });
    expect(p.slides.map((s) => `${s.sortOrder}${s.slideTitle}`)).toEqual(["1A", "2B"]);
    expect(p.slides[0].bulletPoints).toHaveLength(1100);
    expect(p).toMatchObject({ templateKey: "brand_deck", status: "reviewed" });
  });
});
