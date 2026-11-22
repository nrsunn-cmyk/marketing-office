import { crc32, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PPT_TEMPLATES, PPT_TEMPLATE_KEYS, type StoredSlide } from "@/domain/ppt-decks";
import { buildDeckMarkdown } from "./md";
import { buildPptx, type PptxInput } from "./pptx";
import { attachmentHeader, kstMinute, mdText, safeDownloadName, xmlText } from "./text";
import { zip } from "./zip";

/**
 * P3E-BACKEND-IMPL-01 내보내기 단위 시험(E4·E5·ES1·ES2·ES3·ES6·ES7). 만든 zip 을 직접 풀어(외부 라이브러리 없이)
 * 확인값·XML 구조(엄격 검사)·슬라이드 수·순서·템플릿 색을 본다. 실제 PowerPoint 열기는 보고서의 COM 확인으로 따로 한다.
 */

/** zip 풀기(중앙 디렉터리 기준) — 확인값까지 대조 */
function unzip(buf: Uint8Array): Array<{ name: string; text: string }> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Array<{ name: string; text: string }> = [];
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(off + 26, true);
    const data = inflateRawSync(buf.subarray(off + 30 + lnlen, off + 30 + lnlen + csize));
    expect(data.length, name).toBe(usize);
    expect(crc32(data) >>> 0, name).toBe(crc);
    out.push({ name, text: new TextDecoder("utf-8", { fatal: true }).decode(data) });
    p += 46 + nlen;
  }
  return out;
}

/** 엄격한 XML 구조 검사(well-formed): 태그 짝, 따옴표 속성, 글 안의 맨 < & 금지, 엔티티는 5종·숫자만, XML 1.0 불가 글자 없음 */
function assertWellFormed(name: string, xml: string) {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), name).toBe(true);
  expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.test(xml), `${name} 불가 글자`).toBe(false);
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, "");
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<&]*(?:&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);[^"<&]*)*")*)\s*(\/?)>|([^<]+)/gy;
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < body.length && (m = re.exec(body))) {
    pos = re.lastIndex;
    if (m[5] !== undefined) {
      expect(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/.test(m[5]), `${name} 맨 & : ${m[5].slice(0, 40)}`).toBe(false);
      expect(m[5].includes(">") && /]]>/.test(m[5]), `${name} 글 안 ]]>`).toBe(false);
      continue;
    }
    if (m[1]) expect(stack.pop(), `${name} 닫는 태그 ${m[2]}`).toBe(m[2]);
    else if (!m[4]) stack.push(m[2]);
  }
  expect(pos, `${name} 해석 못 한 곳: ${body.slice(pos, pos + 60)}`).toBe(body.length);
  expect(stack, `${name} 안 닫힌 태그`).toEqual([]);
}

const slide = (title: string, o: Partial<StoredSlide> = {}): StoredSlide => ({ id: crypto.randomUUID(), title, bullets: "요점 하나\n요점 둘", notes: null, assets: [], ...o });
const NASTY = `<a:t>]]>&amp;&<b x="1">'"\u0001\u000B￿ 😀 \uD800끝 é`;
const input = (o: Partial<PptxInput> = {}): PptxInput => ({
  title: "봄 제안서",
  templateKey: "royal_grid",
  status: "reviewed",
  versionNo: 3,
  slides: [slide("표지 제목", { bullets: "대상 고객\n2026-11-20" }), slide("본문 하나", { notes: "메모 첫 줄\n둘째 줄", assets: [{ asset_id: "a1", version_no: 2 }] }), slide("마지막")],
  assetNames: new Map([["a1", "로고 <원본>"]]),
  exportedAt: new Date("2026-11-20T05:05:00Z"),
  ...o,
});
const texts = (xml: string) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);

describe("zip 작성기", () => {
  it("다시 풀면 내용·확인값이 같고, 이상한 항목 이름(경로 오르기·사용자 글)은 거절", () => {
    const z = zip([{ name: "[Content_Types].xml", data: "<a/>" }, { name: "ppt/slides/slide1.xml", data: "가나다".repeat(1000) }]);
    const files = unzip(z);
    expect(files.map((f) => f.name)).toEqual(["[Content_Types].xml", "ppt/slides/slide1.xml"]);
    expect(files[1].text).toBe("가나다".repeat(1000));
    for (const bad of ["../x.xml", "ppt/../x.xml", "/abs.xml", "ppt\\x.xml", "슬라이드.xml", "a.exe", "ppt/slide 1.xml"]) expect(() => zip([{ name: bad, data: "" }]), bad).toThrow();
    expect(() => zip([{ name: "a.xml", data: "" }, { name: "a.xml", data: "" }])).toThrow();
  });
});

