/**
 * P3C-UI-CONNECT-01 브라우저 → 저장소 서명 업로드(Backend 보고서 6절 2단계).
 * supabase-js uploadToSignedUrl 과 같은 요청(PUT, 본문 = 파일 그대로, content-type·x-upsert·cache-control)을 XHR 로 보내
 * 실제로 보낸 바이트(upload.onprogress)를 화면에 알린다. 임의 %·가짜 진행은 쓰지 않는다(AGY uploadProgressBytes).
 */

import type { UploadStepResult } from "@/features/design-assets/actions";
import { DA_COPY, guessMime, precheckFile, uploadErrorText, type DesignAssetKind } from "./design-assets-model";

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

/** 서명 주소로 파일을 올린다. onProgress(loaded, total)는 실제 보낸 바이트만 */
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
    xhr.setRequestHeader("cache-control", "max-age=3600");
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

// ── 올리기 흐름(준비 → 올리기 → 확정). 화면 부품은 이 함수를 부르고 단계만 그린다 ──

export type UploadPhase = { k: "idle" } | { k: "uploading"; loaded: number; total: number } | { k: "confirming" } | { k: "error"; text: string } | { k: "done"; text: string };
type Ticket = { uploadId: string; path: string; uploadUrl: string; mime: string; expiresAt: string };
export interface UploadActions {
  prepare: (raw: unknown) => Promise<UploadStepResult<Ticket>>;
  confirmCreate: (path: string, raw: unknown) => Promise<UploadStepResult<{ assetId: string }>>;
  confirmReplace: (assetId: string, revision: number, path: string, raw: unknown) => Promise<UploadStepResult<{ revision: number }>>;
}
export interface UploadInput {
  briefId: string;
  /** 교체면 자산, 새것이면 없음 */
  asset?: { id: string; revision: number };
  kind: DesignAssetKind;
  file: Blob & { name: string; size: number; type: string };
  title: string;
  licenseNote: string;
  changeNote: string;
}

/**
 * 한 번 올리기. 단계가 바뀔 때마다 onPhase. 반환값은 마지막 단계.
 * 취소는 onJob 으로 받은 job.cancel() — 올리는 중 취소하면 대기(idle)로 돌아간다(예약은 서버에서 시간이 지나면 닫힌다).
 */
export async function runDesignUpload(
  input: UploadInput,
  deps: { actions: UploadActions; put?: typeof putToSignedUrl; apiKey?: string },
  onPhase: (p: UploadPhase) => void,
  onJob: (j: PutJob | null) => void = () => {},
): Promise<UploadPhase> {
  const end = (p: UploadPhase) => (onPhase(p), p);
  const bad = precheckFile(input.kind, input.file);
  if (bad) return end({ k: "error", text: bad });
  const mime = guessMime(input.file.name, input.file.type);
  const prep = await deps.actions.prepare({ productionBriefId: input.briefId, assetId: input.asset?.id ?? null, kind: input.kind, fileName: input.file.name, size: input.file.size, mime });
  if (!prep.ok) return end({ k: "error", text: uploadErrorText(prep) });
  onPhase({ k: "uploading", loaded: 0, total: input.file.size });
  const job = (deps.put ?? putToSignedUrl)({ url: prep.data.uploadUrl, file: input.file, mime: prep.data.mime, expiresAt: prep.data.expiresAt, apiKey: deps.apiKey }, (loaded, total) =>
    onPhase({ k: "uploading", loaded, total }),
  );
  onJob(job);
  const put = await job.promise;
  onJob(null);
  if (!put.ok) return end(put.reason === "cancelled" ? { k: "idle" } : { k: "error", text: put.reason === "expired" ? DA_COPY.uploadErrExpired : DA_COPY.uploadErrNetwork });
  onPhase({ k: "confirming" });
  if (input.asset) {
    const r = await deps.actions.confirmReplace(input.asset.id, input.asset.revision, prep.data.path, { uploadId: prep.data.uploadId, changeNote: input.changeNote });
    return end(r.ok ? { k: "done", text: DA_COPY.replacedOk } : { k: "error", text: uploadErrorText(r) });
  }
  const r = await deps.actions.confirmCreate(prep.data.path, { uploadId: prep.data.uploadId, title: input.title, licenseNote: input.licenseNote, origin: "external_upload" });
  return end(r.ok ? { k: "done", text: DA_COPY.savedOk } : { k: "error", text: uploadErrorText(r) });
}
