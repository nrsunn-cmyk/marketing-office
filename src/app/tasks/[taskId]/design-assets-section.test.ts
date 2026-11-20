import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DesignAssetView, DesignAssetsData } from "./design-assets-model";
import type { DesignAssetBoard } from "./design-assets-section";

/**
 * P3C-UI-CONNECT-01 디자인 자산 관리 상태별 화면(서버 보기 모양의 가짜 보드, 실제 업로드 없음).
 * 시안 assets.html 상태 6종(작성 중·검토 완료·이전 기준·보관·읽기 전용·빈 상태) + 업로드 대기·한도·서버 이유(올리기 꺼짐)·불러오기 실패·브리프 둘.
 */
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
// 서버 모듈은 영역(DesignAssetArea)만 쓴다
vi.mock("@/features/design-assets/actions", () => ({
  archiveDesignAssetAction: vi.fn(),
  confirmDesignCreateAction: vi.fn(),
  confirmDesignReplaceAction: vi.fn(),
  designDownloadUrlAction: vi.fn(),
  prepareDesignUploadAction: vi.fn(),
  rebaseDesignAssetAction: vi.fn(),
  restoreDesignAssetAction: vi.fn(),
  setDesignAssetUsagesAction: vi.fn(),
  updateDesignAssetAction: vi.fn(),
}));
vi.mock("@/features/design-assets/server", () => ({}));
vi.mock("@/features/production-brief/server", () => ({}));
vi.mock("@/features/projects/server", () => ({}));
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./design-assets.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { DesignAssetSection } = await import("./design-assets-section");