describe(".pptx(E4·ES1·ES3·ES7)", () => {
  it("템플릿 3종: 모든 XML 이 well-formed, [Content_Types].xml 첫 항목, 슬라이드 수·제목·요점 순서, theme 색이 템플릿 값", () => {
    for (const key of PPT_TEMPLATE_KEYS) {
      const files = unzip(buildPptx(input({ templateKey: key })));
      expect(files[0].name).toBe("[Content_Types].xml");
      for (const f of files) assertWellFormed(`${key}:${f.name}`, f.text);
      const slides = files.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name)).sort((a, b) => Number(/\d+/.exec(a.name)) - Number(/\d+/.exec(b.name)));
      expect(slides).toHaveLength(3);
      expect(texts(slides[0].text)).toEqual(["표지 제목", "대상 고객", "2026-11-20", `템플릿: ${PPT_TEMPLATES[key].label} · 판: v3 · 상태: 검토 완료`, "내보낸 시각: 2026-11-20 14:05 (KST)"]);
      expect(texts(slides[1].text)).toEqual(["본문 하나", "요점 하나", "요점 둘", "사용 디자인 자산: 로고 &lt;원본&gt; (v2)", "2 / 3"]);
      expect(texts(slides[2].text)).toEqual(["마지막", "요점 하나", "요점 둘", "기준 판: v3 · 총 3장 · 2026-11-20 14:05 (KST)", "3 / 3"]);
      const theme = files.find((f) => f.name === "ppt/theme/theme1.xml")!.text;
      expect(theme).toContain(`<a:accent1><a:srgbClr val="${PPT_TEMPLATES[key].scheme[4]}"/>`);
      expect(slides[0].text).toContain(`<a:srgbClr val="${PPT_TEMPLATES[key].coverBg}"/>`);
      // 메모는 메모가 있는 슬라이드만
      expect(files.filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f.name)).map((f) => f.name)).toEqual(["ppt/notesSlides/notesSlide2.xml"]);
      const ct = files[0].text;
      for (const f of files.filter((x) => x.name.endsWith(".xml") && x.name !== "[Content_Types].xml")) expect(ct, f.name).toContain(`PartName="/${f.name}"`);
      // 개인정보 0: 만든 사람 칸 없음
      expect(files.find((f) => f.name === "docProps/core.xml")!.text).not.toMatch(/creator|lastModifiedBy/);
    }
  });

  it("공격 글(<a:t>·]]>·&·따옴표·제어 문자·짝 없는 서로게이트·U+FFFF)도 XML 이 깨지지 않고 글은 그대로(불가 글자만 빠짐)", () => {
    const files = unzip(buildPptx(input({ title: NASTY, slides: [slide(NASTY, { bullets: `${NASTY}\n=HYPERLINK("x")`, notes: NASTY, assets: [{ asset_id: "a1", version_no: 1 }] }), slide(NASTY)], assetNames: new Map([["a1", NASTY]]) })));
    for (const f of files) assertWellFormed(f.name, f.text);
    const s1 = files.find((f) => f.name === "ppt/slides/slide1.xml")!.text;
    const want = xmlText(NASTY);
    expect(want).toBe("&lt;a:t&gt;]]&gt;&amp;amp;&amp;&lt;b x=&quot;1&quot;&gt;&apos;&quot; 😀 끝 é");
    expect(texts(s1)[0]).toBe(want);
    expect(texts(s1)).toContain("=HYPERLINK(&quot;x&quot;)");
    expect(files.find((f) => f.name === "docProps/core.xml")!.text).toContain(`<dc:title>${want}</dc:title>`);
  });

  it("템플릿 키는 3종만(경로·대소문자·__proto__ 거절), 슬라이드 0·41장 거절", () => {
    for (const k of ["../../x", "ROYAL_GRID", "__proto__", "constructor", "toString", ""]) expect(() => buildPptx(input({ templateKey: k })), k).toThrow(/템플릿/);
    expect(() => buildPptx(input({ slides: [] }))).toThrow();
    expect(() => buildPptx(input({ slides: Array.from({ length: 41 }, (_, i) => slide(`${i}`)) }))).toThrow();
  });

  it("상한(40장 × 제목 100·요점 1000·메모 1000, 이모지): 크기·시간 측정(ES7)", () => {
    const big = Array.from({ length: 40 }, (_, i) => slide(`${i}`.padEnd(100, "가"), { bullets: Array.from({ length: 50 }, () => "😀".repeat(19)).join("\n"), notes: "메".repeat(1000), assets: Array.from({ length: 10 }, (_, k) => ({ asset_id: `a${k}`, version_no: 1 })) }));
    const t0 = performance.now();
    const bytes = buildPptx(input({ title: "가".repeat(120), slides: big }));
    const ms = performance.now() - t0;
    const raw = unzip(bytes).reduce((n, f) => n + Buffer.byteLength(f.text), 0);
    console.log(`[ES7] 40장 상한: 압축 ${bytes.length} 바이트, 풀면 ${raw} 바이트, ${ms.toFixed(0)}ms`);
    expect(bytes.length).toBeLessThan(1_000_000); // Vercel 응답 4.5MB 보다 훨씬 작다
    expect(ms).toBeLessThan(3000);
  });

  it("같은 입력이면 같은 바이트(시각 고정)", () => {
    expect(Buffer.from(buildPptx(input())).equals(Buffer.from(buildPptx(input())))).toBe(true);
  });
});

