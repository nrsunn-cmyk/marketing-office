import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WebCopyDocView, WebCopySectionData, WebCopySectionView } from "./web-copy-model";

/**
 * P3B-UI-PREP-01 홈페이지 구조·문구 상태별 화면(가짜 데이터, 서버 없음).
 * 인계표 P3B-HANDOFF.md 3절: 작성 중·검토 완료·이전 브리프 기준·보관·빈 상태·프로젝트 읽기 전용 + 만들 수 없음·불러오기 실패·글자 수 넘침.
 */
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./web-copy.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { WebCopySection } = await import("./web-copy-section");

const s = (id: string, name: string, sortOrder: number, extra: Partial<WebCopySectionView> = {}): WebCopySectionView => ({
  id,
  sectionName: name,
  purpose: "",
  headline: `${name} 헤드라인`,
  body: "",
  ctaLabel: "",
  ctaTarget: "",
  citationIds: [],
  sortOrder,
  excluded: false,
  ...extra,
});
const SOURCES = [
  { id: "src-1", label: "고객 인터뷰 요약 (기준 정리 니즈)" },
  { id: "src-2", label: "파일럿 1차 소요 시간 기록" },
  { id: "src-3", label: "경쟁사 랜딩 구조 비교표" },
];
const DOC: WebCopyDocView = {
  id: "dddddddd-dddd-4ddd-8ddd-000000000001",
  status: "drafting",
  revision: 7,
  version: 3,
  briefVersion: 3,
  stale: false,
  pages: [
    {
      id: "p1",
      title: "홈",
      slug: "/",
      sortOrder: 1,
      sections: [
        s("s1", "히어로 (Hero)", 1, {
          purpose: "첫 화면에서 누구를 위한 서비스인지 알린다",
          headline: "대행사 없이도, 승인된 기준으로 끝까지",
          body: "1인·소규모 사업자가 대행사에 휘둘리지 않고 승인된 기준표와 실제 작업 이력으로 브랜드·견적·납품을 관리합니다.",
          ctaLabel: "무료 상담 신청",
          ctaTarget: "/contact",
          citationIds: ["src-1", "src-2"],
        }),
        s("s2", "신뢰 근거 (Proof)", 2, { body: "모든 문구와 디자인 파일은 버전 번호가 남고, 검수 체크리스트를 통과한 승인본만 최종 묶음으로 전달됩니다." }),
      ],
    },
    { id: "p2", title: "회사 소개", slug: "/about", sortOrder: 2, sections: [s("s3", "소개", 1), s("s4", "연혁", 2, { excluded: true })] },
    { id: "p3", title: "서비스 안내", slug: "/services", sortOrder: 3, sections: [s("s5", "서비스 목록", 1)] },
    { id: "p4", title: "문의", slug: "/contact", sortOrder: 4, sections: [s("s6", "문의 폼", 1)] },
  ],
  versions: [
    { version: 1, status: "drafting", savedAt: "2026-11-18T07:40:00Z", note: "기본 4페이지 구조 생성", current: false },
    { version: 3, status: "drafting", savedAt: "2026-11-19T18:20:00Z", note: "히어로 근거 출처 2건 연결", current: true },
    { version: 2, status: "reviewed", savedAt: "2026-11-19T12:10:00Z", note: "4페이지 전체 초안 확정", current: false },
  ],
};
const data = (doc: WebCopyDocView | null, extra: Partial<WebCopySectionData> = {}): WebCopySectionData => ({ doc, canCreate: true, createBlockedReason: null, latestBriefVersion: 3, sources: SOURCES, ...extra });
const longHome = { ...DOC.pages[0], sections: [s("s1", "히어로", 1, { headline: "가".repeat(161), ctaTarget: "javascript:alert(1)", body: "본문 ".repeat(700) }), DOC.pages[0].sections[1]] };

