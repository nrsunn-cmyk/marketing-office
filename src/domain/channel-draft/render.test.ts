/**
 * P2G-BACKEND-01: 내보내기 순수 함수 시험. Tester QA-PLAN-P2G-01 R1-1 XSS 사례 X1~X21(Master 지시로 미리 넣음).
 * 출력은 두 가지로 따로 확인한다: ① render.ts 의 unsafeHtmlProblems(정규식) ② 이 파일의 글자 단위 해석기(scan, 독립 구현).
 * scan 은 브라우저처럼 속성 값의 엔티티(&#106; 등)를 풀어 본 뒤 href 를 검사한다.
 */
import { describe, expect, it } from "vitest";
import { isSafeHttpsUrl } from "./constants";
import { SAFE_HTML_TAGS, escapeHtml, exportFileName, imagePlaceholders, postInfo, renderTistoryHtml, toMarkdown, toPlainText, unsafeHtmlProblems } from "./render";

type El = { tag: string; close: boolean; attrs: { name: string; value: string | null }[] };
const decode = (v: string) =>
  v
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);?/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** 글자 단위 HTML 해석(독립 구현). 태그가 아닌 < 는 오류로 본다(우리 출력에는 날것의 < 가 없어야 한다) */
function scan(html: string): { els: El[]; errors: string[] } {
  const els: El[] = [];
  const errors: string[] = [];
  let i = 0;
  while (i < html.length) {
    const c = html[i]!;
    if (c === ">") errors.push(`날것의 > @${i}`);
    if (c !== "<") {
      i++;
      continue;
    }
    let j = i + 1;
    const close = html[j] === "/";
    if (close) j++;
    let name = "";
    while (j < html.length && /[A-Za-z0-9]/.test(html[j]!)) name += html[j++];
    if (!name) {
      errors.push(`태그가 아닌 < @${i}`);
      i++;
      continue;
    }
    const attrs: El["attrs"] = [];
    while (j < html.length && html[j] !== ">") {
      if (/\s|\//.test(html[j]!)) {
        j++;
        continue;
      }
      let an = "";
      while (j < html.length && !/[\s=>/]/.test(html[j]!)) an += html[j++];
      let val: string | null = null;
      if (html[j] === "=") {
        j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1);
          val = html.slice(j + 1, end < 0 ? html.length : end);
          j = end < 0 ? html.length : end + 1;
        } else {
          let v = "";
          while (j < html.length && !/[\s>]/.test(html[j]!)) v += html[j++];
          val = v;
        }
      }
      attrs.push({ name: an.toLowerCase(), value: val === null ? null : decode(val) });
    }
    els.push({ tag: name.toLowerCase(), close, attrs });
    i = j + 1;
  }
  return { els, errors };
}

const allowed = new Set<string>(SAFE_HTML_TAGS);
/** 공통 합격 조건(R1-1). 링크 수를 돌려준다 */
function expectSafe(body: string): { html: string; links: string[] } {
  const html = renderTistoryHtml(body);
  expect(unsafeHtmlProblems(html), html).toEqual([]);
  const { els, errors } = scan(html);
  expect(errors, html).toEqual([]);
  const links: string[] = [];
  for (const e of els) {
    expect(allowed.has(e.tag), `${e.tag} @ ${html}`).toBe(true);
    if (e.close) {
      expect(e.attrs).toEqual([]);
      continue;
    }
    if (e.tag === "a") {
      expect(e.attrs.map((a) => a.name), html).toEqual(["href"]);
      const href = e.attrs[0]!.value!;
      expect(href.startsWith("https://"), href).toBe(true);
      expect(isSafeHttpsUrl(href), href).toBe(true);
      links.push(href);
    } else expect(e.attrs, `${e.tag} 속성 @ ${html}`).toEqual([]);
  }
  expect(html).not.toMatch(/<script|<img|<iframe|<svg|<h1|<style|<object|<embed|<base|<meta|<form|<math|<div/i);
  return { html, links };
}

