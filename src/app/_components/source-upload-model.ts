/**
 * SOURCE-UPLOAD-UI-01 자료 파일 브라우저 직접 업로드(Backend SOURCE-UPLOAD-FIX-01 5절).
 * 고르기 → 준비(예약) → 올리기(저장소 서명 주소로 XHR PUT, 실제 보낸 바이트만 진행으로) → 확정(서버가 실제 바이트 검사).
 * 문구는 AGY 확정본 Design/site/SOURCE-UPLOAD-COPY.md 그대로. 근거 없는 %·진행 막대는 두지 않는다.
 * 서버 전용 코드는 가져오지 않는다(type 만).
 */
import type { SourceStepResult } from "@/features/assets/actions";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, extensionOf, type AllowedMime } from "@/domain/assets/file-check";

/** AGY SOURCE_UPLOAD_COPY(그대로) */
export const SOURCE_UPLOAD_COPY = {
  uploadPreparing: "올릴 준비를 하는 중…",
  uploadConfirming: "서버에서 파일 형식과 크기를 확인해 확정하는 중…",
  uploadRetry: "다시 시도",
  uploadCancel: "올리기 취소",
  uploadErrEmpty: "빈 파일은 올릴 수 없습니다. 내용이 있는 파일을 골라 주세요.",
  uploadErrTooLarge: "파일 크기가 한도(10MB)를 넘어 올릴 수 없습니다.",
  uploadErrUnsupportedType: "허용되지 않는 파일 형식입니다. PDF·PNG·JPEG·TXT 파일만 올려 주세요.",
  uploadErrMismatch: "파일 실제 내용이 확장자·크기와 달라 올릴 수 없습니다.",
  uploadErrMissing: "올린 파일을 저장소에서 찾지 못했습니다. 다시 시도를 눌러 주세요.",
  uploadErrNetwork: "네트워크 연결이 끊겨 올리기를 마칠 수 없습니다. 잠시 후 다시 시도해 주세요.",
  uploadErrExpired: "올리기 링크 유효 시간이 지났습니다. 다시 시도를 누르면 새 링크로 올립니다.",
  uploadErrConcurrentLimit: "동시에 올릴 수 있는 작업 수(20개)가 가득 찼습니다. 잠시 후 다시 시도해 주세요.",
  uploadDone: "자료 파일을 올리고 저장을 확인했습니다.",
} as const;

/** "1.2 MB" · "12.0 KB" · "512 B" */
export function formatUploadBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
/** uploadProgressBytes "{loaded} / {total} 올리는 중…"(실측 바이트) */
export const uploadProgressText = (loaded: number, total: number) => `${formatUploadBytes(loaded)} / ${formatUploadBytes(total)} 올리는 중…`;

/** 서버 실패 코드(uploadCode) → 확정 문구. 모르는 코드면 서버 한글 문구 그대로 */
export function sourceUploadErrorText(r: { message: string; uploadCode?: string }): string {
  switch (r.uploadCode) {
    case "EMPTY":
      return SOURCE_UPLOAD_COPY.uploadErrEmpty;
    case "TOO_LARGE":
      return SOURCE_UPLOAD_COPY.uploadErrTooLarge;
    case "UNSUPPORTED_TYPE":
      return SOURCE_UPLOAD_COPY.uploadErrUnsupportedType;
    case "TYPE_MISMATCH":
      return SOURCE_UPLOAD_COPY.uploadErrMismatch;
    case "UPLOAD_MISSING":
      return SOURCE_UPLOAD_COPY.uploadErrMissing;
    case "UPLOAD_EXPIRED":
      return SOURCE_UPLOAD_COPY.uploadErrExpired;
    case "CONCURRENT_LIMIT":
      return SOURCE_UPLOAD_COPY.uploadErrConcurrentLimit;
    default:
      return r.message;
  }
}

/** 고르기 단계에서 미리 막기(빈 파일·10MB 초과·형식). 서버가 다시 막는다. 통과면 null */
export function precheckSourceFile(f: { name: string; size: number }): string | null {
  const ext = extensionOf(f.name);
  const ok = (Object.keys(ALLOWED_TYPES) as AllowedMime[]).some((m) => (ALLOWED_TYPES[m].extensions as readonly string[]).includes(ext));
  if (!ok) return SOURCE_UPLOAD_COPY.uploadErrUnsupportedType;
  if (f.size < 1) return SOURCE_UPLOAD_COPY.uploadErrEmpty;
  if (f.size > MAX_UPLOAD_BYTES) return SOURCE_UPLOAD_COPY.uploadErrTooLarge;
  return null;
}

