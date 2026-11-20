import { describe, expect, it } from "vitest";
import {
  VIDEO_MIME_EXT,
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
  VP_LABELS,
  archivedAssetsWarnText,
  guessVideoMime,
  precheckVideoFile,
  staleReasonAssetText,
  videoCreateBlockedText,
  videoRebaseBlockedText,
  videoStaleNotices,
  videoUploadErrSizeText,
  type VideoSceneView,
} from "./video-plan-model";

const sc = (name: string, sortOrder: number, extra: Partial<VideoSceneView> = {}): VideoSceneView => ({ ...emptyScene(sortOrder), id: `s-${name}`, sceneTitle: name, durationSec: 15, ...extra });

describe("P3-d 영상 구성 화면 모델(P3D-HANDOFF·P3-COPY-FINAL)", () => {
  it("화면 한도·형식은 서버 도메인 상수(DB 와 같은 값)와 똑같다(화면은 zod 를 피하려고 값을 따로 둠)", async () => {
    const d = await import("@/domain/video-plans");
    expect(VIDEO_PLAN_LIMITS).toEqual(d.VIDEO_PLAN_LIMITS);
    expect(VIDEO_MIME_EXT).toEqual(d.VIDEO_MIME_EXT);
  });

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
    expect(issues.title).toBe("영상 제목을 입력해 주세요.");
    expect(issues[sceneKey(0, "sceneTitle")]).toBe("장면 이름을 입력해 주세요.");
    expect(issues[sceneKey(0, "durationSec")]).toBe("길이는 1초부터 600초까지 정수로 적어 주세요.");
    expect(issues[sceneKey(0, "narration")]).toBe("대사 / 내레이션은 1,000자까지 쓸 수 있습니다.");
    expect(issues[sceneKey(0, "subtitle")]).toBe("화면 자막은 300자까지 쓸 수 있습니다.");
    expect(issues[sceneKey(0, "assetIds")]).toBe("목록에 없는 자산 1개가 연결되어 있습니다.");
    expect(issues[sceneKey(1, "assetIds")]).toBe("디자인 자산은 10개까지 연결할 수 있습니다.");
    expect(checkVideoPlan("t", [], []).scenes).toBe("장면이 1개 이상 있어야 합니다.");
  });

  it("보낼 값(Backend 4절): 배열 순서가 곧 순서(sortOrder 안 보냄), 장면 id 그대로(새 장면만 null), 값은 자르지 않음", () => {
    const p = toVideoPlanPayload({ title: "t", aspectRatio: "9:16", status: "reviewed", scenes: [sc("B", 2), sc("A", 1, { narration: "가".repeat(1100) }), { ...emptyScene(3), sceneTitle: "새" }] });
    expect(p.scenes.map((s) => `${s.id}:${s.sceneTitle}`)).toEqual(["s-A:A", "s-B:B", "null:새"]);
    expect(p.scenes.every((s) => !("sortOrder" in s))).toBe(true);
    expect(p.scenes[0].narration).toHaveLength(1100);
    expect(p).toMatchObject({ aspectRatio: "9:16", status: "reviewed" });
  });

  it("이전 기준 원인별(staleReasons): 브리프·자산(서버 staleAssetCount 로 staleReasonAsset {n}), 보관이면 없음", () => {
    const base = { stale: true, archivedAt: null, staleReasons: ["brief"] as ("brief" | "asset")[], staleAssetCount: 0 };
    expect(videoStaleNotices(base)).toEqual([VP_COPY.staleReasonBrief]);
    expect(videoStaleNotices({ ...base, staleReasons: ["asset"], staleAssetCount: 3 })).toEqual(["연결된 디자인 자산 3개가 새 판으로 바뀌었습니다. 사용 자산을 확인해 주세요."]);
    expect(videoStaleNotices({ ...base, staleReasons: ["brief", "asset"], staleAssetCount: 1 })).toEqual([VP_COPY.staleReasonBrief, VP_COPY.staleReasonAsset(1)]);
    // 계약상 없는 경우(자산 원인인데 0개)만 공통 안내
    expect(videoStaleNotices({ ...base, staleReasons: ["asset"] })).toEqual([VP_COPY.staleBanner]);
    expect(videoStaleNotices({ ...base, archivedAt: "x" })).toEqual([]);
    expect(videoStaleNotices({ ...base, stale: false })).toEqual([]);
    expect(staleReasonAssetText(1)).toBe("연결된 디자인 자산 1개가 새 판으로 바뀌었습니다. 사용 자산을 확인해 주세요.");
    expect(archivedAssetsWarnText(2)).toBe("연결된 디자인 자산 2개가 보관되었습니다. 필요하면 다른 자산으로 바꿔 주세요.");
  });

  it("맞추기 막힘: 원인 코드 → AGY 문구, 문구 없는 코드·코드 없음은 서버 한글 사유(대체용)", () => {
    const R = "서버 사유";
    expect(videoRebaseBlockedText("brief_archived", R)).toBe("바탕 제작 브리프가 보관되어 최신 기준으로 맞출 수 없습니다.");
    expect(videoRebaseBlockedText("brief_drafting", R)).toBe("바탕 제작 브리프가 아직 확정 전이라 최신 기준으로 맞출 수 없습니다.");
    expect(videoRebaseBlockedText("version_limit", R)).toBe("구성안 판 이력이 100개에 도달해 최신 기준으로 맞출 수 없습니다.");
    expect(videoRebaseBlockedText("plan_archived", "보관한 영상 구성안은 맞출 수 없습니다.")).toBe("보관한 영상 구성안은 맞출 수 없습니다.");
    expect(videoRebaseBlockedText(null, R)).toBe(R);
    expect(videoRebaseBlockedText(null, null)).toBeNull();
  });

  it("만들기 막힘: 구성안 한도 두 코드만 planLimitReached, 나머지는 서버 한글 사유(대체용)", () => {
    for (const c of ["plan_limit_total", "plan_limit_active"] as const) expect(videoCreateBlockedText(c, "x")).toBe(VP_COPY.planLimitReached);
    for (const c of ["project_archived", "task_cancelled", "brief_archived", "brief_drafting", "no_video_deliverable"] as const) expect(videoCreateBlockedText(c, "서버 사유")).toBe("서버 사유");
    expect(videoCreateBlockedText(null, null)).toBeNull();
  });

  it("영상 파일 미리 거르기: 형식(MP4·MOV·WEBM)·확장자만 이름·크기(서버 한도 {limit})", () => {
    const MB = 1024 * 1024;
    expect(precheckVideoFile({ name: "a.mp4", size: 10 * MB, type: "video/mp4" })).toBeNull();
    expect(precheckVideoFile({ name: "a.MOV", size: 10, type: "" })).toBeNull();
    expect(precheckVideoFile({ name: "a.avi", size: 10, type: "video/x-msvideo" })).toBe("허용되지 않는 파일 형식입니다. MP4·MOV·WEBM 파일만 올려 주세요.");
    expect(precheckVideoFile({ name: ".mp4", size: 10, type: "video/mp4" })).toBe("확장자만 있는 파일 이름은 사용할 수 없습니다. 파일 이름을 붙인 뒤 다시 올려 주세요.");
    expect(precheckVideoFile({ name: "a.webm", size: 50 * MB + 1, type: "video/webm" })).toBe("파일 크기가 한도(50.0 MB)를 넘어 올릴 수 없습니다.");
    expect(videoUploadErrSizeText(100 * MB)).toBe("파일 크기가 한도(100.0 MB)를 넘어 올릴 수 없습니다.");
    expect(guessVideoMime("x.webm", "")).toBe("video/webm");
    expect(VP_LABELS.representative(2)).toBe("대표 구성안 · 활성 2 / 5개");
    // AGY DESIGN-COPY-AUDIT-01: VP_COPY 추가 11키가 모두 VP_COPY 의 같은 키 이름으로 있다
    for (const k of ["staleReasonBrief", "staleReasonAsset", "archivedAssetsWarn", "rebaseBlockedBriefArchived", "rebaseBlockedBriefDraft", "rebaseBlockedVersionLimit", "planLimitReached", "planRestoredOk", "fileRestoredOk", "uploadErrSize", "uploadErrType"])
      expect(k in VP_COPY, k).toBe(true);
    expect(VP_COPY.uploadErrSize(50 * MB)).toBe("파일 크기가 한도(50.0 MB)를 넘어 올릴 수 없습니다.");
  });
});
