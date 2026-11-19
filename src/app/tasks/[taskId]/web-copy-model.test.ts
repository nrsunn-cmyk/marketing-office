import { describe, expect, it } from "vitest";
import {
  WEB_COPY_LIMITS,
  addPage,
  addSection,
  canAddPage,
  canAddSection,
  checkWebCopy,
  ctaTargetLooksOk,
  docToEditor,
  emptySection,
  formatKstMinute,
  isValidSlug,
  moveSection,
  restoreHint,
  secKey,
  setExcluded,
  toWebCopyPayload,
  toggleCitation,
  webCopyBriefNotice,
  WC_COPY,
  restoreMissingCitationsText,
  archivedDocOption,
  type WebCopyPageView,
  type WebCopySectionView,
} from "./web-copy-model";

const sec = (name: string, sortOrder: number, extra: Partial<WebCopySectionView> = {}): WebCopySectionView => ({ ...emptySection(sortOrder), id: `s-${name}`, sectionName: name, headline: `${name} 헤드라인`, ...extra });
const page = (title: string, slug: string, sortOrder: number, sections: WebCopySectionView[]): WebCopyPageView => ({ id: `p-${slug}`, title, slug, sortOrder, sections });
const four = (): WebCopyPageView[] => [
  page("홈", "/", 1, [sec("히어로", 1), sec("신뢰 근거", 2)]),
  page("회사 소개", "/about", 2, [sec("소개", 1)]),
  page("서비스 안내", "/services", 3, [sec("서비스", 1)]),
  page("문의", "/contact", 4, [sec("문의 폼", 1)]),
];

