import { describe, expect, it, vi } from "vitest";
import { DA_COPY } from "./design-assets-model";
import { putToSignedUrl, type UploadPhase, type XhrLike } from "./design-upload";
import { runVideoUpload, type VideoUploadActions } from "./video-upload";

/** P3D-UI-CONNECT-01 영상 첨부 흐름: 미리 거르기 → 예약 → XHR PUT(실제 바이트) → 확정, 실패·취소면 예약 닫기 */

function fakeXhr() {
  const x = {
    headers: {} as Record<string, string>,
    url: "",
    status: 0,
    responseText: "",
    upload: { onprogress: null as XhrLike["upload"]["onprogress"] },
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    open(_m: string, u: string) {
      x.url = u;
    },
    setRequestHeader(k: string, v: string) {
      x.headers[k] = v;
    },
    send() {},
    abort() {
      x.onabort?.();
    },
  };
  return x;
}
const file = (name: string, size: number, type: string) => {
  const b = new Blob([new Uint8Array(8)]);
  Object.defineProperty(b, "size", { value: size });
  Object.defineProperty(b, "type", { value: type });
  Object.defineProperty(b, "name", { value: name });
  return b as Blob & { name: string; size: number; type: string };
};
const P = "vvvvvvvv-vvvv-4vvv-8vvv-000000000001";
const TICKET = { uploadId: "11111111-1111-4111-8111-111111111111", path: "ws/video-files/1111.mp4", uploadUrl: "https://sb.example/storage/v1/object/upload/sign/video-files/ws/video-files/1111.mp4?token=t", mime: "video/mp4", expiresAt: "2999-01-01T00:00:00Z" };
const actions = (x: Partial<VideoUploadActions> = {}): VideoUploadActions => ({
  start: vi.fn(async () => ({ ok: true as const, data: TICKET })),
  finish: vi.fn(async () => ({ ok: true as const, data: { revision: 6 } })),
  cancel: vi.fn(async () => ({ ok: true as const, data: null })),
  ...x,
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const run = (a: VideoUploadActions, x: ReturnType<typeof fakeXhr>, f = file("intro.mp4", 30 * 1024 * 1024, "video/mp4")) => {
  const phases: UploadPhase[] = [];
  const p = runVideoUpload({ planId: P, revision: 5, file: f, changeNote: "자막 보정" }, { actions: a, put: (o, onP) => putToSignedUrl(o, onP, () => x as unknown as XhrLike), apiKey: "pk" }, (ph) => phases.push(ph));
  return { p, phases };
};

describe("영상 파일 첨부 흐름", () => {
  it("예약 값(Backend 4절) → 올리는 중(바이트) → 확정 중 → 첨부됨, 확정은 planId·revision·경로·uploadId·버전 메모", async () => {
    const a = actions();
    const x = fakeXhr();
    const { p, phases } = run(a, x);
    await flush();
    expect(a.start).toHaveBeenCalledWith({ planId: P, fileName: "intro.mp4", size: 30 * 1024 * 1024, mime: "video/mp4" });
    expect(x.url).toBe(TICKET.uploadUrl);
    expect(x.headers["content-type"]).toBe("video/mp4");
    x.upload.onprogress?.({ loaded: 10, total: 20, lengthComputable: true });
    x.status = 200;
    x.onload?.();
    expect(await p).toEqual({ k: "done", text: "새 영상 파일 버전을 첨부했습니다." });
    expect(a.finish).toHaveBeenCalledWith(P, 5, TICKET.path, { uploadId: TICKET.uploadId, changeNote: "자막 보정" });
    expect(a.cancel).not.toHaveBeenCalled();
    expect(phases.map((ph) => ph.k)).toEqual(["uploading", "uploading", "confirming", "done"]);
  });

  it("미리 거르기(50MB 초과·형식)에서 떨어지면 서버를 부르지 않는다", async () => {
    const a = actions();
    expect(await run(a, fakeXhr(), file("big.mp4", 50 * 1024 * 1024 + 1, "video/mp4")).p).toEqual({ k: "error", text: "파일 크기가 한도(50.0 MB)를 넘어 올릴 수 없습니다." });
    expect(await run(a, fakeXhr(), file("a.avi", 10, "video/x-msvideo")).p).toEqual({ k: "error", text: "허용되지 않는 파일 형식입니다. MP4·MOV·WEBM 파일만 올려 주세요." });
    expect(a.start).not.toHaveBeenCalled();
  });

  it("올리기 끊김·만료·취소는 예약을 닫고(cancel), 확정 실패는 서버 문구 그대로", async () => {
    const a1 = actions();
    const x1 = fakeXhr();
    const r1 = run(a1, x1);
    await flush();
    x1.onerror?.();
    expect(await r1.p).toEqual({ k: "error", text: DA_COPY.uploadErrNetwork });
    expect(a1.cancel).toHaveBeenCalledWith(TICKET.uploadId);

    const a2 = actions();
    const x2 = fakeXhr();
    const r2 = run(a2, x2);
    await flush();
    x2.abort();
    expect(await r2.p).toEqual({ k: "idle" });
    expect(a2.cancel).toHaveBeenCalledTimes(1);
    expect(a2.finish).not.toHaveBeenCalled();

    const a3 = actions({ finish: vi.fn(async () => ({ ok: false as const, message: "영상 파일 형식이 확장자와 맞지 않습니다. MP4·MOV·WEBM 영상만 첨부할 수 있습니다." })) });
    const x3 = fakeXhr();
    const r3 = run(a3, x3);
    await flush();
    x3.status = 200;
    x3.onload?.();
    expect(await r3.p).toEqual({ k: "error", text: "영상 파일 형식이 확장자와 맞지 않습니다. MP4·MOV·WEBM 영상만 첨부할 수 있습니다." });
    expect(a3.cancel).not.toHaveBeenCalled(); // 확정 실패는 서버가 예약을 닫는다

    const a4 = actions({ start: vi.fn(async () => ({ ok: false as const, message: "영상 파일 첨부가 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요." })) });
    expect(await run(a4, fakeXhr()).p).toEqual({ k: "error", text: "영상 파일 첨부가 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요." });
  });
});