describe(".md(E5·ES2)", () => {
  it("판 내용·순서, 마크다운 특수문자 이스케이프, 메모 인용, 자산 이름, 끝 줄, LF·BOM 없음", () => {
    const md = buildDeckMarkdown(input({ title: "[링크](http://x) <b>굵게</b> # 제목", slides: [slide("표지"), slide("둘 *강조*", { bullets: "- 이미 글머리\n=HYPERLINK(\"x\")\n![그림](y)", notes: "첫 줄\n> 둘째", assets: [{ asset_id: "a1", version_no: 2 }] })] }));
    expect(md.startsWith("﻿")).toBe(false);
    expect(md.includes("\r")).toBe(false);
    const lines = md.split("\n");
    expect(lines[0]).toBe("# \\[링크\\]\\(http://x\\) \\<b\\>굵게\\</b\\> \\# 제목");
    expect(lines).toContain("- 템플릿: 테크 그리드 로열 블루 · 상태: 검토 완료 · 판: v3 · 슬라이드: 2장");
    expect(lines).toContain("## 2\\. 둘 \\*강조\\*".replace("2\\.", "2.")); // 슬라이드 번호 점은 우리 글이라 그대로
    expect(lines).toContain("- \\- 이미 글머리");
    expect(lines).toContain('- \\=HYPERLINK\\("x"\\)');
    expect(lines).toContain("- \\!\\[그림\\]\\(y\\)");
    expect(lines).toContain("> 발표자 메모: 첫 줄");
    expect(lines).toContain("> \\> 둘째");
    expect(lines).toContain("사용 디자인 자산: 로고 \\<원본\\> (v2)");
    expect(lines.slice(-3)).toEqual(["---", "기준 판: v3 · 총 2장 · 내보낸 시각: 2026-11-20 14:05 (KST)", ""]);
    expect(md).not.toMatch(/[\u0001￿]/);
  });
});

describe("파일 이름·머리글(ES6)", () => {
  it("경로·예약 글자·NUL·방향 글자는 _, 60자, 비면 대체 이름, ASCII 대체 이름에 사용자 글 없음", () => {
    expect(safeDownloadName("../../etc/passwd", "x")).toBe("___etc_passwd"); // / 와 .. 이 모두 _ — 경로 구분이 남지 않는다
    expect(safeDownloadName("a\u0000b<c>:d|e?f*g\"h", "x")).toBe("a_b_c__d_e_f_g_h");
    expect(safeDownloadName("evil‮txt.exe", "x")).toBe("evil_txt.exe");
    expect(safeDownloadName("   ...   ", "PPT-구성안")).toBe("PPT-구성안");
    expect([...safeDownloadName("가".repeat(300), "x")]).toHaveLength(60);
    expect(Buffer.byteLength(`${safeDownloadName("😀".repeat(300), "x")}-v20.pptx`)).toBeLessThan(255);
    expect(attachmentHeader("봄 제안서-v3.pptx", "ppt-deck-v3.pptx")).toBe(`attachment; filename="ppt-deck-v3.pptx"; filename*=UTF-8''${encodeURIComponent("봄 제안서-v3.pptx")}`);
    expect(() => attachmentHeader("x", "봄.pptx")).toThrow();
    expect(() => attachmentHeader("x", 'a"; x=1')).toThrow();
    // P3DE-BACKEND-FIX-01 D2: filename* 는 RFC 5987 attr-char·%XX 만(' ( ) * 도 인코딩), 원래 이름으로 되돌아온다
    const v = attachmentHeader("고객's 발표 (최종)*-v1.pptx", "ppt-deck-v1.pptx").split("filename*=UTF-8''")[1];
    expect(v).toMatch(/^(?:%[0-9A-F]{2}|[A-Za-z0-9!#$&+.^_`|~-])+$/);
    expect(v).toContain("%27");
    expect(decodeURIComponent(v)).toBe("고객's 발표 (최종)*-v1.pptx");
  });
  it("글 처리 도우미", () => {
    expect(mdText("a*b")).toBe("a\\*b");
    // P3DE-BACKEND-FIX-01 D3: 한 줄 자리에 줄바꿈 글자(CR·LF)가 들어와도 공백으로 — 새 머리글이 생기지 않고 CR 이 나가지 않는다
    expect(mdText("제목\r# 가짜")).toBe("제목 \\# 가짜");
    expect(mdText("a\r\nb\nc")).toBe("a b c");
    expect(kstMinute(new Date("2026-11-19T15:30:00Z"))).toBe("2026-11-20 00:30");
  });
});
