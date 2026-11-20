import { describe, expect, it } from "vitest";
import { VIDEO_PLAN_LIMITS, toDbScenes, videoErrorFromDb, videoPlanSaveSchema, videoReserveMessage, videoSignatureOk, videoUploadPrepareSchema } from ".";

/** P3D-BACKEND-IMPL-01 순수 모듈: 입력 정리·글자 수(코드 포인트)·형식 표식·오류 문구 */
const scene = (o: Record<string, unknown> = {}) => ({ id: null, sceneTitle: "첫 장면", durationSec: 10, narration: "대사", subtitle: "", assetIds: [], ...o });
const save = (scenes: unknown[], o: Record<string, unknown> = {}) => videoPlanSaveSchema.safeParse({ title: "봄 영상", aspectRatio: "16:9", status: "drafting", scenes, ...o });

describe("입력 검사(X9·D2)", () => {
  it("앞뒤 공백 정리, 선택 칸 공백만이면 null, 필수 칸 공백만이면 거절", () => {
    const r = save([scene({ sceneTitle: "  하나  ", narration: "   ", subtitle: " 자막 " })], { title: " 제목 " });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.title).toBe("제목");
    expect(toDbScenes(r.data.scenes)).toEqual([{ id: null, title: "하나", duration_sec: 10, narration: null, subtitle: "자막", asset_ids: [] }]);
    expect(save([scene({ sceneTitle: "   " })]).success).toBe(false);
    expect(save([scene()], { title: " " }).success).toBe(false);
  });
  it("글자 수는 코드 포인트(이모지 1자), 경계 ±1", () => {
    expect(save([scene({ narration: "😀".repeat(VIDEO_PLAN_LIMITS.narration) })]).success).toBe(true);
    expect(save([scene({ narration: "😀".repeat(VIDEO_PLAN_LIMITS.narration + 1) })]).success).toBe(false);
    expect(save([scene({ sceneTitle: "가".repeat(80) })]).success).toBe(true);
    expect(save([scene({ sceneTitle: "가".repeat(81) })]).success).toBe(false);
    expect(save([scene()], { title: "가".repeat(121) }).success).toBe(false);
  });
  it("길이는 정수 1~600, 장면 1~30, 자산 10, 모르는 키·상태·비율 거절", () => {
    for (const d of [0, 601, 1.5, -1, "10", null]) expect(save([scene({ durationSec: d })]).success, String(d)).toBe(false);
    for (const d of [1, 600]) expect(save([scene({ durationSec: d })]).success).toBe(true);
    expect(save([]).success).toBe(false);
    expect(save(Array.from({ length: 31 }, () => scene())).success).toBe(false);
    const r = save(Array.from({ length: 31 }, () => scene()));
    if (!r.success) expect(r.error.issues[0].message).toBe("장면은 30개까지 둘 수 있습니다. 불필요한 장면을 제외한 뒤 추가해 주세요.");
    expect(save([scene({ assetIds: Array.from({ length: 11 }, () => "00000000-0000-4000-8000-000000000001") })]).success).toBe(false);
    expect(save([scene({ excluded: true })]).success).toBe(false);
    expect(save([scene()], { status: "approved" }).success).toBe(false);
    expect(save([scene()], { aspectRatio: "4:3" }).success).toBe(false);
  });
  it("파일: 형식 3종만, 서명 메시지 순서", () => {
    const i = { planId: "00000000-0000-4000-8000-000000000001", fileName: " 최종.mp4 ", size: 10, mime: "video/mp4" };
    const p = videoUploadPrepareSchema.parse(i);
    expect(videoReserveMessage(p)).toBe("00000000-0000-4000-8000-000000000001|10|video/mp4|최종.mp4");
    expect(videoUploadPrepareSchema.safeParse({ ...i, mime: "text/html" }).success).toBe(false);
  });
});

describe("영상 형식 표식(DS5)", () => {
  const box = (name: string) => new Uint8Array([0, 0, 0, 0x20, ...[...name].map((c) => c.charCodeAt(0)), 0x69, 0x73, 0x6f, 0x6d]);
  it("mp4 = ftyp, mov = ftyp·moov·wide 등, webm = EBML, html·짧은 바이트는 거절", () => {
    expect(videoSignatureOk(box("ftyp"), "video/mp4")).toBe(true);
    expect(videoSignatureOk(box("moov"), "video/mp4")).toBe(false);
    expect(videoSignatureOk(box("moov"), "video/quicktime")).toBe(true);
    expect(videoSignatureOk(box("wide"), "video/quicktime")).toBe(true);
    expect(videoSignatureOk(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]), "video/webm")).toBe(true);
    expect(videoSignatureOk(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), "video/mp4")).toBe(false);
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    for (const m of ["video/mp4", "video/quicktime", "video/webm"] as const) expect(videoSignatureOk(html, m)).toBe(false);
    expect(videoSignatureOk(new Uint8Array([0, 0, 0]), "video/mp4")).toBe(false);
  });
});

describe("DB 오류 → 안내 문구", () => {
  it("머리별 코드, 한글 문구만 쓰고 영어·긴 글은 버린다", () => {
    expect(videoErrorFromDb("LIMIT_REACHED: 첨부 파일 버전은 20개까지 둘 수 있습니다")).toEqual({ code: "VALIDATION", message: "첨부 파일 버전은 20개까지 둘 수 있습니다." });
    expect(videoErrorFromDb("TYPE_MISMATCH: 올린 파일의 크기·형식이 예약과 다릅니다").code).toBe("UPLOAD_FAILED");
    expect(videoErrorFromDb("CONFLICT: x").code).toBe("CONFLICT");
    expect(videoErrorFromDb("FROZEN_COLUMN: whatever")).toEqual({ code: "INVALID_TRANSITION", message: "보관한 영상 구성안은 고칠 수 없습니다." });
    expect(videoErrorFromDb("NOT_FOUND: relation x does not exist")).toEqual({ code: "NOT_FOUND", message: "찾을 수 없습니다." });
    expect(videoErrorFromDb("syntax error at or near").code).toBe("ERROR");
  });
});
