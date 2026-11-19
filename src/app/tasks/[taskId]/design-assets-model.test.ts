import { describe, expect, it } from "vitest";
import {
  DA_COPY,
  DESIGN_ASSET_KIND_KEYS,
  DESIGN_ASSET_LIMITS,
  P3_COMMON_COPY,
  assetMetaLine,
  checkAssetForm,
  countChars,
  fileFormatLabel,
  filterAssets,
  formatBytes,
  formatKstMinute,
  kindCounts,
  type DesignAssetView,
} from "./design-assets-model";

const asset = (over: Partial<DesignAssetView>): DesignAssetView => ({
  id: "a",
  title: "t",
  kind: "logo",
  origin: "external_upload",
  fileName: "logo.svg",
  fileSizeBytes: 2516582,
  mimeType: "image/svg+xml",
  licenseNote: null,
  status: "drafting",
  archivedAt: null,
  revision: 1,
  version: 1,
  usages: [],
  versions: [],
  ...over,
});

describe("P3-c 디자인 자산 화면 모델(P3C-HANDOFF·P3-COPY-FINAL)", () => {
  it("한도·분류는 인계표와 같다", () => {
    expect(DESIGN_ASSET_LIMITS).toMatchObject({ perProject: 50, versionsPerAsset: 30, usagesPerAsset: 20, title: 100, fileName: 200, licenseNote: 500, changeNote: 300, maxFileBytes: 10_485_760 });
    expect(DESIGN_ASSET_KIND_KEYS).toEqual(["logo", "image", "color", "font"]);
  });

  it("문구는 최종본 그대로(글자 수 표와 대조)", () => {
    // P3-COPY-FINAL.md 의 글자 수 칸과 같은지(코드 포인트)
    const expected: Array<[string, number]> = [
      [DA_COPY.heading, 9],
      [DA_COPY.intro, 58],
      [DA_COPY.emptyTitle, 20],
      [DA_COPY.limitReached, 52],
      [DA_COPY.staleBanner, 67],
      [DA_COPY.archivedNote, 45],
      [DA_COPY.noPermission, 33],
      [DA_COPY.loadError, 39],
      [P3_COMMON_COPY.projectReadOnly, 31],
      [P3_COMMON_COPY.archiveConfirm, 42],
      [P3_COMMON_COPY.restoreHint, 49],
      [P3_COMMON_COPY.notConnected, 26],
    ];
    for (const [s, n] of expected) expect(Array.from(s).length, s).toBe(n);
  });

  it("크기·형식 표시", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(12 * 1024)).toBe("12 KB");
    expect(formatBytes(2516582)).toBe("2.4 MB");
    expect(formatBytes(-1)).toBe("크기 알 수 없음");
    expect(fileFormatLabel("image/svg+xml", "a.svg")).toBe("SVG");
    expect(fileFormatLabel("font/woff2", "a.woff2")).toBe("WOFF2");
    expect(fileFormatLabel("application/zip", "kit.zip")).toBe("ZIP");
    expect(fileFormatLabel("x/y", "noext")).toBe("형식 알 수 없음");
    expect(formatKstMinute("2026-11-19T10:10:00Z")).toBe("2026-11-19 19:10 KST");
  });

  it("정보 줄: 분류·파일(크기·형식)·라이선스", () => {
    expect(assetMetaLine(asset({ licenseNote: "자체 저작권 보유" }))).toBe("분류: 로고 · 파일: logo.svg (2.4 MB · SVG) · 라이선스: 자체 저작권 보유");
    expect(assetMetaLine(asset({ kind: "font", fileName: "P.woff2", mimeType: "font/woff2", fileSizeBytes: 1153434 }))).toBe("분류: 글꼴 · 파일: P.woff2 (1.1 MB · WOFF2)");
  });

  it("분류별 개수와 거르기", () => {
    const list = [asset({ id: "1", kind: "logo" }), asset({ id: "2", kind: "image" }), asset({ id: "3", kind: "image" }), asset({ id: "4", kind: "font" })];
    expect(kindCounts(list)).toEqual({ all: 4, logo: 1, image: 2, color: 0, font: 1 });
    expect(filterAssets(list, "image").map((a) => a.id)).toEqual(["2", "3"]);
    expect(filterAssets(list, "all")).toHaveLength(4);
  });

  it("점검: 서버처럼 앞뒤 정리 뒤 셈, 이름 1~100자·메모 500자", () => {
    expect(countChars("  가나\n")).toBe(2);
    expect(checkAssetForm({ title: `  ${"가".repeat(100)} `, licenseNote: "", status: "drafting" })).toEqual({});
    expect(checkAssetForm({ title: " \n", licenseNote: "", status: "drafting" }).title).toBe("자산 이름을(를) 입력해 주세요.");
    expect(checkAssetForm({ title: "가".repeat(101), licenseNote: "a".repeat(501), status: "drafting" })).toEqual({ title: "자산 이름은(는) 100자까지 쓸 수 있습니다.", licenseNote: "라이선스·주의 메모은(는) 500자까지 쓸 수 있습니다." });
  });
});
