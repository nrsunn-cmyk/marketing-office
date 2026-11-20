import { PPT_STATUS_LABELS, pptTemplateOf, type PptDeckStatus, type PptTemplate, type StoredSlide } from "@/domain/ppt-decks";
import { kstMinute, xmlText } from "./text";
import { zip, type ZipEntry } from "./zip";

/**
 * P3E-BACKEND-IMPL-01: .pptx 만들기(새 의존성 0, Master 결정 D1 A안). 최소 OOXML(PresentationML) 묶음을 직접 쓴다.
 * - 템플릿 값·좌표·글자 크기는 AGY P3E-TEMPLATES.md 그대로(PPT_TEMPLATES 상수). 템플릿은 키로 조회만 — 경로·파일 읽기 없음(ES3).
 * - 사용자 글(제목·요점·메모·자산 이름)은 xmlText 하나로만, 늘 <a:t> 요소 내용으로 넣는다(속성·CDATA 없음, ES1).
 * - 1번 슬라이드 = 표지(레이아웃 1), 나머지 = 본문(레이아웃 2). 메모가 있으면 메모 슬라이드. 끝 장을 따로 더하지 않는다(장 수 = 판의 장 수).
 * - 이미지 넣지 않음(D2): 본문 아래에 "사용 디자인 자산: 이름 (v판)" 글만.
 * - 개인정보 0: docProps 에는 구성안 제목만(만든 사람·회사 칸 없음).
 */
export interface PptxInput {
  title: string;
  templateKey: string;
  status: PptDeckStatus;
  versionNo: number;
  slides: readonly StoredSlide[];
  /** 자산 id → 이름(같은 프로젝트 자산, 읽기 권한 안에서 찾은 것) */
  assetNames: ReadonlyMap<string, string>;
  exportedAt: Date;
}

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const PNS = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;

// 16:9, 1 in = 914400 EMU (AGY 1.3 표)
const W = 12192000;
const H = 6858000;
const FONT = '<a:latin typeface="Arial"/><a:ea typeface="맑은 고딕"/><a:cs typeface="맑은 고딕"/>';

type Box = { x: number; y: number; w: number; h: number };
const BOX = {
  coverBar: { x: 685800, y: 1828800, w: 1097280, h: 73152 },
  coverTitle: { x: 685800, y: 2057400, w: 10820400, h: 1645920 },
  coverSub: { x: 685800, y: 3886200, w: 10820400, h: 1005840 },
  bodyBand: { x: 0, y: 0, w: W, h: 54864 },
  bodyTitle: { x: 685800, y: 457200, w: 10820400, h: 777240 },
  bodyRule: { x: 685800, y: 1298448, w: 10820400, h: 18288 },
  bodyText: { x: 685800, y: 1508760, w: 10820400, h: 4343400 },
  footLeft: { x: 685800, y: 6035040, w: 9326880, h: 411480 },
  footRight: { x: 10195560, y: 6035040, w: 1310640, h: 411480 },
} satisfies Record<string, Box>;

const xfrm = (b: Box) => `<a:xfrm><a:off x="${b.x}" y="${b.y}"/><a:ext cx="${b.w}" cy="${b.h}"/></a:xfrm>`;
const fill = (hex: string) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
const grpHead = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const bg = (hex: string) => `<p:bg><p:bgPr>${fill(hex)}<a:effectLst/></p:bgPr></p:bg>`;

/** 색 막대(글 없음) */
const rect = (id: number, name: string, b: Box, hex: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill(hex)}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;

type Para = { text: string; sz: number; color: string; bold?: boolean; bullet?: boolean; spacing?: number; align?: "l" | "r" };
const run = (p: Para) =>
  `<a:r><a:rPr lang="ko-KR" altLang="en-US" sz="${p.sz}"${p.bold ? ' b="1"' : ""} dirty="0">${fill(p.color)}${FONT}</a:rPr><a:t>${xmlText(p.text)}</a:t></a:r>`;
