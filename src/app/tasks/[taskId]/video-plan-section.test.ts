import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { VideoPlanData, VideoPlanView } from "./video-plan-model";

/**
 * P3D-UI-PREP-01 영상 구성·파일 관리 상태별 화면(가짜 데이터, 서버·실제 첨부 없음).
 * 시안 video-plan.html 상태 6종(작성 중·검토 완료·이전 기준·보관·읽기 전용·빈 상태) + 권한 없음·불러오기 실패 + 한도.
 */
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./video-plan.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./production-brief.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { VideoPlanSection } = await import("./video-plan-section");

const ASSETS = [
  { id: "as1", label: "로고 심볼 패키지 (v2)" },
  { id: "as2", label: "로열 블루 색상 토큰 (v2)" },
  { id: "as3", label: "히어로 인물 사진 (v1)" },
];
const PLAN: VideoPlanView = {
  id: "vvvvvvvv-vvvv-4vvv-8vvv-000000000001",
  title: "나다음 서비스 소개 영상",
  aspectRatio: "16:9",
  status: "drafting",
  archivedAt: null,
  revision: 5,
  stale: false,
  scenes: [
    { id: "sc1", sceneTitle: "문제 제기 (오프닝)", durationSec: 15, narration: "로고, 홈페이지, 견적까지 매번 다른 파일로 흩어져 관리가 어려우셨나요?", subtitle: "", assetIds: ["as1", "as2"], sortOrder: 1 },
    { id: "sc2", sceneTitle: "해결 흐름 및 CTA", durationSec: 23, narration: "승인된 브리프와 검수 체크리스트로 최종 납품 묶음까지 한 번에 확인하세요.", subtitle: "지금 바로 시작하세요", assetIds: [], sortOrder: 2 },
  ],
  files: [
    { version: 1, fileName: "nadaum-intro-v1.mp4", fileSizeBytes: 27367424, savedAt: "2026-11-18T09:05:00Z", note: "1차 편집본", current: false },
    { version: 2, fileName: "nadaum-intro-v2.mp4", fileSizeBytes: 29779558, savedAt: "2026-11-19T13:10:00Z", note: "자막 싱크 보정본", current: true },
  ],
};
const data = (plan: VideoPlanView | null, extra: Partial<VideoPlanData> = {}): VideoPlanData => ({ plan, canWrite: true, canCreate: true, createBlockedReason: null, assets: ASSETS, ...extra });

