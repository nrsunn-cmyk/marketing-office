/**
 * P2G-BACKEND-01: 채널 초안 내보내기 순수 함수(zod 없음, DB 없음). 설계 3절.
 *
 * 본문은 "제한 마크다운" 글자로 저장된다. 여기서는 줄 단위로 정해진 문법만 알아보고, 나머지는 모두 글자 그대로 둔다.
 * HTML 은 먼저 & < > " ' 를 이스케이프한 뒤 허용 태그만 직접 조립한다(입력의 HTML 은 절대 살아남지 않는다).
 *   나올 수 있는 태그: h2 h3 p br ul ol li blockquote table thead tbody tr th td strong em a
 *   속성: a 의 href 하나뿐(https 주소만). class·style·id·on* 은 없다(티스토리 HTML 모드에 붙여 넣는 조각, RESEARCH-P2G-01).
 * 이미지는 만들지 않는다. [이미지: 설명] 은 글자로 남는다(주인님이 티스토리에서 직접 올린다).
 */
import { isSafeHttpsUrl } from "./constants";

export const SAFE_HTML_TAGS = ["h2", "h3", "p", "br", "ul", "ol", "li", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "strong", "em", "a"] as const;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

const LINK = /\[([^\]\n]{1,500})\]\(([^()\s]{1,2048})\)/y;
const STRONG = /\*\*([^*\n]{1,2000})\*\*/y;
const EM = /\*([^*\n]{1,2000})\*/y;

type Inline = { kind: "text"; text: string } | { kind: "strong" | "em"; text: string } | { kind: "link"; text: string; href: string };

/** 한 줄 안의 강조·링크를 나눈다. https 가 아닌 링크는 글자 그대로 둔다 */
function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) out.push({ kind: "text", text: buf });
    buf = "";
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "[") {
      LINK.lastIndex = i;
      const m = LINK.exec(s);
      if (m && isSafeHttpsUrl(m[2])) {
        flush();
        out.push({ kind: "link", text: m[1]!, href: m[2]! });
        i = LINK.lastIndex;
        continue;
      }
    } else if (c === "*") {
      STRONG.lastIndex = i;
      const sm = STRONG.exec(s);
      if (sm) {
        flush();
        out.push({ kind: "strong", text: sm[1]! });
        i = STRONG.lastIndex;
        continue;
      }
      EM.lastIndex = i;
      const em = EM.exec(s);
      if (em) {
        flush();
        out.push({ kind: "em", text: em[1]! });
        i = EM.lastIndex;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

const inlineHtml = (s: string) =>
  parseInline(s)
    .map((t) =>
      t.kind === "text" ? escapeHtml(t.text) : t.kind === "link" ? `<a href="${escapeHtml(t.href)}">${escapeHtml(t.text)}</a>` : `<${t.kind}>${escapeHtml(t.text)}</${t.kind}>`,
    )
    .join("");
const inlineText = (s: string) =>
  parseInline(s)
    .map((t) => (t.kind === "link" ? `${t.text} (${t.href})` : t.text))
    .join("");

type Block =
  | { kind: "h2" | "h3"; text: string }
  | { kind: "p"; lines: string[] }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

// R1(QA-P2G-BACKEND-01 O1): 내용 칸은 [\s\S] 로 둔다. 줄은 이미 \n 으로 나눴고, `.` 은 U+2028 을 받지 않아
//   공백을 길게 늘인 줄 끝에 U+2028 이 오면 [ \t]+ 와 (.+) 사이 공백 나누기를 모두 되감아 시간이 제곱으로 늘었다
const H3 = /^###[ \t]+([\s\S]+)$/;
const H2 = /^##[ \t]+([\s\S]+)$/;
const UL = /^[-*][ \t]+([\s\S]+)$/;
const OL = /^\d{1,3}\.[ \t]+([\s\S]+)$/;
const QUOTE = /^>[ \t]?([\s\S]*)$/;
// 앞뒤를 지운 줄에 쓴다(끝의 [ \t]* 두 개가 겹쳐 되감던 것을 없앰, R1)
const TABLE_SEP = /^\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?$/;
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** 본문 → 블록. 줄바꿈은 \n 기준(\r 은 지운다) */
export function parseBody(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = H3.exec(line))) {
      blocks.push({ kind: "h3", text: m[1]!.trim() });
      i++;
    } else if ((m = H2.exec(line))) {
      blocks.push({ kind: "h2", text: m[1]!.trim() });
      i++;
    } else if (UL.test(line) || OL.test(line)) {
      const re = UL.test(line) ? UL : OL;
      const items: string[] = [];
      while (i < lines.length && (m = re.exec(lines[i]!))) {
        items.push(m[1]!.trim());
        i++;
      }
      blocks.push({ kind: re === UL ? "ul" : "ol", items });
    } else if (QUOTE.test(line)) {
      const ql: string[] = [];
      while (i < lines.length && (m = QUOTE.exec(lines[i]!))) {
        ql.push(m[1]!);
        i++;
      }
      blocks.push({ kind: "quote", lines: ql });
    } else if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!.trim())) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const r = cells(lines[i]!);
        rows.push(head.map((_, k) => r[k] ?? ""));
        i++;
      }
      blocks.push({ kind: "table", head, rows });
    } else {
      const pl: string[] = [];
      while (
        i < lines.length &&
        lines[i]!.trim() !== "" &&
        !H2.test(lines[i]!) &&
        !H3.test(lines[i]!) &&
        !UL.test(lines[i]!) &&
        !OL.test(lines[i]!) &&
        !QUOTE.test(lines[i]!)
      ) {
        pl.push(lines[i]!);
        i++;
      }
      blocks.push({ kind: "p", lines: pl });
    }
  }
  return blocks;
}

