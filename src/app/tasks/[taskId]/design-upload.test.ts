import { describe, expect, it, vi } from "vitest";
import { DA_COPY, guessMime, kindsForMime, precheckFile, titleFromFileName, uploadErrorText, uploadProgressText } from "./design-assets-model";
import { classifyPut, putToSignedUrl, runDesignUpload, type UploadActions, type UploadPhase, type XhrLike } from "./design-upload";

/** P3C-UI-CONNECT-01 올리기: 미리 거르기 → 예약 → 서명 주소 PUT(실제 바이트 진행) → 확정, 실패 문구는 AGY DA_COPY 키 */

/** 가짜 XHR: 보낸 머리글·본문을 기록하고, 시험이 진행·응답을 직접 일으킨다 */
function fakeXhr() {
  const x = {
    method: "",
    url: "",
    headers: {} as Record<string, string>,
    body: null as Blob | null,
    aborted: false,
    status: 0,
    responseText: "",
    upload: { onprogress: null as XhrLike["upload"]["onprogress"] },
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    open(m: string, u: string) {
      x.method = m;
      x.url = u;
    },
    setRequestHeader(k: string, v: string) {
      x.headers[k] = v;
    },
    send(b: Blob) {
      x.body = b;
    },
    abort() {
      x.aborted = true;
      x.onabort?.();
    },
  };
  return x;
}
/** 파일 흉내: Blob 의 size·type 은 읽기 전용이라 속성을 다시 정의한다(큰 파일도 메모리를 쓰지 않음) */
const file = (name: string, size: number, type: string) => {
  const b = new Blob([new Uint8Array(8)]);
  Object.defineProperty(b, "size", { value: size });
  Object.defineProperty(b, "type", { value: type });
  Object.defineProperty(b, "name", { value: name });
  return b as Blob & { name: string; size: number; type: string };
};
const TICKET = { uploadId: "11111111-1111-4111-8111-111111111111", path: "ws/design-assets/11111111-1111-4111-8111-111111111111.png", uploadUrl: "https://sb.example/storage/v1/object/upload/sign/design-assets/ws/x.png?token=t", mime: "image/png", expiresAt: "2999-01-01T00:00:00Z" };
const actions = (x: Partial<UploadActions> = {}): UploadActions => ({
  prepare: vi.fn(async () => ({ ok: true as const, data: TICKET })),
  confirmCreate: vi.fn(async () => ({ ok: true as const, data: { assetId: "a-new" } })),
  confirmReplace: vi.fn(async () => ({ ok: true as const, data: { revision: 5 } })),
  ...x,
});

describe("업로드 문구·미리 거르기(AGY DA_COPY upload 12키·unsafeSvg)", () => {
  it("실패 코드 → 확정 문구, 위험 SVG 는 unsafeSvg, 모르는 키는 서버 문구", () => {
    expect(uploadErrorText({ message: "x", copyKey: "uploadErrSize" })).toBe("파일 크기가 한도(10MB)를 넘어 올릴 수 없습니다.");
    expect(uploadErrorText({ message: "x", uploadCode: "TYPE_MISMATCH" })).toBe("파일 실제 내용이 확장자와 달라 올릴 수 없습니다.");
    expect(uploadErrorText({ message: "x", uploadCode: "UNSAFE_SVG", copyKey: "uploadErrType" })).toBe(DA_COPY.unsafeSvg);
    expect(uploadErrorText({ message: "x", uploadCode: "UPLOAD_EXPIRED", copyKey: "uploadErrExpired" })).toBe("올리기 링크 유효 시간이 지났습니다. 다시 시도를 누르면 새 링크로 올립니다.");
    expect(uploadErrorText({ message: "제작 브리프를 확정해야 디자인 자산을 올릴 수 있습니다." })).toBe("제작 브리프를 확정해야 디자인 자산을 올릴 수 있습니다.");
  });

  it("진행 글은 실제 바이트(%·막대 없음)", () => {
    expect(uploadProgressText(1258291, 2516582)).toBe("1.2 MB / 2.4 MB 올리는 중…");
    expect(uploadProgressText(0, 512)).toBe("0 B / 512 B 올리는 중…");
    expect(uploadProgressText(1, 2)).not.toMatch(/%/);
  });

  it("형식 짐작: 브라우저 형식이 비면 확장자로, 분류는 허용 형식만", () => {
    expect(guessMime("a.woff2", "")).toBe("font/woff2");
    expect(guessMime("a.PNG", "")).toBe("image/png");
    expect(guessMime("a.svg", "image/svg+xml")).toBe("image/svg+xml");
    expect(guessMime("a.zip", "application/zip")).toBeNull();
    expect(kindsForMime("image/png")).toEqual(["logo", "image"]);
    expect(kindsForMime("image/svg+xml")).toEqual(["logo"]);
    expect(kindsForMime("text/css")).toEqual(["color"]);
    expect(titleFromFileName("nadaum-logo-v2.svg")).toBe("nadaum-logo-v2");
  });

  it("미리 거르기: 크기(10MB, 색상 1MB)·형식·분류 맞지 않음·확장자", () => {
    expect(precheckFile("logo", file("a.svg", 1000, "image/svg+xml"))).toBeNull();
    expect(precheckFile("image", file("a.jpg", 10 * 1024 * 1024 + 1, "image/jpeg"))).toBe(DA_COPY.uploadErrSize);
    expect(precheckFile("color", file("t.css", 1024 * 1024 + 1, "text/css"))).toBe(DA_COPY.uploadErrSize);
    expect(precheckFile("logo", file("a.zip", 10, "application/zip"))).toBe(DA_COPY.uploadErrType);
    expect(precheckFile("image", file("a.svg", 10, "image/svg+xml"))).toBe(DA_COPY.uploadErrType);
    expect(precheckFile("image", file("a.jpg", 10, "image/png"))).toBe(DA_COPY.uploadErrMismatch);
  });
});