// ── 저장소 서명 주소 PUT(XHR) ──
export type PutOutcome = { ok: true } | { ok: false; reason: "network" | "expired" | "cancelled" };
/** 응답 → 결과. 링크 유효 시간이 지났거나 저장소가 만료·토큰 오류를 알리면 expired, 그 밖 실패는 network */
export function classifyPut(status: number, body: string, expiresAt: string, now = Date.now()): PutOutcome {
  if (status >= 200 && status < 300) return { ok: true };
  const exp = Date.parse(expiresAt);
  if ((Number.isFinite(exp) && now >= exp) || /expired|jwt|invalid signature|token/i.test(body)) return { ok: false, reason: "expired" };
  return { ok: false, reason: "network" };
}
/** XMLHttpRequest 와 같은 꼴(시험에서 가짜로 바꾼다) */
export interface XhrLike {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  abort(): void;
  status: number;
  responseText: string;
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}
export interface PutJob {
  promise: Promise<PutOutcome>;
  cancel: () => void;
}
/**
 * 서명 주소로 파일을 올린다(Backend 5절: PUT, 본문 파일, content-type 은 준비 결과 mime 그대로(charset 없음), x-upsert false, apikey).
 * onProgress 는 실제 보낸 바이트만.
 */
export function putToSignedUrl(
  opts: { url: string; file: Blob; mime: string; expiresAt: string; apiKey?: string },
  onProgress: (loaded: number, total: number) => void,
  makeXhr: () => XhrLike = () => new XMLHttpRequest() as unknown as XhrLike,
): PutJob {
  const xhr = makeXhr();
  const promise = new Promise<PutOutcome>((resolve) => {
    xhr.open("PUT", opts.url);
    xhr.setRequestHeader("content-type", opts.mime);
    xhr.setRequestHeader("x-upsert", "false");
    if (opts.apiKey) xhr.setRequestHeader("apikey", opts.apiKey);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => resolve(classifyPut(xhr.status, xhr.responseText ?? "", opts.expiresAt));
    xhr.onerror = () => resolve(classifyPut(0, "", opts.expiresAt));
    xhr.onabort = () => resolve({ ok: false, reason: "cancelled" });
    xhr.send(opts.file);
  });
  return { promise, cancel: () => xhr.abort() };
}

// ── 올리기 흐름 ──
export type SourceUploadPhase = { k: "idle" } | { k: "preparing" } | { k: "uploading"; loaded: number; total: number } | { k: "confirming" } | { k: "error"; text: string } | { k: "done"; text: string };
type Ticket = { uploadId: string; path: string; uploadUrl: string; mime: string; expiresAt: string };
export interface SourceUploadActions {
  prepare: (owner: { clientId: string | null; projectId: string | null }, file: { name: string; size: number }) => Promise<SourceStepResult<Ticket>>;
  confirm: (uploadId: string, path: string) => Promise<SourceStepResult<{ id: string }>>;
}

/** 한 번 올리기. 단계가 바뀔 때마다 onPhase, 반환값은 마지막 단계. 올리는 중 취소하면 대기로(예약은 서버에서 시간이 지나면 닫힌다) */
export async function runSourceUpload(
  owner: { clientId: string | null; projectId: string | null },
  file: Blob & { name: string; size: number },
  deps: { actions: SourceUploadActions; put?: typeof putToSignedUrl; apiKey?: string },
  onPhase: (p: SourceUploadPhase) => void,
  onJob: (j: PutJob | null) => void = () => {},
): Promise<SourceUploadPhase> {
  const end = (p: SourceUploadPhase) => (onPhase(p), p);
  const bad = precheckSourceFile(file);
  if (bad) return end({ k: "error", text: bad });
  onPhase({ k: "preparing" });
  const prep = await deps.actions.prepare(owner, { name: file.name, size: file.size });
  if (!prep.ok) return end({ k: "error", text: sourceUploadErrorText(prep) });
  onPhase({ k: "uploading", loaded: 0, total: file.size });
  const job = (deps.put ?? putToSignedUrl)({ url: prep.data.uploadUrl, file, mime: prep.data.mime, expiresAt: prep.data.expiresAt, apiKey: deps.apiKey }, (loaded, total) =>
    onPhase({ k: "uploading", loaded, total }),
  );
  onJob(job);
  const put = await job.promise;
  onJob(null);
  if (!put.ok) return end(put.reason === "cancelled" ? { k: "idle" } : { k: "error", text: put.reason === "expired" ? SOURCE_UPLOAD_COPY.uploadErrExpired : SOURCE_UPLOAD_COPY.uploadErrNetwork });
  onPhase({ k: "confirming" });
  const r = await deps.actions.confirm(prep.data.uploadId, prep.data.path);
  return end(r.ok ? { k: "done", text: SOURCE_UPLOAD_COPY.uploadDone } : { k: "error", text: sourceUploadErrorText(r) });
}