const STATES: Record<string, { data: VideoPlanData | null; readOnly?: boolean }> = {
  작성중: { data: data(PLAN) },
  검토완료: { data: data({ ...PLAN, status: "reviewed" }) },
  이전기준: { data: data({ ...PLAN, stale: true }) },
  보관: { data: data({ ...PLAN, status: "reviewed", archivedAt: "2026-11-20T00:00:00Z" }) },
  읽기전용: { data: data({ ...PLAN, stale: true }), readOnly: true },
  빈상태: { data: data(null) },
  만들수없음: { data: data(null, { canCreate: false, createBlockedReason: "확정된 공통 제작 브리프가 있어야 영상 구성안을 만들 수 있습니다." }) },
  권한없음: { data: data(PLAN, { canWrite: false }) },
  한도: {
    data: data({
      ...PLAN,
      scenes: Array.from({ length: 30 }, (_, i) => ({ ...PLAN.scenes[0], id: `x${i}`, sceneTitle: `장면 ${i + 1}`, sortOrder: i + 1 })),
      files: Array.from({ length: 20 }, (_, i) => ({ ...PLAN.files[0], version: i + 1, current: i === 19 })),
    }),
  },
  불러오기실패: { data: null },
};
const render = (k: string) => renderToString(createElement(VideoPlanSection, { data: STATES[k].data, readOnly: Boolean(STATES[k].readOnly), taskId: "t-1" }));
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("영상 구성·파일 관리 상태별 화면", () => {
  it("모든 상태: 제목·소개·영역 이름, SVG 는 장식, 진행률 막대 없음", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      expect(h, k).toContain('aria-labelledby="video-plan"');
      expect(text(h), k).toContain("장면별 대사·자막·길이·사용 자산을 기획하고, 외부에서 제작한 영상 파일을 버전별로 첨부·관리합니다.");
      expect(h, k).not.toMatch(/<svg(?![^>]*aria-hidden="true")/);
      expect(h, k).not.toMatch(/role="progressbar"|<progress/);
    }
  });

  it("작성 중: 배지·길이 합계·범위 안내·편집기(제목·비율·장면 2개)·파일 버전·보관 확인", () => {
    const h = render("작성중");
    expect(h).toContain('class="vpBadge vpBadge_drafting"');
    expect(text(h)).toContain("총 38초 · 2장면");
    expect(text(h)).toContain("범위 안내: 이 화면은 영상 구성안 작성과 완성 파일 버전 관리만 합니다.");
    expect(text(h)).toContain("영상 제목 (필수)");
    expect(count(h, /<option /g)).toBe(3 + 2); // 비율 3 + 진행 상태 2
    expect(text(h)).toContain("16:9 (홈페이지·소개)");
    expect(text(h)).toContain("1. 장면 목록 (2 / 30장면)");
    expect(text(h)).toContain("장면 1 · 문제 제기 (오프닝)");
    expect(h).toMatch(/disabled=""[^>]*aria-label="장면 1 · 문제 제기 \(오프닝\) 위로"/);
    expect(h).toMatch(/disabled=""[^>]*aria-label="장면 2 · 해결 흐름 및 CTA 아래로"/);
    expect(count(h, /type="number"/g)).toBe(2);
    expect(count(h, /type="checkbox"/g)).toBe(6);
    expect(count(h, /type="checkbox" checked=""/g)).toBe(2);
    expect(text(h)).toContain("사용 디자인 자산 연결 (P3-c 자산 · 0~10개) 2/10개");
    expect(text(h)).toContain("+ 장면 추가");
    expect(text(h)).toContain("2. 첨부 영상 파일 및 버전 (2 / 20버전)");
    expect(text(h)).toContain("허용 형식: MP4, MOV, WEBM (파일 크기·저장소 한도는 서버 정책 따름)");
    expect(text(h)).toContain("+ 새 영상 파일 첨부");
    const t = text(h);
    expect(t).toContain("v2 (현재) · nadaum-intro-v2.mp4");
    expect(t).toContain("28.4 MB · 2026-11-19 22:10 KST · 자막 싱크 보정본");
    expect(t.indexOf("v2 (현재)")).toBeLessThan(t.indexOf("v1 · nadaum-intro-v1.mp4"));
    expect(t).toContain("현재 버전");
    expect(count(h, />이 버전으로 되돌리기</g)).toBe(1);
    expect(t).toContain("되돌리기를 누르면 과거 기록을 지우지 않고, 선택한 판의 내용을 새 버전으로 복원합니다.");
    expect(t).toContain("구성안 저장");
    expect(count(h, /<summary>이 구성안 보관<\/summary>/g)).toBe(1);
    expect(t).toContain("보관하면 내용만 볼 수 있고 고칠 수 없습니다. 보관은 되돌릴 수 없습니다.");
    expect(h).toContain(`name="planId" value="${PLAN.id}"`);
    expect(h).not.toMatch(/class="vpCount[^"]*" aria-live/);
  });

  it("검토 완료: 배지·선택값", () => {
    const h = render("검토완료");
    expect(h).toContain('class="vpBadge vpBadge_reviewed"');
    expect(h).toMatch(/<option value="reviewed" selected="">/);
  });

  it("이전 기준: 배지·안내·맞추기", () => {
    const h = render("이전기준");
    expect(text(h)).toContain("이전 기준: 공통 제작 브리프 또는 연결된 디자인 자산이 새 버전으로 바뀌었습니다. 대사와 연결 자산을 확인해 주세요.");
    expect(count(h, />최신 기준으로 맞추기</g)).toBe(1);
  });

  it("보관: 보관 배지·안내, 폼·첨부·되돌리기 0개, 내용은 글자로", () => {
    const h = render("보관");
    expect(h).toContain('class="vpBadge vpBadge_archived"');
    expect(text(h)).toContain("보관한 영상 구성안입니다. 조회와 파일 내려받기만 할 수 있고 고치기·첨부는 할 수 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(count(h, /<(input|textarea|select|button)/g)).toBe(0);
    expect(text(h)).toContain("장면 1 · 문제 제기 (오프닝) · 15초");
    expect(text(h)).toContain("로고 심볼 패키지 (v2), 로열 블루 색상 토큰 (v2)");
    expect(text(h)).toContain("현재 버전");
  });

  it("읽기 전용·권한 없음: 안내, 폼 0개", () => {
    const r = render("읽기전용");
    expect(text(r)).toContain("보관한 프로젝트이거나 취소한 작업이라 고칠 수 없습니다.");
    expect(count(r, /<form/g)).toBe(0);
    expect(text(r)).not.toContain("최신 기준으로 맞추기");
    const p = render("권한없음");
    expect(text(p)).toContain("영상 구성안이나 파일을 고칠 권한이 없습니다.");
    expect(count(p, /<form/g)).toBe(0);
  });

  it("빈 상태: 그림·안내·만들기, 만들 수 없으면 서버 사유만", () => {
    const h = render("빈상태");
    expect(text(h)).toContain("아직 영상 구성안이 없습니다.");
    expect(text(h)).toContain("확정된 공통 제작 브리프를 바탕으로 장면 목록과 대사·자막 표를 만들고, 완성된 영상 파일을 첨부할 수 있습니다.");
    expect(h).toContain('viewBox="0 0 96 72"');
    expect(text(h)).toContain("+ 영상 구성안 만들기");
    const b = render("만들수없음");
    expect(text(b)).toContain("확정된 공통 제작 브리프가 있어야 영상 구성안을 만들 수 있습니다.");
    expect(count(b, /<form/g)).toBe(0);
  });

  it("한도: 장면 30·파일 20이면 추가·첨부 대신 안내", () => {
    const h = render("한도");
    expect(text(h)).toContain("1. 장면 목록 (30 / 30장면)");
    expect(text(h)).toContain("장면은 30개까지 둘 수 있습니다. 불필요한 장면을 제외한 뒤 추가해 주세요.");
    expect(text(h)).not.toContain("+ 장면 추가");
    expect(text(h)).toContain("첨부 파일 버전은 20개까지 둘 수 있습니다.");
    expect(text(h)).not.toContain("+ 새 영상 파일 첨부");
  });

  it("불러오기 실패: 알림과 다시 불러오기", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("영상 구성안을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    expect(h).toContain('href="/tasks/t-1#video-plan"');
  });

  it("글은 이스케이프되어 HTML 로 들어가지 않는다", () => {
    const evil = '"><script>alert(1)</script>';
    for (const archivedAt of [null, "2026-11-20T00:00:00Z"]) {
      const h = renderToString(createElement(VideoPlanSection, { data: data({ ...PLAN, archivedAt, title: evil, scenes: [{ ...PLAN.scenes[0], sceneTitle: evil, narration: evil }], files: [{ ...PLAN.files[1], fileName: evil }] }), readOnly: false, taskId: "t" }));
      expect(h).not.toContain("<script>");
      expect(h).toContain("&lt;script&gt;");
    }
  });
});

// 화면 점검용 HTML(4폭·2테마 점검은 별도 스크립트). VIDEO_PLAN_HARNESS 가 있을 때만 쓴다
it.runIf(Boolean(process.env.VIDEO_PLAN_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.VIDEO_PLAN_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
  writeFileSync(join(out, "작성중-펼침.html"), render("작성중").replace(/<details class="([^"]*)">/g, '<details class="$1" open="">'));
});
