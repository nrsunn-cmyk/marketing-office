import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { P4ExternalBoard } from "@/features/execution/channels";
import type { ExecutionBoard, ExecutionJobView } from "./execution-model";

/** P4-EXTERNAL-UI-A11Y-01 외부 채널·P4B 패널: 한글 이름표·확정 문구·빈 상태·읽기 전용·이름표 있는 칸(가짜 데이터, 외부 API 없음) */
vi.mock("../../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children }: { submitLabel: string; children?: unknown }) =>
      h("form", null, children as never, h("button", { type: "submit", className: "button" }, submitLabel)),
  };
});
vi.mock("./execution.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { ExternalChannelsPanel, P4B_COPY, SCHEDULE_RUNNER_COPY, dueScheduleCount, P4_POLISH_COPY, safeExternalUrl, P4_LINK_KEEP_COPY, emptyResultOptionLabel } = await import("./execution-channels-panel");

const P = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const job = (x: Partial<ExecutionJobView> = {}): ExecutionJobView => ({
  id: "j1",
  status: "queued",
  statusLabel: "실행 대기",
  blockReason: null,
  blockReasonLabel: null,
  channel: "crm",
  idempotencyKey: "exec-j1",
  attemptCount: 0,
  revision: 1,
  source: { kind: "channel_draft", id: "d1", revision: 1, title: "초안" },
  payloadTitle: "11월 소식",
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
const board = (x: Partial<ExecutionBoard> = {}): ExecutionBoard =>
  ({ projectId: P, jobs: [job()], results: [], enqueueOptions: [{ draftId: "d1", title: "초안", revision: 1 }], canWrite: true, limits: {}, counts: { jobs: 1, results: 0 }, ...x }) as ExecutionBoard;
const conn = { id: "c1", channel: "crm" as const, status: "connected" as const, accountLabel: "회사 CRM", endpointUrl: "https://e", metricsUrl: "https://m", monthlyBudgetWon: 100000, perRunLimitWon: 5000, lastCheckedAt: null, lastErrorCode: null };
const full: P4ExternalBoard = {
  connections: [conn],
  schedules: [
    { id: "s1", executionJobId: "j1", scheduledAt: "2026-11-24T01:30:00Z", status: "scheduled", dueAt: null },
    { id: "s2", executionJobId: "j1", scheduledAt: "2026-11-25T01:30:00Z", status: "paused_version_changed", dueAt: null },
  ],
  inquiries: [{ id: "i1", sourceKind: "manual", maskedName: "김*수", maskedPhone: "010-****-1234", maskedEmail: "k***@a.com", status: "new", createdAt: "2026-11-20T00:00:00Z" }],
  followups: [{ id: "f1", inquiryId: "i1", assigneeName: "담당 A", dueDate: "2026-11-30", status: "todo", linkedResultId: null }],
};
const empty: P4ExternalBoard = { connections: [conn], schedules: [], inquiries: [], followups: [] };
const notConnected = async () => ({});
const html = (b: ExecutionBoard | null, e: P4ExternalBoard | null) =>
  renderToString(createElement(ExternalChannelsPanel, { board: b, externalBoard: e, actions: {}, notConnected })).replaceAll("<!-- -->", "");

describe("외부 채널·P4B 패널", () => {
  it("채널·상태 내부 값 대신 한글 이름표(AGY 권고 1·2)", () => {
    const h = html(board(), full);
    expect(h).toContain("[고객 관리] 11월 소식");
    expect(h).toContain("고객 관리 (회사 CRM)");
    for (const t of ["예약됨", "자동 보류", "신규", "할 일"]) expect(h).toContain(t);
    expect(h).not.toMatch(/>\s*(crm|search_ad|social_api|scheduled|paused_version_changed|new|todo)\s*</);
    expect(h).not.toMatch(/\[crm\]|상태: (scheduled|new|todo)/);
  });

  it("예약 시각은 한국 시각, 자동 보류는 경고 안내(확정 문구), 상태 배지 톤", () => {
    const h = html(board(), full);
    expect(h).toContain("2026-11-24 10:30 KST");
    expect(h).toContain(`<p class="exWarn">${P4B_COPY.scPaused}</p>`);
    expect(h).toMatch(/class="pill pillWarning">자동 보류</);
    expect(h).toMatch(/class="pill pillNeutral">예약됨</);
  });

  it("CRM 상태 고르기 칸은 이름표가 있고 확정 단추 문구를 쓴다", () => {
    const h = html(board(), full);
    expect(h).toMatch(/<label for="fst-f1">진행 상태<\/label><select id="fst-f1" name="status"/);
    expect(h).toContain(`>${P4B_COPY.iqConnect}</button>`);
    expect(h).toContain(`>${P4B_COPY.crSave}</button>`);
    expect(h).toContain('type="tel"');
  });

  it("빈 목록은 AGY 확정 빈 상태(제목·설명)", () => {
    const h = html(board(), empty);
    for (const t of [P4B_COPY.scEmpty, P4B_COPY.scEmptyDesc, P4B_COPY.iqEmpty, P4B_COPY.iqEmptyDesc, P4B_COPY.crEmpty, P4B_COPY.crEmptyDesc]) expect(h).toContain(t);
    expect(h).not.toContain("<ul class=\"exList\"></ul>");
  });

  it("보관 프로젝트(쓰기 불가)는 입력 폼 대신 권한 안내", () => {
    const h = html(board({ canWrite: false }), full);
    for (const t of [P4B_COPY.scNoPermission, P4B_COPY.iqNoPermission, P4B_COPY.crNoPermission]) expect(h).toContain(t);
    expect(h).not.toContain(P4B_COPY.iqConnect);
    expect(h).not.toContain("예약 등록");
  });

  it("P4-SCHEDULE-RUNNER-01: 예약 카드에 어느 실행 건인지 보이고, 예약 중·실행할 차례·자동 보류를 구분한다", () => {
    const tistory = job({ id: "j2", channel: "tistory_manual", payloadTitle: "티스토리 글", status: "queued" });
    const ext: P4ExternalBoard = {
      ...empty,
      schedules: [
        { id: "s1", executionJobId: "j1", scheduledAt: "2026-11-24T01:30:00Z", status: "due", dueAt: "2026-11-24T01:31:00Z" },
        { id: "s2", executionJobId: "j2", scheduledAt: "2026-11-24T02:30:00Z", status: "due", dueAt: "2026-11-24T02:31:00Z" },
        { id: "s3", executionJobId: "zz", scheduledAt: "2099-01-01T00:00:00Z", status: "scheduled", dueAt: null },
      ],
    };
    expect(dueScheduleCount(ext)).toBe(2);
    expect(dueScheduleCount(null)).toBe(0);
    const h = html(board({ jobs: [job(), tistory] }), ext);
    expect(h).toContain("[고객 관리] 11월 소식 · 2026-11-24 10:30 KST");
    expect(h).toContain("[티스토리] 티스토리 글 · 2026-11-24 11:30 KST");
    expect(h).toContain(`${SCHEDULE_RUNNER_COPY.unknownJob} · `); // 목록에 없는 실행 건은 이름 대신 '실행 건'
    expect((h.match(/class="pill pillInfo">실행할 차례</g) ?? []).length).toBe(2);
    expect((h.match(new RegExp(SCHEDULE_RUNNER_COPY.dueNote, "g")) ?? []).length).toBe(2);
    expect(h).toContain('href="#external-dispatch"'); // 외부 채널은 외부 실행 구획으로
    expect(h).toContain('href="#job-j2"'); // 티스토리는 그 실행 건 카드로
    expect((h.match(new RegExp(`>${P4B_COPY.scCancel}</button>`, "g")) ?? []).length).toBe(3); // 실행할 차례도 취소할 수 있다
    expect(h).toMatch(/<details class="exFold" open="">\s*<summary>예약 실행 \(3건\) · 실행할 차례 2건<\/summary>/);
    expect(h.replaceAll("&#x27;", "'")).toContain(SCHEDULE_RUNNER_COPY.intro);
  });

  it("실행할 차례가 없으면 예약 구획은 접힌 채, 요약에 차례 건수를 붙이지 않는다", () => {
    const h = html(board(), full);
    expect(h).toMatch(/<details class="exFold">\s*<summary>예약 실행 \(2건\)<\/summary>/);
    expect(h).not.toContain(SCHEDULE_RUNNER_COPY.dueNote);
  });

  it("P4-UX-POLISH A3·A5: 후속 카드에 '상담: 이름'(없으면 생략), 후속 연결됨 상담은 '후속 작업 추가'", () => {
    const h = html(board(), full);
    expect(h).toContain("상담: 김*수 · 담당: 담당 A · 기한: 2026-11-30");
    const linked: P4ExternalBoard = {
      ...full,
      inquiries: [{ ...full.inquiries[0], status: "linked" }],
      followups: [{ ...full.followups[0], inquiryId: "없는-상담" }],
    };
    const h2 = html(board(), linked);
    expect(h2).toContain(`>${P4_POLISH_COPY.addFollowup}</button>`);
    expect(h2).not.toContain(`>${P4B_COPY.iqConnect}</button>`);
    expect(h2).toContain("<span>담당: 담당 A · 기한: 2026-11-30</span>"); // 짝이 없으면 '상담:' 생략
  });

  it("P4-UX-POLISH A4: '연결할 성과'는 활성 성과만, 연결된 성과는 이름을 보이고 고르기 칸 기본값", () => {
    const res = (id: string, x: object = {}) =>
      ({ id, metricName: `성과 ${id}`, value: 12, unit: "count", numerator: null, denominator: null, status: "active", archivedAt: null, ...x }) as unknown as ExecutionBoard["results"][number];
    const b = board({ results: [res("r1"), res("r2", { status: "voided" }), res("r3", { archivedAt: "2026-11-20T00:00:00Z" })] });
    const h = html(b, { ...full, followups: [{ ...full.followups[0], linkedResultId: "r1" }] });
    expect(h).toMatch(/<label for="flr-f1">연결할 성과<\/label><select id="flr-f1" name="linkedResultId">/);
    // Tester msg_d50295c3379a: 연결이 있으면 빈 선택지는 '유지'다(서버 coalesce)
    expect(h).toContain(`<option value="">${P4_LINK_KEEP_COPY.linkResultKeep}</option>`);
    expect(h).not.toContain('<option value="">선택 안 함</option>');
    expect(h).toMatch(/<option value="r1" selected="">성과 r1 · /);
    // 연결이 없으면 그대로 '선택 안 함'
    const hNone = html(b, { ...full, followups: [{ ...full.followups[0], linkedResultId: null }] });
    expect(hNone).toContain('<option value="" selected="">선택 안 함</option>'); // 연결이 없으면 빈 선택지가 기본값
    expect(emptyResultOptionLabel(null)).toBe(P4_POLISH_COPY.linkResultNone);
    expect(emptyResultOptionLabel("r1")).toBe(P4_LINK_KEEP_COPY.linkResultKeep);
    expect(h).not.toContain('value="r2"');
    expect(h).not.toContain('value="r3"');
    expect(h).toContain(P4_POLISH_COPY.linkedResult("성과 r1 · 12"));
    // 활성 성과가 없으면 칸을 그리지 않는다
    expect(html(board(), full)).not.toContain("flr-f1");
  });

  it("P4-UX-POLISH A6: 외부 게시 주소는 https 만 새 창 링크(noopener noreferrer), 그 밖은 글자로만", () => {
    const h = html(board({ jobs: [job({ status: "succeeded", externalUrl: "https://sns.example.test/p/1" })] }), full);
    expect(h).toContain('<a href="https://sns.example.test/p/1" target="_blank" rel="noopener noreferrer" class="touchLink">https://sns.example.test/p/1</a>');
    const h2 = html(board({ jobs: [job({ status: "succeeded", externalUrl: "http://sns.example.test/p/1" })] }), full);
    expect(h2).toContain("외부 게시 주소: http://sns.example.test/p/1</p>");
    expect(h2).not.toContain('href="http://sns.example.test');
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });

  it("외부 보드를 못 읽으면 P4B 구역은 그리지 않는다(연결 설정은 남음)", () => {
    const h = html(board(), null);
    expect(h).toContain("외부 채널 연결 설정");
    expect(h).not.toContain("p4b-ops");
  });
});

// 화면 점검용 HTML(4폭·테마 점검은 별도 스크립트). EXT_HARNESS 가 있을 때만
it.runIf(Boolean(process.env.EXT_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.EXT_HARNESS!;
  mkdirSync(out, { recursive: true });
  const states: Record<string, string> = {
    목록있음: html(board(), full),
    빈목록: html(board(), empty),
    읽기전용: html(board({ canWrite: false }), full),
  };
  for (const [k, v] of Object.entries(states)) writeFileSync(join(out, `${k}.html`), v);
});
