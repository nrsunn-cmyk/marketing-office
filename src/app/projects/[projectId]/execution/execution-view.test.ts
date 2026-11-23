import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EXECUTION_LIMITS } from "@/domain/execution";
import type { P4ExternalBoard } from "@/features/execution/channels";
import type { ExecutionBoard, ExecutionJobView, ExecutionResultView } from "./execution-model";

/** P4A-UI-01 실행·성과 화면 상태별(서버 보기 모양의 가짜 데이터, 외부 API 없음) */
vi.mock("../../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("./execution.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { ExecutionView } = await import("./execution-view");
const { EX_LABELS } = await import("./execution-model");
const { ExecutionEntryCard, ProjectJumpBar } = await import("./execution-entry");

const P = "pppppppp-pppp-4ppp-8ppp-000000000001";
const job = (n: number, x: Partial<ExecutionJobView> = {}): ExecutionJobView => ({
  id: `jjjjjjjj-jjjj-4jjj-8jjj-00000000000${n}`,
  status: "pending_approval",
  statusLabel: "승인 대기",
  blockReason: null,
  blockReasonLabel: null,
  channel: "tistory_manual",
  idempotencyKey: `exec-jjjjjjjj-jjjj-4jjj-8jjj-00000000000${n}`,
  attemptCount: 0,
  revision: 3,
  source: { kind: "channel_draft", id: `d${n}`, revision: 2, title: `나다음 오픈 안내 ${n}` },
  payloadTitle: `나다음 오픈 안내 ${n}`,
  liveMatches: true,
  approvedAt: null,
  executedAt: null,
  externalUrl: null,
  publicationId: null,
  publicationVoided: false,
  archivedAt: null,
  createdAt: "2026-11-20T00:00:00Z",
  ...x,
});
const result = (n: number, x: Partial<ExecutionResultView> = {}): ExecutionResultView => ({
  id: `rrrrrrrr-rrrr-4rrr-8rrr-00000000000${n}`,
  executionJobId: null,
  metricName: "티스토리 글 조회수",
  value: 342,
  unit: "count",
  numerator: null,
  denominator: null,
  sourceNote: "티스토리 방문자 통계 화면 직접 확인",
  periodStart: "2026-11-13",
  periodEnd: "2026-11-19",
  collectionMode: "manual_entry",
  status: "active",
  voidReason: null,
  archivedAt: null,
  createdAt: "2026-11-20T00:00:00Z",
  ...x,
});
const board = (x: Partial<ExecutionBoard> = {}): ExecutionBoard => ({ projectId: P, jobs: [], results: [], enqueueOptions: [], canWrite: true, limits: EXECUTION_LIMITS, counts: { jobs: 0, results: 0 }, ...x });
const ALL_JOBS = [
  job(1),
  job(2, { status: "blocked_mismatch", statusLabel: "판 불일치 차단", blockReason: "content_changed", liveMatches: false }),
  job(3, { status: "blocked_mismatch", statusLabel: "판 불일치 차단", blockReason: "source_archived", liveMatches: false }),
  job(4, { status: "queued", statusLabel: "실행 대기", approvedAt: "2026-11-20T01:00:00Z" }),
  job(5, { status: "held", statusLabel: "보류" }),
  job(6, { status: "failed", statusLabel: "실패", attemptCount: 1, executedAt: "2026-11-19T18:40:00Z" }),
  job(7, { status: "succeeded", statusLabel: "완료", executedAt: "2026-11-19T18:55:00Z", externalUrl: "https://nadaum.tistory.com/42", publicationId: "pub1", publicationVoided: true }),
];

const STATES: Record<string, { board: ExecutionBoard | null }> = {
  대기열: { board: board({ jobs: ALL_JOBS, results: [result(1), result(2, { metricName: "상담 후속 클릭률", value: 18.4, unit: "percent", numerator: 23, denominator: 125 })] }) },
  빈상태: { board: board() },
  읽기전용: { board: board({ jobs: [job(1), job(4, { status: "queued", statusLabel: "실행 대기" })], results: [result(1)], canWrite: false }) },
  취소보관: { board: board({ results: [result(1, { status: "voided", voidReason: "기간을 잘못 적음" }), result(2, { archivedAt: "2026-11-20T02:00:00Z" })] }) },
  불러오기실패: { board: null },
};
const render = (k: string) => renderToString(createElement(ExecutionView, { board: STATES[k].board, projectTitle: "나다음 리뉴얼" }));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const buttons = (h: string) => [...h.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => text(m[1]).trim());

describe("실행·성과 화면(P4A-UI-01)", () => {
  it("모든 상태: 앵커 셋(#queue·#results·#channels)·돌아가기, 준비 중 채널 셋, 진행률 막대·% 막대 없음, 자동 게시 단추 없음", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      for (const a of ['href="#queue"', 'href="#channels"', 'id="channels"']) expect(h, `${k} ${a}`).toContain(a);
      // UX-EXEC-JUMP-FRONT-01: 성과 구획이 없는 불러오기 실패에서는 #results 링크도 없다(없는 곳을 가리키지 않음)
      if (STATES[k].board) expect(h, k).toContain('href="#results"');
      else expect(h, k).not.toContain('href="#results"');
      expect(h, k).not.toMatch(/<progress|role="progressbar"/);
      expect(text(h), k).not.toMatch(/자동 게시하기|지금 게시/);
      expect(count(h, /준비 중 \(외부 채널은 아직 연결되지 않았습니다\)/g), k).toBeGreaterThanOrEqual(3);
    }
  });

  it("대기열: 상태별 단추(승인·맞추기·재개·다시 시도(1/3)·보류·기록 폼), 막힘 원인별 문구, 지문 일치, 멱등 키", () => {
    const h = render("대기열");
    const t = text(h);
    const b = buttons(h);
    expect(b.filter((x) => x === "실행 승인")).toHaveLength(1);
    expect(b.filter((x) => x === "최신 초안 기준으로 맞추기")).toHaveLength(2);
    expect(b).toContain("재개");
    expect(b).toContain("다시 시도 (1/3)");
    expect(b.filter((x) => x === "보류")).toHaveLength(3); // 승인 대기·실행 대기·실패
    expect(b.filter((x) => x === "티스토리 게시 완료 기록")).toHaveLength(1);
    expect(t).toContain("막힘 원인 (content_changed): 승인 이후 초안 내용이 바뀌었습니다.");
    expect(t).toContain("막힘 원인 (source_archived): 원본 초안이 보관되었습니다. 이 실행 건을 보관해 주세요.");
    expect(t).toContain("지문 일치");
    expect(t).toContain("채널: 티스토리 수동 게시 · 멱등 키: exec-jjjjjjjj-jjjj-4jjj-8jjj-000000000001");
    // 기록 폼: 주소·한국 시각·메모, revision
    expect(h).toMatch(/<input(?=[^>]*name="url")(?=[^>]*type="url")/);
    expect(h).toMatch(/<input(?=[^>]*name="publishedAt")(?=[^>]*type="datetime-local")/);
    expect(h).toContain('name="revision" value="3"');
  });

  it("실행 기록: 완료 건 실행 시각·대상 주소(새 창, noopener), 게시 취소 경고, 실패 시도 수", () => {
    const h = render("대기열");
    const t = text(h);
    expect(t).toContain("실행 기록 (멱등 키 · 재시도 최대 3회 · already_done)");
    expect(t).toContain("실행 시각: 2026-11-20 03:55 KST");
    expect(h).toContain('href="https://nadaum.tistory.com/42" target="_blank" rel="noopener noreferrer" class="touchLink"');
    expect(t).toContain("연결된 티스토리 게시 기록이 나중에 취소되었습니다. 새 게시 기록이 필요하면 새로 올려 주세요.");
    expect(t).toContain("시도 1/3");
  });

  it("성과: 제목·기간·단위·출처, 비율 괄호, 수동 입력 배지, 취소(사유)·보관 접힘, 입력 폼 칸(단위 4종·날짜 최댓값)", () => {
    const h = render("대기열");
    const t = text(h);
    expect(t).toContain("티스토리 글 조회수 · 342건");
    expect(t).toContain("상담 후속 클릭률 · 18.4% (23 / 125)");
    expect(t).toContain("기간: 2026-11-13 ~ 2026-11-19 (KST 7일) · 단위: 건(count)");
    expect(t).toContain("수동 입력");
    expect(h).toMatch(/<summary>이 기록 취소<\/summary>/);
    expect(h).toMatch(/<summary>이 성과 보관<\/summary>/);
    for (const k of ["count", "percent", "won", "seconds"]) expect(h).toContain(`<option value="${k}"`);
    expect(h).toMatch(/<input(?=[^>]*name="periodStart")(?=[^>]*type="date")(?=[^>]*max="\d{4}-\d{2}-\d{2}")/);
    expect(h).toContain(`name="projectId" value="${P}"`);
  });

  it("빈 상태: 대기열·성과 빈 안내, 성과 입력 폼은 펼침", () => {
    const h = render("빈상태");
    expect(text(h)).toContain("아직 실행 대기열에 올라온 건이 없습니다.");
    expect(text(h)).toContain("검토 완료된 티스토리 초안을 선택해 대기열에 올린 뒤 승인해 주세요.");
    expect(text(h)).toContain("아직 기록된 성과 수치가 없습니다.");
    expect(h).toMatch(/<details open=""><summary>\+ 성과 입력<\/summary>/);
  });

  it("읽기 전용(보관 프로젝트): 안내, 폼 0, 조회는 남음", () => {
    const h = render("읽기전용");
    expect(text(h)).toContain("보관한 프로젝트이거나 실행 건을 고칠 권한이 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(text(h)).toContain("티스토리 글 조회수 · 342건");
  });

  it("취소·보관한 성과: 배지·사유, 그 행엔 취소·보관 단추 없음", () => {
    const h = render("취소보관");
    expect(text(h)).toContain("취소됨");
    expect(text(h)).toContain("취소 사유: 기간을 잘못 적음");
    expect(count(h, /<summary>이 기록 취소<\/summary>/g)).toBe(0);
    expect(count(h, /<summary>이 성과 보관<\/summary>/g)).toBe(1); // 취소 행은 보관 가능, 보관 행은 없음
  });

  it("막힘 알림 영역(P4-ALERT-FRONT-01): 대기열 제목 바로 아래·목록 위 한 곳, 처음엔 비어 있고 카드의 막힘 원인(role=note)은 그대로", () => {
    for (const k of Object.keys(STATES).filter((x) => STATES[x].board)) {
      const h = render(k);
      const head = h.indexOf('<h2 id="queue"');
      const region = h.indexOf('<div role="status" aria-live="polite" aria-atomic="true" data-queue-alert=""></div>');
      expect(head, k).toBeGreaterThan(-1);
      expect(region, k).toBeGreaterThan(head);
      expect(h.slice(head, region), k).not.toMatch(/<ul|<li/);
      expect(h.split("data-queue-alert").length - 1, k).toBe(1);
    }
    const all = Object.keys(STATES).map(render).join("");
    expect(all).toMatch(/class="exWarn" role="note"/);
  });

  it("불러오기 실패: 알림", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("실행 대기열을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  });

  it("글은 이스케이프되어 HTML 로 들어가지 않는다", () => {
    const evil = '"><script>alert(1)</script>';
    const h = renderToString(createElement(ExecutionView, { board: board({ jobs: [job(1, { source: { kind: "channel_draft", id: "d", revision: 1, title: evil } })], results: [result(1, { metricName: evil, sourceNote: evil })] }), projectTitle: evil }));
    expect(h).not.toContain("<script>");
  });
});

describe("프로젝트 상세 진입(entry.html 2·4번)", () => {
  it("앵커 여섯(정보 → 작업 → P3 제작·납품 → 실행·성과 → 자료 → 외부 출처, UX F5)", () => {
    const h = renderToString(createElement(ProjectJumpBar));
    expect([...h.matchAll(/href="(#[^"]+)"/g)].map((m) => m[1])).toEqual(["#project-info", "#tasks", "#p3-production", "#p4-execution", "#project-assets", "#project-sources"]);
  });
  it("진입 카드: 상태별 건수(분수·% 없음)와 전용 화면 단추 둘, 건수 못 읽으면 단추만", () => {
    const h = renderToString(createElement(ExecutionEntryCard, { projectId: P, counts: { pending: 1, queued: 2, blocked: 1, results: 3 } }));
    const t = text(h);
    for (const s of ["승인 대기 1건", "실행 대기 · 진행 2건", "판 불일치 차단 1건", "성과 수동 입력 3건"]) expect(t).toContain(s);
    expect(t).not.toMatch(/%|\d+\s*\/\s*\d+/);
    expect(h).toContain(`href="/projects/${P}/execution#queue"`);
    expect(h).toContain(`href="/projects/${P}/execution#results"`);
    expect(h).toContain('id="p4-execution"');
    const n = renderToString(createElement(ExecutionEntryCard, { projectId: P, counts: null }));
    expect(n).not.toContain("<dl");
    expect(n).toContain("실행 대기열 · 수동 게시 관리");
  });
});

// 화면 점검용 HTML(4폭·테마 점검은 별도 스크립트). EX_HARNESS 가 있을 때만
it.runIf(Boolean(process.env.EX_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.EX_HARNESS!;
  mkdirSync(out, { recursive: true });
  // 실제 화면처럼 페이지 틀(touchPage: 단추·입력 44px) 안에 둔다
  const page = (h: string) => `<main class="page wide touchPage">${h}</main>`;
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), page(render(k)));
  writeFileSync(
    join(out, "진입카드.html"),
    page(renderToString(createElement(ProjectJumpBar)) + renderToString(createElement(ExecutionEntryCard, { projectId: P, counts: { pending: 1, queued: 2, blocked: 1, results: 3 } }))),
  );
});

describe("UX-EXEC-JUMP-FRONT-01 바로가기 막대와 외부 연동 구획", () => {
  const conn = (status: "connected" | "disconnected") =>
    ({ id: "c1", channel: "crm", status, accountLabel: "회사 CRM", endpointUrl: "https://e", metricsUrl: "https://m", monthlyBudgetWon: 100000, perRunLimitWon: 5000, lastCheckedAt: null, lastErrorCode: null }) as P4ExternalBoard["connections"][number];
  const ext = (status: "connected" | "disconnected"): P4ExternalBoard => ({ connections: [conn(status)], schedules: [], inquiries: [], followups: [] });
  const CASES: Record<string, { b: ExecutionBoard | null; e: P4ExternalBoard | null | undefined; jumps: string[] }> = {
    "외부 연동 없음(undefined)": { b: board(), e: undefined, jumps: ["queue", "results", "channels"] },
    "외부 연동 불러오기 실패(null)": { b: board(), e: null, jumps: ["queue", "results", "channels", "external-channels-setup"] },
    "외부 연동 · 미연결": { b: board(), e: ext("disconnected"), jumps: ["queue", "results", "external-channels-setup", "p4b-ops"] },
    "외부 연동 · 연결됨": { b: board(), e: ext("connected"), jumps: ["queue", "results", "external-channels-setup", "external-dispatch", "p4b-ops"] },
    "대기열 실패 · 외부 연동 연결됨": { b: null, e: ext("connected"), jumps: ["queue", "external-channels-setup"] },
  };
  const jumpsOf = (h: string) => [...(h.match(/<nav aria-label="실행 화면 바로 가기">[\s\S]*?<\/nav>/)?.[0] ?? "").matchAll(/href="#([a-z0-9-]+)"/g)].map((m) => m[1]);
  const sectionsOf = (h: string) => [...h.matchAll(/<h2 id="([a-z0-9-]+)"/g)].map((m) => m[1]);

  for (const [k, c] of Object.entries(CASES)) {
    it(`${k}: 막대 링크 = 실제 구획(순서 그대로), 없는 곳을 가리키지 않음`, () => {
      const h = renderToString(createElement(ExecutionView, { board: c.b, projectTitle: "나다음 리뉴얼", externalBoard: c.e })).replaceAll("<!-- -->", "");
      expect(jumpsOf(h)).toEqual(c.jumps);
      expect(sectionsOf(h)).toEqual(c.jumps);
    });
  }

  it("외부 연동을 불러왔으면 '준비 중인 외부 채널' 구획·링크가 없고(설정 구획과 중복 방지), AGY 막대 이름을 쓴다", () => {
    const h = text(renderToString(createElement(ExecutionView, { board: board(), projectTitle: "나다음 리뉴얼", externalBoard: ext("connected") })));
    expect(h).not.toContain(EX_LABELS.channelsHeading);
    expect(h).not.toContain(EX_LABELS.jumpChannels);
    expect(h).not.toContain("연동 가능");
    // 대기열 머리 '준비 중' 태그도 뺀다(AGY msg_a00e8d11a62d). 옆 '1차 입력' 태그는 유지
    expect(h).not.toContain("아직 연결되지 않았습니다");
    expect(h).toContain(EX_LABELS.firstSource);
    for (const l of ["외부 채널 설정", "외부 채널 실행", "예약·상담·CRM"]) expect(h).toContain(l);
    // G6(AGY msg_979029ebaf58): 성과 구획 머리 '자동 수집: 준비 중' 태그도 뺀다
    expect(h).not.toContain("자동 수집: 준비 중");
  });

  it("G6 성과 머리 태그는 외부 연동이 없거나 조회 실패면 유지, 자동 수집 성과 배지는 '자동 수집'(준비 중 아님)", () => {
    for (const e of [undefined, null]) {
      const t = text(renderToString(createElement(ExecutionView, { board: board(), projectTitle: "나다음 리뉴얼", externalBoard: e })));
      expect(t, String(e)).toContain("자동 수집: 준비 중 (수동 입력만)");
    }
    const b = board({ results: [result(1), result(2, { collectionMode: "readonly_sync" })] });
    const t = text(renderToString(createElement(ExecutionView, { board: b, projectTitle: "나다음 리뉴얼", externalBoard: ext("connected") })));
    expect(t).toContain(` ${EX_LABELS.manualBadge} `);
    expect(EX_LABELS.syncBadge).toBe("자동 수집");
    expect(t).toMatch(/ 자동 수집 /);
    expect(t).not.toContain("읽기 전용 수집)");
  });
});