const D1 = "dddddddd-dddd-4ddd-8ddd-000000000001";
const ver = (id: string, version: number, savedAt: string, note: string | null, current: boolean, x: Partial<DesignAssetView["versions"][number]> = {}): DesignAssetView["versions"][number] => ({
  id,
  version,
  kind: version === 1 ? "create" : "replace",
  savedAt,
  note,
  fileName: "f",
  fileSizeBytes: 1,
  mimeType: "image/png",
  restoredFromVersion: null,
  current,
  ...x,
});
const LOGO: DesignAssetView = {
  id: "a1",
  title: "나다음 로고 심볼 & 워드마크",
  kind: "logo",
  origin: "external_upload",
  fileName: "nadaum-logo.svg",
  fileSizeBytes: 2516582,
  mimeType: "image/svg+xml",
  licenseNote: "자체 저작권 보유",
  status: "reviewed",
  archivedAt: null,
  revision: 3,
  version: 2,
  stale: false,
  usages: [
    { id: "u1", docId: D1, sectionId: "s1", label: "홈 · 히어로 헤더" },
    { id: "u2", docId: D1, sectionId: "s2", label: "회사 소개 · 브랜드 소개" },
    { id: "u3", docId: D1, sectionId: "s9", label: null },
  ],
  versions: [ver("v1", 1, "2026-11-18T05:20:00Z", "기본 로열 블루 심볼", false), ver("v2", 2, "2026-11-19T10:10:00Z", "다크 배경용 흰색 워드마크 추가", true)],
};
const IMAGE: DesignAssetView = { ...LOGO, id: "a2", title: "히어로 인물 사진", kind: "image", fileName: "hero.jpg", fileSizeBytes: 1887437, mimeType: "image/jpeg", licenseNote: null, revision: 1, version: 1, usages: [{ id: "u4", docId: D1, sectionId: "s1", label: "홈 · 히어로 헤더" }], versions: [ver("v3", 1, "2026-11-19T10:00:00Z", null, true)] };
const COLOR: DesignAssetView = { ...IMAGE, id: "a3", title: "로열 블루 색상 토큰", kind: "color", fileName: "tokens.css", fileSizeBytes: 12288, mimeType: "text/css", status: "drafting", usages: [] };
const FONT: DesignAssetView = { ...IMAGE, id: "a4", title: "Pretendard 웹폰트 Subset", kind: "font", fileName: "Pretendard.woff2", fileSizeBytes: 1153434, mimeType: "font/woff2", licenseNote: "SIL OFL 1.1", status: "drafting", usages: [] };
const FOUR = [LOGO, IMAGE, COLOR, FONT];
const BRIEF = { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", title: "브랜드 리뉴얼 제작 브리프", revision: 4, status: "ready", archived: false, includesDesignAssets: true };
const OPTIONS = [
  { docId: D1, sectionId: "s1", label: "홈 · 히어로 헤더" },
  { docId: D1, sectionId: "s2", label: "회사 소개 · 브랜드 소개" },
  { docId: D1, sectionId: "s3", label: "문의 · 문의 폼" },
];
const PREVIEWS = { a1: { url: "https://storage.example/a1.svg?token=x" }, a2: { url: "https://storage.example/a2.jpg?token=y" }, a3: { text: ":root { --primary: #2563eb; }" } };
const data = (assets: DesignAssetView[], x: Partial<DesignAssetsData> = {}): DesignAssetsData => ({
  brief: BRIEF,
  assets,
  stale: false,
  canWrite: true,
  readOnlyReason: null,
  canCreate: true,
  createBlockedReason: null,
  count: assets.length,
  limit: 50,
  usageOptions: OPTIONS,
  // 서버(Backend 378aa6c)가 늘 준다. 기본은 넉넉한 사용량
  storage: { usedBytes: 4 * 1024 * 1024, limitBytes: 500 * 1024 * 1024 },
  ...x,
});
const board = (d: DesignAssetsData, previews: DesignAssetBoard["previews"] = PREVIEWS): DesignAssetBoard => ({ data: d, previews });

const STATES: Record<string, { boards: DesignAssetBoard[] | null; readOnly?: boolean }> = {
  작성중: { boards: [board(data(FOUR))] },
  검토완료: { boards: [board(data(FOUR.map((a) => ({ ...a, status: "reviewed" as const }))))] },
  이전기준: { boards: [board(data([{ ...LOGO, stale: true }, IMAGE], { stale: true }))] },
  보관: { boards: [board(data([{ ...LOGO, archivedAt: "2026-11-20T00:00:00Z" }, IMAGE]))] },
  읽기전용: { boards: [board(data(FOUR, { stale: true, canWrite: false, readOnlyReason: "보관한 프로젝트라 디자인 자산을 고칠 수 없습니다.", canCreate: false, createBlockedReason: "보관한 프로젝트라 디자인 자산을 고칠 수 없습니다." }))], readOnly: true },
  빈상태: { boards: [board(data([]))] },
  한도: { boards: [board(data([IMAGE], { count: 50, canCreate: false, createBlockedReason: "디자인 자산이 50개라 더 올릴 수 없습니다. 쓰지 않는 자산을 보관한 뒤 다시 올려 주세요." }))] },
  올리기꺼짐: { boards: [board(data(FOUR, { canWrite: false, readOnlyReason: "디자인 자산 올리기가 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요.", canCreate: false, createBlockedReason: "디자인 자산 올리기가 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요." }))] },
  브리프작성중: { boards: [board(data([], { canCreate: false, createBlockedReason: "제작 브리프를 확정해야 디자인 자산을 올릴 수 있습니다." }))] },
  브리프없음: { boards: [] },
  용량보통: { boards: [board({ ...data(FOUR), storage: { usedBytes: 120 * 1024 * 1024, limitBytes: 500 * 1024 * 1024 } } as DesignAssetsData)] },
  용량거의: { boards: [board({ ...data(FOUR), storage: { usedBytes: 460 * 1024 * 1024, limitBytes: 500 * 1024 * 1024 } } as DesignAssetsData)] },
  용량가득: { boards: [board({ ...data(FOUR), storage: { usedBytes: 500 * 1024 * 1024, limitBytes: 500 * 1024 * 1024 } } as DesignAssetsData)] },
  브리프둘: { boards: [board(data([LOGO])), board(data([], { brief: { ...BRIEF, id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002", title: "두 번째 브리프" } }))] },
  불러오기실패: { boards: null },
};
const render = (k: string) => renderToString(createElement(DesignAssetSection, { boards: STATES[k].boards, readOnly: Boolean(STATES[k].readOnly), taskId: "t-1" }));
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/\s+/g, " ");

describe("디자인 자산 관리 상태별 화면(서버 연결)", () => {
  it("모든 상태: 제목·소개·영역 이름, SVG 아이콘은 장식(aria-hidden), 자산 SVG 는 인라인으로 넣지 않음", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      expect(h, k).toContain('aria-labelledby="design-assets"');
      expect(count(h, /id="design-assets"/g), k).toBe(1);
      expect(text(h), k).toContain("로고·이미지·색상·글꼴 자산을 외부 업로드와 앱 내 생성으로 구분하고, 사용처와 버전 이력을 관리합니다.");
      expect(h, k).not.toMatch(/<svg(?![^>]*aria-hidden="true")/);
    }
  });

  it("작성 중: 브리프 블록·개수 배지·파일 안내·업로드 패널(대기)·분류 필터·카드 4개, 앱 내 등록 단추는 없음(서버 미지원)", () => {
    const h = render("작성중");
    const t = text(h);
    expect(t).toContain("기준 제작 브리프: 브랜드 리뉴얼 제작 브리프");
    expect(t).toContain("자산 4 / 50개");
    expect(t).toContain("로고(SVG·PNG), 이미지(PNG·JPEG·WEBP), 글꼴(WOFF2·TTF·OTF), 색상(JSON·CSS)을 올릴 수 있습니다.");
    expect(t).toContain("여기에 파일을 끌어 놓거나 파일 고르기 단추를 눌러 주세요.");
    expect(t).toContain("파일 고르기");
    expect(h).toContain('type="file"');
    expect(h).toMatch(/<button type="button" class="button touch" disabled="">\+ 외부 파일 올리기<\/button>/); // 파일을 고르기 전에는 막힘
    expect(t).not.toContain("+ 앱 내 산출물 등록");
    for (const s of ["전체 (4)", "로고 (1)", "이미지 (1)", "색상 (1)", "글꼴 (1)"]) expect(t).toContain(s);
    expect(count(h, /class="daCard /g)).toBe(4);
  });

  it("미리 보기: 그림은 서명 주소 <img> 로만, SVG 는 안내 문구, 색상은 글자, 글꼴은 없음", () => {
    const h = render("작성중");
    expect(h).toContain('<img src="https://storage.example/a1.svg?token=x" alt="나다음 로고 심볼 &amp; 워드마크 미리 보기"');
    expect(h).toContain('src="https://storage.example/a2.jpg?token=y"');
    expect(count(h, /보안상 SVG 파일은 실행을 막기 위해 읽기 전용 이미지로만 미리 보며, 내려받을 때만 원본 파일로 받습니다\./g)).toBe(1);
    expect(h).toMatch(/<pre class="daPreviewText" tabindex="0" aria-label="로열 블루 색상 토큰 미리 보기">:root \{ --primary: #2563eb; \}<\/pre>/);
    expect(count(h, /<img /g)).toBe(2);
  });

  it("사용처: 이름, 지금 판에서 사라진 섹션은 '이전 기준' 표시, 고르기(체크 상자·전체 교체 payload)", () => {
    const h = render("작성중");
    const t = text(h);
    expect(t).toContain("사용처 (3):");
    expect(t).toContain("홈 · 히어로 헤더");
    expect(h).toMatch(/<li><span class="tag tag_warn daTagIcon"><svg[^>]*>.*?<\/svg>이전 기준<\/span><\/li>/);
    expect(t).toContain("사용처 (2 / 20)"); // 로고: 지금 판에 있는 2곳만 고른 상태
    expect(h).toContain(`value="[{&quot;docId&quot;:&quot;${D1}&quot;,&quot;sectionId&quot;:&quot;s1&quot;},{&quot;docId&quot;:&quot;${D1}&quot;,&quot;sectionId&quot;:&quot;s2&quot;}]"`);
  });

  it("카드 안: 버전 이력(최신 위·현재·사용 중·판마다 내려받기·되돌리기), 정보 고치기·교체 패널·보관 확인", () => {
    const h = render("작성중");
    const t = text(h);
    expect(t.indexOf("v2 (현재)")).toBeLessThan(t.indexOf("v1 · 2026-11-18 14:20 KST · 기본 로열 블루 심볼"));
    expect(t).toContain("사용 중");
    expect(h).toContain('aria-label="v1 내려받기"');
    expect(count(h, /aria-label="v\d+ 내려받기"/g)).toBe(5); // 로고 2판 + 그림·색상·글꼴 1판씩
    expect(h).toContain('name="version" value="1"');
    expect(t).toContain("이 버전으로 되돌리기");
    expect(t).toContain("새 버전으로 교체");
    expect(t).toContain("버전 교체 사유");
    expect(h).toMatch(/<details[^>]*><summary>이 자산 보관<\/summary>/);
  });

  it("검토 완료: 모든 카드 배지", () => {
    expect(count(render("검토완료"), /class="daBadge daBadge_reviewed"/g)).toBe(4);
  });

  it("이전 기준: 배지·안내, 맞추기는 이전 기준 자산 카드에만", () => {
    const h = render("이전기준");
    const t = text(h);
    expect(t).toContain("이전 기준: 공통 제작 브리프 또는 홈페이지 구조가 새 버전으로 바뀌었습니다. 자산 사용처와 톤이 최신 기준과 맞는지 확인해 주세요.");
    expect(count(h, />최신 기준으로 맞추기</g)).toBe(1);
    expect(h).toContain('name="assetId" value="a1"');
  });

  it("보관 자산: 보관 배지·안내, 그 카드는 내려받기만(폼·되돌리기·교체 없음)", () => {
    const h = render("보관");
    const t = text(h);
    expect(t).toContain("보관한 자산입니다. 조회와 내려받기만 할 수 있고 고치기·교체는 할 수 없습니다.");
    expect(h).toContain('class="daBadge daBadge_archived"');
    const card = h.slice(h.indexOf('aria-labelledby="da-a1"'), h.indexOf('aria-labelledby="da-a2"'));
    expect(count(card, /<form/g)).toBe(0);
    expect(card).toContain('aria-label="v1 내려받기"');
    expect(card).not.toContain("이 버전으로 되돌리기");
  });

  it("읽기 전용: 프로젝트 안내 하나, 폼·업로드·맞추기 0개, 내려받기·필터는 남음", () => {
    const h = render("읽기전용");
    const t = text(h);
    expect(count(h, /보관한 프로젝트이거나 취소한 작업이라 고칠 수 없습니다\./g)).toBe(1);
    expect(count(h, /<form/g)).toBe(0);
    expect(h).not.toContain('type="file"');
    expect(t).not.toContain("최신 기준으로 맞추기");
    expect(count(h, /aria-label="v\d+ 내려받기"/g)).toBe(5);
    expect(t).toContain("전체 (4)");
  });

  it("올리기 꺼짐(서버 이유): 서버 문구 그대로, 폼·업로드 0개", () => {
    const h = render("올리기꺼짐");
    expect(text(h)).toContain("디자인 자산 올리기가 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요.");
    expect(count(h, /<form/g)).toBe(0);
    expect(h).not.toContain('type="file"');
  });

  it("빈 상태: 그림·안내·업로드 패널 / 브리프 작성 중: 서버 이유만 / 브리프 없음: 안내만", () => {
    const h = render("빈상태");
    expect(text(h)).toContain("아직 등록된 디자인 자산이 없습니다.");
    expect(text(h)).toContain("외부 도구에서 만든 파일을 올리거나, 앱 안에서 만든 로고·이미지 산출물을 연결해 관리할 수 있습니다.");
    expect(h).toContain('type="file"');
    expect(h).not.toContain('class="daFilters"');
    const b = render("브리프작성중");
    expect(text(b)).toContain("제작 브리프를 확정해야 디자인 자산을 올릴 수 있습니다.");
    expect(b).not.toContain('type="file"');
    const n = render("브리프없음");
    expect(text(n)).toContain("아직 등록된 디자인 자산이 없습니다.");
    expect(n).not.toContain('type="file"');
  });

  it("한도(50/50): 확정 문구 하나, 업로드 패널 없음(서버 이유와 겹치지 않음)", () => {
    const h = render("한도");
    expect(text(h)).toContain("자산 50 / 50개");
    expect(count(h, /디자인 자산이 50개라 더 올릴 수 없습니다/g)).toBe(1);
    expect(h).not.toContain("+ 외부 파일 올리기");
  });

  it("브리프가 둘: 블록 둘, id 가 겹치지 않음", () => {
    const h = render("브리프둘");
    expect(text(h)).toContain("기준 제작 브리프: 두 번째 브리프");
    const ids = [...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("업로드 패널은 빈 상태 상자 밖, 자산이 있을 때와 같은 자리(첫 자산 뒤에도 다시 만들어지지 않음 — Tester O1)", () => {
    const empty = render("빈상태");
    const box = empty.indexOf('class="emptyState daEmpty"');
    const boxEnd = empty.indexOf("</div>", empty.indexOf("</strong>", box));
    expect(empty.indexOf('type="file"')).toBeGreaterThan(boxEnd);
    const one = render("작성중");
    // 패널 앞에 오는 형제는 같은 블록 제목·안내뿐, 목록은 패널 뒤
    expect(one.indexOf('type="file"')).toBeLessThan(one.indexOf('class="daFilters"'));
  });

  it("저장 용량(Backend 378aa6c storage): 사용 중 글, 90% 이상 안내, 가득 차면 업로드 패널 없음", () => {
    expect(text(render("작성중"))).toContain("사용 중 4.0 MB / 500.0 MB");
    const ok = render("용량보통");
    expect(text(ok)).toContain("사용 중 120.0 MB / 500.0 MB");
    expect(ok).not.toMatch(/progressbar|<progress|%/);
    expect(text(ok)).not.toContain("거의 찼습니다");
    expect(text(render("용량거의"))).toContain("업무실 디자인 자산 저장 용량(500.0 MB)이 거의 찼습니다. 쓰지 않는 자산을 정리해 주세요.");
    const full = render("용량가득");
    expect(text(full)).toContain("업무실 디자인 자산 저장 용량(500.0 MB)이 가득 차 더 올릴 수 없습니다. 쓰지 않는 자산을 정리한 뒤 다시 올려 주세요.");
    expect(full).not.toContain("+ 외부 파일 올리기");
    expect(full).toContain('aria-label="v1 내려받기"');
  });

  it("불러오기 실패: 알림과 다시 불러오기", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("디자인 자산 목록을 불러오지 못했습니다.");
    expect(h).toContain('href="/tasks/t-1#design-assets"');
  });

  it("글은 이스케이프되어 HTML 로 들어가지 않는다(자산 이름·파일 이름·사용처·글자 미리 보기)", () => {
    const evil = '"><script>alert(1)</script>';
    const a = { ...COLOR, title: evil, fileName: `${evil}.css`, licenseNote: evil, usages: [{ id: "u", docId: D1, sectionId: "s1", label: evil }] };
    const h = renderToString(createElement(DesignAssetSection, { boards: [board(data([a], { brief: { ...BRIEF, title: evil } }), { a3: { text: evil } })], readOnly: false, taskId: "t" }));
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  });
});

// 화면 점검용 HTML(4폭·테마 브라우저 점검은 별도 스크립트). DA_HARNESS 가 있을 때만 쓴다
it.runIf(Boolean(process.env.DA_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.DA_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
});
