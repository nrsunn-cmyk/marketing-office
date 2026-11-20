import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DesignAssetView, DesignAssetsData } from "./design-assets-model";

/**
 * P3C-UI-PREP-01 디자인 자산 관리 상태별 화면(가짜 데이터, 서버·실제 업로드 없음).
 * 시안 assets.html 상태 6종(작성 중·검토 완료·이전 기준·보관·읽기 전용·빈 상태) + 한도·권한 없음·불러오기 실패.
 */
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./design-assets.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./production-brief.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { DesignAssetSection } = await import("./design-assets-section");

const LOGO: DesignAssetView = {
  id: "a1",
  title: "나다음 로고 심볼 & 워드마크 패키지",
  kind: "logo",
  origin: "external_upload",
  fileName: "nadaum-logo-kit-v2.zip",
  fileSizeBytes: 2516582,
  mimeType: "application/zip",
  licenseNote: "자체 저작권 보유",
  status: "reviewed",
  archivedAt: null,
  revision: 3,
  version: 2,
  usages: [
    { id: "u1", label: "홈 > 히어로 헤더" },
    { id: "u2", label: "회사 소개 > 브랜드 소개" },
    { id: "u3", label: "공통 푸터" },
  ],
  versions: [
    { version: 1, savedAt: "2026-11-18T05:20:00Z", note: "기본 로열 블루 심볼", current: false },
    { version: 2, savedAt: "2026-11-19T10:10:00Z", note: "다크 배경용 흰색 워드마크 추가", current: true },
  ],
};
const IMAGE: DesignAssetView = { ...LOGO, id: "a2", title: "히어로 섹션 인물 에디토리얼 사진", kind: "image", origin: "app_generated", fileName: "hero_director_editorial_v2.jpg", fileSizeBytes: 1887437, mimeType: "image/jpeg", licenseNote: null, revision: 1, version: 1, usages: [{ id: "u4", label: "홈 > 히어로 (첫 화면)" }], versions: [{ version: 1, savedAt: "2026-11-19T10:00:00Z", note: null, current: true }] };
const COLOR: DesignAssetView = { ...IMAGE, id: "a3", title: "나다음 로열 블루 색상 토큰 묶음", kind: "color", fileName: "nadaum-tokens-v2.css", fileSizeBytes: 12288, mimeType: "text/css", status: "drafting", version: 2, usages: [{ id: "u5", label: "홈페이지 전체 테마" }, { id: "u6", label: "주요 행동 버튼(CTA)" }] };
const FONT: DesignAssetView = { ...IMAGE, id: "a4", title: "Pretendard 웹폰트 Subset", kind: "font", origin: "external_upload", fileName: "Pretendard-Subset.woff2", fileSizeBytes: 1153434, mimeType: "font/woff2", licenseNote: "SIL OFL 1.1", status: "drafting", usages: [] };
const FOUR = [LOGO, IMAGE, COLOR, FONT];
const data = (assets: DesignAssetView[], extra: Partial<DesignAssetsData> = {}): DesignAssetsData => ({ assets, stale: false, canWrite: true, limit: 50, ...extra });

const STATES: Record<string, { data: DesignAssetsData | null; readOnly?: boolean }> = {
  작성중: { data: data(FOUR) },
  검토완료: { data: data(FOUR.map((a) => ({ ...a, status: "reviewed" as const }))) },
  이전기준: { data: data(FOUR, { stale: true }) },
  보관: { data: data([{ ...LOGO, archivedAt: "2026-11-20T00:00:00Z" }, IMAGE]) },
  읽기전용: { data: data(FOUR, { stale: true }), readOnly: true },
  빈상태: { data: data([]) },
  한도: { data: data(Array.from({ length: 50 }, (_, i) => ({ ...IMAGE, id: `x${i}`, title: `자산 ${i + 1}` }))) },
  권한없음: { data: data(FOUR, { canWrite: false }) },
  불러오기실패: { data: null },
};
const render = (k: string) => renderToString(createElement(DesignAssetSection, { data: STATES[k].data, readOnly: Boolean(STATES[k].readOnly), taskId: "t-1" }));
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/\s+/g, " ");

