import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WebCopySectionView as ServerSection } from "@/domain/web-copy";
import type { WebCopyBoard, WebCopyDocView } from "@/features/web-copy/server";

/**
 * P3B-UI-CONNECT-01 홈페이지 구조·문구 상태별 화면(서버 보기 모양의 가짜 보드).
 * 인계표 P3B-HANDOFF.md 3절 + 원인별 안내(P3-COPY-FINAL 6절): 작성 중·검토 완료·이전 브리프 기준(맞추기 가능·브리프 보관·브리프 작성 중·판 100)·
 * 문서 읽기 전용·프로젝트 읽기 전용·빈 상태·만들 수 없음·브리프 없음·브리프 둘·불러오기 실패·글자 수 넘침.
 */
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
// 서버 모듈은 영역(WebCopyArea)만 쓴다. 본문(WebCopySection)은 가짜 보드로 그린다
vi.mock("@/features/web-copy/actions", () => ({ createWebCopyDocAction: vi.fn(), saveWebCopyAction: vi.fn(), rebaseWebCopyAction: vi.fn(), archiveWebCopyAction: vi.fn(), restoreWebCopyVersionAction: vi.fn() }));
vi.mock("@/features/web-copy/server", () => ({}));
vi.mock("@/features/production-brief/server", () => ({}));
vi.mock("@/features/projects/server", () => ({}));
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./web-copy.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { WebCopySection } = await import("./web-copy-section");

