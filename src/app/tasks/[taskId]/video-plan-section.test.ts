import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { VideoPlanData, VideoPlanView } from "./video-plan-model";
import type { VideoPlanBoard } from "./video-plan-section";

/**
 * P3D-UI-CONNECT-01 영상 구성·파일 관리 상태별 화면(서버 보기 모양의 가짜 보드, 실제 첨부 없음).
 * 시안 video-plan.html 상태 6종 + 원인별 이전 기준(브리프·자산)·맞추기 막힘·자산 보관 경고·구성안 판 이력·첨부 막힘·한도·불러오기 실패.
 */
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("@/features/video-plans/actions", () => ({
  archiveVideoPlanAction: vi.fn(),
  cancelVideoUploadAction: vi.fn(),
  createVideoPlanAction: vi.fn(),
  finishVideoUploadAction: vi.fn(),
  rebaseVideoPlanAction: vi.fn(),
  restoreVideoFileVersionAction: vi.fn(),
  restoreVideoPlanVersionAction: vi.fn(),
  saveVideoPlanAction: vi.fn(),
  startVideoUploadAction: vi.fn(),
  videoDownloadUrlAction: vi.fn(),
}));
vi.mock("@/features/video-plans/server", () => ({}));
vi.mock("@/features/production-brief/server", () => ({}));
vi.mock("@/features/projects/server", () => ({}));
vi.mock("./qa-fix-flags", () => ({ fixRequestedIdsFor: async () => [] }));
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./video-plan.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./design-assets.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { VideoPlanSection } = await import("./video-plan-section");

