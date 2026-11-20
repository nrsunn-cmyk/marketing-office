/**
 * QA-P3E-PREP-01(Tester): P3-e 내보내기(.pptx·.md·파일 이름) 공격 시험. 구현 모듈이 없으면 건너뛴다(이름은 ./qa-p3e-names.ts).
 * Backend 시험과 다른 방법으로 독립 확인한다:
 *  - zip 은 로컬 머리글을 앞에서부터 차례로 읽고 중앙 디렉터리와 대조(이름·크기·CRC·오프셋)
 *  - XML 은 글자 단위로 읽는 엄격 파서(이름 규칙, 속성 따옴표·중복, 엔티티·문자 참조, XML 1.0 글자, 선언된 이름공간 접두사, 뿌리 1개, DTD 금지, 내용 속 ]]> 금지)
 *  - OPC: [Content_Types] 첫 항목·모든 파트 형식, 모든 관계 대상 존재·외부 링크 0, 슬라이드 목록 id, 메모 슬라이드 수, 개인정보 칸 0
 * 모든 값은 합성.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { crc32, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { modulePath, modulePresent, P3E } from "./qa-p3e-names";

type Slide = {
  id: string;
  title: string;
  bullets: string | null;
  notes: string | null;
  assets: Array<{ asset_id: string; version_no: number }>;
};
type Input = {
  title: string;
  templateKey: string;
  status: "drafting" | "reviewed";
  versionNo: number;
  slides: Slide[];
  assetNames: Map<string, string>;
  exportedAt: Date;
};
type Text = {
  safeDownloadName: (t: string, fb: string, max?: number) => string;
  attachmentHeader: (name: string, ascii: string) => string;
  xmlText: (s: string) => string;
};
const present = (["text", "md", "pptx", "zip", "domain"] as const).every(
  modulePresent,
);
const load = async <T>(k: keyof typeof P3E.modules) =>
  (await import(/* @vite-ignore */ pathToFileURL(modulePath(k)).href)) as T;
const L = P3E.limits;
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ───────────── zip(로컬 머리글 순서대로 + 중앙 디렉터리 대조) ─────────────
type Entry = { name: string; data: Buffer };
function readZip(buf: Uint8Array): Entry[] {
  const b = Buffer.from(buf);
  const out: Entry[] = [];
  let p = 0;
  while (b.readUInt32LE(p) === 0x04034b50) {
    const flags = b.readUInt16LE(p + 6);
    const method = b.readUInt16LE(p + 8);
    const crc = b.readUInt32LE(p + 14);
    const csize = b.readUInt32LE(p + 18);
    const usize = b.readUInt32LE(p + 22);
    const nlen = b.readUInt16LE(p + 26);
    const xlen = b.readUInt16LE(p + 28);
    expect(flags & 0x0008, "데이터 설명자(크기 뒤에 쓰기)를 쓰지 않아야").toBe(
      0,
    );
    expect(flags & 0x0001, "암호화 0").toBe(0);
    const name = b.subarray(p + 30, p + 30 + nlen).toString("latin1");
    const raw = b.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + csize);
    const data =
      method === 0
        ? Buffer.from(raw)
        : method === 8
          ? inflateRawSync(raw)
          : (() => {
              throw new Error(`압축 방식 ${method}`);
            })();
    expect(data.length, name).toBe(usize);
    expect(crc32(data) >>> 0, name).toBe(crc);
    out.push({ name, data });
    p += 30 + nlen + xlen + csize;
  }
  // 중앙 디렉터리
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd, "끝 레코드").toBeGreaterThan(0);
  expect(b.length - eocd, "끝 레코드 뒤 주석 0").toBe(22);
  const total = b.readUInt16LE(eocd + 10);
  const cdSize = b.readUInt32LE(eocd + 12);
  let c = b.readUInt32LE(eocd + 16);
  expect(c, "중앙 디렉터리는 로컬 항목 바로 뒤").toBe(p);
  expect(c + cdSize, "중앙 디렉터리 크기").toBe(eocd);
  expect(total).toBe(out.length);
  let off = 0;
  for (const e of out) {
    expect(b.readUInt32LE(c)).toBe(0x02014b50);
    const nlen = b.readUInt16LE(c + 28);
    const xlen = b.readUInt16LE(c + 30);
    const klen = b.readUInt16LE(c + 32);
    expect(b.subarray(c + 46, c + 46 + nlen).toString("latin1")).toBe(e.name);
    expect(b.readUInt32LE(c + 16) >>> 0).toBe(crc32(e.data) >>> 0);
    expect(b.readUInt32LE(c + 42), `${e.name} 오프셋`).toBe(off);
    off +=
      30 +
      b.readUInt16LE(off + 26) +
      b.readUInt16LE(off + 28) +
      b.readUInt32LE(off + 18);
    c += 46 + nlen + xlen + klen;
  }
  return out;
}

