import { describe, expect, it } from "vitest";
import { PPT_DECK_LIMITS as SERVER_LIMITS, PPT_TEMPLATE_KEYS as SERVER_TEMPLATE_KEYS } from "@/domain/ppt-decks";
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
  pptCreateBlockedText,
  pptExportHref,
  pptRebaseBlockedText,
  pptStaleNotices,
  PPT_LABELS,
  toggleAsset,
  type PptSlideView,
} from "./ppt-deck-model";

const sl = (name: string, sortOrder: number, extra: Partial<PptSlideView> = {}): PptSlideView => ({ ...emptySlide(sortOrder), id: `s-${name}`, slideTitle: name, ...extra });

describe("P3-e PPT 구성 화면 모델(P3E-HANDOFF·P3-COPY-FINAL)", () => {
  it("한도·템플릿 코드는 인계표와 같다", () => {
    expect(PPT_DECK_LIMITS).toEqual({ slidesMax: 40, versionsMax: 20, assetsPerSlide: 10, activeDecksPerBrief: 5, decksPerBrief: 10, title: 120, slideTitle: 100, bulletPoints: 1000, speakerNotes: 1000 });
    expect(PPT_TEMPLATE_KEYS).toEqual(["royal_grid", "minimal_report", "brand_deck"]);
    // 화면은 zod 를 피하려고 값을 따로 둔다 — 서버 도메인 값과 똑같아야 한다
    expect(PPT_DECK_LIMITS).toEqual(SERVER_LIMITS);
    expect(PPT_TEMPLATE_KEYS).toEqual([...SERVER_TEMPLATE_KEYS]);
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
      [PPT_COPY.staleBanner, 63],
      [PPT_COPY.archivedNote, 50],
      [PPT_COPY.noPermission, 21],
      [PPT_COPY.loadError, 37],
      [PPT_COPY.exportPptx, 10],
      [PPT_COPY.exportMd, 12],
      [PPT_COPY.restore, 10],
      [PPT_COPY.restoredOk, 29],
      [PPT_COPY.staleReasonBrief, 46],
      [PPT_COPY.staleReasonAsset(3), 44], // 표의 {n} 세 글자 → 숫자 한 글자
      [PPT_COPY.archivedAssetsWarn(3), 44],
      [PPT_COPY.rebaseBlockedBriefArchived, 34],
      [PPT_COPY.rebaseBlockedBriefDraft, 39],
      [PPT_COPY.rebaseBlockedVersionLimit, 41],
      [PPT_COPY.versionLimitReached, 65],
      [PPT_COPY.planLimitReached, 39],
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

  it("보낼 값(Backend 5절): 배열 순서, 슬라이드 id 그대로·새 장 null, sortOrder 없음(strict), 값은 자르지 않음", () => {
    const p = toPptDeckPayload({ title: "t", templateKey: "brand_deck", status: "reviewed", slides: [sl("B", 2), sl("A", 1, { bulletPoints: "가".repeat(1100) }), { ...emptySlide(3), slideTitle: "새" }] });
    expect(p.slides.map((s) => s.slideTitle)).toEqual(["A", "B", "새"]);
    expect(p.slides.map((s) => s.id)).toEqual(["s-A", "s-B", null]);
    for (const s of p.slides) expect(Object.keys(s).sort()).toEqual(["assetIds", "bulletPoints", "id", "slideTitle", "speakerNotes"]);
    expect(p.slides[0].bulletPoints).toHaveLength(1100);
    expect(p).toMatchObject({ templateKey: "brand_deck", status: "reviewed" });
  });

  it("이전 기준 원인별: 브리프·자산 {n}, 보관·stale 아님이면 없음", () => {
    const base = { stale: true, archivedAt: null, staleReasons: ["brief"] as ("brief" | "asset")[], staleAssetCount: 0 };
    expect(pptStaleNotices(base)).toEqual([PPT_COPY.staleReasonBrief]);
    expect(pptStaleNotices({ ...base, staleReasons: ["brief", "asset"], staleAssetCount: 2 })).toEqual([
      PPT_COPY.staleReasonBrief,
      "연결된 디자인 자산 2개가 새 판으로 바뀌었습니다. 사용 자산을 확인해 주세요.",
    ]);
    expect(pptStaleNotices({ ...base, staleReasons: ["asset"] })).toEqual([PPT_COPY.staleBanner]);
    expect(pptStaleNotices({ ...base, archivedAt: "x" })).toEqual([]);
    expect(pptStaleNotices({ ...base, stale: false })).toEqual([]);
  });

  it("맞추기 막힘은 서버 문구 키 그대로, 만들기 막힘은 deck_limit 만 planLimitReached", () => {
    expect(pptRebaseBlockedText("rebaseBlockedBriefDraft")).toBe(PPT_COPY.rebaseBlockedBriefDraft);
    expect(pptRebaseBlockedText("rebaseBlockedVersionLimit")).toBe(PPT_COPY.rebaseBlockedVersionLimit);
    expect(pptRebaseBlockedText("archivedNote")).toBe(PPT_COPY.archivedNote);
    expect(pptRebaseBlockedText(null)).toBeNull();
    expect(pptCreateBlockedText("deck_limit", "x")).toBe(PPT_COPY.planLimitReached);
    expect(pptCreateBlockedText("brief_drafting", "서버 사유")).toBe("서버 사유");
    expect(pptCreateBlockedText(null, null)).toBeNull();
  });

  it("내보내기 주소: 경로 처리기, 옛 판은 version, id 는 인코딩", () => {
    expect(pptExportHref("d-1", "pptx")).toBe("/ppt-decks/d-1/export?format=pptx");
    expect(pptExportHref("d-1", "md", 2)).toBe("/ppt-decks/d-1/export?format=md&version=2");
    expect(pptExportHref("a/b?c", "md")).toBe("/ppt-decks/a%2Fb%3Fc/export?format=md");
    expect(PPT_LABELS.versionsHeading(3)).toBe("구성안 판 이력 · 되돌리기 (3 / 20판 · 빼기 슬라이드 복구)");
    expect(PPT_LABELS.representative(1)).toBe("대표 구성안 · 활성 1 / 5개");
  });
});