describe("기본 문법", () => {
  it("소제목·문단·목록·인용·표·강조·링크", () => {
    const body = [
      "## 큰 소제목",
      "첫 줄",
      "둘째 줄",
      "",
      "### 작은 소제목",
      "- 하나",
      "* 둘",
      "",
      "1. 첫째",
      "2. 둘째",
      "",
      "> 인용 한 줄",
      "> 인용 둘",
      "",
      "| 항목 | 값 |",
      "|---|---|",
      "| 가 | **굵게** |",
      "| 나 |",
      "",
      "**굵게** 와 *기울임* 과 [링크](https://a.tistory.com/12?x=1&y=2)",
      "[이미지: 회의 사진 / 대체 글: 회의실]",
    ].join("\n");
    const { html, links } = expectSafe(body);
    expect(html).toBe(
      [
        "<h2>큰 소제목</h2>",
        "<p>첫 줄<br>둘째 줄</p>",
        "<h3>작은 소제목</h3>",
        "<ul><li>하나</li><li>둘</li></ul>",
        "<ol><li>첫째</li><li>둘째</li></ol>",
        "<blockquote><p>인용 한 줄<br>인용 둘</p></blockquote>",
        "<table><thead><tr><th>항목</th><th>값</th></tr></thead><tbody><tr><td>가</td><td><strong>굵게</strong></td></tr><tr><td>나</td><td></td></tr></tbody></table>",
        '<p><strong>굵게</strong> 와 <em>기울임</em> 과 <a href="https://a.tistory.com/12?x=1&amp;y=2">링크</a><br>[이미지: 회의 사진 / 대체 글: 회의실]</p>',
      ].join("\n"),
    );
    expect(links).toEqual(["https://a.tistory.com/12?x=1&y=2"]);
    expect(toPlainText(body)).toContain("링크 (https://a.tistory.com/12?x=1&y=2)");
    expect(imagePlaceholders(body)).toEqual(["회의 사진 / 대체 글: 회의실"]);
    expect(toMarkdown("제목", "본문\r\n둘")).toBe("# 제목\n\n본문\n둘\n");
  });

  it("빈 본문은 빈 조각", () => {
    expect(renderTistoryHtml("")).toBe("");
    expect(toPlainText("  \n\n ")).toBe("");
  });
});