describe("디자인 자산 관리 상태별 화면", () => {
  it("모든 상태: 제목·소개·영역 이름, 아이콘은 장식(aria-hidden)", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      expect(h, k).toContain('aria-labelledby="design-assets"');
      expect(text(h), k).toContain("디자인 자산 관리");
      expect(text(h), k).toContain("로고·이미지·색상·글꼴 자산을 외부 업로드와 앱 내 생성으로 구분하고, 사용처와 버전 이력을 관리합니다.");
      expect(h, k).not.toMatch(/<svg(?![^>]*aria-hidden="true")/);
    }
  });

  it("작성 중: 개수 배지·파일 안내·올리기 단추 2개·분류 필터·카드 4개", () => {
    const h = render("작성중");
    expect(text(h)).toContain("자산 4 / 50개");
    expect(text(h)).toContain("파일당 최대 10MB, 프로젝트당 50개까지 둘 수 있으며 실제 검사는 서버 기준을 따릅니다.");
    expect(text(h)).toContain("+ 외부 파일 올리기");
    expect(text(h)).toContain("+ 앱 내 산출물 등록");
    expect(h).toContain('role="group" aria-label="자산 분류"');
    for (const f of ["전체 (4)", "로고 (1)", "이미지 (1)", "색상 (1)", "글꼴 (1)"]) expect(text(h)).toContain(f);
    expect(count(h, /aria-pressed="true"/g)).toBe(1);
    expect(count(h, /<li class="daCard/g)).toBe(4);
    expect(text(h)).toContain("분류: 로고 · 파일: nadaum-logo-kit-v2.zip (2.4 MB · ZIP) · 라이선스: 자체 저작권 보유");
    expect(text(h)).toContain("외부 업로드");
    expect(text(h)).toContain("앱 내 생성");
    expect(text(h)).toContain("사용처 (3):");
    expect(text(h)).toContain("홈 > 히어로 헤더");
    expect(text(h)).toContain("아직 연결된 홈페이지 섹션·결과물이 없습니다.");
    expect(h).toContain('class="daBadge daBadge_drafting"');
    expect(h).toContain('class="daBadge daBadge_reviewed"');
  });

  it("카드 안: 버전 이력(최신 위, 현재·사용 중, 되돌리기), 고치기·교체·보관 확인", () => {
    const h = render("작성중");
    expect(count(h, /<summary>버전·교체 이력 및 정보 고치기<\/summary>/g)).toBe(4);
    const t = text(h);
    expect(t).toContain("v2 (현재) · 2026-11-19 19:10 KST · 다크 배경용 흰색 워드마크 추가");
    expect(t.indexOf("v2 (현재) · 2026-11-19")).toBeLessThan(t.indexOf("v1 · 2026-11-18 14:20 KST · 기본 로열 블루 심볼"));
    expect(t).toContain("사용 중");
    expect(count(h, />이 버전으로 되돌리기</g)).toBe(1); // 이전 버전이 있는 로고 하나
    expect(t).toContain("되돌리기를 누르면 과거 기록을 지우지 않고, 선택한 판의 내용을 새 버전으로 복원합니다.");
    expect(count(h, />저장</g)).toBe(4);
    expect(count(h, />새 버전으로 교체</g)).toBe(4);
    expect(count(h, /<summary>이 자산 보관<\/summary>/g)).toBe(4);
    expect(t).toContain("보관하면 내용만 볼 수 있고 고칠 수 없습니다. 보관은 되돌릴 수 없습니다.");
    for (const l of ["자산 이름", "라이선스·주의 메모", "버전 교체 사유", "진행 상태"]) expect(t).toContain(l);
    expect(t).toContain("0 / 300자");
    expect(h).toContain('name="assetId" value="a1"');
    expect(h).toContain('name="payload"');
    // 글자 수 표시는 aria-live 아님(한도 근처에서만 숨은 글로)
    expect(h).not.toMatch(/class="daCount[^"]*" aria-live/);
  });

  it("검토 완료: 모든 카드 배지", () => {
    expect(count(render("검토완료"), /class="daBadge daBadge_reviewed"/g)).toBe(4);
  });

  it("이전 기준: 배지·안내·맞추기 단추", () => {
    const h = render("이전기준");
    expect(text(h)).toContain("이전 기준:");
    expect(text(h)).toContain("공통 제작 브리프 또는 홈페이지 구조가 새 버전으로 바뀌었습니다. 자산 사용처와 톤이 최신 기준과 맞는지 확인해 주세요.");
    expect(count(h, />최신 기준으로 맞추기</g)).toBe(1);
  });

  it("보관: 보관 배지, 그 카드는 폼·되돌리기 없음과 보관 안내", () => {
    const h = render("보관");
    expect(h).toContain('class="daBadge daBadge_archived"');
    expect(text(h)).toContain("보관한 자산입니다. 조회와 내려받기만 할 수 있고 고치기·교체는 할 수 없습니다.");
    expect(count(h, />이 버전으로 되돌리기</g)).toBe(0);
    expect(count(h, /<summary>이 자산 보관<\/summary>/g)).toBe(1); // 보관 안 한 이미지만
  });

  it("읽기 전용: 안내, 폼·올리기·맞추기 0개(분류 필터는 남음)", () => {
    const h = render("읽기전용");
    expect(text(h)).toContain("보관한 프로젝트이거나 취소한 작업이라 고칠 수 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(count(h, /<(input|textarea|select)/g)).toBe(0);
    expect(text(h)).not.toContain("최신 기준으로 맞추기");
    expect(text(h)).not.toContain("+ 외부 파일 올리기");
    expect(count(h, /class="daFilter"/g)).toBe(5);
  });

  it("권한 없음: 안내, 폼 0개", () => {
    const h = render("권한없음");
    expect(text(h)).toContain("이 프로젝트의 디자인 자산을 올리거나 고칠 권한이 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
  });

  it("빈 상태: 그림·안내·올리기 단추 2개, 필터 없음", () => {
    const h = render("빈상태");
    expect(text(h)).toContain("아직 등록된 디자인 자산이 없습니다.");
    expect(text(h)).toContain("외부 도구에서 만든 파일을 올리거나, 앱 안에서 만든 로고·이미지 산출물을 연결해 관리할 수 있습니다.");
    expect(h).toContain('viewBox="0 0 96 72"');
    expect(count(h, /<form/g)).toBe(2);
    expect(h).not.toContain("자산 분류");
  });

  it("한도(50/50): 안내, 올리기 단추 없음", () => {
    const h = render("한도");
    expect(text(h)).toContain("자산 50 / 50개");
    expect(text(h)).toContain("디자인 자산이 50개라 더 올릴 수 없습니다. 쓰지 않는 자산을 보관한 뒤 다시 올려 주세요.");
    expect(text(h)).not.toContain("+ 외부 파일 올리기");
  });

  it("불러오기 실패: 알림과 다시 불러오기", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("디자인 자산 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    expect(h).toContain('href="/tasks/t-1#design-assets"');
    expect(text(h)).toContain("다시 불러오기");
  });

  it("글은 이스케이프되어 HTML 로 들어가지 않는다(자산 이름·파일 이름·사용처)", () => {
    const evil = '"><script>alert(1)</script>';
    const h = renderToString(createElement(DesignAssetSection, { data: data([{ ...LOGO, title: evil, fileName: evil, usages: [{ id: "u", label: evil }] }]), readOnly: false, taskId: "t" }));
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  });
});

// 화면 점검용 HTML(4폭·2테마 점검은 별도 스크립트). DESIGN_ASSETS_HARNESS 가 있을 때만 쓴다
it.runIf(Boolean(process.env.DESIGN_ASSETS_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.DESIGN_ASSETS_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
  for (const k of ["작성중", "보관"]) writeFileSync(join(out, `${k}-펼침.html`), render(k).replace(/<details class="([^"]*)">/g, '<details class="$1" open="">'));
});
