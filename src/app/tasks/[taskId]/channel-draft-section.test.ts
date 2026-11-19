import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CHANNEL_DRAFT_DISPLAY_STATUSES, type ChannelDraftDisplayStatus } from "@/domain/channel-draft/constants";
import { exportFileName, postInfo, renderTistoryHtml, toMarkdown, toPlainText } from "@/domain/channel-draft/render";
import type { ChannelDraftsForBrief, ChannelDraftView, ChannelPublicationView } from "@/features/channel-draft/server";

/**
 * P2G-UI-01 채널 초안 영역의 상태별 화면(시안 channel-draft.html R1: 생성 전·작성 중·검토 완료·이전 전략·브리프 보관·초안 보관
 * + 게시 기록됨·만들 수 없음·읽기 전용·기록 한도·오류). 서버 동작·읽기는 가짜(외부 호출 없음). CSS 모듈은 원래 클래스 이름 그대로.
 */
const getChannelDraftsFor = vi.fn();
vi.mock("@/features/channel-draft/server", () => ({ getChannelDraftsFor: (...a: unknown[]) => getChannelDraftsFor(...a) }));
vi.mock("@/features/channel-draft/actions", () => {
  const noop = async () => ({});
  return {
    createChannelDraftAction: noop,
    updateChannelDraftAction: noop,
    rebaseChannelDraftAction: noop,
    archiveChannelDraftAction: noop,
    recordChannelPublicationAction: noop,
    voidChannelPublicationAction: noop,
  };
});
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./channel-draft.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { ChannelDraftBody, ChannelDraftSection } = await import("./channel-draft-section");

const id = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;
const BRIEF = id(1);
const V2 = { id: id(902), version: 2 };
const V1 = { id: id(901), version: 1 };
const BODY = [
  "출근길에 커피 할인을 찾는 직장인을 위한 안내입니다.",
  "",
  "## 1. 왜 정기 배송일까요?",
  "매주 월요일 아침에 원두가 도착합니다. **첫 달 30% 할인**.",
  "",
  "- 원두 3종 중 고르기",
  "- 언제든 해지",
  "",
  "[이미지: 정기 배송 상자 사진]",
  "",
  "<script>alert(1)</script> 는 글자로 나갑니다.",
].join("\n");

function exp(title: string, body: string, tags: string[], meta: string | null, img: string | null) {
  return {
    html: renderTistoryHtml(body),
    markdown: toMarkdown(title, body),
    text: toPlainText(body),
    info: postInfo({ title, tags, metaDescription: meta, imageNote: img, body }),
    fileNames: { html: exportFileName(title, "html"), md: exportFileName(title, "md"), txt: exportFileName(title, "txt") },
  };
}
const pub = (n: number, over: Partial<ChannelPublicationView> = {}): ChannelPublicationView => ({
  id: id(500 + n),
  kind: "record",
  url: `https://coffee-office.tistory.com/${n}`,
  nonTistoryHost: false,
  publishedAt: "2026-11-19T11:50:00.000Z",
  note: null,
  voided: false,
  voidsId: null,
  createdAt: `2026-11-19T12:0${n % 10}:00.000Z`,
  ...over,
});
function draft(n: number, over: Partial<ChannelDraftView> & { displayStatus?: ChannelDraftDisplayStatus } = {}): ChannelDraftView {
  const title = over.title ?? `합성 초안 ${n}: 출근길 커피 정기 배송 첫 달 할인`;
  const body = over.body ?? BODY;
  const tags = over.tags ?? ["정기배송", "커피", "출근길"];
  const meta = over.metaDescription === undefined ? "매주 월요일 아침 원두가 도착하는 정기 배송, 첫 달 30% 할인 안내" : over.metaDescription;
  const img = over.imageNote === undefined ? "1200×630 상자 사진을 티스토리에서 직접 올리기" : over.imageNote;
  const displayStatus = over.displayStatus ?? "drafting";
  return {
    id: id(100 + n),
    title,
    body,
    tags,
    imageNote: img,
    metaDescription: meta,
    status: "drafting",
    revision: 2,
    archived: false,
    createdAt: "2026-11-19T10:00:00Z",
    updatedAt: "2026-11-19T10:00:00Z",
    strategyVersion: V2,
    stale: false,
    briefChanged: false,
    sourceBriefRevision: 3,
    sourceSnapshot: {},
    publications: [],
    ...over,
    displayStatus,
    displayLabel: CHANNEL_DRAFT_DISPLAY_STATUSES[displayStatus],
    export: exp(title, body, tags, meta, img),
  };
}
const data = (drafts: ChannelDraftView[], over: Partial<ChannelDraftsForBrief> = {}): ChannelDraftsForBrief => ({
  drafts,
  canCreate: true,
  createBlockedReason: null,
  activeCount: drafts.filter((d) => !d.archived).length,
  limit: 5,
  ...over,
});
const LONG = "아주긴티스토리초안제목".repeat(17);
const PUBS = [
  pub(1, { voided: true }),
  pub(2, { kind: "void", url: null, publishedAt: null, note: "주소를 잘못 적음", voidsId: id(501) }),
  pub(3, { url: "https://blog.example.com/coffee/3", nonTistoryHost: true, note: "개인 도메인에 1차 발행" }),
];