// ───────────── 엄격 XML 파서(글자 단위) ─────────────
type El = {
  name: string;
  attrs: Record<string, string>;
  children: El[];
  text: string;
};
const NAME_START = /[A-Za-z_À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/;
const NAME_CHAR = /[-.0-9·̀-ͯ‿⁀A-Za-z_À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�:]/;
const validXmlCp = (cp: number) =>
  cp === 0x9 ||
  cp === 0xa ||
  cp === 0xd ||
  (cp >= 0x20 && cp <= 0xd7ff) ||
  (cp >= 0xe000 && cp <= 0xfffd) ||
  (cp >= 0x10000 && cp <= 0x10ffff);
function parseXml(where: string, src: string): El {
  const fail = (i: number, why: string): never => {
    throw new Error(
      `${where}: ${why} @${i} «${src.slice(Math.max(0, i - 20), i + 30)}»`,
    );
  };
  for (let i = 0; i < src.length;) {
    const cp = src.codePointAt(i)!;
    if (cp >= 0xd800 && cp <= 0xdfff) fail(i, "짝 없는 서로게이트");
    if (!validXmlCp(cp)) fail(i, `XML 1.0 불가 글자 U+${cp.toString(16)}`);
    i += cp > 0xffff ? 2 : 1;
  }
  let i = 0;
  if (!src.startsWith("<?xml ")) fail(0, "XML 선언으로 시작해야");
  const decl = src.indexOf("?>");
  if (
    !/^<\?xml version="1\.0" encoding="UTF-8"( standalone="yes")?\?>$/.test(
      src.slice(0, decl + 2),
    )
  )
    fail(0, "XML 선언 모양");
  i = decl + 2;
  const decode = (s: string, at: number) =>
    s.replace(/&([^;]*);?/g, (m, body: string) => {
      if (!m.endsWith(";")) fail(at, `끝나지 않은 참조 ${m}`);
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      };
      if (body in named && Object.hasOwn(named, body)) return named[body];
      const num = /^#(\d+)$/.exec(body) ?? /^#x([0-9A-Fa-f]+)$/.exec(body);
      if (!num) fail(at, `모르는 엔티티 &${body};`);
      const cp = parseInt(num![1], body.startsWith("#x") ? 16 : 10);
      if (!validXmlCp(cp)) fail(at, `불가 문자 참조 &${body};`);
      return String.fromCodePoint(cp);
    });
  const readName = () => {
    const s = i;
    if (!NAME_START.test(src[i] ?? "") && src[i] !== ":")
      fail(i, "이름 시작 글자");
    i++;
    while (i < src.length && NAME_CHAR.test(src[i])) i++;
    return src.slice(s, i);
  };
  const ws = () => {
    const s = i;
    while (/[ \t\r\n]/.test(src[i] ?? "")) i++;
    return i > s;
  };
  const skipMisc = () => {
    for (;;) {
      ws();
      if (src.startsWith("<!--", i)) {
        const e = src.indexOf("-->", i + 4);
        if (e < 0 || src.slice(i + 4, e).includes("--")) fail(i, "주석");
        i = e + 3;
      } else if (src.startsWith("<?", i)) {
        const e = src.indexOf("?>", i);
        if (e < 0) fail(i, "처리 명령");
        i = e + 2;
      } else return;
    }
  };
  const nsStack: Array<Set<string>> = [new Set(["xml", "xmlns"])];
  const declared = (p: string) => nsStack.some((s) => s.has(p));
  const element = (): El => {
    if (src[i] !== "<") fail(i, "< 기대");
    i++;
    const name = readName();
    const attrs: Record<string, string> = {};
    let selfClose = false;
    for (;;) {
      const had = ws();
      if (src.startsWith("/>", i)) {
        i += 2;
        selfClose = true;
        break;
      }
      if (src[i] === ">") {
        i++;
        break;
      }
      if (!had) fail(i, "속성 앞 공백");
      const an = readName();
      ws();
      if (src[i] !== "=") fail(i, "= 기대");
      i++;
      ws();
      const q = src[i];
      if (q !== '"' && q !== "'") fail(i, "속성 따옴표");
      const e = src.indexOf(q, i + 1);
      if (e < 0) fail(i, "속성 끝");
      const raw = src.slice(i + 1, e);
      if (raw.includes("<")) fail(i, "속성 값 안 <");
      if (Object.hasOwn(attrs, an)) fail(i, `속성 중복 ${an}`);
      attrs[an] = decode(raw, i);
      i = e + 1;
    }
    const scope = new Set<string>();
    for (const k of Object.keys(attrs))
      if (k.startsWith("xmlns:")) scope.add(k.slice(6));
    nsStack.push(scope);
    const pfx = (n: string) => (n.includes(":") ? n.split(":")[0] : null);
    for (const n of [
      name,
      ...Object.keys(attrs).filter((k) => !k.startsWith("xmlns")),
    ]) {
      const p = pfx(n);
      if (p && !declared(p)) fail(i, `선언 안 된 접두사 ${p}`);
    }
    const el: El = { name, attrs, children: [], text: "" };
    if (!selfClose) {
      for (;;) {
        if (i >= src.length) fail(i, `${name} 닫히지 않음`);
        if (src.startsWith("</", i)) {
          i += 2;
          const n = readName();
          ws();
          if (src[i] !== ">") fail(i, "닫는 태그 >");
          i++;
          if (n !== name) fail(i, `닫는 태그 ${n} ≠ ${name}`);
          break;
        }
        if (src.startsWith("<![CDATA[", i))
          fail(i, "CDATA(사용자 글은 요소 내용으로만)");
        if (src.startsWith("<!--", i) || src.startsWith("<?", i)) {
          skipMisc();
          continue;
        }
        if (src.startsWith("<!", i)) fail(i, "DTD·선언 금지");
        if (src[i] === "<") {
          el.children.push(element());
          continue;
        }
        const e = src.indexOf("<", i);
        const raw = src.slice(i, e < 0 ? src.length : e);
        if (raw.includes("]]>")) fail(i, "내용 속 ]]>");
        el.text += decode(raw, i);
        i += raw.length;
      }
    }
    nsStack.pop();
    return el;
  };
  skipMisc();
  if (src.startsWith("<!", i)) fail(i, "DTD 금지");
  const root = element();
  skipMisc();
  if (i !== src.length) fail(i, "뿌리 뒤 남은 내용");
  return root;
}
const walk = (e: El, f: (x: El) => void) => {
  f(e);
  e.children.forEach((c) => walk(c, f));
};
const texts = (e: El) => {
  const out: string[] = [];
  walk(e, (x) => x.name === "a:t" && out.push(x.text));
  return out;
};

