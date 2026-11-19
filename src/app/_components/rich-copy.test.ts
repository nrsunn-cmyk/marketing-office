import { describe, expect, it, vi } from "vitest";
import { copyHtmlSource, copyMessage, copyPlainText, copyRich, downloadExport, safeDownloadName, type ClipboardEnv, type DownloadEnv } from "./rich-copy";

/** P2G-CLIPBOARD-01: 가짜 navigator.clipboard·ClipboardItem 으로 복사·내보내기 도구를 시험한다 */

class FakeItem {
  static supported = new Set(["text/html", "text/plain"]);
  static supports = (t: string) => FakeItem.supported.has(t);
  constructor(public readonly items: Record<string, Blob>) {}
}

function domError(name: string) {
  return Object.assign(new Error(name), { name });
}

function env(opts: { write?: (items: FakeItem[]) => Promise<void>; writeText?: (t: string) => Promise<void>; noItem?: boolean; noWrite?: boolean; noSupports?: boolean } = {}) {
  const writes: FakeItem[][] = [];
  const texts: string[] = [];
  const clipboard = {
    writeText: vi.fn(opts.writeText ?? (async (t: string) => void texts.push(t))),
    ...(opts.noWrite
      ? {}
      : {
          write: vi.fn(
            opts.write ??
              (async (items: FakeItem[]) => {
                writes.push(items);
              }),
          ),
        }),
  };
  let Item: ClipboardEnv["ClipboardItem"] = FakeItem as unknown as ClipboardEnv["ClipboardItem"];
  if (opts.noSupports) Item = class extends FakeItem {} as unknown as ClipboardEnv["ClipboardItem"];
  if (opts.noSupports) (Item as unknown as { supports?: unknown }).supports = undefined;
  const e: ClipboardEnv = { clipboard: clipboard as unknown as ClipboardEnv["clipboard"], ClipboardItem: opts.noItem ? undefined : Item, Blob };
  return { e, clipboard, writes, texts };
}

const INPUT = { html: "<h2>소제목</h2><p>본문 <strong>굵게</strong></p>", text: "소제목\n\n본문 굵게" };