type State = { data: ChannelDraftsForBrief; readOnly?: boolean; briefArchived?: boolean };
const STATES: Record<string, State> = {
  생성전: { data: data([]) },
  만들수없음: { data: data([], { canCreate: false, createBlockedReason: "브리프를 준비 완료로 바꾸면 초안을 만들 수 있습니다." }) },
  작성중: { data: data([draft(1), draft(2, { title: LONG, body: "", tags: [], metaDescription: null, imageNote: null })]) },
  검토완료: { data: data([draft(1, { status: "reviewed", displayStatus: "reviewed" })]) },
  게시기록됨: { data: data([draft(1, { displayStatus: "published", publications: PUBS })]) },
  이전전략: { data: data([draft(1, { stale: true, strategyVersion: V1 })]) },
  브리프변경: { data: data([draft(1, { briefChanged: true })]) },
  브리프보관: { data: data([draft(1)], { canCreate: false, createBlockedReason: "보관한 브리프로는 초안을 만들 수 없습니다." }), briefArchived: true },
  초안보관: { data: data([draft(1, { archived: true, displayStatus: "archived", publications: PUBS })], { activeCount: 0 }) },
  읽기전용: { data: data([draft(1, { displayStatus: "published", publications: PUBS, stale: true, strategyVersion: V1 })]), readOnly: true },
  한도: { data: data([1, 2, 3, 4, 5].map((n) => draft(n)), { canCreate: false, createBlockedReason: "한 브리프에는 초안을 5개까지 둘 수 있습니다." }) },
  기록한도: { data: data([draft(1, { displayStatus: "published", publications: Array.from({ length: 50 }, (_, i) => pub(10 + i)) })]) },
};
const render = (k: string) => {
  const s = STATES[k]!;
  return renderToString(createElement(ChannelDraftBody, { data: s.data, briefId: BRIEF, briefArchived: s.briefArchived ?? false, readOnly: s.readOnly ?? false, approvedVersion: 2 }));
};
const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => text(m[1]!).trim());
const forms = (html: string) => (html.match(/<form/g) ?? []).length;

