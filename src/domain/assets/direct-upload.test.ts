import { describe, expect, it } from "vitest";
import { sourceMimeOfKey, sourceReserveMessage, sourceUploadErrorFromDb } from "./direct-upload";

describe("자료 직접 업로드 규칙(SOURCE-UPLOAD-FIX-01)", () => {
  it("경로 확장자 → 형식, 모르는 모양은 null", () => {
    expect(sourceMimeOfKey("w/u/original.pdf")).toBe("application/pdf");
    expect(sourceMimeOfKey("w/u/original.jpg")).toBe("image/jpeg");
    expect(sourceMimeOfKey("w/u/original.html")).toBeNull();
    expect(sourceMimeOfKey("w/u/x.pdf")).toBeNull();
  });
  it("서명 메시지 순서는 DB 와 같다(없는 칸은 빈칸)", () => {
    expect(sourceReserveMessage({ clientId: null, projectId: "p", size: 3, mime: "text/plain", fileName: "a.txt" })).toBe("|p|3|text/plain|a.txt");
  });
  it("DB 오류 → 안내", () => {
    expect(sourceUploadErrorFromDb("TOO_LARGE: x")).toEqual({ code: "UPLOAD_FAILED", message: "파일은 10MB까지 올릴 수 있습니다.", uploadCode: "TOO_LARGE" });
    expect(sourceUploadErrorFromDb("UPLOAD_EXPIRED: x").uploadCode).toBe("UPLOAD_EXPIRED");
    expect(sourceUploadErrorFromDb("VALIDATION: 다른 고객의 프로젝트에는 자료를 붙일 수 없습니다")).toEqual({ code: "VALIDATION", message: "다른 고객의 프로젝트에는 자료를 붙일 수 없습니다" });
    expect(sourceUploadErrorFromDb("NOT_CONFIGURED: x").message).toContain("켜져 있지 않습니다");
    expect(sourceUploadErrorFromDb("BAD_SIGNATURE: x").code).toBe("ERROR");
  });
});
