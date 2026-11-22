/**
 * QA-P3C-PREP-01(Tester): P3-c 파일 검사(앞 바이트 9종·위장·SVG 위험 요소) 단위 공격 시험.
 * 대상 모듈은 qa-p3c-names.ts 의 fileCheckModule(구현: detectDesignMime·svgDanger). 모듈이 없으면 건너뛴다.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { P3C } from "./qa-p3c-names";

const path = join(import.meta.dirname, "..", "..", P3C.fileCheckModule);
const present = existsSync(path);
type Mod = {
  detectDesignMime: (b: Uint8Array) => string | null;
  svgDanger: (t: string) => string | null;
};
const load = async () =>
  (await import(/* @vite-ignore */ pathToFileURL(path).href)) as Mod;
const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(
    parts.flatMap((p) =>
      typeof p === "string" ? [...new TextEncoder().encode(p)] : p,
    ),
  );
const SVG_OK =
  '<?xml version="1.0"?>\n<!-- 로고 -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="10" height="10"/><use href="#g"/></svg>';

describe.skipIf(!present)("P3-c 파일 검사(앞 바이트·SVG)", () => {
  it("앞 바이트 9종을 맞게 판정한다", async () => {
    const m = await load();
    const cases: Array<[Uint8Array, string]> = [
      [
        bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "rest"),
        "image/png",
      ],
      [bytes([0xff, 0xd8, 0xff, 0xe0], "rest"), "image/jpeg"],
      [bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "), "image/webp"],
      [bytes("wOF2", [0, 1, 0, 0]), "font/woff2"],
      [bytes([0x00, 0x01, 0x00, 0x00], "rest"), "font/ttf"],
      [bytes("OTTO", [0, 0]), "font/otf"],
      [bytes(SVG_OK), "image/svg+xml"],
      [bytes('{"primary":"#2563eb"}'), "application/json"],
      [bytes(":root { --primary: #2563eb; }"), "text/css"],
    ];
    for (const [b, want] of cases)
      expect(m.detectDesignMime(b), want).toBe(want);
  });
  it("위장: PNG 이름의 HTML·스크립트·실행 파일·빈 파일·NUL 섞인 글자는 9종 중 하나로 판정되지 않거나 SVG/텍스트 검사에서 걸린다", async () => {
    const m = await load();
    const html = m.detectDesignMime(
      bytes("<!doctype html><script>alert(1)</script>"),
    );
    expect(html === null || html === "text/css").toBe(html === null); // HTML 이 CSS 로 오판되면 안 된다
    expect(m.detectDesignMime(bytes("MZ", [0x90, 0])), "exe").toBeNull();
    expect(m.detectDesignMime(new Uint8Array()), "빈 파일").toBeNull();
    expect(
      m.detectDesignMime(bytes("a { color: red }", [0], "x")),
      "NUL 섞인 CSS",
    ).toBeNull();
    expect(m.detectDesignMime(bytes("{ not json")), "깨진 JSON").not.toBe(
      "application/json",
    );
    expect(
      m.detectDesignMime(bytes([0x89, 0x50, 0x4e])),
      "잘린 PNG 머리",
    ).toBeNull();
  });
  it("안전한 SVG 는 통과(내부 #참조·주석·xml 선언)", async () => {
    expect((await load()).svgDanger(SVG_OK)).toBeNull();
  });
  it("SVG 위험 요소 12가지(+ 우회 모양)를 모두 거절", async () => {
    const m = await load();
    const wrap = (inner: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    const cases = [
      wrap("<script>alert(1)</script>"),
      wrap("< SCRIPT >alert(1)</script>"),
      wrap('<rect onload="alert(1)"/>'),
      wrap("<rect/onclick=alert(1)>"),
      wrap('<a href="javascript:alert(1)">x</a>'),
      wrap('<a href="ja\tva script:alert(1)">x</a>'.replace("\t", " ")),
      wrap('<a href="vbscript:msgbox(1)">x</a>'),
      wrap('<a href="data:text/html,<script>alert(1)</script>">x</a>'),
      wrap("<foreignObject><body/></foreignObject>"),
      `<!DOCTYPE svg [<!ENTITY x "y">]>${wrap("")}`,
      wrap('<iframe src="https://evil.example"/>'),
      wrap('<embed src="x"/>'),
      wrap('<object data="x"/>'),
      wrap('<image href="https://evil.example/x.png"/>'),
      wrap('<use xlink:href="https://evil.example/s.svg#a"/>'),
      wrap('<rect style="fill:url(https://evil.example/x)"/>'),
      wrap("<style>@import url(https://evil.example/x.css);</style>"),
      wrap('<set attributeName="href" to="javascript:alert(1)"/>'),
      wrap(
        '<animate attributeName="xlink:href" values="javascript:alert(1)"/>',
      ),
      wrap('<a href="&#106;avascript:alert(1)">x</a>'),
      wrap("<text>&#x3c;script&#x3e;</text>"),
    ];
    const passed = cases.filter((c) => m.svgDanger(c) === null);
    expect(passed, "위험한데 통과한 SVG").toEqual([]);
  });
});
