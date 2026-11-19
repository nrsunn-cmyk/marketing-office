import { describe, expect, it } from "vitest";
import { CTA_PATH_RE, SLUG_RE, fromDbContent, toDbPages, webCopyErrorFromDb, webCopyIssueMessage, webCopySaveSchema } from ".";
import { DEFAULT_WEB_COPY_PAGES } from "./template";

const sec = (o: Record<string, unknown> = {}) => ({ id: null, sectionName: "첫 화면", purpose: null, headline: "제목", body: null, ctaLabel: null, ctaTarget: null, citationIds: [], sortOrder: 1, excluded: false, ...o });
const page = (o: Record<string, unknown> = {}) => ({ id: null, title: "홈", slug: "/", sortOrder: 1, sections: [sec()], ...o });
const msg = (raw: unknown) => {
  const r = webCopySaveSchema.safeParse(raw);
  return r.success ? null : webCopyIssueMessage(r.error.issues[0]);
};

describe("저장 계약(Front e739bc8 toWebCopyPayload 모양)", () => {
  it("camelCase 를 받아 DB 판 내용 snake_case 로 바꾼다", () => {
    const v = webCopySaveSchema.parse({ status: "reviewed", pages: [page({ sections: [sec({ ctaLabel: "문의", ctaTarget: "/contact", citationIds: ["00000000-0000-4000-8000-000000000001"], excluded: true })] })] });
    expect(toDbPages(v)).toEqual([
      { id: null, title: "홈", slug: "/", sort_order: 1, sections: [{ id: null, section_name: "첫 화면", purpose: null, headline: "제목", body: null, cta_label: "문의", cta_target: "/contact", citation_ids: ["00000000-0000-4000-8000-000000000001"], sort_order: 1, excluded: true }] },
    ]);
  });

  it("한도(제외 포함)·모르는 칸·상태·id 형식은 서버에 가기 전에 거절", () => {
    expect(msg({ status: "drafting", pages: [] })).toBe("페이지가 1개 이상 있어야 합니다.");
    expect(msg({ status: "drafting", pages: Array.from({ length: 11 }, () => page()) })).toBe("페이지는 10개까지입니다.");
    expect(msg({ status: "drafting", pages: [page({ sections: Array.from({ length: 13 }, (_, i) => sec({ excluded: i > 0 })) })] })).toMatch(/12개까지입니다\(제외한 섹션 포함\)/);
    expect(msg({ status: "drafting", pages: Array.from({ length: 6 }, () => page({ sections: Array.from({ length: 11 }, () => sec()) })) })).toMatch(/전체 60개까지/);
    expect(msg({ status: "approved", pages: [page()] })).toBe("알 수 없는 진행 상태입니다.");
    expect(msg({ status: "drafting", pages: [page({ id: "x" })] })).toBe("페이지 id 가 올바르지 않습니다.");
    expect(msg({ status: "drafting", pages: [page({ sections: [sec({ extra: 1 })] })] })).not.toBeNull();
    expect(msg({ status: "drafting", pages: [page({ sections: [sec({ citationIds: Array.from({ length: 11 }, () => "00000000-0000-4000-8000-000000000001") })] })] })).toMatch(/10개까지/);
  });

  it("DB 판 내용 → 화면 보기(camelCase), 모양이 이상하면 빈 목록", () => {
    const v = fromDbContent({ pages: DEFAULT_WEB_COPY_PAGES });
    expect(v.map((p) => p.slug)).toEqual(["/", "/about", "/services", "/contact"]);
    expect(v[0].sections[0]).toMatchObject({ sectionName: "첫 화면", ctaTarget: "/contact", excluded: false });
    expect(fromDbContent(null)).toEqual([]);
    expect(fromDbContent({})).toEqual([]);
  });
});

describe("형식·오류 문구", () => {
  it("경로·CTA 경로 정규식은 DB 와 같다", () => {
    for (const ok of ["/", "/about", "/a-b-1"]) expect(SLUG_RE.test(ok), ok).toBe(true);
    for (const bad of ["", "about", "/About", "/a/b", "/a--b", "//", "/a-"]) expect(SLUG_RE.test(bad), bad).toBe(false);
    for (const ok of ["/", "/contact", "/a/b-c", "/a#form", "/#top"]) expect(CTA_PATH_RE.test(ok), ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "/A", "/a//b", "/a#", "/a#<x>"]) expect(CTA_PATH_RE.test(bad), bad).toBe(false);
  });

  it("기본 템플릿: 4페이지 5섹션, 글자 수가 AGY 검증표와 같다(코드 포인트)", () => {
    const len = (s: string | null) => (s === null ? 0 : Array.from(s).length);
    type S = { section_key: string; section_name: string; purpose: string | null; headline: string; body: string | null; cta_label: string | null; cta_target: string | null };
    const secs: S[] = DEFAULT_WEB_COPY_PAGES.flatMap((p) => [...p.sections] as S[]);
    expect(DEFAULT_WEB_COPY_PAGES.map((p) => p.page_key)).toEqual(["home", "about", "services", "contact"]);
    expect(secs.map((s) => [s.section_key, len(s.section_name), len(s.purpose), len(s.headline), len(s.body), len(s.cta_label), len(s.cta_target)])).toEqual([
      ["home_hero", 4, 31, 27, 46, 4, 8],
      ["home_proof", 5, 36, 27, 66, 10, 9],
      ["about_intro", 5, 28, 22, 46, 0, 0],
      ["services_list", 6, 31, 24, 53, 7, 8],
      ["contact_form", 5, 33, 22, 48, 6, 8],
    ]);
  });

  it("DB 오류 → 안내: 한도·찾을 수 없음은 DB 한글 문구, 날것 오류는 숨김", () => {
    expect(webCopyErrorFromDb("LIMIT_REACHED: 한 문서의 판은 100개까지입니다. 문서를 보관하고 새 문서를 만들어 주세요")).toEqual({ code: "VALIDATION", message: "한 문서의 판은 100개까지입니다. 문서를 보관하고 새 문서를 만들어 주세요" });
    expect(webCopyErrorFromDb("NOT_FOUND: 이 문서에 그 판이 없습니다")).toEqual({ code: "NOT_FOUND", message: "이 문서에 그 판이 없습니다" });
    expect(webCopyErrorFromDb("VALIDATION: 바뀐 내용이 없습니다").code).toBe("VALIDATION");
    expect(webCopyErrorFromDb("CONFLICT: 다른 곳에서 먼저 수정되었습니다").code).toBe("CONFLICT");
    const e = webCopyErrorFromDb('new row for relation "web_copy_versions" violates check constraint');
    expect(e.code).toBe("ERROR");
    expect(e.message).not.toMatch(/relation|constraint/);
  });
});