describe("P3-b 홈페이지 구조·문구 화면 모델(인계표 P3B-HANDOFF.md)", () => {
  it("한도는 인계표 1·2절·서버 도메인 상수와 같다", () => {
    expect(WEB_COPY_LIMITS).toEqual({
      pagesMax: 10,
      sectionsPerPageMax: 12,
      sectionsTotalMax: 60,
      citationsMax: 10,
      pageTitle: 60,
      slug: 80,
      sectionName: 80,
      purpose: 200,
      headline: 160,
      body: 2000,
      ctaLabel: 60,
      ctaTarget: 200,
      versionsMax: 100,
      docsPerBrief: 10,
    });
  });

  it("경로: 홈 / 또는 한 단계만(서버 SLUG_RE, Tester Q1), 영소문자·숫자·- 만", () => {
    for (const ok of ["/", "/about", "/a1-b2", "/web-design"]) expect(isValidSlug(ok), ok).toBe(true);
    for (const bad of ["", "about", "/About", "/a_b", "/a/", "/-a", "/a--b", "/한글", "/services/web-design", "//", `/${"a".repeat(80)}`]) expect(isValidSlug(bad), bad).toBe(false);
  });

  it("CTA 이동 대상: /경로(하위·#조각 허용) 또는 https 주소, // 로 시작은 거절(Tester Q2)", () => {
    for (const ok of ["", "/contact", "/services/web-design", "/contact#form", "https://example.com/x", "https://example.co.kr"]) expect(ctaTargetLooksOk(ok), ok).toBe(true);
    for (const bad of ["//evil.com", "//evil.com/path", "///x", "/\\evil.com", "http://example.com", "javascript:alert(1)", "https://", "https:///x", "/Contact", "contact"]) expect(ctaTargetLooksOk(bad), bad).toBe(false);
    const pages = four();
    pages[0] = { ...pages[0], sections: [sec("히어로", 1, { ctaTarget: "//evil.com" })] };
    expect(checkWebCopy(pages, [])[secKey(0, 0, "ctaTarget")]).toBe("CTA 이동 대상은 /경로 또는 https:// 주소로 적어 주세요.");
  });

  it("섹션 순서 이동: 위·아래, 끝에서는 그대로, 번호는 1부터 다시", () => {
    const list = [sec("A", 1), sec("B", 2), sec("C", 3)];
    expect(moveSection(list, 2, -1).map((s) => `${s.sortOrder}${s.sectionName}`)).toEqual(["1A", "2C", "3B"]);
    expect(moveSection(list, 0, 1).map((s) => s.sectionName)).toEqual(["B", "A", "C"]);
    expect(moveSection(list, 0, -1).map((s) => s.sectionName)).toEqual(["A", "B", "C"]);
    expect(moveSection(list, 2, 1).map((s) => s.sectionName)).toEqual(["A", "B", "C"]);
    // 순서가 섞여 들어와도 sortOrder 기준
    expect(moveSection([sec("B", 2), sec("A", 1)], 0, 1).map((s) => s.sectionName)).toEqual(["B", "A"]);
  });

  it("제외: 지우지 않고 표시만, 다시 포함 가능", () => {
    const list = setExcluded([sec("A", 1), sec("B", 2)], 1, true);
    expect(list).toHaveLength(2);
    expect(list[1].excluded).toBe(true);
    expect(setExcluded(list, 1, false)[1].excluded).toBe(false);
  });

  it("추가: 섹션은 페이지당 12개·전체 60개, 페이지는 10개까지, 새 페이지 경로는 겹치지 않음", () => {
    const pages = four();
    const added = addSection(pages, 0);
    expect(added[0].sections).toHaveLength(3);
    expect(added[0].sections[2]).toMatchObject({ id: null, sortOrder: 3, sectionName: "" });
    const fullPage = [page("홈", "/", 1, Array.from({ length: 12 }, (_, i) => sec(`S${i}`, i + 1)))];
    expect(canAddSection(fullPage, 0)).toBe(false);
    expect(addSection(fullPage, 0)[0].sections).toHaveLength(12);
    const sixty = Array.from({ length: 5 }, (_, p) => page(`P${p}`, `/p${p}`, p + 1, Array.from({ length: 12 }, (_, i) => sec(`S${p}-${i}`, i + 1))));
    expect(canAddSection(sixty, 0)).toBe(false);
    expect(addPage(sixty)).toHaveLength(5); // 전체 60개라 빈 섹션 하나 든 새 페이지도 못 만든다
    const withNew = addPage([...pages, page("x", "/new-page-5", 5, [sec("x", 1)])]);
    expect(withNew.at(-1)).toMatchObject({ id: null, title: "새 페이지 6", slug: "/new-page-6", sortOrder: 6 });
    expect(withNew.at(-1)!.sections).toHaveLength(1);
    const ten = Array.from({ length: 10 }, (_, p) => page(`P${p}`, `/p${p}`, p + 1, [sec("s", 1)]));
    expect(canAddPage(ten)).toBe(false);
    expect(addPage(ten)).toHaveLength(10);
  });

  it("근거 출처: 목록에 있는 것만, 목록 순서", () => {
    const allowed = ["a", "b", "c"];
    expect(toggleCitation([], "c", true, allowed)).toEqual(["c"]);
    expect(toggleCitation(["c", "x"], "a", true, allowed)).toEqual(["a", "c"]);
    expect(toggleCitation(["a", "c"], "a", false, allowed)).toEqual(["c"]);
  });

  it("점검: 기본 4페이지는 문제 없음", () => {
    expect(checkWebCopy(four(), [])).toEqual({});
  });

  it("점검: 필수·한도·경로 형식·경로 겹침·CTA·출처", () => {
    const pages = four();
    pages[1] = { ...pages[1], slug: "/" };
    pages[2] = { ...pages[2], slug: "Services", title: "가".repeat(61) };
    pages[0] = {
      ...pages[0],
      sections: [
        sec("히어로", 1, { headline: "  ", ctaTarget: "http://x", citationIds: ["a", "zz"] }),
        sec("신뢰 근거", 2, { body: "가".repeat(2001), citationIds: Array.from({ length: 11 }, (_, i) => `c${i}`) }),
      ],
    };
    pages[3] = { ...pages[3], sections: [] };
    const known = ["a", ...Array.from({ length: 11 }, (_, i) => `c${i}`)];
    const issues = checkWebCopy(pages, known);
    expect(issues["page:1:slug"]).toBe("경로 / 가 1번 페이지와 겹칩니다.");
    expect(issues["page:2:slug"]).toMatch(/영소문자/);
    expect(issues["page:2:title"]).toBe("페이지 이름은 60자까지 쓸 수 있습니다.");
    expect(issues["page:3:sections"]).toBe("페이지마다 섹션이 1개 이상 있어야 합니다.");
    expect(issues[secKey(0, 0, "headline")]).toBe("헤드라인 문구을(를) 입력해 주세요.");
    expect(issues[secKey(0, 0, "ctaTarget")]).toBe("CTA 이동 대상은 /경로 또는 https:// 주소로 적어 주세요.");
    expect(issues[secKey(0, 0, "citationIds")]).toBe("목록에 없는 출처 1개가 연결되어 있습니다(지워졌거나 다른 업무실 자료).");
    expect(issues[secKey(0, 1, "body")]).toBe("본문 문구은(는) 2,000자까지 쓸 수 있습니다.");
    expect(issues[secKey(0, 1, "citationIds")]).toBe("근거 출처는 10개까지 연결할 수 있습니다.");
    expect(checkWebCopy([], [])["doc:pages"]).toBe("페이지가 1개 이상 있어야 합니다.");
  });

  it("보낼 값: 정렬·번호 다시 매김, 제외 섹션도 excluded 로 남김, 값은 자르지 않음", () => {
    const pages = [page("소개", "/about", 2, [sec("B", 2, { excluded: true }), sec("A", 1, { body: "가".repeat(2100) })]), page("홈", "/", 1, [sec("H", 1)])];
    const p = toWebCopyPayload("reviewed", pages);
    expect(p.status).toBe("reviewed");
    expect(p.pages.map((x) => `${x.sortOrder}${x.slug}`)).toEqual(["1/", "2/about"]);
    expect(p.pages[1].sections.map((s) => `${s.sortOrder}${s.sectionName}${s.excluded ? "x" : ""}`)).toEqual(["1A", "2Bx"]);
    expect(p.pages[1].sections[0].body).toHaveLength(2100);
    expect(Object.keys(p.pages[0].sections[0])).toEqual(["id", "sectionName", "purpose", "headline", "body", "ctaLabel", "ctaTarget", "citationIds", "sortOrder", "excluded"]);
  });

  // 서버 보기(빈 칸 null, id 필수)
  const srvSec = (id: string, name: string, sortOrder: number) => ({ id, sectionName: name, purpose: null, headline: `${name} 헤드라인`, body: null, ctaLabel: null, ctaTarget: null, citationIds: [], sortOrder, excluded: false });

  it("보기 → 편집 값: 정렬, 빈 칸 null 은 '', 검토 완료는 그대로", () => {
    const doc = { status: "reviewed" as const, pages: [{ id: "pb", title: "b", slug: "/b", sortOrder: 5, sections: [srvSec("y", "y", 9), srvSec("x", "x", 3)] }, { id: "pa", title: "a", slug: "/", sortOrder: 2, sections: [srvSec("z", "z", 1)] }] };
    const e = docToEditor(doc);
    expect(e.status).toBe("reviewed");
    expect(e.pages.map((p) => `${p.sortOrder}${p.slug}`)).toEqual(["1/", "2/b"]);
    expect(e.pages[1].sections.map((s) => `${s.sortOrder}${s.sectionName}`)).toEqual(["1x", "2y"]);
    expect(e.pages[1].sections[0]).toMatchObject({ purpose: "", body: "", ctaLabel: "", ctaTarget: "" });
    expect(docToEditor({ ...doc, status: "drafting" }).status).toBe("drafting");
  });

  it("저장 값(O2): 기존 페이지·섹션은 id 를 그대로 보내고(순서 바꿈·제외·추가 뒤에도), 새로 추가한 것만 id = null", () => {
    const doc = {
      status: "drafting" as const,
      pages: [
        { id: "11111111-1111-4111-8111-000000000001", title: "홈", slug: "/", sortOrder: 1, sections: [srvSec("aaaaaaaa-aaaa-4aaa-8aaa-000000000001", "히어로", 1), srvSec("aaaaaaaa-aaaa-4aaa-8aaa-000000000002", "신뢰", 2)] },
        { id: "11111111-1111-4111-8111-000000000002", title: "소개", slug: "/about", sortOrder: 2, sections: [srvSec("aaaaaaaa-aaaa-4aaa-8aaa-000000000003", "소개", 1)] },
      ],
    };
    const e = docToEditor(doc);
    let pages = e.pages.map((p, i) => (i === 0 ? { ...p, sections: setExcluded(moveSection(p.sections, 0, 1), 0, true) } : p));
    pages = addSection(pages, 1);
    pages = addPage(pages);
    const out = toWebCopyPayload(e.status, pages);
    const ids = out.pages.map((p) => [p.id, ...p.sections.map((x) => x.id)]);
    expect(ids).toEqual([
      ["11111111-1111-4111-8111-000000000001", "aaaaaaaa-aaaa-4aaa-8aaa-000000000002", "aaaaaaaa-aaaa-4aaa-8aaa-000000000001"],
      ["11111111-1111-4111-8111-000000000002", "aaaaaaaa-aaaa-4aaa-8aaa-000000000003", null],
      [null, null],
    ]);
    expect(out.pages[0].sections.map((x) => `${x.sortOrder}${x.sectionName}${x.excluded ? "x" : ""}`)).toEqual(["1신뢰x", "2히어로"]);
    // 한 번 저장한 문서를 다시 불러와도 기존 id 가 모두 남는다(빠지면 서버가 새 섹션으로 본다)
    expect(toWebCopyPayload(e.status, e.pages).pages.flatMap((p) => p.sections.map((x) => x.id)).every((x) => typeof x === "string")).toBe(true);
  });

  it("바탕 브리프 안내(Master O1 결정): 원인별로 하나만, 브리프 보관이면 staleBanner 없이 briefArchivedNotice", () => {
    const d = (x: Partial<{ stale: boolean; canRebase: boolean; rebaseBlockedReason: string | null; readOnlyReason: string | null }>) => ({ stale: true, canRebase: false, rebaseBlockedReason: null, readOnlyReason: null, ...x });
    const ready = { archived: false, status: "ready" };
    expect(webCopyBriefNotice(d({ stale: false }), ready)).toBeNull();
    expect(webCopyBriefNotice(d({ canRebase: true }), ready)).toEqual({ kind: "stale", text: WC_COPY.staleBanner, canRebase: true });
    expect(webCopyBriefNotice(d({ rebaseBlockedReason: "보관한 제작 브리프라 맞출 수 없습니다." }), { archived: true, status: "ready" })).toEqual({ kind: "archived", text: WC_COPY.briefArchivedNotice, canRebase: false });
    expect(webCopyBriefNotice(d({ rebaseBlockedReason: "제작 브리프가 작성 중이라 맞출 수 없습니다." }), { archived: false, status: "drafting" })).toEqual({ kind: "notConfirmed", text: WC_COPY.briefNotConfirmedNotice, canRebase: false });
    const full = "판이 100개라 맞출 수 없습니다. 문서를 보관하고 마지막 판을 복사해 새 문서를 만들어 주세요.";
    expect(webCopyBriefNotice(d({ rebaseBlockedReason: full }), ready)).toEqual({ kind: "other", text: full, canRebase: false });
    // 판 100개가 찼으면 화면이 versionLimitReached 를 따로 보이므로 맞추기 안내는 없음
    expect(webCopyBriefNotice({ ...d({ rebaseBlockedReason: full }), versionsFull: true }, ready)).toBeNull();
    // 고칠 수 없는 문서(프로젝트 보관·작업 취소)는 맞추기 안내 없음
    expect(webCopyBriefNotice(d({ readOnlyReason: "보관한 프로젝트입니다." }), { archived: true, status: "ready" })).toBeNull();
  });

  it("문구: 시각·이전 브리프·맞추기·되돌리기 안내", () => {
    expect(formatKstMinute("2026-11-19T18:20:00Z")).toBe("2026-11-20 03:20 KST");
    expect(formatKstMinute("x")).toBe("시각 알 수 없음");
    // AGY P3-COPY-FINAL.md 6절 글자 그대로
    expect(WC_COPY.briefArchivedNotice).toBe("바탕이 된 공통 제작 브리프가 보관되었습니다. 이 문서는 계속 고칠 수 있지만 최신 기준으로 맞추기는 할 수 없습니다.");
    expect(WC_COPY.staleBanner).toBe("바탕이 된 공통 제작 브리프가 새 버전으로 바뀌었습니다. 페이지 문구와 연결된 근거가 최신 기준과 맞는지 확인해 주세요.");
    expect(WC_COPY.briefNotConfirmedNotice).toBe("바탕이 된 공통 제작 브리프가 아직 확정 전이라 최신 기준으로 맞출 수 없습니다. 브리프 확정 후 다시 시도해 주세요.");
    expect(restoreMissingCitationsText(2)).toBe("되돌리려는 판에 지금은 없는 근거 출처가 2개 있어 되돌릴 수 없습니다. 출처를 먼저 확인해 주세요.");
    expect(WC_COPY.rebase).toBe("최신 제작 브리프 기준으로 맞추기");
    expect(WC_COPY.copyFromArchived).toBe("보관한 문서 내용을 복사해 새로 만들기");
    expect(WC_COPY.copyFromArchivedHint).toBe("보관한 문서나 판이 가득 찬 문서의 내용을 복사해 새 홈페이지 문서로 이어서 작업할 수 있습니다.");
    expect(WC_COPY.versionLimitReached).toBe("판 이력이 100개에 도달해 더 저장하거나 되돌릴 수 없습니다. 보관한 뒤 내용을 복사해 새 문서로 만들어 주세요.");
    expect(archivedDocOption({ currentVersionNo: 100, archivedAt: "2026-11-19T18:20:00Z" })).toBe("v100 · 2026-11-20 03:20 KST 보관");
    expect(restoreHint(4)).toBe("되돌리기를 누르면 과거 기록을 지우지 않고, 선택한 판의 내용을 새 편집본(v4)으로 복원합니다.");
  });
});