const s = (id: string, name: string, sortOrder: number, extra: Partial<ServerSection> = {}): ServerSection => ({
  id,
  sectionName: name,
  purpose: null,
  headline: `${name} 헤드라인`,
  body: null,
  ctaLabel: null,
  ctaTarget: null,
  citationIds: [],
  sortOrder,
  excluded: false,
  ...extra,
});
const SOURCES: WebCopyBoard["sources"] = [
  { id: "src-1", title: "고객 인터뷰 요약 (기준 정리 니즈)", url: "https://example.com/1", reviewStatus: "reviewed" },
  { id: "src-2", title: "파일럿 1차 소요 시간 기록", url: "https://example.com/2", reviewStatus: "reviewed" },
  { id: "src-3", title: "", url: "https://example.com/compare", reviewStatus: "unreviewed" },
];
const DOC: WebCopyDocView = {
  id: "dddddddd-dddd-4ddd-8ddd-000000000001",
  status: "drafting",
  displayStatus: "drafting",
  displayLabel: "작성 중",
  archived: false,
  archivedAt: null,
  revision: 7,
  currentVersionNo: 3,
  currentVersionId: "vvvvvvvv-vvvv-4vvv-8vvv-000000000003",
  sourceBriefRevision: 4,
  stale: false,
  staleLabel: null,
  canRebase: false,
  rebaseBlockedReason: null,
  versionsFull: false,
  readOnlyReason: null,
  createdAt: "2026-11-18T07:40:00Z",
  updatedAt: "2026-11-19T18:20:00Z",
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
};
const VERSIONS: WebCopyBoard["versions"] = [
  { id: "v3", versionNo: 3, kind: "save", kindLabel: "저장", status: "drafting", sourceBriefRevision: 4, restoredFromVersionNo: null, createdAt: "2026-11-19T18:20:00Z", current: true },
  { id: "v1", versionNo: 1, kind: "create", kindLabel: "처음 만듦", status: "drafting", sourceBriefRevision: 4, restoredFromVersionNo: null, createdAt: "2026-11-18T07:40:00Z", current: false },
  { id: "v2", versionNo: 2, kind: "restore", kindLabel: "되돌림", status: "reviewed", sourceBriefRevision: 4, restoredFromVersionNo: 1, createdAt: "2026-11-19T12:10:00Z", current: false },
];
const BRIEF = { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", title: "브랜드 리뉴얼 제작 브리프", revision: 4, status: "ready", archived: false, includesWebCopy: true };
const LIMITS = { pagesMax: 10, sectionsPerPageMax: 12, sectionsTotalMax: 60, citationsMax: 10, pageTitle: 60, slug: 80, sectionName: 80, purpose: 200, headline: 160, body: 2000, ctaLabel: 60, ctaTarget: 200, versionsMax: 100, docsPerBrief: 10 } as const;
const board = (doc: WebCopyDocView | null, extra: Partial<WebCopyBoard> = {}): WebCopyBoard => ({
  brief: BRIEF,
  doc,
  versions: doc ? VERSIONS : [],
  archivedDocs: [],
  sources: SOURCES,
  canCreate: doc === null,
  createBlockedReason: doc ? "작업 중인 홈페이지 문서가 이미 있습니다. 그 문서를 쓰거나 보관한 뒤 새로 만들어 주세요." : null,
  docCount: doc ? 1 : 0,
  limits: LIMITS,
  ...extra,
});
const stale = (x: Partial<WebCopyDocView>): WebCopyDocView => ({ ...DOC, stale: true, staleLabel: "이전 브리프 기준", sourceBriefRevision: 3, ...x });
const longHome = { ...DOC.pages[0], sections: [s("s1", "히어로", 1, { headline: "가".repeat(161), ctaTarget: "//evil.com", body: "본문 ".repeat(700) }), DOC.pages[0].sections[1]] };

const STATES: Record<string, { boards: WebCopyBoard[] | null; readOnly?: boolean }> = {
  빈상태: { boards: [board(null)] },
  만들수없음: { boards: [board(null, { canCreate: false, createBlockedReason: "제작 브리프를 확정해야 홈페이지 문서를 만들 수 있습니다." })] },
  브리프없음: { boards: [] },
  작성중: { boards: [board(DOC)] },
  검토완료: { boards: [board({ ...DOC, status: "reviewed", displayStatus: "reviewed", displayLabel: "검토 완료" })] },
  이전브리프: { boards: [board(stale({ canRebase: true }))] },
  브리프보관: { boards: [board(stale({ rebaseBlockedReason: "보관한 제작 브리프라 맞출 수 없습니다. 이 문서는 지난 브리프 기준 그대로 고칠 수 있습니다." }), { brief: { ...BRIEF, archived: true } })] },
  브리프작성중: { boards: [board(stale({ rebaseBlockedReason: "제작 브리프가 작성 중이라 맞출 수 없습니다. 브리프를 확정한 뒤 맞춰 주세요." }), { brief: { ...BRIEF, status: "drafting" } })] },
  판100: { boards: [board(stale({ versionsFull: true, currentVersionNo: 100, rebaseBlockedReason: "판이 100개라 맞출 수 없습니다. 문서를 보관하고 마지막 판을 복사해 새 문서를 만들어 주세요." }))] },
  문서읽기전용: { boards: [board(stale({ readOnlyReason: "보관한 프로젝트입니다. 프로젝트를 다시 열어야 홈페이지 문서를 만들거나 고칠 수 있습니다." }))] },
  프로젝트읽기전용: { boards: [board(stale({ canRebase: true }))], readOnly: true },
  프로젝트읽기전용빈: { boards: [board(null)], readOnly: true },
  브리프둘: { boards: [board(DOC), board(null, { brief: { ...BRIEF, id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002", title: "두 번째 브리프" } })] },
  불러오기실패: { boards: null },
  글자넘침출처없음: { boards: [board({ ...DOC, pages: [longHome, ...DOC.pages.slice(1)] }, { sources: [] })] },
};
const render = (k: string) => renderToString(createElement(WebCopySection, { boards: STATES[k].boards, readOnly: Boolean(STATES[k].readOnly), taskId: "t-1" }));
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

const STALE_BANNER = "바탕이 된 공통 제작 브리프가 새 버전으로 바뀌었습니다. 페이지 문구와 연결된 근거가 최신 기준과 맞는지 확인해 주세요.";
const ARCHIVED_NOTICE = "바탕이 된 공통 제작 브리프가 보관되었습니다. 이 문서는 계속 고칠 수 있지만 최신 기준으로 맞추기는 할 수 없습니다.";
const NOT_CONFIRMED = "바탕이 된 공통 제작 브리프가 아직 확정 전이라 최신 기준으로 맞출 수 없습니다. 브리프 확정 후 다시 시도해 주세요.";
const REBASE = "최신 제작 브리프 기준으로 맞추기";

describe("홈페이지 구조·문구 상태별 화면", () => {
  it("모든 상태: 제목·안내·영역 이름(id=web-copy, 빠른 이동 대상)", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      expect(h, k).toContain('aria-labelledby="web-copy"');
      expect(count(h, /id="web-copy"/g), k).toBe(1);
      expect(text(h), k).toContain("확정된 공통 제작 브리프를 기준으로 페이지와 섹션 구조를 짜고, 근거 출처를 연결해 문구를 작성합니다.");
    }
  });

  it("빈 상태: 시작 단추 하나(briefId), 만들 수 없음은 서버 이유만, 브리프 없음은 안내만", () => {
    const h = render("빈상태");
    expect(text(h)).toContain("기준 제작 브리프: 브랜드 리뉴얼 제작 브리프");
    expect(text(h)).toContain("아직 홈페이지 구조·문구 초안이 없습니다.");
    expect(text(h)).toContain("기본 4페이지(홈·회사 소개·서비스 안내·문의) 뼈대로 시작할 수 있습니다.");
    expect(count(h, /<form/g)).toBe(1);
    expect(h).toContain('class="button">+ 홈페이지 구조·문구 시작하기</button>');
    expect(h).toContain(`name="briefId" value="${BRIEF.id}"`);
    const b = render("만들수없음");
    expect(text(b)).toContain("제작 브리프를 확정해야 홈페이지 문서를 만들 수 있습니다.");
    expect(count(b, /<form/g)).toBe(0);
    const n = render("브리프없음");
    expect(text(n)).toContain("확정된 공통 제작 브리프가 있어야 시작할 수 있습니다.");
    expect(count(n, /<form/g)).toBe(0);
  });

  it("작성 중: 배지, 페이지 목록 4개(첫 페이지 선택), 섹션 카드·도구, 글자 수, 출처, 저장·보관 확인", () => {
    const h = render("작성중");
    expect(h).toContain('class="wcStatus wcStatus_drafting">작성 중</span>');
    expect(text(h)).toContain("편집 v3");
    expect(text(h)).not.toContain("이전 브리프 기준");
    expect(text(h)).toContain("페이지 (4 / 10)");
    expect(count(h, /class="wcPageTab"/g)).toBe(4);
    expect(count(h, /aria-pressed="true"/g)).toBe(1);
    expect(h).toMatch(/aria-pressed="true"[^>]*>.*?1\. 홈/);
    for (const slug of ["/about", "/services", "/contact"]) expect(text(h)).toContain(slug);
    expect(text(h)).toContain("1. 홈 (/) · 섹션 2 / 12개");
    expect(text(h)).toContain("섹션 1 · 히어로 (Hero)");
    expect(text(h)).toContain("섹션 2 · 신뢰 근거 (Proof)");
    expect(h).toMatch(/disabled=""[^>]*aria-label="섹션 1 · 히어로 \(Hero\) 위로"/);
    expect(h).toMatch(/disabled=""[^>]*aria-label="섹션 2 · 신뢰 근거 \(Proof\) 아래로"/);
    expect(h).toContain('aria-label="섹션 1 · 히어로 (Hero) 제외"');
    expect(count(h, /<input type="text"/g) + count(h, /<textarea/g)).toBe(2 + 12);
    expect(text(h)).toContain("섹션 목적 0 / 200자"); // 서버 null → 빈 칸
    expect(text(h)).toContain(`${Array.from("대행사 없이도, 승인된 기준으로 끝까지").length} / 160자`);
    // 출처 3개 × 섹션 2, 히어로는 2개 연결. 제목이 빈 출처는 주소로
    expect(count(h, /type="checkbox"/g)).toBe(6);
    expect(count(h, /type="checkbox" checked=""/g)).toBe(2);
    expect(text(h)).toContain("[출처 #1] 고객 인터뷰 요약 (기준 정리 니즈)");
    expect(text(h)).toContain("[출처 #3] https://example.com/compare");
    expect(text(h)).toContain("문구·구조 저장");
    // 보관은 접은 안 + '보관 확인'(P3-a 와 같은 방식)
    expect(h).toMatch(/<details[^>]*><summary>이 문서 보관<\/summary>/);
    expect(text(h)).toContain("보관 확인");
    expect(h).toContain(`name="docId" value="${DOC.id}"`);
    expect(h).toContain('name="revision" value="7"');
    expect(h).toContain('name="payload"');
  });

  it("저장 payload(O2): 기존 페이지·섹션 id 를 그대로 담는다", () => {
    const h = render("작성중");
    const m = /name="payload" value="([^"]*)"/.exec(h);
    expect(m).not.toBeNull();
    const payload = JSON.parse(m![1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    expect(payload.status).toBe("drafting");
    expect(payload.pages.map((p: { id: string }) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(payload.pages.flatMap((p: { sections: { id: string }[] }) => p.sections.map((x) => x.id))).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(payload.pages[1].sections[1]).toMatchObject({ id: "s4", excluded: true, purpose: "", body: "" });
  });

  it("버전 이력: 최신이 위, 현재 판 표시, 판 종류·되돌린 판, 나머지는 되돌리기 단추(versionNo)", () => {
    const h = render("작성중");
    const t = text(h);
    expect(t).toContain("버전 이력 (이전 판으로 되돌리기)");
    expect(t).toContain("되돌리기를 누르면 과거 기록을 지우지 않고, 선택한 판의 내용을 새 편집본(v4)으로 복원합니다.");
    expect(t.indexOf("v3 (현재 작업본 · 작성 중)")).toBeLessThan(t.indexOf("v2 (검토 완료)"));
    expect(t.indexOf("v2 (검토 완료)")).toBeLessThan(t.indexOf("v1 (작성 중)"));
    expect(t).toContain("2026-11-20 03:20 KST · 저장");
    expect(t).toContain("2026-11-19 21:10 KST · 되돌림 (v1에서)");
    expect(t).toContain("2026-11-18 16:40 KST · 처음 만듦");
    expect(count(h, />이 판으로 되돌리기</g)).toBe(2);
    expect(h).toContain('name="versionNo" value="2"');
    expect(h).toContain('name="versionNo" value="1"');
  });

  it("검토 완료: 배지·선택값", () => {
    const h = render("검토완료");
    expect(h).toContain('class="wcStatus wcStatus_reviewed">검토 완료</span>');
    expect(h).toMatch(/<option value="reviewed" selected="">/);
  });

  it("이전 브리프 기준(맞출 수 있음): 배지·staleBanner·맞추기 단추, 편집 그대로", () => {
    const h = render("이전브리프");
    expect(text(h)).toContain("이전 브리프 기준");
    expect(text(h)).toContain(STALE_BANNER);
    expect(text(h)).toContain(REBASE);
    expect(text(h)).not.toContain(ARCHIVED_NOTICE);
    expect(count(h, /<textarea/g)).toBeGreaterThan(0);
  });

  it("바탕 브리프 보관(Master O1): briefArchivedNotice 만, staleBanner·맞추기 없음, 편집은 그대로", () => {
    const h = render("브리프보관");
    expect(text(h)).toContain(ARCHIVED_NOTICE);
    expect(text(h)).not.toContain(STALE_BANNER);
    expect(text(h)).not.toContain(REBASE);
    expect(text(h)).toContain("보관한 브리프");
    expect(count(h, /<textarea/g)).toBeGreaterThan(0);
    expect(text(h)).toContain("문구·구조 저장");
  });

  it("바탕 브리프 작성 중: briefNotConfirmedNotice, 맞추기 없음", () => {
    const h = render("브리프작성중");
    expect(text(h)).toContain(NOT_CONFIRMED);
    expect(text(h)).not.toContain(STALE_BANNER);
    expect(text(h)).not.toContain(REBASE);
  });

  it("판 100개: 서버 문구 그대로, 맞추기 없음", () => {
    const h = render("판100");
    expect(text(h)).toContain("판이 100개라 맞출 수 없습니다.");
    expect(text(h)).not.toContain(REBASE);
    expect(text(h)).toContain("편집 v100");
  });

  it("고칠 수 없는 문서(서버 readOnlyReason): 안내, 폼·맞추기·되돌리기 0개, 모든 페이지 내용·제외 표시·출처 이름", () => {
    const h = render("문서읽기전용");
    expect(text(h)).toContain("보관한 프로젝트이거나 취소한 작업이라 홈페이지 구조·문구를 고칠 수 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(count(h, /<(input|textarea|select|button)/g)).toBe(0);
    for (const p of ["1. 홈 (/) · 섹션 2개", "2. 회사 소개 (/about) · 섹션 2개", "3. 서비스 안내 (/services) · 섹션 1개", "4. 문의 (/contact) · 섹션 1개"]) expect(text(h)).toContain(p);
    expect(text(h)).toContain("섹션 2 · 연혁 제외됨");
    expect(text(h)).toContain("[출처 #1] 고객 인터뷰 요약 (기준 정리 니즈), [출처 #2] 파일럿 1차 소요 시간 기록");
    expect(text(h)).toContain("현재 판");
    expect(text(h)).not.toContain(REBASE);
    expect(text(h)).not.toContain("새 편집본(v4)");
  });

  it("프로젝트 읽기 전용(작업 취소 포함): 안내, 폼·맞추기·되돌리기 0개", () => {
    const h = render("프로젝트읽기전용");
    expect(text(h)).toContain("보관한 프로젝트이거나 취소한 작업이라 홈페이지 구조·문구를 고칠 수 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(text(h)).not.toContain(REBASE);
    const e = render("프로젝트읽기전용빈");
    expect(count(e, /<form/g)).toBe(0);
    expect(text(e)).toContain("고칠 수 없습니다");
  });

  it("브리프가 둘: 블록 둘, 제목 id 가 겹치지 않음", () => {
    const h = render("브리프둘");
    expect(text(h)).toContain("기준 제작 브리프: 브랜드 리뉴얼 제작 브리프");
    expect(text(h)).toContain("기준 제작 브리프: 두 번째 브리프");
    const ids = [...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("불러오기 실패: 알림과 다시 불러오기 링크", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("홈페이지 구조·문구를 불러오지 못했습니다.");
    expect(h).toContain('href="/tasks/t-1#web-copy"');
  });

  it("글자 수 넘침·CTA //주소·출처 없음: 바로 보이는 안내, 값은 자르지 않음", () => {
    const h = render("글자넘침출처없음");
    expect(h).toContain('class="wcCount wcCountOver"');
    expect(text(h)).toContain("161 / 160자");
    expect(text(h)).toContain("헤드라인 문구은(는) 160자까지 쓸 수 있습니다.");
    expect(text(h)).toContain("2,100 / 2,000자");
    expect(text(h)).toContain("CTA 이동 대상은 /경로 또는 https:// 주소로 적어 주세요.");
    expect(h).toContain(`value="//evil.com"`);
    expect(text(h)).toContain("연결할 수 있는 리서치 출처가 없습니다.");
    expect(count(h, /type="checkbox"/g)).toBe(0);
    expect(h).toContain('aria-invalid="true"');
  });

  it("글은 이스케이프되어 HTML 로 들어가지 않는다", () => {
    const evil = '"><script>alert(1)</script>';
    const docEvil: WebCopyDocView = { ...DOC, pages: [{ ...DOC.pages[0], title: evil, sections: [s("x", evil, 1, { body: evil })] }] };
    for (const readOnlyReason of [null, "보관한 프로젝트입니다."]) {
      const h = renderToString(createElement(WebCopySection, { boards: [board({ ...docEvil, readOnlyReason }, { brief: { ...BRIEF, title: evil } })], readOnly: false, taskId: "t" }));
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