describe("서명 주소 PUT(XHR)", () => {
  it("supabase uploadToSignedUrl 과 같은 요청: PUT·본문 파일 그대로·content-type·x-upsert false·apikey, 진행은 실제 바이트만", async () => {
    const x = fakeXhr();
    const seen: Array<[number, number]> = [];
    const f = file("a.png", 2000, "image/png");
    const job = putToSignedUrl({ url: TICKET.uploadUrl, file: f, mime: "image/png", expiresAt: TICKET.expiresAt, apiKey: "pk" }, (l, t) => seen.push([l, t]), () => x as unknown as XhrLike);
    expect(x.method).toBe("PUT");
    expect(x.url).toBe(TICKET.uploadUrl);
    expect(x.headers).toEqual({ "content-type": "image/png", "x-upsert": "false", "cache-control": "max-age=3600", apikey: "pk" });
    expect(x.body).toBe(f);
    x.upload.onprogress?.({ loaded: 500, total: 2000, lengthComputable: true });
    x.upload.onprogress?.({ loaded: 999, total: 0, lengthComputable: false }); // 모르면 알리지 않는다
    x.upload.onprogress?.({ loaded: 2000, total: 2000, lengthComputable: true });
    x.status = 200;
    x.onload?.();
    expect(await job.promise).toEqual({ ok: true });
    expect(seen).toEqual([
      [500, 2000],
      [2000, 2000],
    ]);
  });

  it("응답 분류: 2xx 성공, 링크 만료·토큰 오류는 expired, 그 밖·연결 끊김은 network, 취소는 cancelled", async () => {
    expect(classifyPut(201, "", TICKET.expiresAt)).toEqual({ ok: true });
    expect(classifyPut(400, '{"error":"InvalidJWT","message":"jwt expired"}', TICKET.expiresAt)).toEqual({ ok: false, reason: "expired" });
    expect(classifyPut(400, "", "2026-11-20T00:00:00Z", Date.parse("2026-11-20T00:00:01Z"))).toEqual({ ok: false, reason: "expired" });
    expect(classifyPut(500, "Internal", TICKET.expiresAt)).toEqual({ ok: false, reason: "network" });
    const x = fakeXhr();
    const job = putToSignedUrl({ url: "u", file: file("a.png", 1, "image/png"), mime: "image/png", expiresAt: TICKET.expiresAt }, () => {}, () => x as unknown as XhrLike);
    expect(x.headers.apikey).toBeUndefined();
    job.cancel();
    expect(x.aborted).toBe(true);
    expect(await job.promise).toEqual({ ok: false, reason: "cancelled" });
    const y = fakeXhr();
    const j2 = putToSignedUrl({ url: "u", file: file("a.png", 1, "image/png"), mime: "image/png", expiresAt: TICKET.expiresAt }, () => {}, () => y as unknown as XhrLike);
    y.onerror?.();
    expect(await j2.promise).toEqual({ ok: false, reason: "network" });
  });
});

