import { describe, expect, it, vi } from "vitest";
import {
  SOURCE_UPLOAD_COPY,
  classifyPut,
  precheckSourceFile,
  putToSignedUrl,
  runSourceUpload,
  sourceUploadErrorText,
  uploadProgressText,
  type SourceUploadActions,
  type SourceUploadPhase,
  type XhrLike,
} from "./source-upload-model";

/** SOURCE-UPLOAD-UI-01 자료 파일 직접 업로드: 미리 막기 → 예약 → 서명 주소 PUT(실제 바이트) → 확정, 문구는 AGY SOURCE_UPLOAD_COPY */

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
/** 파일 흉내(큰 크기도 메모리를 쓰지 않음) */
const file = (name: string, size: number) => {
  const b = new Blob([new Uint8Array(8)]);
  Object.defineProperty(b, "size", { value: size });
  Object.defineProperty(b, "name", { value: name });
  return b as Blob & { name: string; size: number };
};
const OWNER = { clientId: null, projectId: "22222222-2222-4222-8222-222222222222" };
const TICKET = { uploadId: "11111111-1111-4111-8111-111111111111", path: "ws/11111111-1111-4111-8111-111111111111/original.pdf", uploadUrl: "https://sb.example/storage/v1/object/upload/sign/source-assets/ws/x/original.pdf?token=t", mime: "application/pdf", expiresAt: "2999-01-01T00:00:00Z" };
const actions = (x: Partial<SourceUploadActions> = {}): SourceUploadActions => ({
  prepare: vi.fn(async () => ({ ok: true as const, data: TICKET })),
  confirm: vi.fn(async () => ({ ok: true as const, data: { id: "a-1" } })),
  ...x,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("문구·미리 막기(AGY SOURCE-UPLOAD-COPY.md 그대로)", () => {
  it("확정 문구 14키 중 화면이 쓰는 것", () => {
    expect(SOURCE_UPLOAD_COPY).toMatchObject({
      uploadPreparing: "올릴 준비를 하는 중…",
      uploadConfirming: "서버에서 파일 형식과 크기를 확인해 확정하는 중…",
      uploadRetry: "다시 시도",
      uploadCancel: "올리기 취소",
      uploadDone: "자료 파일을 올리고 저장을 확인했습니다.",
      uploadErrTooLarge: "파일 크기가 한도(10MB)를 넘어 올릴 수 없습니다.",
    });
    expect(uploadProgressText(4 * 1024 * 1024, 8 * 1024 * 1024)).toBe("4.0 MB / 8.0 MB 올리는 중…");
    expect(uploadProgressText(512, 2048)).toBe("512 B / 2.0 KB 올리는 중…");
  });

  it("서버 실패 코드 → 확정 문구(동시 업로드 한도 CONCURRENT_LIMIT 포함), 그 밖은 서버 문구 그대로", () => {
    expect(sourceUploadErrorText({ message: "x", uploadCode: "EMPTY" })).toBe(SOURCE_UPLOAD_COPY.uploadErrEmpty);
    expect(sourceUploadErrorText({ message: "x", uploadCode: "TOO_LARGE" })).toBe(SOURCE_UPLOAD_COPY.uploadErrTooLarge);
    expect(sourceUploadErrorText({ message: "x", uploadCode: "UNSUPPORTED_TYPE" })).toBe(SOURCE_UPLOAD_COPY.uploadErrUnsupportedType);
    expect(sourceUploadErrorText({ message: "x", uploadCode: "TYPE_MISMATCH" })).toBe("파일 실제 내용이 확장자·크기와 달라 올릴 수 없습니다.");
    expect(sourceUploadErrorText({ message: "x", uploadCode: "UPLOAD_MISSING" })).toBe("올린 파일을 저장소에서 찾지 못했습니다. 다시 시도를 눌러 주세요.");
    expect(sourceUploadErrorText({ message: "x", uploadCode: "UPLOAD_EXPIRED" })).toBe(SOURCE_UPLOAD_COPY.uploadErrExpired);
    expect(sourceUploadErrorText({ message: "진행 중인 업로드가 너무 많습니다. 잠시 후 다시 시도해 주세요.", uploadCode: "CONCURRENT_LIMIT" })).toBe("동시에 올릴 수 있는 작업 수(20개)가 가득 찼습니다. 잠시 후 다시 시도해 주세요.");
    expect(sourceUploadErrorText({ message: "파일 올리기가 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요." })).toBe("파일 올리기가 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요.");
  });

  it("고르기 단계: 형식(확장자)·빈 파일·10MB 초과를 막고, 10MB 정각·8MB 는 통과", () => {
    expect(precheckSourceFile({ name: "a.pdf", size: 10 * 1024 * 1024 })).toBeNull();
    expect(precheckSourceFile({ name: "a.JPEG", size: 8 * 1024 * 1024 })).toBeNull();
    expect(precheckSourceFile({ name: "a.pdf", size: 10 * 1024 * 1024 + 1 })).toBe(SOURCE_UPLOAD_COPY.uploadErrTooLarge);
    expect(precheckSourceFile({ name: "a.txt", size: 0 })).toBe(SOURCE_UPLOAD_COPY.uploadErrEmpty);
    expect(precheckSourceFile({ name: "setup.exe", size: 10 })).toBe(SOURCE_UPLOAD_COPY.uploadErrUnsupportedType);
    expect(precheckSourceFile({ name: "noext", size: 10 })).toBe(SOURCE_UPLOAD_COPY.uploadErrUnsupportedType);
  });
});

describe("서명 주소 PUT(XHR)", () => {
  it("Backend 5절 요청 모양: PUT·본문 파일 그대로·content-type 은 준비 결과 mime(charset 없음)·x-upsert false·apikey, 진행은 실제 바이트만", async () => {
    const x = fakeXhr();
    const seen: Array<[number, number]> = [];
    const f = file("a.pdf", 8 * 1024 * 1024);
    const job = putToSignedUrl({ url: TICKET.uploadUrl, file: f, mime: "application/pdf", expiresAt: TICKET.expiresAt, apiKey: "pk" }, (l, t) => seen.push([l, t]), () => x as unknown as XhrLike);
    expect([x.method, x.url]).toEqual(["PUT", TICKET.uploadUrl]);
    expect(x.headers).toEqual({ "content-type": "application/pdf", "x-upsert": "false", apikey: "pk" });
    expect(x.body).toBe(f);
    x.upload.onprogress?.({ loaded: 4194304, total: 8388608, lengthComputable: true });
    x.upload.onprogress?.({ loaded: 1, total: 0, lengthComputable: false });
    x.status = 200;
    x.onload?.();
    expect(await job.promise).toEqual({ ok: true });
    expect(seen).toEqual([[4194304, 8388608]]);
  });

  it("응답 분류: 2xx 성공, 만료·토큰 오류 expired, 그 밖·끊김 network, 취소 cancelled", async () => {
    expect(classifyPut(200, "", TICKET.expiresAt)).toEqual({ ok: true });
    expect(classifyPut(400, '{"message":"jwt expired"}', TICKET.expiresAt)).toEqual({ ok: false, reason: "expired" });
    expect(classifyPut(403, "", "2026-11-20T00:00:00Z", Date.parse("2026-11-20T01:00:00Z"))).toEqual({ ok: false, reason: "expired" });
    expect(classifyPut(413, "Payload too large", TICKET.expiresAt)).toEqual({ ok: false, reason: "network" });
    const x = fakeXhr();
    const job = putToSignedUrl({ url: "u", file: file("a.pdf", 1), mime: "application/pdf", expiresAt: TICKET.expiresAt }, () => {}, () => x as unknown as XhrLike);
    job.cancel();
    expect(await job.promise).toEqual({ ok: false, reason: "cancelled" });
  });
});

describe("올리기 흐름(준비 → 올리기 → 확정)", () => {
  const run = (a: SourceUploadActions, x: ReturnType<typeof fakeXhr>, f = file("회사소개서.pdf", 8 * 1024 * 1024)) => {
    const phases: SourceUploadPhase[] = [];
    const p = runSourceUpload(OWNER, f, { actions: a, put: (o, onP) => putToSignedUrl(o, onP, () => x as unknown as XhrLike), apiKey: "pk" }, (ph) => phases.push(ph));
    return { p, phases };
  };

  it("8MB: 준비 중 → 올리는 중(바이트) → 확정 중 → 완료, 서버에는 이름·크기·id·경로만", async () => {
    const a = actions();
    const x = fakeXhr();
    const { p, phases } = run(a, x);
    await flush();
    expect(a.prepare).toHaveBeenCalledWith(OWNER, { name: "회사소개서.pdf", size: 8 * 1024 * 1024 });
    x.upload.onprogress?.({ loaded: 4 * 1024 * 1024, total: 8 * 1024 * 1024, lengthComputable: true });
    x.status = 200;
    x.onload?.();
    expect(await p).toEqual({ k: "done", text: SOURCE_UPLOAD_COPY.uploadDone });
    expect(a.confirm).toHaveBeenCalledWith(TICKET.uploadId, TICKET.path);
    expect(phases.map((ph) => ph.k)).toEqual(["preparing", "uploading", "uploading", "confirming", "done"]);
  });

  it("미리 막기에서 떨어지면 서버를 부르지 않는다(10MB 초과)", async () => {
    const a = actions();
    const { p } = run(a, fakeXhr(), file("큰파일.pdf", 10 * 1024 * 1024 + 1));
    expect(await p).toEqual({ k: "error", text: SOURCE_UPLOAD_COPY.uploadErrTooLarge });
    expect(a.prepare).not.toHaveBeenCalled();
  });

  it("예약 실패·확정 실패(내용 불일치)·끊김·만료·취소", async () => {
    expect(await run(actions({ prepare: vi.fn(async () => ({ ok: false as const, message: "진행 중인 업로드가 너무 많습니다. 잠시 후 다시 시도해 주세요.", uploadCode: "CONCURRENT_LIMIT" as const })) }), fakeXhr()).p).toEqual({ k: "error", text: SOURCE_UPLOAD_COPY.uploadErrConcurrentLimit });

    const x1 = fakeXhr();
    const r1 = run(actions({ confirm: vi.fn(async () => ({ ok: false as const, message: "x", uploadCode: "TYPE_MISMATCH" as const })) }), x1);
    await flush();
    x1.status = 200;
    x1.onload?.();
    expect(await r1.p).toEqual({ k: "error", text: SOURCE_UPLOAD_COPY.uploadErrMismatch });

    const x2 = fakeXhr();
    const r2 = run(actions(), x2);
    await flush();
    x2.onerror?.();
    expect(await r2.p).toEqual({ k: "error", text: SOURCE_UPLOAD_COPY.uploadErrNetwork });

    const x3 = fakeXhr();
    const r3 = run(actions(), x3);
    await flush();
    x3.status = 400;
    x3.responseText = "signature expired";
    x3.onload?.();
    expect(await r3.p).toEqual({ k: "error", text: SOURCE_UPLOAD_COPY.uploadErrExpired });

    const a4 = actions();
    const x4 = fakeXhr();
    const r4 = run(a4, x4);
    await flush();
    x4.abort();
    expect(await r4.p).toEqual({ k: "idle" });
    expect(a4.confirm).not.toHaveBeenCalled();
  });
});