const ASSETS = [
  { id: "as1", label: "로고 심볼 패키지 (v2)" },
  { id: "as2", label: "로열 블루 색상 토큰 (v2)" },
];
const PLAN: VideoPlanView = {
  id: "vvvvvvvv-vvvv-4vvv-8vvv-000000000001",
  title: "나다음 서비스 소개 영상",
  aspectRatio: "16:9",
  status: "drafting",
  archivedAt: null,
  revision: 5,
  stale: false,
  staleReasons: [],
  staleAssetCount: 0,
  rebaseBlockedCode: null,
  rebaseBlockedReason: null,
  archivedAssetCount: 0,
  totalSec: 38,
  scenes: [
    { id: "sc1", sceneTitle: "문제 제기 (오프닝)", durationSec: 15, narration: "로고, 홈페이지, 견적까지 매번 다른 파일로 흩어져 관리가 어려우셨나요?", subtitle: "", assetIds: ["as1", "as2"], sortOrder: 1 },
    { id: "sc2", sceneTitle: "해결 흐름 및 CTA", durationSec: 23, narration: "승인된 브리프로 한 번에 확인하세요.", subtitle: "지금 바로 시작하세요", assetIds: [], sortOrder: 2 },
  ],
  files: [
    { version: 2, fileName: "nadaum-intro-v2.mp4", fileSizeBytes: 29779558, savedAt: "2026-11-19T13:10:00Z", note: "자막 싱크 보정본", current: true, kind: "upload", restoredFromVersion: null },
    { version: 1, fileName: "nadaum-intro-v1.mp4", fileSizeBytes: 27367424, savedAt: "2026-11-18T09:05:00Z", note: "1차 편집본", current: false, kind: "upload", restoredFromVersion: null },
  ],
  planVersions: [
    { version: 3, kind: "save", status: "drafting", savedAt: "2026-11-19T23:40:00Z", sceneCount: 2, totalSec: 38, restoredFromVersion: null, current: true },
    { version: 2, kind: "save", status: "drafting", savedAt: "2026-11-19T23:10:00Z", sceneCount: 3, totalSec: 53, restoredFromVersion: null, current: false },
  ],
};
const BRIEF = { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", title: "브랜드 리뉴얼 제작 브리프" };
const data = (plan: VideoPlanView | null, x: Partial<VideoPlanData> = {}): VideoPlanData => ({
  plan,
  canWrite: plan !== null,
  readOnlyReason: null,
  canCreate: plan === null,
  createBlockedCode: null,
  createBlockedReason: plan === null ? null : "작업 중인 영상 구성안이 이미 있습니다.",
  canAttach: plan !== null,
  attachBlockedReason: null,
  assets: ASSETS,
  activePlanCount: plan === null ? 0 : 1,
  ...x,
});
const board = (d: VideoPlanData, brief = BRIEF): VideoPlanBoard => ({ brief, data: d });
const stale = (x: Partial<VideoPlanView>): VideoPlanView => ({ ...PLAN, stale: true, ...x });

const STATES: Record<string, { boards: VideoPlanBoard[] | null; readOnly?: boolean }> = {
  작성중: { boards: [board(data(PLAN))] },
  검토완료: { boards: [board(data({ ...PLAN, status: "reviewed" }))] },
  이전기준: { boards: [board(data(stale({ staleReasons: ["brief", "asset"], staleAssetCount: 2 })))] },
  맞추기막힘: { boards: [board(data(stale({ staleReasons: ["brief"], rebaseBlockedCode: "brief_drafting", rebaseBlockedReason: "제작 브리프가 작성 중이라 맞출 수 없습니다. 브리프를 확정한 뒤 맞춰 주세요." })))] },
  자산보관: { boards: [board(data({ ...PLAN, archivedAssetCount: 2 }))] },
  보관: { boards: [board(data({ ...PLAN, status: "reviewed", archivedAt: "2026-11-20T00:00:00Z" }, { canWrite: false, canAttach: false, readOnlyReason: "보관한 영상 구성안입니다. 조회와 파일 내려받기만 할 수 있고 고치기·첨부는 할 수 없습니다." }))] },
  읽기전용: { boards: [board(data(stale({ staleReasons: ["brief"] })))], readOnly: true },
  첨부꺼짐: { boards: [board(data(PLAN, { canAttach: false, attachBlockedReason: "영상 파일 첨부가 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요." }))] },
  빈상태: { boards: [board(data(null))] },
  구성안한도: { boards: [board(data(null, { canCreate: false, createBlockedCode: "plan_limit_total", createBlockedReason: "영상 구성안은 제작 브리프당 10개까지입니다(보관 포함)." }))] },
  브리프없음: { boards: [] },
  불러오기실패: { boards: null },
};
const render = (k: string) => renderToString(createElement(VideoPlanSection, { boards: STATES[k].boards, readOnly: Boolean(STATES[k].readOnly), taskId: "t-1" }));
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const REBASE = "최신 기준으로 맞추기";

describe("영상 구성·파일 관리 상태별 화면(서버 연결)", () => {
  it("모든 상태: 제목·소개·영역 이름, SVG 는 장식, 진행률 막대 없음", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      expect(h, k).toContain('aria-labelledby="video-plan"');
      expect(count(h, /id="video-plan"/g), k).toBe(1);
      expect(text(h), k).toContain("장면별 대사·자막·길이·사용 자산을 기획하고");
      expect(h, k).not.toMatch(/<svg(?![^>]*aria-hidden="true")/);
      expect(h, k).not.toMatch(/progressbar|<progress/);
    }
  });

  it("작성 중: 브리프 블록·배지(길이 합계·대표 구성안 활성 n/5)·범위 안내·편집기·판 이력·파일·업로드 패널·보관 확인", () => {
    const h = render("작성중");
    const t = text(h);
    expect(t).toContain("기준 제작 브리프: 브랜드 리뉴얼 제작 브리프");
    expect(t).toContain("총 38초 · 2장면");
    expect(t).toContain("대표 구성안 · 활성 1 / 5개");
    expect(t).toContain("범위 안내: 이 화면은 영상 구성안 작성과 완성 파일 버전 관리만 합니다.");
    expect(t).toContain("구성안 저장");
    expect(h).toContain(`name="planId" value="${PLAN.id}"`);
    // 판 이력: 최신 위, 현재 판, 옛 판 되돌리기(versionNo)
    expect(t).toContain("구성안 판 이력 · 되돌리기 (최대 100판 · 빼기 장면 복구)");
    expect(t).toContain("v3 (현재) · 저장");
    expect(t).toContain("현재 판");
    expect(t).toContain("2026-11-20 08:10 KST · 총 53초 · 3장면");
    expect(h).toContain('name="versionNo" value="2"');
    expect(t).toContain("이 판으로 되돌리기");
    // 파일: 판마다 내려받기, 옛 판 되돌리기(version), 업로드 패널(허용 형식에 서버 한도 50.0 MB)
    expect(t).toContain("2. 첨부 영상 파일 및 버전 (2 / 20버전)");
    expect(t).toContain("허용 형식: MP4, MOV, WEBM (최대 크기 한도는 서버 버킷 설정값 50.0 MB 따름)");
    expect(count(h, /aria-label="v\d 내려받기"/g)).toBe(2);
    expect(h).toContain('name="version" value="1"');
    expect(t).toContain("이 버전으로 되돌리기");
    expect(h).toContain('accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"');
    expect(t).toContain("+ 새 영상 파일 첨부");
    expect(t).toContain("버전 메모 (선택)");
    expect(h).toMatch(/<details[^>]*><summary>이 구성안 보관<\/summary>/);
    // 만들 수 없을 때(이미 대표 있음) 만들기 폼 없음
    expect(t).not.toContain("+ 영상 구성안 만들기");
  });

  it("이전 기준(원인별): 브리프·자산 안내 둘(자산은 서버 staleAssetCount 로 바뀐 자산 n개) + 맞추기", () => {
    const t = text(render("이전기준"));
    expect(t).toContain("이전 기준: 공통 제작 브리프가 새 버전으로 바뀌었습니다. 대사와 장면 구성을 확인해 주세요.");
    expect(t).toContain("연결된 디자인 자산 2개가 새 판으로 바뀌었습니다. 사용 자산을 확인해 주세요.");
    expect(t).not.toContain("공통 제작 브리프 또는 연결된 디자인 자산이 새 버전으로");
    expect(t).toContain(REBASE);
  });

  it("맞추기 막힘: AGY 원인 문구, 맞추기 단추 없음", () => {
    const t = text(render("맞추기막힘"));
    expect(t).toContain("바탕 제작 브리프가 아직 확정 전이라 최신 기준으로 맞출 수 없습니다.");
    expect(t).not.toContain(REBASE);
  });

  it("자산 보관 경고(이전 기준과 별도)", () => {
    const t = text(render("자산보관"));
    expect(t).toContain("연결된 디자인 자산 2개가 보관되었습니다. 필요하면 다른 자산으로 바꿔 주세요.");
    expect(t).not.toContain("이전 기준:");
  });

  it("보관: 보관 배지·안내, 폼·첨부·되돌리기 0개, 내려받기는 남음", () => {
    const h = render("보관");
    const t = text(h);
    expect(t).toContain("보관한 영상 구성안입니다. 조회와 파일 내려받기만 할 수 있고 고치기·첨부는 할 수 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(h).not.toContain('type="file"');
    expect(t).not.toContain("이 판으로 되돌리기");
    expect(t).not.toContain("이 버전으로 되돌리기");
    expect(count(h, /aria-label="v\d 내려받기"/g)).toBe(2);
    expect(t).toContain("문제 제기 (오프닝)");
  });

  it("읽기 전용: 프로젝트 안내 한 번, 폼·맞추기 0개", () => {
    const h = render("읽기전용");
    expect(count(h, /보관한 프로젝트이거나 취소한 작업이라 고칠 수 없습니다\./g)).toBe(1);
    expect(count(h, /<form/g)).toBe(0);
    expect(text(h)).not.toContain(REBASE);
  });

  it("첨부 꺼짐(서버 사유): 업로드 패널 없이 사유 글", () => {
    const h = render("첨부꺼짐");
    expect(text(h)).toContain("영상 파일 첨부가 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요.");
    expect(h).not.toContain('type="file"');
    expect(text(h)).toContain("구성안 저장");
  });

  it("빈 상태: 그림·안내·만들기 폼(펼침, productionBriefId) / 구성안 한도: AGY planLimitReached / 브리프 없음: 안내만", () => {
    const h = render("빈상태");
    expect(text(h)).toContain("아직 영상 구성안이 없습니다.");
    expect(text(h)).toContain("확정된 공통 제작 브리프를 바탕으로 장면 목록과 대사·자막 표를 만들고");
    expect(h).toMatch(/<details[^>]*open=""[^>]*><summary>\+ 영상 구성안 만들기<\/summary>/);
    expect(h).toContain(`name="productionBriefId" value="${BRIEF.id}"`);
    expect(h).not.toContain('name="planId"');
    expect(text(render("구성안한도"))).toContain("영상 구성안은 브리프당 활성 5개(전체 10개)까지 둘 수 있습니다.");
    expect(render("구성안한도")).not.toContain("+ 영상 구성안 만들기");
    expect(text(render("브리프없음"))).toContain("제작 브리프를 확정해야 영상 구성안을 만들 수 있습니다.");
  });

  it("불러오기 실패: 알림과 다시 불러오기", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("영상 구성안을 불러오지 못했습니다.");
    expect(h).toContain('href="/tasks/t-1#video-plan"');
  });

  it("글은 이스케이프되어 HTML 로 들어가지 않는다", () => {
    const evil = '"><script>alert(1)</script>';
    const p = { ...PLAN, title: evil, scenes: [{ ...PLAN.scenes[0], sceneTitle: evil, narration: evil }], files: [{ ...PLAN.files[0], fileName: evil, note: evil }] };
    for (const d of [data(p), data({ ...p, archivedAt: "2026-11-20T00:00:00Z" }, { canWrite: false })]) {
      const h = renderToString(createElement(VideoPlanSection, { boards: [board(d, { ...BRIEF, title: evil })], readOnly: false, taskId: "t" }));
      expect(h).not.toContain("<script>");
      expect(h).toContain("&lt;script&gt;");
    }
  });
});

// 화면 점검용 HTML(4폭·테마 브라우저 점검은 별도 스크립트). VP_HARNESS 가 있을 때만 쓴다
it.runIf(Boolean(process.env.VP_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.VP_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
});

describe("R1: 검수에서 보완 요청됨 배지", () => {
  it("검수 열린 회차가 보완 요청이면 구성안 배지 줄에 'QA_COPY.fixRequestedOnTarget', 아니면 없음", () => {
    const on = renderToString(createElement(VideoPlanSection, { boards: STATES["작성중"].boards, readOnly: false, taskId: "t", fixRequestedIds: [PLAN.id] }));
    expect(text(on)).toContain("검수에서 보완 요청됨");
    expect(text(render("작성중"))).not.toContain("검수에서 보완 요청됨");
  });
});
