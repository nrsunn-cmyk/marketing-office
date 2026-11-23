import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminPublicInquiry } from "@/features/public-inquiries/contract";

/** NADAUM-BRAND-CONNECT-01 /admin/inquiries: 목록·상태 탭·상세·글자 격리·URL 글자·상태 바꾸기 서버 동작(합성 데이터) */
const setMock = vi.fn();
vi.mock("@/features/admin/server", () => ({ isAdmin: async () => true, setAdminPublicInquiryStatus: (...a: unknown[]) => setMock(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return { ActionForm: ({ submitLabel, children }: { submitLabel: string; children?: unknown }) => h("form", null, children as never, h("button", { type: "submit", className: "button" }, submitLabel)) };
});
vi.mock("../admin.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { InquiriesView, inquiriesHref, parseInquiryCursor, cursorText } = await import("./inquiries-view");
const { setInquiryStatusAction } = await import("./actions");
const { INQ_COPY } = await import("./inquiry-copy");

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const row = (x: Partial<AdminPublicInquiry> = {}): AdminPublicInquiry => ({
  id: ID1,
  refCode: "ND-261123-AAAAAA",
  createdAt: "2026-11-23T03:00:00.123456+00:00",
  status: "new",
  companyName: "합성 업체",
  contactName: "합성 담당자",
  phone: "010-0000-0000",
  services: ["homepage", "logo"],
  serviceLabels: ["홈페이지 제작", "로고 제작"],
  otherService: null,
  message: "첫 줄\n둘째 줄",
  referenceUrl: "https://example.test/a",
  desiredTimeline: "12월",
  budgetRange: null,
  privacyConsentAt: "2026-11-23T03:00:00Z",
  consentVersion: "privacy-v1-20261123",
  statusChangedAt: null,
  updatedAt: "2026-11-23T03:00:00Z",
  ...x,
});
const counts = { new: 2, contacted: 1, quoted: 0, closed: 4 };
const action = async () => ({});
const render = (p: Partial<Parameters<typeof InquiriesView>[0]> = {}) =>
  renderToString(createElement(InquiriesView, { counts, rows: [row(), row({ id: ID2, refCode: "ND-261123-BBBBBB", status: "closed" })], nextCursor: null, status: null, cursor: null, selectedId: null, action, ...p })).replaceAll("<!-- -->", "");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("관리자 공개 상담 화면", () => {
  it("상태 탭: 전체(합계)·신규·연락함·견적 발송·종료 건수, 현재 상태 표시", () => {
    const t = text(render({ status: "closed" }));
    for (const s of ["전체 7건", "신규 2건", "연락함 1건", "견적 발송 0건", "종료 4건"]) expect(t).toContain(s);
    const h = render({ status: "closed" });
    const tag = h.match(/<a [^>]*href="\/admin\/inquiries\?status=closed"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain("tabActive");
    expect(tag).toContain('aria-current="page"');
    expect(h).not.toMatch(/새 접수|견적 보냄/);
  });

  it("목록(열 5개): 접수 번호·시각, 업체·담당자, 서비스 한글, 상태, 사용자 글자는 bdi 로 격리, 보기 링크는 고른 상담 주소", () => {
    const h = render();
    expect(h).toContain("ND-261123-AAAAAA");
    expect(text(h)).toContain("홈페이지 제작, 로고 제작");
    expect(h).toMatch(/<bdi class="userText">합성 업체<\/bdi>/);
    expect(h).toMatch(/<bdi class="userText">합성 담당자<\/bdi>/);
    expect(h).toContain(`href="/admin/inquiries?id=${ID1}"`);
    expect(text(h)).toContain(INQ_COPY.pickOne);
  });

  it("상세: 고른 상담의 모든 칸, 요청 내용 줄바꿈 블록, 참고 URL 은 링크가 아닌 글자, 상태 바꾸기 폼(보던 상태 expectedStatus)", () => {
    const h = render({ selectedId: ID1 });
    expect(h).toMatch(/<bdi class="userText userBlock">첫 줄\n둘째 줄<\/bdi>/);
    expect(h).toContain("https://example.test/a");
    expect(h).not.toMatch(/<a[^>]*href="https:\/\/example\.test/);
    expect(text(h)).toContain(INQ_COPY.urlNote);
    expect(h).toContain(`name="id" value="${ID1}"`);
    expect(h).toContain('name="expectedStatus" value="new"');
    expect(h).toMatch(/<select id="inq-status" name="status">/);
    for (const l of ["신규", "연락함", "견적 발송", "종료"]) expect(h).toContain(`>${l}</option>`);
    expect(text(h)).toContain("상태 바꾸기");
  });

  it("방향 제어 문자(U+202E)가 있어도 bdi 안에만 머문다", () => {
    const h = render({ rows: [row({ companyName: "‮가짜업체" })], selectedId: ID1 });
    expect(h).toMatch(/<bdi class="userText">‮가짜업체<\/bdi>/);
    expect((h.match(/‮/g) ?? []).length).toBe((h.match(/<bdi class="userText">‮/g) ?? []).length);
  });

  it("빈 목록·불러오기 실패·쪽 밖의 상담 안내", () => {
    expect(text(render({ rows: [] }))).toContain(INQ_COPY.empty);
    expect(text(render({ rows: [], status: "quoted" }))).toContain(INQ_COPY.emptyFiltered);
    expect(render({ rows: null })).toContain('role="alert"');
    expect(text(render({ selectedId: "33333333-3333-4333-8333-333333333333" }))).toContain(INQ_COPY.notInPage);
  });

  it("쪽 넘김 링크와 커서(마이크로초 그대로)", () => {
    const c = "2026-11-23T03:00:00.123456+00:00|" + ID1;
    const h = render({ nextCursor: c });
    expect(h).toContain(`href="${inquiriesHref({ before: c }).replace(/&/g, "&amp;")}"`);
    expect(parseInquiryCursor(c)).toEqual({ beforeCreated: "2026-11-23T03:00:00.123456+00:00", beforeId: ID1 });
    expect(cursorText(parseInquiryCursor(c))).toBe(c);
    for (const bad of [undefined, "", "x|y", `nope|${ID1}`, "2026-11-23|not-uuid"]) expect(parseInquiryCursor(bad)).toBeUndefined();
    expect(inquiriesHref({ status: "new", before: "a|b", id: ID2 })).toBe(`/admin/inquiries?status=new&before=a%7Cb&id=${ID2}`);
  });
});

describe("상태 바꾸기 서버 동작", () => {
  beforeEach(() => setMock.mockReset());
  const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it("계약 함수에 id·새 상태·보던 상태를 넘기고 성공 안내", async () => {
    setMock.mockResolvedValue({ ok: true, data: { status: "contacted", statusChangedAt: "t", updatedAt: "t" } });
    const r = await setInquiryStatusAction({}, fd({ id: ID1, status: "contacted", expectedStatus: "new" }));
    expect(setMock).toHaveBeenCalledWith({ id: ID1, status: "contacted", expectedStatus: "new" });
    expect(r).toEqual({ ok: true, message: INQ_COPY.statusDone });
  });

  it("충돌·찾을 수 없음은 서버 문구, 모르는 상태는 호출 없이 칸 오류", async () => {
    setMock.mockResolvedValue({ ok: false, code: "CONFLICT", message: "다른 관리자가 먼저 상태를 바꿨습니다. 새로 고친 뒤 다시 시도해 주세요." });
    expect(await setInquiryStatusAction({}, fd({ id: ID1, status: "closed", expectedStatus: "new" }))).toEqual({ message: "다른 관리자가 먼저 상태를 바꿨습니다. 새로 고친 뒤 다시 시도해 주세요." });
    setMock.mockClear();
    expect(await setInquiryStatusAction({}, fd({ id: ID1, status: "deleted", expectedStatus: "new" }))).toEqual({ errors: { status: "알 수 없는 상담 상태입니다." } });
    expect(setMock).not.toHaveBeenCalled();
  });
});

// 화면 점검용 HTML(환경 변수로만)
if (process.env.INQ_HARNESS) {
  mkdirSync(process.env.INQ_HARNESS, { recursive: true });
  writeFileSync(join(process.env.INQ_HARNESS, "inquiries.html"), render({ selectedId: ID1 }));
}