const STATES: Record<string, { data: WebCopySectionData | null; readOnly?: boolean }> = {
  빈상태: { data: data(null) },
  만들수없음: { data: data(null, { canCreate: false, createBlockedReason: "확정된 공통 제작 브리프가 없어 시작할 수 없습니다. 제작 브리프를 먼저 확정해 주세요.", latestBriefVersion: null }) },
  작성중: { data: data(DOC) },
  검토완료: { data: data({ ...DOC, status: "reviewed" }) },
  이전브리프: { data: data({ ...DOC, stale: true, briefVersion: 2 }) },
  보관: { data: data({ ...DOC, status: "archived" }) },
  프로젝트읽기전용: { data: data({ ...DOC, stale: true, briefVersion: 2 }), readOnly: true },
  프로젝트읽기전용빈: { data: data(null), readOnly: true },
  불러오기실패: { data: null },
  글자넘침출처없음: { data: data({ ...DOC, pages: [longHome, ...DOC.pages.slice(1)] }, { sources: [] }) },
};
const render = (k: string) => renderToString(createElement(WebCopySection, { data: STATES[k].data, readOnly: Boolean(STATES[k].readOnly), taskId: "t-1" }));
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("홈페이지 구조·문구 상태별 화면", () => {
  it("모든 상태: 제목·안내·영역 이름", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      expect(h, k).toContain('aria-labelledby="web-copy"');
      expect(text(h), k).toContain("확정된 공통 제작 브리프를 기준으로 페이지와 섹션 구조를 짜고, 근거 출처를 연결해 문구를 작성합니다.");
    }
  });

  it("빈 상태: 시작 단추 하나, 만들 수 없음은 이유만", () => {
    const h = render("빈상태");
    expect(text(h)).toContain("아직 홈페이지 구조·문구 초안이 없습니다.");
    expect(text(h)).toContain("기본 4페이지(홈·회사 소개·서비스 안내·문의) 뼈대로 시작할 수 있습니다.");
    expect(count(h, /<form/g)).toBe(1);
    expect(h).toContain('class="button">+ 홈페이지 구조·문구 시작하기</button>');
    const b = render("만들수없음");
    expect(text(b)).toContain("확정된 공통 제작 브리프가 없어 시작할 수 없습니다.");
    expect(count(b, /<form/g)).toBe(0);
  });

  it("작성 중: 배지, 페이지 목록 4개(첫 페이지 선택), 섹션 카드·도구, 글자 수, 출처, 저장·보관", () => {
    const h = render("작성중");
    expect(h).toContain('class="wcStatus wcStatus_drafting">작성 중</span>');
    expect(text(h)).toContain("제작 브리프 v3 기준 · 편집 v3");
    expect(text(h)).toContain("페이지 (4 / 10)");
    expect(count(h, /class="wcPageTab"/g)).toBe(4);
    expect(count(h, /aria-pressed="true"/g)).toBe(1);
    expect(h).toMatch(/aria-pressed="true"[^>]*>.*?1\. 홈/);
    for (const slug of ["/about", "/services", "/contact"]) expect(text(h)).toContain(slug);
    expect(text(h)).toContain("1. 홈 (/) · 섹션 2 / 12개");
    expect(text(h)).toContain("섹션 1 · 히어로 (Hero)");
    expect(text(h)).toContain("섹션 2 · 신뢰 근거 (Proof)");
    // 첫 섹션의 위로·마지막 섹션의 아래로는 비활성
    expect(h).toMatch(/disabled=""[^>]*aria-label="섹션 1 · 히어로 \(Hero\) 위로"/);
    expect(h).toMatch(/disabled=""[^>]*aria-label="섹션 2 · 신뢰 근거 \(Proof\) 아래로"/);
    expect(h).toContain('aria-label="섹션 1 · 히어로 (Hero) 제외"');
    // 칸: 페이지 2 + 섹션당 6 × 2
    expect(count(h, /<input type="text"/g) + count(h, /<textarea/g)).toBe(2 + 12);
    expect(text(h)).toContain("섹션 목적 0 / 200자"); // 신뢰 근거 섹션의 빈 목적 칸
    expect(text(h)).toContain(`${Array.from("대행사 없이도, 승인된 기준으로 끝까지").length} / 160자`);
    // 출처 3개 × 섹션 2, 히어로는 2개 연결
    expect(count(h, /type="checkbox"/g)).toBe(6);
    expect(count(h, /type="checkbox" checked=""/g)).toBe(2);
    expect(text(h)).toContain("[출처 #1] 고객 인터뷰 요약 (기준 정리 니즈)");
    expect(text(h)).toContain("2/10개");
    expect(text(h)).toContain("수치나 주장을 쓸 때는 연결된 출처에 있는 내용만 사용합니다.");
    expect(count(h, /<option /g)).toBe(2);
    expect(text(h)).toContain("문구·구조 저장");
    expect(text(h)).toContain("이 문서 보관");
    expect(h).toContain(`name="docId" value="${DOC.id}"`);
    expect(h).toContain('name="revision" value="7"');
    expect(h).toContain('name="payload"');
  });

  it("버전 이력: 최신이 위, 현재 판 표시, 나머지는 되돌리기 단추(새 편집본 v4 안내)", () => {
    const h = render("작성중");
    expect(text(h)).toContain("버전 이력 (이전 판으로 되돌리기)");
    expect(text(h)).toContain("되돌리기를 누르면 과거 기록을 지우지 않고, 선택한 판의 내용을 새 편집본(v4)으로 복원합니다.");
    const t = text(h);
    expect(t.indexOf("v3 (현재 작업본 · 작성 중)")).toBeLessThan(t.indexOf("v2 (검토 완료)"));
    expect(t.indexOf("v2 (검토 완료)")).toBeLessThan(t.indexOf("v1 (작성 중)"));
    expect(t).toContain("2026-11-20 03:20 KST · 히어로 근거 출처 2건 연결");
    expect(t).toContain("현재 판");
    expect(count(h, />이 판으로 되돌리기</g)).toBe(2);
    expect(h).toContain('name="version" value="2"');
    expect(h).toContain('name="version" value="1"');
  });

  it("검토 완료: 배지·선택값", () => {
    const h = render("검토완료");
    expect(h).toContain('class="wcStatus wcStatus_reviewed">검토 완료</span>');
    expect(h).toMatch(/<option value="reviewed" selected="">/);
  });

  it("이전 브리프 기준: 배지·시안 문구·맞추기 단추, 편집 그대로", () => {
    const h = render("이전브리프");
    expect(text(h)).toContain("이전 브리프 기준");
    expect(text(h)).toContain("제작 브리프 v2 기준 · 편집 v3");
    expect(text(h)).toContain("이전 브리프 기준: 공통 제작 브리프가 v3로 새로 확정되었습니다. 페이지 구조와 문구가 최신 제작 브리프와 맞는지 확인해 주세요. 맞추지 않아도 고칠 수 있습니다.");
    expect(text(h)).toContain("최신 제작 브리프(v3) 기준으로 맞추기");
    expect(count(h, /<textarea/g)).toBeGreaterThan(0);
  });

  it("보관: 읽기 전용 안내, 폼·되돌리기 0개, 모든 페이지 내용·제외 표시·출처 이름", () => {
    const h = render("보관");
    expect(h).toContain('class="wcStatus wcStatus_archived">보관</span>');
    expect(text(h)).toContain("보관한 홈페이지 문구 문서입니다. 조회만 가능하며 수정·되돌리기는 할 수 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(count(h, /<(input|textarea|select|button)/g)).toBe(0);
    for (const p of ["1. 홈 (/) · 섹션 2개", "2. 회사 소개 (/about) · 섹션 2개", "3. 서비스 안내 (/services) · 섹션 1개", "4. 문의 (/contact) · 섹션 1개"]) expect(text(h)).toContain(p);
    expect(text(h)).toContain("섹션 2 · 연혁 제외됨");
    expect(text(h)).toContain("[출처 #1] 고객 인터뷰 요약 (기준 정리 니즈), [출처 #2] 파일럿 1차 소요 시간 기록");
    expect(text(h)).toContain("현재 판");
    expect(text(h)).not.toContain("이 판으로 되돌리기");
    expect(text(h)).not.toContain("새 편집본(v4)");
  });

  it("프로젝트 읽기 전용: 안내, 폼·맞추기·되돌리기 0개", () => {
    const h = render("프로젝트읽기전용");
    expect(text(h)).toContain("보관한 프로젝트이거나 취소한 작업이라 홈페이지 구조·문구를 고칠 수 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(text(h)).toContain("이전 브리프 기준:");
    expect(text(h)).not.toContain("기준으로 맞추기");
    const e = render("프로젝트읽기전용빈");
    expect(count(e, /<form/g)).toBe(0);
    expect(text(e)).toContain("고칠 수 없습니다");
  });

  it("불러오기 실패: 알림과 다시 불러오기 링크", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("홈페이지 구조·문구를 불러오지 못했습니다.");
    expect(h).toContain('href="/tasks/t-1#web-copy"');
  });

  it("글자 수 넘침·CTA 형식·출처 없음: 바로 보이는 안내, 값은 자르지 않음", () => {
    const h = render("글자넘침출처없음");
    expect(h).toContain('class="wcCount wcCountOver"');
    expect(text(h)).toContain("161 / 160자");
    expect(text(h)).toContain("헤드라인 문구은(는) 160자까지 쓸 수 있습니다.");
    expect(text(h)).toContain("2,100 / 2,000자");
    expect(text(h)).toContain("CTA 이동 대상은 /경로 또는 https:// 주소로 적어 주세요.");
    expect(h).toContain(`value="javascript:alert(1)"`);
    expect(text(h)).toContain("연결할 수 있는 리서치 출처가 없습니다.");
    expect(count(h, /type="checkbox"/g)).toBe(0);
    expect(h).toContain('aria-invalid="true"');
  });

  it("글은 이스케이프되어 HTML 로 들어가지 않는다", () => {
    const evil = '"><script>alert(1)</script>';
    const docEvil: WebCopyDocView = { ...DOC, pages: [{ ...DOC.pages[0], title: evil, sections: [s("x", evil, 1, { body: evil })] }] };
    for (const status of ["drafting", "archived"] as const) {
      const h = renderToString(createElement(WebCopySection, { data: data({ ...docEvil, status }), readOnly: false, taskId: "t" }));
      expect(h).not.toContain("<script>");
      expect(h).toContain("&lt;script&gt;");
    }
  });
});

// 화면 점검용 HTML(4폭·2테마 브라우저 점검은 별도 스크립트). WEB_COPY_HARNESS 가 있을 때만 쓴다
it.runIf(Boolean(process.env.WEB_COPY_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.WEB_COPY_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
});