describe("채널 초안 영역: 상태별 화면", () => {
  it("모든 상태: 영역 제목·채널·언어 배지, 자동 게시 단추 없음(R08)", () => {
    for (const k of Object.keys(STATES)) {
      const html = render(k);
      expect(html, k).toContain('aria-labelledby="channel-drafts"');
      expect(text(html), k).toContain("채널: 티스토리 블로그");
      expect(text(html), k).toContain("언어: 한국어");
      for (const b of buttons(html)) expect(b, `${k}: ${b}`).not.toMatch(/^(게시|발행)(하기)?$|^발행|티스토리로 보내기|자동 게시/);
    }
  });

  it("생성 전: 개수 0/5, 만들기 단추, 빈 상태", () => {
    const html = render("생성전");
    expect(text(html)).toContain("티스토리 초안 0/5개");
    expect(buttons(html)).toContain("티스토리 초안 만들기");
    expect(text(html)).toContain("아직 티스토리 초안이 없습니다.");
    expect(html).toContain(`name="briefId" value="${BRIEF}"`);
  });

  it("만들 수 없음: 서버가 준 이유를 그대로, 만들기 단추 없음", () => {
    const html = render("만들수없음");
    expect(text(html)).toContain("새 초안을 만들 수 없습니다: 브리프를 준비 완료로 바꾸면 초안을 만들 수 있습니다.");
    expect(buttons(html).some((b) => b.includes("초안 만들기"))).toBe(false);
  });

  it("작성 중: 카드마다 h3 제목·상태 배지(글자)·고치기·복사·내보내기·기록 남기기·보관", () => {
    const html = render("작성중");
    expect(html).toContain('aria-label="티스토리 초안 목록"');
    expect((html.match(/<h3 /g) ?? []).length).toBe(2);
    expect(text(html)).toContain("작성 중");
    expect(buttons(html)).toEqual(expect.arrayContaining(["서식째 복사 (기본 모드)", "HTML 소스 복사 (HTML 모드)", "글자만 복사", ".html 내려받기", ".md 내려받기", "초안 저장", "게시 기록 남기기", "이 초안 보관"]));
    expect(buttons(html)).toContain("티스토리 초안 하나 더 만들기");
    expect(text(html)).toContain("아직 게시 기록이 없습니다.");
    expect(text(html)).toContain("취소 안 된 기록 0/50");
    // 빈 값은 '비어 있음'
    expect(text(html)).toContain("비어 있음");
  });

  it("미리 보기에 HTML 을 넣지 않는다: 본문·HTML 소스는 글자로만(태그가 이스케이프됨)", () => {
    const html = render("작성중");
    const d = STATES["작성중"]!.data.drafts[0]!;
    expect(d.export.html).toContain("<h2>");
    expect(html).not.toContain(d.export.html); // 그대로 끼워 넣지 않음
    expect(html).toContain("&lt;h2&gt;1. 왜 정기 배송일까요?&lt;/h2&gt;"); // HTML 소스 상자에 글자로
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<h2>1\. 왜 정기 배송일까요\?<\/h2>/);
    // 본문 보기는 pre 안 글자
    expect(text(html)).toContain("## 1. 왜 정기 배송일까요?");
  });

  it("글 정보: 제목·태그·메타 설명 복사 단추, 이미지 자리 목록", () => {
    const html = render("작성중");
    expect(html).toContain('aria-label="제목 복사"');
    expect(html).toContain('aria-label="태그 복사"');
    expect(html).toContain('aria-label="메타 설명 복사"');
    expect(text(html)).toContain("정기배송, 커피, 출근길");
    expect(text(html)).toContain("본문 이미지 자리 1곳");
    expect(text(html)).toContain("정기 배송 상자 사진");
  });

  it("검토 완료: 배지 글자, 상태 선택에 '게시 기록됨' 없음", () => {
    const html = render("검토완료");
    expect(html).toMatch(/cdStatus_reviewed">검토 완료</);
    const opts = [...html.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map((m) => m[1]);
    expect(opts).toEqual(["작성 중", "검토 완료"]);
  });

  it("게시 기록됨: 링크는 서버 url 에만 + rel noopener noreferrer + 새 창, 취소 기록은 취소선·이유, 개인 도메인 안내", () => {
    const html = render("게시기록됨");
    expect(html).toMatch(/cdStatus_published">게시 기록됨</);
    expect(text(html)).toContain("취소 안 된 기록 1/50");
    const anchors = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
    expect(anchors).toHaveLength(1); // 취소한 기록은 링크 없음
    expect(anchors[0]).toContain('href="https://blog.example.com/coffee/3"');
    expect(anchors[0]).toContain('target="_blank"');
    expect(anchors[0]).toContain('rel="noopener noreferrer"');
    expect(text(html)).toContain("(새 창)");
    expect(html).toContain("<s>https://coffee-office.tistory.com/1</s>");
    expect(text(html)).toContain("취소됨");
    expect(text(html)).toContain("취소 이유: 주소를 잘못 적음");
    expect(text(html)).toContain("티스토리 주소가 맞는지 확인하세요");
    expect(text(html)).toContain("메모: 개인 도메인에 1차 발행");
    // 취소 행 자체는 목록에 따로 보이지 않는다(기록 2개만)
    expect((html.match(/class="cdPub /g) ?? []).length).toBe(2);
    // 취소는 아직 안 취소한 기록에만
    expect((html.match(/이 기록 취소/g) ?? []).length).toBe(1);
  });

  it("이전 전략 기준: 배지·안내·맞추기 단추(편집은 막지 않음)", () => {
    const html = render("이전전략");
    expect(text(html)).toContain("이전 전략 기준");
    expect(text(html)).toContain("지금 승인본(2번 버전)보다 앞선 전략");
    expect(text(html)).toContain("전략 1번 버전 기준");
    expect(buttons(html)).toContain("지금 승인본 기준으로 맞추기");
    expect(buttons(html)).toContain("초안 저장");
  });

  it("브리프 변경: 안내만(초안 내용은 그대로)", () => {
    expect(text(render("브리프변경"))).toContain("만든 뒤 브리프가 바뀌었습니다.");
  });

  it("브리프 보관: 새로 만들기만 막고 기존 초안은 고칠 수 있다", () => {
    const html = render("브리프보관");
    expect(text(html)).toContain("원본 브리프가 보관되었습니다.");
    expect(text(html)).toContain("보관한 브리프로는 초안을 만들 수 없습니다.");
    expect(buttons(html)).toEqual(expect.arrayContaining(["초안 저장", "게시 기록 남기기", "이 초안 보관"]));
  });

  it("초안 보관: 보관 목록에 들어가고 복사·내보내기만(고치기·기록·취소 없음, D4)", () => {
    const html = render("초안보관");
    expect(html).toContain('aria-label="보관한 티스토리 초안 목록"');
    expect(text(html)).toContain("보관한 초안 1개");
    expect(text(html)).toContain("보관한 초안입니다. 복사·내보내기만 할 수 있고");
    expect(forms(html)).toBe(1); // 남은 폼은 위쪽 '만들기'뿐
    expect(buttons(html)).not.toContain("초안 저장");
    expect(text(html)).not.toContain("이 기록 취소");
    expect(buttons(html)).toEqual(expect.arrayContaining(["서식째 복사 (기본 모드)", ".md 내려받기"]));
  });

  it("읽기 전용(프로젝트 보관·작업 취소): 폼이 하나도 없고 복사·내보내기와 기록 목록은 보인다", () => {
    const html = render("읽기전용");
    expect(forms(html)).toBe(0);
    expect(text(html)).toContain("읽기와 복사·내보내기만 할 수 있습니다");
    expect(buttons(html)).toEqual(expect.arrayContaining(["서식째 복사 (기본 모드)", "HTML 소스 복사 (HTML 모드)"]));
    expect(buttons(html)).not.toContain("지금 승인본 기준으로 맞추기");
    expect(text(html)).toContain("취소 이유: 주소를 잘못 적음");
  });

  it("초안 한도 5: 만들기 대신 이유", () => {
    const html = render("한도");
    expect(text(html)).toContain("티스토리 초안 5/5개");
    expect(text(html)).toContain("한 브리프에는 초안을 5개까지 둘 수 있습니다.");
  });

  it("기록 한도: 취소 안 된 기록 50 → 기록 남기기 대신 안내", () => {
    const html = render("기록한도");
    expect(text(html)).toContain("취소 안 된 기록 50/50");
    expect(buttons(html)).not.toContain("게시 기록 남기기");
    expect(text(html)).toContain("취소하지 않은 게시 기록이 50개라 더 남길 수 없습니다.");
  });

  it("조작부는 44px 범위(.funnel)와 touch 클래스 안에 있다", () => {
    const html = render("게시기록됨");
    expect(html).toMatch(/class="section funnel cdSection"/);
    for (const m of html.matchAll(/<button type="button" class="([^"]+)"/g)) expect(m[1], m[0]).toContain("touch");
  });

  it("게시 시각 입력: datetime-local, 기본값은 지금 한국 시간", () => {
    const html = render("작성중");
    expect(html).toMatch(/type="datetime-local"[^>]*value="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}"/);
    expect(text(html)).toContain("게시 시각 (한국 시간)");
  });
});

describe("ChannelDraftSection: 읽기", () => {
  const board = { strategy: { approvedVersion: V2 }, funnel: { id: id(1) } } as never;
  const detail = { brief: { id: BRIEF, archived: false } } as never;

  it("읽기 실패 → 오류 안내와 다시 불러오기", async () => {
    getChannelDraftsFor.mockRejectedValueOnce(new Error("db"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString((await ChannelDraftSection({ board, detail, readOnly: false, taskId: id(9) }))!);
    spy.mockRestore();
    expect(text(html)).toContain("티스토리 초안을 불러오지 못했습니다.");
    expect(html).toContain(`href="/tasks/${id(9)}?brief=${BRIEF}#channel-drafts"`);
  });
  it("퍼널·브리프가 없으면(null) 영역을 숨긴다", async () => {
    getChannelDraftsFor.mockResolvedValueOnce(null);
    expect(await ChannelDraftSection({ board, detail, readOnly: false, taskId: id(9) })).toBeNull();
  });
  it("정상: 받은 값을 그린다", async () => {
    getChannelDraftsFor.mockResolvedValueOnce(STATES["작성중"]!.data);
    const html = renderToString((await ChannelDraftSection({ board, detail, readOnly: false, taskId: id(9) }))!);
    expect(text(html)).toContain("티스토리 초안 2/5개");
  });
});

// 화면 점검용 HTML(4폭·2테마 브라우저 점검은 별도 스크립트). CHANNEL_DRAFT_HARNESS 가 있을 때만 파일을 쓴다
it.runIf(Boolean(process.env.CHANNEL_DRAFT_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.CHANNEL_DRAFT_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
  // 접힌 영역을 모두 펼친 모양
  for (const k of ["작성중", "게시기록됨"]) writeFileSync(join(out, `${k}-펼침.html`), render(k).replace(/<details class="inlineDetails">/g, '<details class="inlineDetails" open="">'));
});
