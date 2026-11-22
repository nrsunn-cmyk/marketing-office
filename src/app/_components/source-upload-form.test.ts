import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SourceUploadPhase } from "./source-upload-model";

/** SOURCE-UPLOAD-UI-01 자료 파일 올리기 폼 단계별 화면(기존 제목·라벨·안내 그대로 + AGY 단계 문구) */
vi.mock("../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
const { SourceUploadForm } = await import("./source-upload-form");

const OWNER = { clientId: null, projectId: "22222222-2222-4222-8222-222222222222" };
const STATES: Record<string, SourceUploadPhase> = {
  대기: { k: "idle" },
  준비중: { k: "preparing" },
  올리는중: { k: "uploading", loaded: 4 * 1024 * 1024, total: 8 * 1024 * 1024 },
  확정중: { k: "confirming" },
  완료: { k: "done", text: "자료 파일을 올리고 저장을 확인했습니다." },
  실패: { k: "error", text: "네트워크 연결이 끊겨 올리기를 마칠 수 없습니다. 잠시 후 다시 시도해 주세요." },
};
const render = (k: string) => renderToString(createElement(SourceUploadForm, { owner: OWNER, initialPhase: STATES[k] }));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("자료 파일 올리기 폼", () => {
  it("대기: 기존 라벨·accept·휴대폰 안내·'파일 올리기' 단추(파일 본문을 서버 폼으로 보내지 않음 — form·name=file 전송 없음)", () => {
    const h = render("대기");
    expect(h).toContain('<label for="asset-file">파일</label>');
    expect(h).toContain('accept=".pdf,.png,.jpg,.jpeg,.txt"');
    expect(text(h)).toContain("휴대폰에서는 파일 고르기 창에서 사진 찍기도 고를 수 있습니다.");
    expect(h).toMatch(/<button type="button" class="button">파일 올리기<\/button>/);
    expect(h).not.toContain("<form");
  });

  it("단계 문구: 준비 중·올리는 중(실제 바이트, % 없음)·확정 중은 막힌 단추, 완료는 status, 실패는 alert + 올리기 취소", () => {
    expect(text(render("준비중"))).toContain("올릴 준비를 하는 중…");
    const up = render("올리는중");
    expect(text(up)).toContain("4.0 MB / 8.0 MB 올리는 중…");
    expect(up).not.toMatch(/%|<progress|progressbar/);
    expect(up).toContain("올리기 취소");
    expect(up).toMatch(/disabled=""[^>]*>올리는 중…<\/button>/);
    expect(text(render("확정중"))).toContain("서버에서 파일 형식과 크기를 확인해 확정하는 중…");
    expect(render("완료")).toMatch(/<p class="notice" role="status">자료 파일을 올리고 저장을 확인했습니다\.<\/p>/);
    const err = render("실패");
    expect(err).toMatch(/<p class="error" role="alert">네트워크 연결이 끊겨/);
    expect(text(err)).toContain("올리기 취소");
  });
});

// 화면 점검용 HTML(4폭·테마 브라우저 점검은 별도 스크립트). SRC_HARNESS 가 있을 때만 쓴다
it.runIf(Boolean(process.env.SRC_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.SRC_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), `<section class="section"><details open><summary>파일 올리기 (PDF·PNG·JPEG·TXT, 10MB까지)</summary>${render(k)}</details></section>`);
});