describe("올리기 흐름(준비 → 올리기 → 확정)", () => {
  const run = (a: UploadActions, x: ReturnType<typeof fakeXhr>, input: Partial<Parameters<typeof runDesignUpload>[0]> = {}) => {
    const phases: UploadPhase[] = [];
    const p = runDesignUpload(
      { briefId: "b1", kind: "image", file: file("hero.png", 2000, "image/png"), title: "히어로", licenseNote: "", changeNote: "", ...input },
      { actions: a, put: (o, onP) => putToSignedUrl(o, onP, () => x as unknown as XhrLike), apiKey: "pk" },
      (ph) => phases.push(ph),
    );
    return { p, phases };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("새 자산: 예약 값 → 올리는 중(바이트) → 확정 중 → 저장됨, 확정 값은 서버 계약 그대로", async () => {
    const a = actions();
    const x = fakeXhr();
    const { p, phases } = run(a, x);
    await flush();
    expect(a.prepare).toHaveBeenCalledWith({ productionBriefId: "b1", assetId: null, kind: "image", fileName: "hero.png", size: 2000, mime: "image/png" });
    x.upload.onprogress?.({ loaded: 1000, total: 2000, lengthComputable: true });
    x.status = 200;
    x.onload?.();
    expect(await p).toEqual({ k: "done", text: DA_COPY.savedOk });
    expect(a.confirmCreate).toHaveBeenCalledWith(TICKET.path, { uploadId: TICKET.uploadId, title: "히어로", licenseNote: "", origin: "external_upload" });
    expect(phases.map((ph) => ph.k)).toEqual(["uploading", "uploading", "confirming", "done"]);
    expect(phases[1]).toEqual({ k: "uploading", loaded: 1000, total: 2000 });
  });

  it("교체: 자산 id 로 예약, 확정은 confirmReplace(자산·revision·경로·교체 사유)", async () => {
    const a = actions();
    const x = fakeXhr();
    const { p } = run(a, x, { asset: { id: "a1", revision: 3 }, kind: "logo", changeNote: "다크용" });
    await flush();
    expect(a.prepare).toHaveBeenCalledWith(expect.objectContaining({ assetId: "a1", kind: "logo" }));
    x.status = 200;
    x.onload?.();
    expect(await p).toEqual({ k: "done", text: DA_COPY.replacedOk });
    expect(a.confirmReplace).toHaveBeenCalledWith("a1", 3, TICKET.path, { uploadId: TICKET.uploadId, changeNote: "다크용" });
  });

  it("미리 거르기에서 떨어지면 서버를 부르지 않는다", async () => {
    const a = actions();
    const { p } = run(a, fakeXhr(), { file: file("big.png", 11 * 1024 * 1024, "image/png") });
    expect(await p).toEqual({ k: "error", text: DA_COPY.uploadErrSize });
    expect(a.prepare).not.toHaveBeenCalled();
  });

  it("예약 실패·확정 실패(위험 SVG·형식 불일치)는 확정 문구, 올리기 실패는 연결 끊김·만료, 취소는 대기", async () => {
    const a1 = actions({ prepare: vi.fn(async () => ({ ok: false as const, message: "x", uploadCode: "TOO_LARGE" as const, copyKey: "uploadErrSize" })) });
    expect(await run(a1, fakeXhr()).p).toEqual({ k: "error", text: DA_COPY.uploadErrSize });

    const a2 = actions({ confirmCreate: vi.fn(async () => ({ ok: false as const, message: "x", uploadCode: "UNSAFE_SVG" as const, copyKey: "uploadErrType" })) });
    const x2 = fakeXhr();
    const r2 = run(a2, x2, { kind: "logo", file: file("l.svg", 100, "image/svg+xml") });
    await flush();
    x2.status = 200;
    x2.onload?.();
    expect(await r2.p).toEqual({ k: "error", text: DA_COPY.unsafeSvg });

    const x3 = fakeXhr();
    const r3 = run(actions(), x3);
    await flush();
    x3.onerror?.();
    expect(await r3.p).toEqual({ k: "error", text: DA_COPY.uploadErrNetwork });

    const x4 = fakeXhr();
    const r4 = run(actions(), x4);
    await flush();
    x4.status = 400;
    x4.responseText = "signature expired";
    x4.onload?.();
    expect(await r4.p).toEqual({ k: "error", text: DA_COPY.uploadErrExpired });

    const a5 = actions();
    const x5 = fakeXhr();
    const r5 = run(a5, x5);
    await flush();
    x5.abort();
    expect(await r5.p).toEqual({ k: "idle" });
    expect(a5.confirmCreate).not.toHaveBeenCalled();
  });
});
