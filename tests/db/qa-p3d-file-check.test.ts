/**
 * QA-P3D-PREP-01(Tester): P3-d 영상 앞 바이트 형식 표식(mp4·mov `ftyp` 상자, webm `1A 45 DF A3`) 단위 공격 시험.
 * 대상 모듈은 qa-p3d-names.ts 의 domainModule(구현: videoSignatureOk(head, mime)). 모듈이 없으면 건너뛴다.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { P3D } from "./qa-p3d-names";

const path = join(import.meta.dirname, "..", "..", P3D.domainModule);
const present = existsSync(path);
type Mod = { videoSignatureOk: (head: Uint8Array, mime: string) => boolean };
const load = async () =>
  (await import(/* @vite-ignore */ pathToFileURL(path).href)) as Mod;
const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(
    parts.flatMap((p) =>
      typeof p === "string" ? [...new TextEncoder().encode(p)] : p,
    ),
  );
const box = (brand: string) =>
  bytes([0, 0, 0, 0x20], "ftyp", brand, [0, 0, 0, 0], brand, "mp41");

describe.skipIf(!present)("P3-d 영상 앞 바이트 표식", () => {
  it("맞는 표식은 통과: mp4(ftyp isom·mp42)·mov(ftyp qt)·webm(EBML)", async () => {
    const m = await load();
    expect(m.videoSignatureOk(box("isom"), "video/mp4")).toBe(true);
    expect(m.videoSignatureOk(box("mp42"), "video/mp4")).toBe(true);
    expect(m.videoSignatureOk(box("qt  "), "video/quicktime")).toBe(true);
    expect(
      m.videoSignatureOk(bytes([0x1a, 0x45, 0xdf, 0xa3], "webm"), "video/webm"),
    ).toBe(true);
  });
  it("위조·불일치는 거절: HTML 을 .mp4 로, 빈 바이트, ftyp 위치 어긋남, webm 바이트를 mp4 로, mp4 바이트를 webm 으로", async () => {
    const m = await load();
    const cases: Array<[Uint8Array, string, string]> = [
      [
        bytes("<!doctype html><script>alert(1)</script>"),
        "video/mp4",
        "HTML→mp4",
      ],
      [new Uint8Array(), "video/mp4", "빈 바이트"],
      [bytes("ftyp", [0, 0, 0, 0x20], "isom"), "video/mp4", "ftyp 위치 0"],
      [bytes([0x1a, 0x45, 0xdf, 0xa3]), "video/mp4", "webm→mp4"],
      [box("isom"), "video/webm", "mp4→webm"],
      [bytes([0, 0, 0]), "video/mp4", "잘린 머리"],
    ];
    const passed = cases
      .filter(([b, mime]) => m.videoSignatureOk(b, mime))
      .map((x) => x[2]);
    expect(passed, "받아들여진 위조").toEqual([]);
  });
});