const para = (p: Para) => {
  const attrs = `${p.align === "r" ? ' algn="r"' : ""}${p.bullet ? ' marL="285750" indent="-285750"' : ""}`;
  const inner = `${p.spacing ? `<a:lnSpc><a:spcPct val="${p.spacing}"/></a:lnSpc>` : ""}${p.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : "<a:buNone/>"}`;
  return `<a:p><a:pPr${attrs}>${inner}</a:pPr>${p.text ? run(p) : ""}<a:endParaRPr lang="ko-KR" altLang="en-US" sz="${p.sz}" dirty="0"/></a:p>`;
};
/** 글 상자. 사용자 글은 para → run → xmlText 로만 들어간다 */
const textBox = (id: number, name: string, b: Box, paras: readonly Para[], anchor: "t" | "ctr" | "b" = "t") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
  `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${(paras.length ? paras : [{ text: "", sz: 1600, color: "000000" }]).map(para).join("")}</p:txBody></p:sp>`;

const lines = (s: string | null) => (s ?? "").split("\n").map((x) => x.trimEnd()).filter((x) => x.trim() !== "");

function assetLine(s: StoredSlide, names: ReadonlyMap<string, string>): string | null {
  if (!s.assets.length) return null;
  return `사용 디자인 자산: ${s.assets.map((a) => `${names.get(a.asset_id) ?? "알 수 없는 자산"} (v${a.version_no})`).join(", ")}`;
}

