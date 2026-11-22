import { describe, expect, it } from "vitest";
import { DESIGN_UPLOAD_ERROR_COPY_KEY, checkDesignBytes, checkDesignDeclared, designAssetCreateSchema, designAssetUpdateSchema, designAssetUsagesSchema, designErrorFromDb, designTextPreview, detectDesignMime, sectionLabel, svgDanger } from "./index";

/** P3C-BACKEND-IMPL-01: 디자인 자산 파일 검사·입력 계약·오류 문구 (Q3·Q4·Q5, Tester QA-PLAN-P3CDE 2절) */
const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...xs: number[]) => new Uint8Array([...xs, ...Array(16).fill(0x20)]);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const WEBP = new Uint8Array([...enc("RIFF"), 0, 0, 0, 0, ...enc("WEBPVP8 ")]);
const SVG = enc('<?xml version="1.0"?>\n<!-- 로고 --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href="#a"/><rect fill="url(#g)"/></svg>');

describe("앞 바이트 형식 판정(Q3)", () => {
  it("9종을 내용으로 가른다", () => {
    expect(detectDesignMime(PNG)).toBe("image/png");
    expect(detectDesignMime(JPEG)).toBe("image/jpeg");
    expect(detectDesignMime(WEBP)).toBe("image/webp");
    expect(detectDesignMime(bytes(...enc("wOF2")))).toBe("font/woff2");
    expect(detectDesignMime(bytes(0x00, 0x01, 0x00, 0x00))).toBe("font/ttf");
    expect(detectDesignMime(bytes(...enc("OTTO")))).toBe("font/otf");
    expect(detectDesignMime(SVG)).toBe("image/svg+xml");
    expect(detectDesignMime(enc('﻿{"brand":{"primary":"#123456"}}'))).toBe("application/json");
    expect(detectDesignMime(enc(":root { --brand: #123456; }"))).toBe("text/css");
  });

  it("위장·모르는 형식: PNG 이름의 HTML, 이미지 분류의 SVG, 깨진 JSON, 실행 파일", () => {
    const html = enc("<!doctype html><html><script>alert(1)</script></html>");
    expect(detectDesignMime(html)).toBeNull();
    expect(checkDesignBytes("image", "image/png", html)).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(checkDesignBytes("logo", "image/png", SVG)).toMatchObject({ ok: false, code: "TYPE_MISMATCH", detail: "image/svg+xml" });
    expect(checkDesignBytes("color", "application/json", enc('{"a":'))).toMatchObject({ ok: false });
    expect(detectDesignMime(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull(); // MZ(실행 파일)
    expect(checkDesignBytes("image", "image/png", new Uint8Array(0))).toMatchObject({ ok: false, code: "TOO_LARGE" });
    expect(checkDesignBytes("color", "text/css", new Uint8Array(1024 * 1024 + 1).fill(0x7b))).toMatchObject({ ok: false, code: "TOO_LARGE" });
    expect(checkDesignBytes("image", "image/png", PNG)).toEqual({ ok: true, mime: "image/png" });
  });

  it("선언 검사: 분류별 형식·크기·확장자", () => {
    expect(checkDesignDeclared("logo", "a.svg", 10, "image/svg+xml")).toEqual({ ok: true, mime: "image/svg+xml" });
    expect(checkDesignDeclared("image", "a.JPEG", 10, "image/jpeg")).toMatchObject({ ok: true });
    expect(checkDesignDeclared("image", "a.svg", 10, "image/svg+xml")).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(checkDesignDeclared("logo", "a.png", 10, "image/svg+xml")).toMatchObject({ ok: false, code: "TYPE_MISMATCH" });
    expect(checkDesignDeclared("color", "a.json", 1024 * 1024 + 1, "application/json")).toMatchObject({ ok: false, code: "TOO_LARGE" });
    expect(checkDesignDeclared("font", "a.woff2", 10 * 1024 * 1024 + 1, "font/woff2")).toMatchObject({ ok: false, code: "TOO_LARGE" });
    for (const n of [".svg", ".SVG", "logo.svg.html", "a..svg", "a/b.svg", "a\\b.svg", "a\nb.svg", "x\u202egvs.svg", ` a.svg`, `${"가".repeat(197)}.svg`])
      expect(checkDesignDeclared("logo", n, 10, "image/svg+xml"), n).toMatchObject({ ok: false, code: "TYPE_MISMATCH" });
    expect(checkDesignDeclared("logo", `${"가".repeat(196)}.svg`, 10, "image/svg+xml")).toMatchObject({ ok: true });
  });
});

describe("SVG 위험 요소(Q4) — 하나라도 있으면 거절", () => {
  const cases: Array<[string, string]> = [
    ["script 태그", "<svg><script>alert(1)</script></svg>"],
    ["script 대문자·공백", "<svg>< SCRIPT >x</SCRIPT></svg>"],
    ["on… 이벤트 속성", '<svg onload="alert(1)"></svg>'],
    ["on… 슬래시 뒤", "<svg/onload=alert(1)></svg>"],
    ["javascript: 주소", '<svg><a href="javascript:alert(1)">x</a></svg>'],
    ["javascript 끊어 쓰기", '<svg><a href="java\tscript:alert(1)">x</a></svg>'],
    ["data:text/html", '<svg><a href="data:text/html,<script>">x</a></svg>'],
    ["foreignObject", "<svg><foreignObject><div>x</div></foreignObject></svg>"],
    ["DOCTYPE·ENTITY", '<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>'],
    ["iframe", "<svg><iframe src='x'></iframe></svg>"],
    ["외부 href", '<svg><image href="https://evil.example/x.png"/></svg>'],
    ["외부 xlink:href", '<svg><use xlink:href="http://evil.example/a.svg#x"/></svg>'],
    ["외부 url()", "<svg><rect style=\"fill:url('https://evil.example/a')\"/></svg>"],
    ["@import", "<svg><style>@import 'https://evil.example/a.css';</style></svg>"],
    ["set 으로 href 바꾸기", '<svg><a><set attributeName="href" to="#x"/></a></svg>'],
    ["글자 참조로 숨긴 javascript", '<svg><a href="&#106;avascript:alert(1)">x</a></svg>'],
  ];
  for (const [name, svg] of cases)
    it(name, () => {
      expect(svgDanger(svg)).not.toBeNull();
      expect(checkDesignBytes("logo", "image/svg+xml", enc(svg))).toMatchObject({ ok: false });
    });

  it("안전한 로고(내부 #참조·url(#g)·xml 머리·주석)는 통과", () => {
    expect(svgDanger(new TextDecoder().decode(SVG))).toBeNull();
    expect(checkDesignBytes("logo", "image/svg+xml", SVG)).toEqual({ ok: true, mime: "image/svg+xml" });
  });
});

describe("색상·토큰 미리보기(Q5)", () => {
  it("JSON 은 정렬해 글자로, CSS 는 원문 그대로, 그림 형식은 null", () => {
    expect(designTextPreview("application/json", enc('{"a":{"b":"#fff"}}'))).toBe('{\n  "a": {\n    "b": "#fff"\n  }\n}');
    expect(designTextPreview("text/css", enc("a{color:red}</style><script>"))).toBe("a{color:red}</style><script>");
    expect(designTextPreview("image/png", PNG)).toBeNull();
  });
});

describe("입력 계약", () => {
  it("이름·메모는 앞뒤 공백을 떼고, 빈 메모는 null, 앱 내 생성 거절, 받침 맞춘 문구", () => {
    const u = "11111111-1111-4111-8111-111111111111";
    expect(designAssetCreateSchema.parse({ uploadId: u, title: "  로고 ", licenseNote: " ", origin: "external_upload" })).toEqual({ uploadId: u, title: "로고", licenseNote: null, origin: "external_upload" });
    expect(designAssetCreateSchema.safeParse({ uploadId: u, title: "x", licenseNote: null, origin: "app_generated" }).error?.issues[0].message).toBe("앱 내 생성은 아직 지원하지 않습니다.");
    expect(designAssetUpdateSchema.safeParse({ title: " ", licenseNote: null, status: "drafting" }).error?.issues[0].message).toBe("자산 이름을 입력해 주세요.");
    expect(designAssetUpdateSchema.safeParse({ title: "x", licenseNote: "가".repeat(501), status: "drafting" }).error?.issues[0].message).toBe("라이선스·주의 메모는 500자까지입니다.");
    expect(designAssetUsagesSchema.safeParse(Array.from({ length: 21 }, () => ({ docId: u, sectionId: u }))).success).toBe(false);
  });
});

describe("DB 오류 → 문구·DA_COPY 키", () => {
  it("업로드 실패는 UPLOAD_FAILED + 문구 키, 그 밖은 원인 문구", () => {
    expect(designErrorFromDb("TOO_LARGE: x")).toMatchObject({ code: "UPLOAD_FAILED", uploadCode: "TOO_LARGE", copyKey: "uploadErrSize", message: "파일 크기가 한도(10MB)를 넘어 올릴 수 없습니다." });
    expect(designErrorFromDb("UPLOAD_EXPIRED: x")).toMatchObject({ copyKey: "uploadErrExpired" });
    expect(designErrorFromDb("TYPE_MISMATCH: x")).toMatchObject({ copyKey: "uploadErrMismatch" });
    expect(designErrorFromDb("LIMIT_REACHED: 디자인 자산은 프로젝트당 50개까지입니다(보관 포함)").message).toBe("디자인 자산이 50개라 더 올릴 수 없습니다. 쓰지 않는 자산을 보관한 뒤 다시 올려 주세요.");
    expect(designErrorFromDb("CONFLICT: x").code).toBe("CONFLICT");
    expect(designErrorFromDb("BAD_SIGNATURE: x")).toMatchObject({ code: "ERROR" });
    expect(designErrorFromDb("INVALID_TRANSITION: 보관한 디자인 자산은 고칠 수 없습니다")).toEqual({ code: "INVALID_TRANSITION", message: "보관한 디자인 자산은 고칠 수 없습니다" });
    // 문구 키는 AGY DA_COPY 확정 키만(upload* 5개 + unsafeSvg)
    for (const k of Object.values(DESIGN_UPLOAD_ERROR_COPY_KEY)) expect(k).toMatch(/^(uploadErr(Size|Type|Mismatch|Network|Expired)|unsafeSvg)$/);
    expect(designErrorFromDb("UNSAFE_SVG: x")).toMatchObject({ copyKey: "unsafeSvg", message: expect.stringContaining("위험한 요소") });
  });

  it("사용처 이름표: 페이지 · 섹션, 없으면 null", () => {
    const c = { pages: [{ title: "홈", sections: [{ id: "s1", section_name: "첫 화면" }] }] };
    expect(sectionLabel(c, "s1")).toBe("홈 · 첫 화면");
    expect(sectionLabel(c, "s2")).toBeNull();
  });
});
