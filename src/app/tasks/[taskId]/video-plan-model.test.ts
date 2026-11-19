import { describe, expect, it } from "vitest";
import {
  VIDEO_PLAN_LIMITS,
  VP_COPY,
  addScene,
  canAddScene,
  checkVideoPlan,
  durationSummary,
  emptyScene,
  formatDuration,
  moveScene,
  removeScene,
  sceneKey,
  toVideoPlanPayload,
  toggleAsset,
  totalSeconds,
  type VideoSceneView,
} from "./video-plan-model";

const sc = (name: string, sortOrder: number, extra: Partial<VideoSceneView> = {}): VideoSceneView => ({ ...emptyScene(sortOrder), id: `s-${name}`, sceneTitle: name, durationSec: 15, ...extra });

describe("P3-d 영상 구성 화면 모델(P3D-HANDOFF·P3-COPY-FINAL)", () => {
  it("한도는 인계표와 같다", () => {
    expect(VIDEO_PLAN_LIMITS).toMatchObject({ scenesMax: 30, fileVersionsMax: 20, assetsPerScene: 10, title: 120, sceneTitle: 80, durationMin: 1, durationMax: 600, narration: 1000, subtitle: 300 });
  });

  it("문구는 최종본 그대로(글자 수 표와 대조)", () => {
    const expected: Array<[string, number]> = [
      [VP_COPY.heading, 11],
      [VP_COPY.intro, 56],
      [VP_COPY.scopeNotice, 65],
      [VP_COPY.emptyTitle, 16],
      [VP_COPY.emptyDesc, 63],
      [VP_COPY.sceneLimitReached, 43],
      [VP_COPY.fileLimitReached, 25],
      [VP_COPY.staleBanner, 59],
      [VP_COPY.archivedNote, 52],
      [VP_COPY.noPermission, 25],
      [VP_COPY.loadError, 36],
    ];
    for (const [s, n] of expected) expect(Array.from(s).length, s).toBe(n);
  });

  it("길이 합계: 1~600 정수 장면만 더하고, 분·초로 보인다(근거 있는 숫자만)", () => {
    expect(totalSeconds([sc("a", 1, { durationSec: 15 }), sc("b", 2, { durationSec: 23 })])).toBe(38);
    expect(totalSeconds([sc("a", 1, { durationSec: 15 }), sc("b", 2, { durationSec: Number.NaN }), sc("c", 3, { durationSec: 601 }), sc("d", 4, { durationSec: 1.5 })])).toBe(15);
    expect(formatDuration(38)).toBe("38초");
    expect(formatDuration(98)).toBe("1분 38초");
    expect(formatDuration(120)).toBe("2분");
    expect(durationSummary([sc("a", 1, { durationSec: 15 }), sc("b", 2, { durationSec: 23 })])).toBe("총 38초 · 2장면");
  });

  it("장면 순서·빼기·추가(30개까지, 마지막 1개는 못 뺌)", () => {
    const list = [sc("A", 1), sc("B", 2), sc("C", 3)];
    expect(moveScene(list, 2, -1).map((s) => `${s.sortOrder}${s.sceneTitle}`)).toEqual(["1A", "2C", "3B"]);
    expect(moveScene(list, 0, -1).map((s) => s.sceneTitle)).toEqual(["A", "B", "C"]);
    expect(removeScene(list, 1).map((s) => `${s.sortOrder}${s.sceneTitle}`)).toEqual(["1A", "2C"]);
    expect(removeScene([sc("A", 1)], 0)).toHaveLength(1);
    expect(addScene(list).at(-1)).toMatchObject({ id: null, sortOrder: 4, durationSec: 10 });
    const thirty = Array.from({ length: 30 }, (_, i) => sc(`S${i}`, i + 1));
    expect(canAddScene(thirty)).toBe(false);
    expect(addScene(thirty)).toHaveLength(30);
  });

  it("자산 연결: 목록에 있는 것만, 목록 순서", () => {
    expect(toggleAsset(["c", "x"], "a", true, ["a", "b", "c"])).toEqual(["a", "c"]);
    expect(toggleAsset(["a"], "a", false, ["a"])).toEqual([]);
  });

  it("점검: 제목·장면 이름 필수(정리 뒤), 길이 1~600 정수, 글자 수·자산 한도", () => {
    expect(checkVideoPlan("  제목 ", [sc("A", 1)], [])).toEqual({});
    const issues = checkVideoPlan(" \n", [sc(" ", 1, { durationSec: 0, narration: "가".repeat(1001), subtitle: "a".repeat(301), assetIds: ["zz"] }), sc("B", 2, { assetIds: Array.from({ length: 11 }, (_, i) => `a${i}`) })], Array.from({ length: 11 }, (_, i) => `a${i}`));
    expect(issues.title).toBe("영상 제목을(를) 입력해 주세요.");
    expect(issues[sceneKey(0, "sceneTitle")]).toBe("장면 이름을(를) 입력해 주세요.");
    expect(issues[sceneKey(0, "durationSec")]).toBe("길이는 1초부터 600초까지 정수로 적어 주세요.");
    expect(issues[sceneKey(0, "narration")]).toBe("대사 / 내레이션은(는) 1,000자까지 쓸 수 있습니다.");
    expect(issues[sceneKey(0, "subtitle")]).toBe("화면 자막은(는) 300자까지 쓸 수 있습니다.");
    expect(issues[sceneKey(0, "assetIds")]).toBe("목록에 없는 자산 1개가 연결되어 있습니다.");
    expect(issues[sceneKey(1, "assetIds")]).toBe("디자인 자산은 10개까지 연결할 수 있습니다.");
    expect(checkVideoPlan("t", [], []).scenes).toBe("장면이 1개 이상 있어야 합니다.");
  });

  it("보낼 값: 정렬·번호 다시 매김, 값은 자르지 않음", () => {
    const p = toVideoPlanPayload({ title: "t", aspectRatio: "9:16", status: "reviewed", scenes: [sc("B", 2), sc("A", 1, { narration: "가".repeat(1100) })] });
    expect(p.scenes.map((s) => `${s.sortOrder}${s.sceneTitle}`)).toEqual(["1A", "2B"]);
    expect(p.scenes[0].narration).toHaveLength(1100);
    expect(p).toMatchObject({ aspectRatio: "9:16", status: "reviewed" });
  });
});