// ───────────── OPC 묶음 검사 ─────────────
function checkPackage(
  entries: Entry[],
  slideCount: number,
  notesCount: number,
) {
  const names = entries.map((e) => e.name);
  expect(new Set(names).size, "zip 이름 중복").toBe(names.length);
  for (const n of names)
    expect(
      /^[\x21-\x7e]+$/.test(n) &&
        !n.startsWith("/") &&
        !n.includes("\\") &&
        !n.split("/").includes(".."),
      `안전한 zip 경로 ${n}`,
    ).toBe(true);
  expect(names[0]).toBe("[Content_Types].xml");
  const xml = new Map<string, El>();
  for (const e of entries) {
    expect(
      e.data.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
      `${e.name} BOM 0`,
    ).toBe(false);
    xml.set(
      e.name,
      parseXml(
        e.name,
        new TextDecoder("utf-8", { fatal: true }).decode(e.data),
      ),
    );
  }
  // 형식
  const ct = xml.get("[Content_Types].xml")!;
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const c of ct.children) {
    if (c.name === "Default")
      defaults.set(c.attrs.Extension.toLowerCase(), c.attrs.ContentType);
    else if (c.name === "Override")
      overrides.set(c.attrs.PartName, c.attrs.ContentType);
  }
  for (const n of names.slice(1)) {
    const t =
      overrides.get(`/${n}`) ?? defaults.get(n.split(".").pop()!.toLowerCase());
    expect(t, `${n} 형식 없음`).toBeTruthy();
  }
  for (const p of overrides.keys())
    expect(names, `Override 대상 ${p} 없음`).toContain(p.slice(1));
  // 관계
  const resolve = (base: string, target: string) => {
    const parts = (
      target.startsWith("/") ? target.slice(1) : base + target
    ).split("/");
    const out: string[] = [];
    for (const s of parts) {
      if (s === "..") out.pop();
      else if (s !== ".") out.push(s);
    }
    return out.join("/");
  };
  const relsOf = new Map<
    string,
    Map<string, { type: string; target: string }>
  >();
  for (const n of names.filter((x) => x.endsWith(".rels"))) {
    const src =
      n === "_rels/.rels" ? "" : n.replace(/_rels\/([^/]+)\.rels$/, "$1");
    const base = src.includes("/")
      ? src.slice(0, src.lastIndexOf("/") + 1)
      : "";
    const ids = new Map<string, { type: string; target: string }>();
    for (const r of xml.get(n)!.children) {
      expect(r.attrs.TargetMode, `${n} 외부 링크`).toBeUndefined();
      expect(ids.has(r.attrs.Id), `${n} Id 중복`).toBe(false);
      const t = resolve(base, r.attrs.Target);
      expect(names, `${n} → ${r.attrs.Target} 없음`).toContain(t);
      ids.set(r.attrs.Id, { type: r.attrs.Type.split("/").pop()!, target: t });
    }
    relsOf.set(src, ids);
  }
  const main = [...relsOf.get("")!.values()].find(
    (r) => r.type === "officeDocument",
  );
  expect(main?.target).toBe("ppt/presentation.xml");
  // 슬라이드 목록
  const pres = xml.get("ppt/presentation.xml")!;
  const ids: El[] = [];
  walk(pres, (x) => x.name === "p:sldId" && ids.push(x));
  expect(ids).toHaveLength(slideCount);
  const presRels = relsOf.get("ppt/presentation.xml")!;
  const nums = ids.map((x) => Number(x.attrs.id));
  expect(new Set(nums).size).toBe(nums.length);
  for (const n of nums)
    expect(n >= 256 && n < 2147483648, `sldId ${n}`).toBe(true);
  const order = ids.map((x) => presRels.get(x.attrs["r:id"])?.target);
  expect(order).toEqual(
    Array.from(
      { length: slideCount },
      (_, k) => `ppt/slides/slide${k + 1}.xml`,
    ),
  );
  for (const x of ids)
    expect(presRels.get(x.attrs["r:id"])?.type).toBe("slide");
  expect(
    names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)),
  ).toHaveLength(notesCount);
  // 개인정보 칸 0
  const core = xml.get("docProps/core.xml");
  if (core) {
    const pii: string[] = [];
    walk(
      core,
      (x) =>
        ["dc:creator", "cp:lastModifiedBy"].includes(x.name) &&
        x.text.trim() !== "" &&
        pii.push(x.name),
    );
    expect(pii).toEqual([]);
  }
  return { xml, presRels };
}

