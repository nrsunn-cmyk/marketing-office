import { describe, expect, it } from "vitest";
import { checkUploadFile, detectMime, displayFileName, MAX_UPLOAD_BYTES } from "./file-check";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const TXT = new TextEncoder().encode("회사 소개\n천연 발효 식빵\r\n");
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);

describe("내용으로 형식 판정", () => {
  it.each([
    [PDF, "application/pdf"],
    [PNG, "image/png"],
    [JPG, "image/jpeg"],
    [TXT, "text/plain"],
    [EXE, null],
    [new Uint8Array([0xc3, 0x28]), null], // 깨진 UTF-8
  ])("%#", (bytes, mime) => {
    expect(detectMime(bytes)).toBe(mime);
  });
});

describe("T04 업로드 검사", () => {
  it.each([
    ["소개서.pdf", PDF, "application/pdf", "pdf"],
    ["logo.PNG", PNG, "image/png", "png"],
    ["photo.jpeg", JPG, "image/jpeg", "jpg"],
    ["photo.jpg", JPG, "image/jpeg", "jpg"],
    ["memo.txt", TXT, "text/plain", "txt"],
  ])("%s 허용", (name, bytes, mime, extension) => {
    expect(checkUploadFile(name, bytes)).toEqual({ ok: true, mime, extension });
  });

  it.each([
    ["가짜.pdf (실제 exe)", "fake.pdf", EXE, "TYPE_MISMATCH"],
    ["가짜.png (실제 pdf)", "fake.png", PDF, "TYPE_MISMATCH"],
    ["가짜.txt (실제 png)", "fake.txt", PNG, "TYPE_MISMATCH"],
    ["실행 파일", "setup.exe", EXE, "UNSUPPORTED_TYPE"],
    ["확장자 없음", "README", TXT, "UNSUPPORTED_TYPE"],
    ["워드 파일", "doc.docx", PDF, "UNSUPPORTED_TYPE"],
    ["이중 확장자", "invoice.pdf.exe", PDF, "UNSUPPORTED_TYPE"],
    ["빈 파일", "empty.pdf", new Uint8Array(), "EMPTY"],
  ])("%s 거절", (_label, name, bytes, code) => {
    const r = checkUploadFile(name, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it("10MB는 허용, 1바이트라도 넘으면 거절", () => {
    const exact = new Uint8Array(MAX_UPLOAD_BYTES);
    exact.set(PDF);
    expect(checkUploadFile("big.pdf", exact).ok).toBe(true);
    const over = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    over.set(PDF);
    const r = checkUploadFile("big.pdf", over);
    expect(!r.ok && r.code).toBe("TOO_LARGE");
  });
});

describe("표시용 파일 이름", () => {
  it.each([
    ["소개서.pdf", "소개서.pdf"],
    ["C:\\Users\\me\\소개서.pdf", "소개서.pdf"],
    ["../../etc/passwd", "passwd"],
    ["a\u0000b\nc.txt", "abc.txt"],
    ["   ", "파일"],
  ])("%j → %j", (input, expected) => {
    expect(displayFileName(input)).toBe(expected);
  });
});