// ── R1-1 X1~X21 ──
const X: [string, string[], number[]][] = [
  ["X1 원시 HTML", ["<script>alert(1)</script>"], [0]],
  ["X2 img onerror", ["<img src=x onerror=alert(1)>"], [0]],
  [
    "X3 위험 요소",
    [
      "<svg onload=alert(1)>",
      '<iframe src="https://evil.com">',
      "<object data=x>",
      "<embed src=x>",
      "<style>body{}</style>",
      "<base href=https://evil.com>",
      '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
      "<form action=https://evil.com>",
      '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    ],
    [0],
  ],
  ["X4 HTML 블록", ["<div>\n<script>alert(1)</script>\n</div>"], [0]],
  ["X5 주석·CDATA", ["<!-- x -->", "<![CDATA[ x ]]>", "<!doctype html>"], [0]],
  [
    "X6 링크 스킴",
    [
      "[x](javascript:alert(1))",
      "[x](JaVaScRiPt:alert(1))",
      "[x](data:text/html,<script>alert(1)</script>)",
      "[x](vbscript:msgbox(1))",
      "[x](file:///c:/)",
      "[x](http://a.com)",
      "[x](//evil.com)",
      "[x](/relative)",
      "[x](#top)",
    ],
    [0],
  ],
  ["X7 스킴 공백·제어 문자", ["[x]( javascript:alert(1))", "[x](\tjavascript:alert(1))", "[x](java\u0000script:alert(1))", "[x](\u200bhttps://a.com)", "[x](https:\u0000//a.com)", "[x](https://a.com/\u0000)"], [0]],
  ["X8 엔티티 우회", ["[x](&#106;avascript:alert(1))", "[x](&#x6A;avascript:alert(1))", "[x](javascript&colon;alert(1))", "[x](https&#58;//a.com)"], [0]],
  ["X9a 퍼센트 스킴", ["[x](%6Aavascript:alert(1))"], [0]],
  ["X9b 퍼센트 경로", ["[x](https://a.com/%22%3E%3Cscript%3E)"], [1]],
  ["X10a 속성 주입(괄호 포함 → 링크 아님)", ["[x](https://a.com/\"onmouseover=\"alert(1))", "[x](https://a.com/' onfocus='alert(1))"], [0]],
  ["X10b 속성 주입(링크 됨, 속성 이스케이프)", ['[x](https://a.com/"><script>alert`1`</script>)', "[x](https://a.com/'onfocus='x')"], [1]],
  ["X11 링크 글 안 HTML", ["[<img src=x onerror=alert(1)>](https://a.com)"], [1]],
  ["X12a 괄호 중첩", ["[x](https://a.com/(y))"], [0]],
  ["X12b 안전한 것만", ["[x](https://a.com) [y](javascript:alert(1))"], [1]],
  ["X12c 겹친 괄호", ["[[x](https://a.com)](javascript:alert(1))"], [1]],
  ["X12d 제목 속성", ['[x](https://a.com "title" onclick=alert(1))'], [0]],
  ["X13 자동 링크", ["<javascript:alert(1)>", "<https://a.com>", "https://a.com"], [0]],
  ["X14 이미지 문법", ["![x](https://a.com/x.png)", "![x](javascript:alert(1))", "[이미지: <script>alert(1)</script>]"], [1, 0, 0]],
  ["X15 강조 안 HTML", ["**<script>alert(1)</script>**", "*<img src=x onerror=alert(1)>*", "**[x](javascript:alert(1))**"], [0]],
  ["X16 소제목·목록·인용", ["## <script>alert(1)</script>", "- <img src=x onerror=alert(1)>", "1. [x](javascript:alert(1))", "> <iframe src=x>", "# <script>alert(1)</script>"], [0]],
  ["X17 표 칸", ["| <script>alert(1)</script> | [x](javascript:alert(1)) |\n|---|---|\n| a | b | c |\n| d \\| e |"], [0]],
  ["X18 유니코드", ["＜script＞alert(1)＜/script＞", "a\u2028## 줄 구분\u2029<script>", "\u202eevil.com", "e\u0301\u0301 😀 🇰🇷"], [0]],
  ["X19 이중 이스케이프", ["&lt;script&gt;", "&amp;lt;", "&#60;script&#62;"], [0]],
];

describe("R1-1 XSS 사례(X1~X19): 모두 허용 태그·a[href](https)만, 입력은 글자로", () => {
  for (const [name, inputs, counts] of X) {
    it(name, () => {
      inputs.forEach((input, k) => {
        const { html, links } = expectSafe(input);
        // 기대 링크 수: 항목마다 적거나, 하나만 적으면 모든 입력에 같게
        expect(links.length, `${input} → ${html}`).toBe(counts.length === 1 ? counts[0] : counts[k]);
        // 입력의 꺾쇠는 늘 이스케이프되어 글자로 남는다
        if (input.includes("<script")) expect(html).toContain("&lt;script");
      });
    });
  }

  it("X10b·X14 링크 개수와 href 이스케이프를 따로 확인", () => {
    const a = renderTistoryHtml('[x](https://a.com/"><script>alert`1`</script>)');
    expect(a).toBe('<p><a href="https://a.com/&quot;&gt;&lt;script&gt;alert`1`&lt;/script&gt;">x</a></p>');
    expect(renderTistoryHtml("![x](https://a.com/x.png)")).toBe('<p>!<a href="https://a.com/x.png">x</a></p>');
    expect(renderTistoryHtml("![x](javascript:alert(1))")).toBe("<p>![x](javascript:alert(1))</p>");
    expect(renderTistoryHtml("[x](https://a.com) [y](javascript:alert(1))")).toBe('<p><a href="https://a.com">x</a> [y](javascript:alert(1))</p>');
    expect(renderTistoryHtml("&lt;script&gt;")).toBe("<p>&amp;lt;script&amp;gt;</p>");
    expect(renderTistoryHtml("# <script>")).toBe("<p># &lt;script&gt;</p>");
  });

  it("X18 \\n 만 줄로 본다(U+2028·U+2029 는 줄이 아님)", () => {
    expect(renderTistoryHtml("a\u2028## b")).toBe("<p>a\u2028## b</p>");
  });
});

describe("X20 큰 입력: 빠르게 끝나고 예외 없음", () => {
  for (const [name, body] of [
    ["별표 20000", "*".repeat(20000)],
    ["여는 대괄호 20000", "[".repeat(20000)],
    ["세로 막대 20000", "|".repeat(20000)],
    ["링크 비슷한 것 반복", "[a](".repeat(5000)],
    ["강조 비슷한 것 반복", "**a*".repeat(5000)],
    ["중첩 인용 1000단계", `${"> ".repeat(1000)}x`],
    ["표 줄 반복", `| a | b |\n|---|---|\n${"| x | y |\n".repeat(2000)}`],
  ] as const) {
    it(name, () => {
      const t = performance.now();
      expectSafe(body);
      toPlainText(body);
      expect(performance.now() - t).toBeLessThan(500);
    });
  }
});

describe("X20b 되감기(QA-P2G-BACKEND-01 O1): 줄 끝 앞 U+2028·표 구분선 공백 19990개도 50ms 안", () => {
  for (const [name, body] of [
    ["목록", `-${" ".repeat(19990)} `],
    ["번호 목록", `1.${" ".repeat(19990)} `],
    ["소제목", `##${" ".repeat(19990)} `],
    ["작은 소제목", `###${" ".repeat(19990)} `],
    ["표 구분선", `| a |\n|---${" ".repeat(19980)}x`],
  ] as const) {
    it(name, () => {
      expectSafe(body);
      const t = performance.now();
      renderTistoryHtml(body);
      toPlainText(body);
      expect(performance.now() - t).toBeLessThan(50);
    });
  }
});

describe("X21 다른 출력", () => {
  const evil = "<script>alert(1)</script>\u0000\r\n../..\\x:*?\"<>|";
  it("toPlainText 는 글자(태그를 만들지 않음 — 화면은 글자로만 보인다)", () => {
    for (const [, inputs] of X) for (const s of inputs) expect(typeof toPlainText(s)).toBe("string");
    expect(toPlainText("[x](https://a.com)")).toBe("x (https://a.com)");
    expect(toPlainText("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))");
  });
  it("postInfo 는 값을 그대로 모은다(이스케이프는 화면 몫, 이미지 자리는 글자)", () => {
    const i = postInfo({ title: evil, tags: ["<b>", "a"], metaDescription: evil, imageNote: evil, body: "[이미지: <img onerror=x>]" });
    expect(i).toEqual({ title: evil, tags: "<b>, a", metaDescription: evil, imageNote: evil, imagePlaceholders: ["<img onerror=x>"] });
  });
  it("exportFileName: 금지 글자·제어 문자 0, 한글 그대로, 150바이트, 예약 이름", () => {
    for (const [, inputs] of X) {
      for (const s of inputs) {
        const n = exportFileName(s, "html");
        expect(n, s).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
        expect(new TextEncoder().encode(n.replace(/\.html$/, "")).length).toBeLessThanOrEqual(150);
      }
    }
    expect(exportFileName(evil, "md")).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
    expect(exportFileName("  티스토리 첫 글.  ", "md")).toBe("티스토리 첫 글.md");
    expect(exportFileName("../../etc/passwd", "txt")).toBe("_.._etc_passwd.txt");
    expect(exportFileName("", "html")).toBe("channel-draft.html");
    expect(exportFileName("...", "html")).toBe("channel-draft.html");
    expect(exportFileName("CON", "html")).toBe("_CON.html");
    expect(exportFileName("가".repeat(100), "html")).toBe(`${"가".repeat(50)}.html`);
    expect(exportFileName("😀".repeat(100), "md")).toBe(`${"😀".repeat(37)}.md`);
  });
});

describe("차단선 자체", () => {
  it("unsafeHtmlProblems 는 나쁜 조각을 잡는다", () => {
    expect(unsafeHtmlProblems("<p>a</p>")).toEqual([]);
    expect(unsafeHtmlProblems("<script>x</script>").length).toBeGreaterThan(0);
    expect(unsafeHtmlProblems('<p class="x">a</p>').length).toBeGreaterThan(0);
    expect(unsafeHtmlProblems('<a href="javascript:alert(1)">x</a>').length).toBeGreaterThan(0);
    expect(unsafeHtmlProblems('<a href="https://a.com" onclick="x">x</a>').length).toBeGreaterThan(0);
    expect(unsafeHtmlProblems("a < b").length).toBeGreaterThan(0);
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
