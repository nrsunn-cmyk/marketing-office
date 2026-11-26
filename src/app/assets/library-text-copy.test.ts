import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isTextTruncated, TEXT_PREVIEW_CHARS, textAssetHref } from "./library-text-copy";

describe("메모 보기 (LIBRARY-TEXT-VIEW-FRONT-01, AUDIT-05 C2)", () => {
  it("미리 보기 글자 수를 넘을 때만 '전체 보기'가 필요하다", () => {
    expect(TEXT_PREVIEW_CHARS).toBe(120);
    expect(isTextTruncated("가".repeat(120))).toBe(false);
    expect(isTextTruncated("가".repeat(121))).toBe(true);
    expect(isTextTruncated(null)).toBe(false);
    expect(isTextTruncated(undefined)).toBe(false);
  });

  it("보기 주소는 /assets/{id}", () => {
    expect(textAssetHref("aaaaaaaa-aaaa-4aaa-8aaa-000000000001")).toBe("/assets/aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
  });

  // 서버 컴포넌트라 직접 그리지 않고, 계약만 소스에서 확인한다
  const page = readFileSync(join(__dirname, "[assetId]", "page.tsx"), "utf8");
  it("보기 화면은 Backend getTextAsset 만 쓰고, 없으면 404, 본문은 글자로만 그린다", () => {
    expect(page).toContain('from "@/features/library/server"');
    expect(page).toContain("getTextAsset(assetId)");
    expect(page).toMatch(/res\.code === "NOT_FOUND"\) notFound\(\)/);
    expect(page).not.toContain("dangerouslySetInnerHTML");
    expect(page).toContain("{m.text}");
  });

  it("자료실 목록과 자료 칸에서 보기 화면으로 이어진다", () => {
    const lib = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(lib).toMatch(/a\.kind === "text" && \(\s*<Link href=\{textAssetHref\(a\.id\)\}/);
    const panel = readFileSync(join(__dirname, "..", "_components", "assets-panel.tsx"), "utf8");
    expect(panel).toContain("isTextTruncated(a.text_content)");
    expect(panel).toContain("href={textAssetHref(a.id)}");
  });
});