/** 티스토리 HTML 모드에 붙여 넣는 깨끗한 HTML 조각(body 없음) */
export function renderTistoryHtml(body: string): string {
  return parseBody(body)
    .map((b) => {
      switch (b.kind) {
        case "h2":
        case "h3":
          return `<${b.kind}>${inlineHtml(b.text)}</${b.kind}>`;
        case "p":
          return `<p>${b.lines.map((l) => inlineHtml(l.trim())).join("<br>")}</p>`;
        case "ul":
        case "ol":
          return `<${b.kind}>${b.items.map((x) => `<li>${inlineHtml(x)}</li>`).join("")}</${b.kind}>`;
        case "quote":
          return `<blockquote><p>${b.lines.map((l) => inlineHtml(l.trim())).join("<br>")}</p></blockquote>`;
        case "table":
          return (
            `<table><thead><tr>${b.head.map((h) => `<th>${inlineHtml(h)}</th>`).join("")}</tr></thead>` +
            `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
          );
      }
    })
    .join("\n");
}

/** 서식 없는 글자(어느 모드에나 붙일 수 있는 마지막 수단) */
export function toPlainText(body: string): string {
  return parseBody(body)
    .map((b) => {
      switch (b.kind) {
        case "h2":
        case "h3":
          return inlineText(b.text);
        case "p":
        case "quote":
          return b.lines.map((l) => inlineText(l.trim())).join("\n");
        case "ul":
          return b.items.map((x) => `- ${inlineText(x)}`).join("\n");
        case "ol":
          return b.items.map((x, k) => `${k + 1}. ${inlineText(x)}`).join("\n");
        case "table":
          return [b.head, ...b.rows].map((r) => r.map(inlineText).join(" | ")).join("\n");
      }
    })
    .join("\n\n");
}

/** .md 내보내기: 제목 한 줄 + 저장된 본문 그대로 */
export const toMarkdown = (title: string, body: string) => `# ${title}\n\n${body.replace(/\r\n?/g, "\n")}\n`;

const IMAGE_SLOT = /\[이미지:[ \t]*([^\]\n]{1,300})\]/g;
/** 본문의 [이미지: 설명] 자리 목록(티스토리에서 직접 올릴 때 대체 글로 쓴다) */
export const imagePlaceholders = (body: string) => [...body.matchAll(IMAGE_SLOT)].map((m) => m[1]!.trim());

export interface PostInfo {
  title: string;
  tags: string;
  metaDescription: string;
  imageNote: string;
  imagePlaceholders: string[];
}
/** 티스토리 발행 화면에 따로 넣는 글 정보 */
export function postInfo(d: { title: string; tags: string[]; metaDescription: string | null; imageNote: string | null; body: string }): PostInfo {
  return {
    title: d.title,
    tags: d.tags.join(", "),
    metaDescription: d.metaDescription ?? "",
    imageNote: d.imageNote ?? "",
    imagePlaceholders: imagePlaceholders(d.body),
  };
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
/**
 * 내보내기 파일 이름. 한글은 그대로, 경로·예약 글자와 제어 문자는 _ 로, 앞뒤 점·공백 제거, UTF-8 150바이트까지(글자 경계).
 * 비면 channel-draft. 확장자는 html·md·txt 만.
 */
export function exportFileName(title: string, ext: "html" | "md" | "txt"): string {
  let base = title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g, "_").replace(/\s+/g, " ").trim().replace(/^[.\s]+|[.\s]+$/g, "");
  const enc = new TextEncoder();
  let out = "";
  for (const ch of base) {
    if (enc.encode(out + ch).length > 150) break;
    out += ch;
  }
  base = out.replace(/[.\s]+$/g, "");
  if (!base) base = "channel-draft";
  if (RESERVED.test(base.split(".")[0]!)) base = `_${base}`;
  return `${base}.${ext}`;
}

/**
 * 시험용 차단선: HTML 조각에 허용 목록 밖의 태그·속성, 날것의 < > 가 없는지. 문제 목록을 돌려준다(빈 배열이면 통과).
 * renderTistoryHtml 출력은 늘 통과해야 한다.
 */
export function unsafeHtmlProblems(html: string): string[] {
  const problems: string[] = [];
  const allowed = new Set<string>(SAFE_HTML_TAGS);
  const rest = html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>/g, (all, close: string, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    if (!allowed.has(t)) problems.push(`허용 밖 태그 ${t}`);
    const a = attrs.trim();
    if (close) {
      if (a) problems.push(`닫는 태그 속성 ${t}`);
    } else if (t === "a") {
      const m = /^href="([^"]*)"$/.exec(a);
      const href = m?.[1]?.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      if (!m || !isSafeHttpsUrl(href)) problems.push(`a 속성 ${a}`);
    } else if (a) problems.push(`속성 ${t} ${a}`);
    return "";
  });
  if (/[<>]/.test(rest)) problems.push("날것의 < 또는 >");
  return problems;
}

/** unsafeHtmlProblems 가 하나라도 있으면 예외(시험·내보내기 직전 확인용) */
export function assertSafeHtml(html: string): void {
  const p = unsafeHtmlProblems(html);
  if (p.length) throw new Error(`안전하지 않은 HTML: ${p.join(", ")}`);
}
