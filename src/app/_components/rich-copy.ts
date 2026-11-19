/**
 * P2G-CLIPBOARD-01 채널 초안(티스토리 수동 게시) 복사·내보내기 도구. 근거 Plan/Claude-Plan-Audit-20261119/RESEARCH-P2G-01.md.
 *
 * - 이 도구는 HTML 을 만들지 않는다. 서버 순수 함수가 조립한 HTML 문자열과 서식 없는 글을 받아 그대로 전달만 한다.
 * - 브라우저 전용 동작이지만 화면 코드와 떨어진 순수 함수라, 클립보드·문서 객체를 바깥에서 넣어(env) 시험한다.
 * - 클릭 처리 안에서 **기다림(await) 없이 바로** 부른다. Firefox·Safari 는 최근 사용자 동작이 있어야 클립보드에 쓸 수 있다(MDN).
 */

export type CopyResult =
  /** rich = 서식째, plain = 처음부터 글자만, fallback = 서식 복사가 안 되어 글자만 */
  | { ok: true; mode: "rich" | "plain" | "fallback" }
  | { ok: false; reason: "unsupported" | "denied" | "failed" };

/** 클립보드 쪽 바깥 의존. 기본값은 브라우저 전역 */
export type ClipboardEnv = {
  clipboard?: Pick<Clipboard, "writeText"> & Partial<Pick<Clipboard, "write">>;
  ClipboardItem?: {
    new (items: Record<string, Blob>): ClipboardItem;
    supports?: (type: string) => boolean;
  };
  Blob?: typeof Blob;
};

function browserClipboard(): ClipboardEnv {
  const g = globalThis as typeof globalThis & { ClipboardItem?: ClipboardEnv["ClipboardItem"] };
  return {
    clipboard: typeof navigator !== "undefined" ? navigator.clipboard : undefined,
    ClipboardItem: g.ClipboardItem,
    Blob: typeof Blob !== "undefined" ? Blob : undefined,
  };
}

function failure(e: unknown): CopyResult {
  const name = (e as { name?: unknown } | null)?.name;
  return { ok: false, reason: name === "NotAllowedError" ? "denied" : "failed" };
}

async function writePlain(clipboard: NonNullable<ClipboardEnv["clipboard"]>, text: string, mode: "plain" | "fallback" = "plain"): Promise<CopyResult> {
  try {
    await clipboard.writeText(text);
    return { ok: true, mode };
  } catch (e) {
    return failure(e);
  }
}

/**
 * 서식째 복사: ClipboardItem 하나에 text/html 과 text/plain 을 함께 넣는다(여러 항목은 첫 항목만 쓰이는 운영체제가 있어 하나로).
 * ClipboardItem·write 가 없거나 text/html 을 지원하지 않으면 text/plain 만 쓴다(mode "fallback").
 * 서식째 쓰기가 실패해도 사용자 동작이 끊긴 게 아니면(NotAllowedError 가 아니면) 글자만 한 번 더 시도한다.
 */
export function copyRich(input: { html: string; text: string }, env: ClipboardEnv = browserClipboard()): Promise<CopyResult> {
  const { clipboard, ClipboardItem: Item, Blob: B } = env;
  if (!clipboard) return Promise.resolve({ ok: false, reason: "unsupported" });
  const richOk = !!(Item && B && clipboard.write) && (Item!.supports ? Item!.supports("text/html") : true);
  if (!richOk) return writePlain(clipboard, input.text, "fallback");

  let pending: Promise<void>;
  try {
    // 동기 구간: 클릭 직후 바로 write 를 부른다(사이에 await 없음)
    const item = new Item!({
      "text/html": new B!([input.html], { type: "text/html" }),
      "text/plain": new B!([input.text], { type: "text/plain" }),
    });
    pending = clipboard.write!([item]);
  } catch {
    return writePlain(clipboard, input.text, "fallback");
  }
  return pending.then(
    (): CopyResult => ({ ok: true, mode: "rich" }),
    (e) => ((e as { name?: unknown } | null)?.name === "NotAllowedError" ? failure(e) : writePlain(clipboard, input.text, "fallback")),
  );
}