function slideXml(i: number, input: PptxInput, t: PptTemplate): string {
  const s = input.slides[i];
  const n = input.slides.length;
  const isCover = i === 0;
  const isLast = i === n - 1;
  const when = kstMinute(input.exportedAt);
  const shapes: string[] = [];
  const asset = assetLine(s, input.assetNames);
  if (isCover) {
    shapes.push(rect(2, "Accent", BOX.coverBar, t.coverAccent));
    shapes.push(textBox(3, "Title", BOX.coverTitle, [{ text: s.title, sz: 3600, color: t.coverTitle, bold: true }]));
    const sub: Para[] = lines(s.bullets).map((x) => ({ text: x, sz: 1400, color: t.coverSub }));
    sub.push({ text: `템플릿: ${t.label} · 판: v${input.versionNo} · 상태: ${PPT_STATUS_LABELS[input.status]}`, sz: 1400, color: t.coverSub });
    sub.push({ text: `내보낸 시각: ${when} (KST)`, sz: 1400, color: t.coverSub });
    shapes.push(textBox(4, "Subtitle", BOX.coverSub, sub));
    if (asset) shapes.push(textBox(5, "Assets", BOX.footLeft, [{ text: asset, sz: 1050, color: t.coverSub }], "b"));
  } else {
    shapes.push(rect(2, "Band", BOX.bodyBand, t.accent));
    shapes.push(textBox(3, "Title", BOX.bodyTitle, [{ text: s.title, sz: 2400, color: t.bodyTitle, bold: true }], "ctr"));
    shapes.push(rect(4, "Rule", BOX.bodyRule, t.border));
    shapes.push(textBox(5, "Body", BOX.bodyText, lines(s.bullets).map((x) => ({ text: x, sz: 1600, color: t.bodyText, bullet: true, spacing: 135000 }))));
    const foot: Para[] = [];
    if (asset) foot.push({ text: asset, sz: 1050, color: t.mutedText });
    // 끝 장은 따로 만들지 않고 마지막 슬라이드 아래에 기준 판 1줄(AGY 3.2)
    if (isLast) foot.push({ text: `기준 판: v${input.versionNo} · 총 ${n}장 · ${when} (KST)`, sz: 1050, color: t.mutedText });
    if (foot.length) shapes.push(textBox(6, "Footer", BOX.footLeft, foot, "b"));
    shapes.push(textBox(7, "Page", BOX.footRight, [{ text: `${i + 1} / ${n}`, sz: 1050, color: t.mutedText, align: "r" }], "b"));
  }
  return `${HEAD}<p:sld ${PNS}><p:cSld>${bg(isCover ? t.coverBg : t.bodyBg)}<p:spTree>${grpHead}${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function notesXml(text: string): string {
  const paras = text
    .split("\n")
    .map((x) => `<a:p><a:r><a:rPr lang="ko-KR" altLang="en-US" dirty="0"/><a:t>${xmlText(x)}</a:t></a:r></a:p>`)
    .join("");
  return `${HEAD}<p:notes ${PNS}><p:cSld><p:spTree>${grpHead}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

function themeXml(name: string, scheme: readonly string[]): string {
  const slots = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  const clr = slots.map((s, i) => `<a:${s}><a:srgbClr val="${scheme[i]}"/></a:${s}>`).join("");
  const font = (k: string) => `<a:${k}><a:latin typeface="Arial"/><a:ea typeface="맑은 고딕"/><a:cs typeface="맑은 고딕"/></a:${k}>`;
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const ln = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${solid}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  return (
    `${HEAD}<a:theme xmlns:a="${NS_A}" name="${name}"><a:themeElements><a:clrScheme name="${name}">${clr}</a:clrScheme>` +
    `<a:fontScheme name="${name}">${font("majorFont")}${font("minorFont")}</a:fontScheme>` +
    `<a:fmtScheme name="${name}"><a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst><a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
  );
}

const CLR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const lvl1 = (sz: number) => `<a:lvl1pPr><a:defRPr sz="${sz}">${FONT}</a:defRPr></a:lvl1pPr>`;
const rels = (items: ReadonlyArray<[string, string, string]>) =>
  `${HEAD}<Relationships xmlns="${NS_REL}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join("")}</Relationships>`;

/** .pptx 바이트. 템플릿 키가 3종이 아니면 오류(경로로 쓰지 않는다) */
export function buildPptx(input: PptxInput): Uint8Array {
  const t = pptTemplateOf(input.templateKey);
  if (!t) throw new Error("알 수 없는 템플릿입니다");
  const n = input.slides.length;
  if (n < 1 || n > 40) throw new Error("슬라이드 수가 범위를 벗어났습니다");
  const withNotes = input.slides.map((s, i) => (s.notes && s.notes.trim() ? i : -1)).filter((i) => i >= 0);
  const files: ZipEntry[] = [];

  const overrides = [
    ["/ppt/presentation.xml", `${CT}.presentationml.presentation.main+xml`],
    ["/ppt/slideMasters/slideMaster1.xml", `${CT}.presentationml.slideMaster+xml`],
    ["/ppt/slideLayouts/slideLayout1.xml", `${CT}.presentationml.slideLayout+xml`],
    ["/ppt/slideLayouts/slideLayout2.xml", `${CT}.presentationml.slideLayout+xml`],
    ["/ppt/notesMasters/notesMaster1.xml", `${CT}.presentationml.notesMaster+xml`],
    ["/ppt/theme/theme1.xml", `${CT}.theme+xml`],
    ["/ppt/theme/theme2.xml", `${CT}.theme+xml`],
    ["/ppt/presProps.xml", `${CT}.presentationml.presProps+xml`],
    ["/ppt/viewProps.xml", `${CT}.presentationml.viewProps+xml`],
    ["/ppt/tableStyles.xml", `${CT}.presentationml.tableStyles+xml`],
    ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
    ["/docProps/app.xml", `${CT}.extended-properties+xml`],
    ...input.slides.map((_, i) => [`/ppt/slides/slide${i + 1}.xml`, `${CT}.presentationml.slide+xml`]),
    ...withNotes.map((i) => [`/ppt/notesSlides/notesSlide${i + 1}.xml`, `${CT}.presentationml.notesSlide+xml`]),
  ];
  // [Content_Types].xml 을 첫 항목으로(일부 프로그램이 순서를 본다)
  files.push({
    name: "[Content_Types].xml",
    data: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map(([p, c]) => `<Override PartName="${p}" ContentType="${c}"/>`).join("")}</Types>`,
  });
  files.push({
    name: "_rels/.rels",
    data: `${HEAD}<Relationships xmlns="${NS_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  });
  const iso = input.exportedAt.toISOString().replace(/\.\d{3}Z$/, "Z");
  files.push({
    name: "docProps/core.xml",
    data: `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(input.title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`,
  });
  files.push({
    name: "docProps/app.xml",
    data: `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office PowerPoint</Application><PresentationFormat>와이드스크린</PresentationFormat><Slides>${n}</Slides><Notes>${withNotes.length}</Notes></Properties>`,
  });

  // 발표 자료 본체: 마스터 → 메모 마스터 → 슬라이드 목록 → 크기(스키마 순서)
  const presRels: Array<[string, string, string]> = [
    ["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
    ["rId2", "theme", "theme/theme1.xml"],
    ["rId3", "presProps", "presProps.xml"],
    ["rId4", "viewProps", "viewProps.xml"],
    ["rId5", "tableStyles", "tableStyles.xml"],
    ["rId6", "notesMaster", "notesMasters/notesMaster1.xml"],
    ...input.slides.map((_, i): [string, string, string] => [`rId${100 + i}`, "slide", `slides/slide${i + 1}.xml`]),
  ];
  files.push({
    name: "ppt/presentation.xml",
    data: `${HEAD}<p:presentation ${PNS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId6"/></p:notesMasterIdLst><p:sldIdLst>${input.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${100 + i}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle>${lvl1(1800)}</p:defaultTextStyle></p:presentation>`,
  });
  files.push({ name: "ppt/_rels/presentation.xml.rels", data: rels(presRels) });
  files.push({ name: "ppt/presProps.xml", data: `${HEAD}<p:presentationPr ${PNS}/>` });
  files.push({ name: "ppt/viewProps.xml", data: `${HEAD}<p:viewPr ${PNS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>` });
  files.push({ name: "ppt/tableStyles.xml", data: `${HEAD}<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>` });
  files.push({ name: "ppt/theme/theme1.xml", data: themeXml(t.label, t.scheme) });
  files.push({ name: "ppt/theme/theme2.xml", data: themeXml("메모", t.scheme) });

  // 마스터·레이아웃(그림 없이 배경만, 실제 모양은 슬라이드가 그린다)
  files.push({
    name: "ppt/slideMasters/slideMaster1.xml",
    data: `${HEAD}<p:sldMaster ${PNS}><p:cSld>${bg(t.bodyBg)}<p:spTree>${grpHead}</p:spTree></p:cSld>${CLR_MAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>${lvl1(2400)}</p:titleStyle><p:bodyStyle>${lvl1(1600)}</p:bodyStyle><p:otherStyle>${lvl1(1050)}</p:otherStyle></p:txStyles></p:sldMaster>`,
  });
  files.push({ name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "slideLayout", "../slideLayouts/slideLayout2.xml"], ["rId3", "theme", "../theme/theme1.xml"]]) });
  for (const [k, type, name] of [[1, "title", "표지"], [2, "obj", "제목 및 내용"]] as const) {
    files.push({
      name: `ppt/slideLayouts/slideLayout${k}.xml`,
      data: `${HEAD}<p:sldLayout ${PNS} type="${type}" preserve="1"><p:cSld name="${name}"><p:spTree>${grpHead}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    });
    files.push({ name: `ppt/slideLayouts/_rels/slideLayout${k}.xml.rels`, data: rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]) });
  }
  files.push({
    name: "ppt/notesMasters/notesMaster1.xml",
    data: `${HEAD}<p:notesMaster ${PNS}><p:cSld><p:spTree>${grpHead}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR"/></a:p></p:txBody></p:sp></p:spTree></p:cSld>${CLR_MAP}<p:notesStyle>${lvl1(1200)}</p:notesStyle></p:notesMaster>`,
  });
  files.push({ name: "ppt/notesMasters/_rels/notesMaster1.xml.rels", data: rels([["rId1", "theme", "../theme/theme2.xml"]]) });

  input.slides.forEach((s, i) => {
    files.push({ name: `ppt/slides/slide${i + 1}.xml`, data: slideXml(i, input, t) });
    const r: Array<[string, string, string]> = [["rId1", "slideLayout", `../slideLayouts/slideLayout${i === 0 ? 1 : 2}.xml`]];
    if (s.notes && s.notes.trim()) {
      r.push(["rId2", "notesSlide", `../notesSlides/notesSlide${i + 1}.xml`]);
      files.push({ name: `ppt/notesSlides/notesSlide${i + 1}.xml`, data: notesXml(s.notes) });
      files.push({ name: `ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`, data: rels([["rId1", "notesMaster", "../notesMasters/notesMaster1.xml"], ["rId2", "slide", `../slides/slide${i + 1}.xml`]]) });
    }
    files.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: rels(r) });
  });
  return zip(files);
}

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