/** XML 1.0 에 못 쓰는 글자를 뺀 기대값(내보내기가 빼야 하는 것) */
const sanitize = (s: string) =>
  s.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "",
  );
const ATTACK = `<a:t>]]>&amp;&<"'</a:t><!--x--><![CDATA[y]]><?pi?>&#0;&#x1;\u0001\u000B￾￿\uD800끝👍🏽é‮ltr ·tab\t`;

const base = (o: Partial<Input> = {}): Input => ({
  title: "합성 발표",
  templateKey: "royal_grid",
  status: "drafting",
  versionNo: 3,
  slides: [
    { id: uuid(1), title: "표지", bullets: null, notes: null, assets: [] },
    {
      id: uuid(2),
      title: "본문",
      bullets: "첫 요점\n둘째 요점",
      notes: "메모",
      assets: [{ asset_id: uuid(90), version_no: 2 }],
    },
  ],
  assetNames: new Map([[uuid(90), "합성 로고"]]),
  exportedAt: new Date("2026-11-20T05:05:00Z"),
  ...o,
});

describe.skipIf(!present)("P3-e 내보내기 공격 시험", () => {
  it("ES1 공격 글(XML 특수 문자·]]>·CDATA·주석·제어 문자·짝 없는 서로게이트·이모지·RTL) × 템플릿 3종 → 유효 zip·OOXML, 글은 그대로(불가 글자만 빠짐)", async () => {
    const { buildPptx } = await load<{ buildPptx: (i: Input) => Uint8Array }>(
      "pptx",
    );
    for (const t of P3E.templates) {
      const input = base({
        templateKey: t,
        title: `제목${ATTACK}`,
        slides: [
          {
            id: uuid(1),
            title: `표지${ATTACK}`,
            bullets: `부제${ATTACK}`,
            notes: `메모${ATTACK}`,
            assets: [],
          },
          {
            id: uuid(2),
            title: `본문${ATTACK}`,
            bullets: `요점1${ATTACK}\n\n  \n요점2 <b>굵게</b>`,
            notes: `메모1${ATTACK}\n메모2`,
            assets: [{ asset_id: uuid(90), version_no: 2 }],
          },
        ],
        assetNames: new Map([[uuid(90), `자산${ATTACK}`]]),
      });
      const entries = readZip(buildPptx(input));
      const { xml } = checkPackage(entries, 2, 2);
      const s2 = texts(xml.get("ppt/slides/slide2.xml")!).join("\n");
      expect(s2, t).toContain(sanitize(`본문${ATTACK}`));
      expect(s2, t).toContain(sanitize(`요점1${ATTACK}`).trimEnd());
      expect(s2, t).toContain("요점2 <b>굵게</b>");
      expect(s2, t).toContain(sanitize(`자산${ATTACK}`));
      expect(
        texts(xml.get("ppt/notesSlides/notesSlide2.xml")!).join("\n"),
        t,
      ).toContain(sanitize(`메모1${ATTACK}`));
      expect(texts(xml.get("ppt/slides/slide1.xml")!).join("\n"), t).toContain(
        sanitize(`표지${ATTACK}`),
      );
      // 사용자 글이 요소 내용 밖(속성·태그)으로 새지 않음: 원본 바이트에 맨 <a:t>]]> 가 글로 나타나지 않는다
      const raw = entries.map((e) => e.data.toString("utf8")).join("");
      expect(raw.includes("<![CDATA[y")).toBe(false);
      expect(raw.includes("<!--x-->")).toBe(false);
    }
  });

  it("E4 일반 구성: 장 수·순서·제목·요점 줄(빈 줄 건너뜀)·메모 슬라이드는 메모 있는 장만·템플릿별 테마 색이 다름", async () => {
    const { buildPptx } = await load<{ buildPptx: (i: Input) => Uint8Array }>(
      "pptx",
    );
    const sl: Slide[] = Array.from({ length: 5 }, (_, k) => ({
      id: uuid(k + 1),
      title: `제목 ${k + 1}`,
      bullets: k === 0 ? null : `가\n\n나 ${k}`,
      notes: k % 2 ? `메모 ${k}` : null,
      assets: [],
    }));
    const themes = new Set<string>();
    for (const t of P3E.templates) {
      const entries = readZip(buildPptx(base({ templateKey: t, slides: sl })));
      const { xml } = checkPackage(entries, 5, 2);
      for (let k = 0; k < 5; k++)
        expect(texts(xml.get(`ppt/slides/slide${k + 1}.xml`)!)).toContain(
          `제목 ${k + 1}`,
        );
      const body = texts(xml.get("ppt/slides/slide3.xml")!);
      expect(body.indexOf("가")).toBeLessThan(body.indexOf("나 2"));
      expect(body).not.toContain("");
      const th = entries.find((e) =>
        /^ppt\/theme\/theme\d+\.xml$/.test(e.name),
      )!;
      themes.add(
        th.data
          .toString("utf8")
          .match(/srgbClr val="[0-9A-Fa-f]{6}"/g)!
          .join(","),
      );
    }
    expect(themes.size, "템플릿 3종의 테마 색이 서로 달라야").toBe(3);
  });

  it("ES7 상한: 40장 × 제목 100·요점 1000(줄 200개)·메모 1000·자산 10(이름 100자) → 유효, 4.5MB 미만, 시간 기록", async () => {
    const { buildPptx } = await load<{ buildPptx: (i: Input) => Uint8Array }>(
      "pptx",
    );
    const names = new Map<string, string>();
    const sl: Slide[] = Array.from({ length: L.slides }, (_, k) => ({
      id: uuid(k + 1),
      title: "가".repeat(L.slideTitle),
      bullets: Array.from({ length: 200 }, () => "&<>")
        .join("\n")
        .slice(0, L.bullets),
      notes: "😀".repeat(L.notes),
      assets: Array.from({ length: L.assetsPerSlide }, (_, j) => {
        const id = uuid(1000 + k * 10 + j);
        names.set(id, "자".repeat(100));
        return { asset_id: id, version_no: j + 1 };
      }),
    }));
    for (const t of P3E.templates) {
      const t0 = performance.now();
      const bytes = buildPptx(
        base({
          templateKey: t,
          title: "가".repeat(L.deckTitle),
          slides: sl,
          assetNames: names,
        }),
      );
      const ms = performance.now() - t0;
      const entries = readZip(bytes);
      checkPackage(entries, L.slides, L.slides);
      const unz = entries.reduce((n, e) => n + e.data.length, 0);
      console.info(
        `[QA-P3E 상한] ${t}: ${bytes.length}바이트(압축 전 ${unz}) ${ms.toFixed(0)}ms`,
      );
      expect(bytes.length).toBeLessThan(L.responseBytes);
      expect(ms).toBeLessThan(5000);
    }
  });

  it("ES3 템플릿 이름 주입: __proto__·constructor·toString·hasOwnProperty·경로·대문자 → 조회 null, pptx·md 만들기 거절", async () => {
    const d = await load<{
      pptTemplateOf: (k: string) => unknown;
      PPT_TEMPLATES: object;
    }>("domain");
    const { buildPptx } = await load<{ buildPptx: (i: Input) => Uint8Array }>(
      "pptx",
    );
    const { buildDeckMarkdown } = await load<{
      buildDeckMarkdown: (i: Input) => string;
    }>("md");
    expect(Object.isFrozen(d.PPT_TEMPLATES)).toBe(true);
    const keys = [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "valueOf",
      "../royal_grid",
      "royal_grid/../brand_deck",
      "ROYAL_GRID",
      "royal_grid ",
      "",
    ];
    const leaked: string[] = [];
    for (const k of keys) {
      if (d.pptTemplateOf(k) !== null) leaked.push(`조회 ${k}`);
      try {
        buildPptx(base({ templateKey: k }));
        leaked.push(`pptx ${k}`);
      } catch {
        /* 거절이 맞다 */
      }
      try {
        buildDeckMarkdown(base({ templateKey: k }));
        leaked.push(`md ${k}`);
      } catch {
        /* 거절이 맞다 */
      }
    }
    expect(leaked).toEqual([]);
    for (const k of P3E.templates) expect(d.pptTemplateOf(k)).not.toBeNull();
  });

  it("ES2 .md: 특수 문자 이스케이프(링크·이미지·HTML·표·강조·수식·목록), 줄 구조가 사용자 글로 늘지 않음, UTF-8·BOM 0·CR 0", async () => {
    const { buildDeckMarkdown } = await load<{
      buildDeckMarkdown: (i: Input) => string;
    }>("md");
    const evil =
      '# 가짜 [링크](http://x.test) ![그림](y.png) <script>alert(1)</script> | 표 | `코드` *강조* _밑줄_ ~취소~ =HYPERLINK("x") +cmd -rm 1. 목록 \\끝';
    const md = buildDeckMarkdown(
      base({
        title: evil,
        slides: [
          {
            id: uuid(1),
            title: evil,
            bullets: `${evil}\n  - 들여쓴 줄\n\n> 인용`,
            notes: `${evil}\n# 메모 제목`,
            assets: [{ asset_id: uuid(90), version_no: 2 }],
          },
        ],
        assetNames: new Map([[uuid(90), evil]]),
      }),
    );
    expect(md.charCodeAt(0)).not.toBe(0xfeff);
    expect(md.includes("\r")).toBe(false);
    const SPECIAL = new Set([..."\\`*_{}[]<>()#+-.!|~"]);
    /** 사용자 글 부분에서 특수 문자는 모두 홀수 개 \ 뒤에 와야 한다 */
    const unescaped = (s: string) => {
      const bad: string[] = [];
      for (let k = 0; k < s.length; k++) {
        if (s[k] === "\\") {
          k++;
          continue;
        }
        if (SPECIAL.has(s[k])) bad.push(s[k]);
      }
      return bad;
    };
    const lines = md.split("\n");
    const user = [
      lines.find((l) => l.startsWith("# "))!.slice(2),
      lines.find((l) => l.startsWith("## 1. "))!.slice(6),
      ...lines
        .filter(
          (l) =>
            l.startsWith("- ") &&
            !l.startsWith("- 템플릿") &&
            !l.startsWith("- 내보낸"),
        )
        .map((l) => l.slice(2)),
      ...lines
        .filter((l) => l.startsWith("> "))
        .map((l) => l.replace(/^> (발표자 메모: )?/, "")),
      lines
        .find((l) => l.startsWith("사용 디자인 자산: "))!
        .slice("사용 디자인 자산: ".length)
        .replace(/ \(v2\)$/, ""),
    ];
    for (const u of user)
      expect(unescaped(u), `이스케이프 안 된 글자: ${u.slice(0, 60)}`).toEqual(
        [],
      );
    // 구조: 제목 줄 1개, 슬라이드 제목 1개, 요점 3줄, 메모 2줄
    expect(lines.filter((l) => /^# /.test(l))).toHaveLength(1);
    expect(lines.filter((l) => /^## /.test(l))).toHaveLength(1);
    expect(user).toHaveLength(2 + 3 + 2 + 1);
    expect(md).not.toMatch(/<script>|\]\(http|!\[/);
  });

  // D3(Tester, 낮음): DB(app.ppt_text_ok)는 CR 을 허용하고 .md 는 CR 을 그대로 내보낸다. 앱 스키마(clean)는 \r\n→\n 으로 바꾸지만
  //   로그인 사용자가 RPC 를 직접 부르면 CR 이 든 글이 저장되고 .md 의 'LF 만' 약속이 깨진다. 고쳐지면 it 으로 바꾼다.
  it.fails(
    "D3 .md 에 CR 이 나가지 않음(DB 에 CR 이 든 글이 저장된 경우)",
    async () => {
      const { buildDeckMarkdown } = await load<{
        buildDeckMarkdown: (i: Input) => string;
      }>("md");
      const md = buildDeckMarkdown(
        base({
          title: "제목\r# 가짜",
          slides: [
            {
              id: uuid(1),
              title: "슬라이드",
              bullets: "요점\r\n둘째",
              notes: "메모\r끝",
              assets: [],
            },
          ],
        }),
      );
      expect(md.includes("\r")).toBe(false);
    },
  );

  it("ES2 .md 줄바꿈 주입: 제목에 줄바꿈이 들어와도 새 머리글·목록이 생기지 않음", async () => {
    const { buildDeckMarkdown } = await load<{
      buildDeckMarkdown: (i: Input) => string;
    }>("md");
    const md = buildDeckMarkdown(
      base({
        title: "제목\n# 가짜 제목\n- 가짜 요점",
        slides: [
          {
            id: uuid(1),
            title: "슬라이드\n## 2. 가짜",
            bullets: null,
            notes: null,
            assets: [],
          },
        ],
      }),
    );
    const lines = md.split("\n");
    expect(
      lines.filter((l) => l.startsWith("#")),
      "머리글 줄",
    ).toHaveLength(2);
    expect(
      lines.filter((l) => l.startsWith("- ")).length,
      "목록 줄(템플릿·시각 2줄만)",
    ).toBe(2);
  });

  it("ES6 파일 이름: ..·/·\\·금지 문자·제어·방향 문자 → _, 앞뒤 점·공백 제거, 60 코드 포인트, 비면 대체, 255바이트 이하", async () => {
    const t = await load<Text>("text");
    const fb = P3E.fallbackName;
    const cases: Array<[string, (r: string) => boolean, string]> = [
      [
        "../../etc/passwd",
        (r) => !r.includes("/") && !r.includes(".."),
        "경로",
      ],
      [
        "..\\..\\win.ini",
        (r) => !r.includes("\\") && !r.includes(".."),
        "역슬래시 경로",
      ],
      ['con:"*?<>|', (r) => !/[:"*?<>|]/.test(r), "금지 문자"],
      [
        "a\u0000b\u001fc\u007fd",
        (r) => !/[\u0000-\u001f\u007f]/.test(r),
        "제어 문자",
      ],
      ["보고서‮gpj.exe", (r) => !/[‪-‮⁦-⁩‎‏]/.test(r), "방향 바꾸기"],
      [
        "  ...앞뒤 점... ",
        (r) => r === "앞뒤 점" || (!/^[.\s]|[.\s]$/.test(r) && r.length > 0),
        "앞뒤 점",
      ],
      ["가".repeat(200), (r) => [...r].length === L.fileName, "60자"],
      [
        "😀".repeat(100),
        (r) =>
          [...r].length === L.fileName &&
          !/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/.test(
            r.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""),
          ),
        "서로게이트 안 자름",
      ],
      ["....", (r) => r === fb, "점만"],
      ["   ", (r) => r === fb, "공백만"],
      ["///", (r) => r === fb, "금지 문자만"],
      ["", (r) => r === fb, "빈 글"],
      ["한글 발표 자료", (r) => r === "한글 발표 자료", "한글 그대로"],
    ];
    const bad: string[] = [];
    for (const [input, ok, label] of cases) {
      const r = t.safeDownloadName(input, fb);
      if (!ok(r))
        bad.push(`${label}: ${JSON.stringify(input)} → ${JSON.stringify(r)}`);
      const full = `${r}-v${L.versions}.pptx`;
      if (Buffer.byteLength(full) > 255)
        bad.push(`${label}: ${Buffer.byteLength(full)}바이트`);
    }
    expect(bad).toEqual([]);
  });

  it("ES6 Content-Disposition: ASCII 대체 이름에 사용자 글 없음, 잘못된 대체 이름은 거절, filename* 은 퍼센트 인코딩으로 원래 이름 복원", async () => {
    const t = await load<Text>("text");
    const name = t.safeDownloadName(
      '발표 "자료" ; filename=evil.exe\r\nX-Inject: 1',
      P3E.fallbackName,
    );
    const h = t.attachmentHeader(`${name}-v3.pptx`, "ppt-deck-v3.pptx");
    expect(
      h.startsWith(
        "attachment; filename=\"ppt-deck-v3.pptx\"; filename*=UTF-8''",
      ),
    ).toBe(true);
    expect(/[\r\n]/.test(h)).toBe(false);
    const v = h.split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(v)).toBe(`${name}-v3.pptx`);
    expect(
      v.includes(";") || v.includes('"') || v.includes(" "),
      "filename* 값 안 구분 글자",
    ).toBe(false);
    for (const badAscii of [
      'a"b.pptx',
      "한글.pptx",
      "a;b.pptx",
      "a b.pptx",
      "a\r\nb.pptx",
    ])
      expect(() => t.attachmentHeader("x.pptx", badAscii), badAscii).toThrow();
  });

  // D2(Tester, 낮음): RFC 5987 attr-char 는 ' ( ) * 를 허용하지 않는데 encodeURIComponent 는 이 글자를 그대로 둔다. 제목에 ' ( ) 가 있으면 filename* 값이 규격 밖이 된다(대부분 브라우저는 받아 줌). 고쳐지면 it 으로 바꾼다.
  it.fails(
    "D2 filename* 값이 RFC 5987 attr-char·%XX 만으로 이뤄짐(제목에 ' ( ) 가 있을 때)",
    async () => {
      const t = await load<Text>("text");
      const name = t.safeDownloadName("고객's 발표 (최종)", P3E.fallbackName);
      const v = t
        .attachmentHeader(`${name}-v1.pptx`, "ppt-deck-v1.pptx")
        .split("filename*=UTF-8''")[1];
      expect(v).toMatch(/^(?:%[0-9A-F]{2}|[A-Za-z0-9!#$&+.^_`|~-])+$/);
    },
  );

  it("X11 내보내기 모듈: 외부 주소·fetch·파일 읽기·프로세스 실행 0(OOXML 이름공간 주소만)", () => {
    const bad: string[] = [];
    for (const k of ["text", "md", "pptx", "zip", "route"] as const) {
      if (!modulePresent(k)) continue;
      const src = readFileSync(modulePath(k), "utf8");
      for (const m of src.matchAll(/https?:\/\/[^\s"'`)]+/g))
        if (
          !/^http:\/\/(schemas\.openxmlformats\.org|purl\.org|www\.w3\.org|schemas\.microsoft\.com)\//.test(
            m[0],
          )
        )
          bad.push(`${k}: ${m[0]}`);
      for (const pat of [
        /\bfetch\(/,
        /readFile|createReadStream|readdir/,
        /child_process|spawn\(|exec\(/,
        /\beval\(|new Function\(/,
      ])
        if (pat.test(src)) bad.push(`${k}: ${pat}`);
    }
    expect(bad).toEqual([]);
  });
});