describe("copyRich: 서식째 복사", () => {
  it("ClipboardItem 하나에 text/html·text/plain 두 형식을 받은 그대로 넣는다", async () => {
    const { e, writes, clipboard } = env();
    expect(await copyRich(INPUT, e)).toEqual({ ok: true, mode: "rich" });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toHaveLength(1); // 항목은 하나
    const item = writes[0][0];
    expect(Object.keys(item.items).sort()).toEqual(["text/html", "text/plain"]);
    expect(await item.items["text/html"].text()).toBe(INPUT.html); // HTML 을 고치거나 만들지 않는다
    expect(await item.items["text/plain"].text()).toBe(INPUT.text);
    expect(item.items["text/html"].type).toBe("text/html");
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("클릭 처리 안에서 기다림 없이 바로 write 를 부른다(사용자 동작이 끊기지 않게)", () => {
    const { e, clipboard } = env();
    void copyRich(INPUT, e); // await 하지 않는다
    expect(clipboard.write).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["ClipboardItem 없음", { noItem: true }],
    ["clipboard.write 없음", { noWrite: true }],
  ])("%s → text/plain 만으로 떨어진다", async (_n, o) => {
    const { e, texts } = env(o);
    expect(await copyRich(INPUT, e)).toEqual({ ok: true, mode: "fallback" });
    expect(texts).toEqual([INPUT.text]);
  });

  it("ClipboardItem.supports('text/html') 가 거짓이면 text/plain 만", async () => {
    FakeItem.supported.delete("text/html");
    try {
      const { e, clipboard, texts } = env();
      expect(await copyRich(INPUT, e)).toEqual({ ok: true, mode: "fallback" });
      expect(clipboard.write).not.toHaveBeenCalled();
      expect(texts).toEqual([INPUT.text]);
    } finally {
      FakeItem.supported.add("text/html");
    }
  });

  it("supports 가 없는 옛 구현은 지원한다고 보고 서식째 쓴다", async () => {
    const { e } = env({ noSupports: true });
    expect(await copyRich(INPUT, e)).toEqual({ ok: true, mode: "rich" });
  });

  it("서식째 쓰기가 다른 이유로 실패하면 글자만 한 번 더 시도한다", async () => {
    const { e, texts } = env({ write: async () => Promise.reject(domError("DataError")) });
    expect(await copyRich(INPUT, e)).toEqual({ ok: true, mode: "fallback" });
    expect(texts).toEqual([INPUT.text]);
  });

  it("NotAllowedError(사용자 동작 없음·권한 거부)는 다시 시도하지 않고 denied", async () => {
    const { e, clipboard } = env({ write: async () => Promise.reject(domError("NotAllowedError")) });
    expect(await copyRich(INPUT, e)).toEqual({ ok: false, reason: "denied" });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("글자 대체까지 실패하면 failed", async () => {
    const { e } = env({ write: async () => Promise.reject(domError("DataError")), writeText: async () => Promise.reject(new Error("x")) });
    expect(await copyRich(INPUT, e)).toEqual({ ok: false, reason: "failed" });
  });

  it("ClipboardItem 생성이 예외를 던지면 글자만", async () => {
    const Throwing = class {
      static supports = () => true;
      constructor() {
        throw new TypeError("bad");
      }
    };
    const { e, texts } = env();
    e.ClipboardItem = Throwing as unknown as ClipboardEnv["ClipboardItem"];
    expect(await copyRich(INPUT, e)).toEqual({ ok: true, mode: "fallback" });
    expect(texts).toEqual([INPUT.text]);
  });

  it("클립보드 자체가 없으면 unsupported(브라우저 밖·HTTP 주소)", async () => {
    expect(await copyRich(INPUT, { clipboard: undefined })).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("copyHtmlSource: HTML 모드용 소스 복사", () => {
  it("HTML 소스를 글자로 그대로 넣는다", async () => {
    const { e, texts, clipboard } = env();
    expect(await copyHtmlSource(INPUT.html, e)).toEqual({ ok: true, mode: "plain" });
    expect(texts).toEqual([INPUT.html]);
    expect(clipboard.write).not.toHaveBeenCalled();
  });
  it("거부되면 denied, 클립보드 없으면 unsupported", async () => {
    const { e } = env({ writeText: async () => Promise.reject(domError("NotAllowedError")) });
    expect(await copyHtmlSource("<p>x</p>", e)).toEqual({ ok: false, reason: "denied" });
    expect(await copyHtmlSource("<p>x</p>", {})).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("copyMessage: 안내 문구", () => {
  it("결과마다 한글 안내, 실패는 직접 복사 방법을 알려 준다", () => {
    expect(copyMessage({ ok: true, mode: "rich" })).toBe("서식째 복사했습니다.");
    expect(copyMessage({ ok: true, mode: "fallback" })).toMatch(/^글자만 복사했습니다/);
    expect(copyMessage({ ok: true, mode: "plain" })).toBe("복사했습니다.");
    for (const reason of ["denied", "unsupported", "failed"] as const) expect(copyMessage({ ok: false, reason })).toMatch(/Ctrl\+C/);
  });
});

describe("safeDownloadName: 서버가 준 파일 이름의 마지막 확인", () => {
  it.each([
    ["합성 초안.html", "html", "합성 초안.html"],
    ["합성 초안.md", "md", "합성 초안.md"],
    ["합성 초안.txt", "txt", "합성 초안.txt"],
    ["../위험.html", "html", "채널-초안.html"],
    ["a\\b.md", "md", "채널-초안.md"],
    ["a\u0007b.md", "md", "채널-초안.md"],
    ["줄\n바꿈.md", "md", "채널-초안.md"],
    ["확장자다름.md", "html", "채널-초안.html"],
    ["", "md", "채널-초안.md"],
    [".md", "md", "채널-초안.md"],
  ] as const)("%j(%s) → %s", (name, kind, want) => {
    expect(safeDownloadName(name, kind)).toBe(want);
  });
});

describe("copyPlainText: 글 정보 복사", () => {
  it("받은 글을 그대로 글자로 넣는다(mode plain)", async () => {
    const { e, texts } = env();
    expect(await copyPlainText("태그1, 태그2", e)).toEqual({ ok: true, mode: "plain" });
    expect(texts).toEqual(["태그1, 태그2"]);
  });
});

describe("downloadExport: 파일 내보내기", () => {
  function fakeDom() {
    const anchors: { href: string; download: string; rel: string; style: { display: string }; click: () => void; remove: () => void; clicked: number; removed: number }[] = [];
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    const appended: unknown[] = [];
    const d: DownloadEnv = {
      document: {
        createElement: (() => {
          const a = { href: "", download: "", rel: "", style: { display: "" }, clicked: 0, removed: 0, click() { this.clicked++; }, remove() { this.removed++; } };
          anchors.push(a);
          return a;
        }) as unknown as Document["createElement"],
        body: { appendChild: (n: unknown) => appended.push(n) } as unknown as HTMLElement,
      },
      URL: {
        createObjectURL: (b: Blob) => {
          blobs.push(b);
          return `blob:fake/${blobs.length}`;
        },
        revokeObjectURL: (u: string) => void revoked.push(u),
      } as unknown as DownloadEnv["URL"],
      Blob,
    };
    return { d, anchors, blobs, revoked, appended };
  }

  it(".html 조각: BOM + 받은 HTML 그대로, UTF-8 HTML 형식, 파일 이름·클릭·정리", async () => {
    vi.useFakeTimers();
    try {
      const { d, anchors, blobs, revoked, appended } = fakeDom();
      expect(downloadExport({ fileName: "합성 초안.html", kind: "html", content: INPUT.html }, d)).toBe(true);
      expect(blobs[0].type).toBe("text/html;charset=utf-8");
      const bytes = new Uint8Array(await blobs[0].arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM
      expect(new TextDecoder().decode(bytes.slice(3))).toBe(INPUT.html);
      expect(anchors[0]).toMatchObject({ href: "blob:fake/1", download: "합성 초안.html", rel: "noopener", clicked: 1, removed: 1 });
      expect(appended).toHaveLength(1);
      expect(revoked).toEqual([]); // 바로 풀지 않는다
      vi.runAllTimers();
      expect(revoked).toEqual(["blob:fake/1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it(".txt: text/plain, BOM 없음", async () => {
    const { d, blobs, anchors } = fakeDom();
    expect(downloadExport({ fileName: "합성 초안.txt", kind: "txt", content: "본문" }, d)).toBe(true);
    expect(blobs[0].type).toBe("text/plain;charset=utf-8");
    expect(await blobs[0].text()).toBe("본문");
    expect(anchors[0].download).toBe("합성 초안.txt");
  });

  it(".md: BOM 없이 받은 글 그대로, text/markdown", async () => {
    const { d, blobs, anchors } = fakeDom();
    const md = "## 소제목\n\n| 가 | 나 |\n| --- | --- |\n| 1 | 2 |\n";
    expect(downloadExport({ fileName: "합성 초안.md", kind: "md", content: md }, d)).toBe(true);
    expect(blobs[0].type).toBe("text/markdown;charset=utf-8");
    expect(await blobs[0].text()).toBe(md);
    expect(anchors[0].download).toBe("합성 초안.md");
  });

  it("브라우저가 아니면 false, 도중 오류도 false", () => {
    expect(downloadExport({ fileName: "x.md", kind: "md", content: "" }, null)).toBe(false);
    const { d } = fakeDom();
    d.URL.createObjectURL = () => {
      throw new Error("막힘");
    };
    expect(downloadExport({ fileName: "x.md", kind: "md", content: "" }, d)).toBe(false);
  });
});