/** 글자만 복사(제목·태그·메타 설명 같은 글 정보, 또는 HTML 모드에 붙여 넣을 HTML 소스) */
export function copyPlainText(text: string, env: ClipboardEnv = browserClipboard()): Promise<CopyResult> {
  if (!env.clipboard) return Promise.resolve({ ok: false, reason: "unsupported" });
  return writePlain(env.clipboard, text);
}
/** HTML 소스 복사: 티스토리 HTML 모드에 붙여 넣을 소스를 글자(text/plain)로 넣는다 */
export const copyHtmlSource = copyPlainText;

/** 결과 안내 문구(AGY 확정본 COPY-P2G-01 1절) */
export function copyMessage(r: CopyResult): string {
  if (r.ok) return r.mode === "rich" ? "서식째 복사했습니다. 티스토리 기본 모드에 붙여 넣으세요." : r.mode === "fallback" ? "서식 복사를 지원하지 않는 브라우저라 글자만 복사했습니다." : "복사했습니다.";
  if (r.reason === "denied") return "브라우저가 복사를 막았습니다. 단추를 다시 누르거나 아래 글 상자에서 Ctrl+C로 복사해 주세요.";
  if (r.reason === "unsupported") return "이 브라우저에서는 자동 복사를 쓸 수 없습니다. 아래 글 상자에서 Ctrl+C로 복사해 주세요.";
  return "복사하지 못했습니다. 아래 글 상자에서 Ctrl+C로 복사해 주세요.";
}

// ── 파일 내보내기 ──────────────────────────────────────────────

export type ExportKind = "html" | "md" | "txt";

const MIME: Record<ExportKind, string> = {
  html: "text/html;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  txt: "text/plain;charset=utf-8",
};
// .html 조각에는 <meta charset> 이 없으므로 내려받은 파일을 브라우저로 열 때 한글이 깨지지 않게 BOM 을 붙인다(내용은 바꾸지 않음)
const BOM = "\uFEFF";

/**
 * 파일 이름은 서버가 정한 값(export.fileNames)을 그대로 쓴다. 이 도구는 마지막 확인만 한다:
 * 경로 구분자·제어 문자가 섞였거나 확장자가 다르거나 비었으면 "채널-초안.<확장자>"로 바꾼다.
 */
export function safeDownloadName(name: string, kind: ExportKind): string {
  const ok = name.length > 0 && name.length <= 200 && !/[\\/\u0000-\u001f\u007f]/.test(name) && name.toLowerCase().endsWith(`.${kind}`) && name !== `.${kind}`;
  return ok ? name : `채널-초안.${kind}`;
}

export type DownloadEnv = {
  document: Pick<Document, "createElement" | "body">;
  URL: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  Blob: typeof Blob;
};

function browserDownload(): DownloadEnv | null {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") return null;
  return { document, URL, Blob };
}

/** 받은 글을 그대로 파일로 내려받게 한다. 성공하면 true, 브라우저가 아니거나 실패하면 false */
export function downloadExport(
  input: { fileName: string; kind: ExportKind; content: string },
  env: DownloadEnv | null = browserDownload(),
): boolean {
  if (!env) return false;
  try {
    const body = input.kind === "html" ? BOM + input.content : input.content;
    const url = env.URL.createObjectURL(new env.Blob([body], { type: MIME[input.kind] }));
    const a = env.document.createElement("a");
    a.href = url;
    a.download = safeDownloadName(input.fileName, input.kind);
    a.rel = "noopener";
    a.style.display = "none";
    env.document.body.appendChild(a);
    a.click();
    a.remove();
    // 클릭 직후 바로 풀면 내려받기가 끊기는 브라우저가 있어 다음 차례에 푼다
    setTimeout(() => env.URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}
