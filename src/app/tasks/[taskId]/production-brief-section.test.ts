import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProductionBriefSectionData, ProductionBriefView } from "./production-brief-model";

/**
 * P3A-UI-PREP-01 공통 제작 브리프 상태별 화면(가짜 데이터, 서버 없음).
 * 인계표 P3A-HANDOFF.md 2절 6종(작성 중·확정·이전 전략 기준·보관·빈 상태·프로젝트 읽기 전용) + 만들 수 없음·불러오기 실패·글자 수 넘침.
 * CSS 모듈은 원래 클래스 이름 그대로 나오게 해서 화면 점검 스크립트가 실제 CSS 를 입힐 수 있게 한다.
 */
vi.mock("../../_components/action-form", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionForm: ({ submitLabel, children, className, variant }: { submitLabel: string; children?: unknown; className?: string; variant?: string }) =>
      h("form", { className }, children as never, h("button", { type: "submit", className: variant === "secondary" ? "secondaryButton" : "button" }, submitLabel)),
  };
});
vi.mock("./funnel.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("./production-brief.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("../../ui.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

const { ProductionBriefSection } = await import("./production-brief-section");

const BRIEF: ProductionBriefView = {
  id: "cccccccc-cccc-4ccc-8ccc-000000000001",
  title: "동네 카페 홈페이지·로고 제작 기준",
  targetAudience: "외부 대행사 없이 직접 브랜드와 견적 기준을 정리하려는 1인·소규모 서비스 대표",
  coreMessage: "복잡한 마케팅 기획과 제작 파일을 승인된 버전 기준으로 한 번에 정리해 중간 혼선 없이 납품까지 이어집니다.",
  deliverableTypes: ["web_copy", "design_asset"],
  scopeSummary: "포함: 홈페이지 5개 섹션 구조 및 최종 문구, 로고 SVG/PNG 패키지, 히어로 이미지 1종.\n제외: 외부 광고 집행, 결제 연동, 영상 촬영 본편 제작(2차 범위).",
  brandToneConstraints: "쉬운 한국어, 과장·허위 성과 수치 금지, 밝은 배경 대비 4.5:1 이상 유지.",
  referenceNotes: "",
  status: "drafting",
  revision: 4,
  strategyVersion: { id: "s3", version: 3 },
  stale: false,
};
const data = (brief: ProductionBriefView | null, extra: Partial<ProductionBriefSectionData> = {}): ProductionBriefSectionData => ({
  brief,
  canCreate: true,
  createBlockedReason: null,
  approvedVersion: 3,
  ...extra,
});

const STATES: Record<string, { data: ProductionBriefSectionData | null; readOnly?: boolean }> = {
  빈상태: { data: data(null) },
  만들수없음: { data: data(null, { canCreate: false, createBlockedReason: "승인된 전략이 없어 제작 브리프를 만들 수 없습니다. 전략을 먼저 승인해 주세요.", approvedVersion: null }) },
  작성중: { data: data(BRIEF) },
  확정: { data: data({ ...BRIEF, status: "confirmed", deliverableTypes: ["web_copy", "design_asset", "video_script", "ppt_template"] }) },
  이전전략: { data: data({ ...BRIEF, stale: true, strategyVersion: { id: "s2", version: 2 } }) },
  보관: { data: data({ ...BRIEF, status: "archived" }) },
  프로젝트읽기전용: { data: data({ ...BRIEF, stale: true, strategyVersion: { id: "s2", version: 2 } }), readOnly: true },
  프로젝트읽기전용빈: { data: data(null), readOnly: true },
  불러오기실패: { data: null },
  글자넘침: { data: data({ ...BRIEF, title: "가".repeat(121), scopeSummary: "범위 ".repeat(700), deliverableTypes: [] }) },
};
const render = (k: string) => {
  const s = STATES[k];
  return renderToString(createElement(ProductionBriefSection, { data: s.data, readOnly: Boolean(s.readOnly), taskId: "t-1" }));
};
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("공통 제작 브리프 상태별 화면", () => {
  it("모든 상태: 제목·안내, 영역 이름 연결", () => {
    for (const k of Object.keys(STATES)) {
      const h = render(k);
      expect(h, k).toContain('aria-labelledby="production-brief"');
      expect(h, k).toContain('id="production-brief"');
      expect(text(h), k).toContain("승인된 전략을 바탕으로 홈페이지·디자인·영상·PPT 제작에 공통으로 쓸 기준을 정리합니다.");
    }
  });

  it("빈 상태: 만들기 단추 하나, 입력 폼 없음", () => {
    const h = render("빈상태");
    expect(text(h)).toContain("아직 공통 제작 브리프가 없습니다.");
    expect(text(h)).toContain("전략 내용을 바탕으로 처음 입력값을 채워 둡니다.");
    expect(count(h, /<form/g)).toBe(1);
    expect(h).toMatch(/<button type="submit" class="button">\+ 공통 제작 브리프 만들기<\/button>/);
    expect(h).not.toContain("<textarea");
  });

  it("만들 수 없음: 막힌 이유만, 폼 없음", () => {
    const h = render("만들수없음");
    expect(text(h)).toContain("승인된 전략이 없어 제작 브리프를 만들 수 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
  });

  it("작성 중: 배지·필드 8종(글 6·산출물 4개·상태)·글자 수·보관 단추", () => {
    const h = render("작성중");
    expect(h).toContain('class="pbStatus pbStatus_drafting">작성 중</span>');
    expect(text(h)).toContain("전략 3번 버전 기준");
    expect(count(h, /<textarea/g)).toBe(5);
    expect(count(h, /<input type="text"/g)).toBe(1);
    expect(count(h, /type="checkbox"/g)).toBe(4);
    expect(count(h, /type="checkbox"[^>]*checked=""/g)).toBe(2);
    for (const label of ["제작 브리프 제목", "핵심 대상(타깃)", "핵심 전달 메시지", "제작 범위 및 제외 사항", "브랜드 톤·금기 사항", "참고 자료·링크 안내", "포함 산출물 종류", "진행 상태"]) expect(text(h)).toContain(label);
    expect(count(h, /\(필수\)/g)).toBe(4);
    expect(count(h, /\(선택\)/g)).toBe(2);
    expect(count(h, / required=""/g)).toBe(4);
    expect(text(h)).toContain(`${Array.from(BRIEF.title).length} / 120자`);
    expect(text(h)).toContain("0 / 1,000자"); // 비어 있는 참고 자료
    expect(text(h)).toContain("2/4개");
    // 진행 상태에 보관은 없다(별도 단추)
    expect(count(h, /<option /g)).toBe(2);
    expect(text(h)).toContain("확정 (후속 제작 단계에서 기준본으로 사용)");
    expect(text(h)).toContain("보관은 아래 ‘이 제작 브리프 보관’ 단추로만 전환할 수 있습니다.");
    expect(text(h)).toContain("제작 브리프 저장");
    expect(text(h)).toContain("이 제작 브리프 보관");
    expect(text(h)).not.toContain("지금 승인본 기준으로 맞추기");
    // 체크 상자는 44px 라벨 안에
    expect(count(h, /<label class="pbCheck"><input type="checkbox"/g)).toBe(4);
    // 숨은 칸: 대상 id·revision·payload
    expect(h).toContain(`name="briefId" value="${BRIEF.id}"`);
    expect(h).toContain('name="revision" value="4"');
    expect(h).toContain('name="payload"');
  });

  it("확정: 배지·주의 안내·선택값", () => {
    const h = render("확정");
    expect(h).toContain('class="pbStatus pbStatus_confirmed">확정</span>');
    expect(text(h)).toContain("확정한 제작 브리프는 이후 홈페이지·디자인 자산 단계의 기준본으로 씁니다.");
    expect(h).toMatch(/<option value="confirmed" selected="">/);
    expect(text(h)).toContain("4/4개");
  });

  it("이전 전략 기준: 배지·시안 문구·맞추기 단추, 편집은 그대로", () => {
    const h = render("이전전략");
    expect(text(h)).toContain("이전 전략 기준");
    expect(text(h)).toContain("전략 2번 버전 기준");
    expect(text(h)).toContain(
      "이전 전략 기준: 지금 승인본(3번 버전)보다 앞선 전략(2번 버전)으로 만든 제작 브리프입니다. 대상과 메시지가 지금 전략과 맞는지 확인해 주세요. 맞추지 않아도 고칠 수 있습니다.",
    );
    expect(text(h)).toContain("지금 승인본 기준으로 맞추기");
    expect(count(h, /<textarea/g)).toBe(5);
  });

  it("보관: 읽기 전용 안내, 폼 0개, 내용은 글자로", () => {
    const h = render("보관");
    expect(h).toContain('class="pbStatus pbStatus_archived">보관</span>');
    expect(text(h)).toContain("보관한 제작 브리프입니다. 내용만 볼 수 있고, 고치기·상태 변경은 할 수 없습니다. 보관을 되돌릴 수는 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(count(h, /<(input|textarea|select)/g)).toBe(0);
    expect(h).toContain('<dl class="pbView">');
    expect(text(h)).toContain("홈페이지 구조·문구, 디자인 자산 (로고·배너)");
    expect(text(h)).toContain("적지 않음"); // 비어 있는 참고 자료
  });

  it("프로젝트 읽기 전용: 안내, 폼·맞추기 단추 0개(이전 전략 안내는 보임)", () => {
    const h = render("프로젝트읽기전용");
    expect(text(h)).toContain("보관한 프로젝트이거나 취소한 작업이라 제작 브리프를 고칠 수 없습니다.");
    expect(count(h, /<form/g)).toBe(0);
    expect(text(h)).toContain("이전 전략 기준:");
    expect(text(h)).not.toContain("지금 승인본 기준으로 맞추기");
    const empty = render("프로젝트읽기전용빈");
    expect(count(empty, /<form/g)).toBe(0);
    expect(text(empty)).toContain("아직 공통 제작 브리프가 없습니다.");
    expect(text(empty)).toContain("고칠 수 없습니다");
  });

  it("불러오기 실패: 오류 알림과 다시 불러오기 링크", () => {
    const h = render("불러오기실패");
    expect(h).toContain('role="alert"');
    expect(text(h)).toContain("공통 제작 브리프를 불러오지 못했습니다.");
    expect(h).toContain('href="/tasks/t-1#production-brief"');
    expect(count(h, /<form/g)).toBe(0);
  });

  it("글자 수 넘침: 빨간 카운터와 칸 안내가 바로 보이고 값은 자르지 않는다", () => {
    const h = render("글자넘침");
    expect(h).toContain('class="pbCount pbCountOver"');
    expect(text(h)).toContain("121 / 120자");
    expect(text(h)).toContain("제작 브리프 제목은(는) 120자까지 쓸 수 있습니다.");
    expect(text(h)).toContain("2,100 / 2,000자");
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain(`value="${"가".repeat(121)}"`);
    // 산출물 0개 안내는 손댄 뒤에만(처음 열 때는 숨김)
    expect(text(h)).not.toContain("포함 산출물 종류를 1개 이상 선택해 주세요.");
  });

  it("글은 이스케이프되어 HTML 로 들어가지 않는다", () => {
    const evil = '"><script>alert(1)</script>';
    for (const status of ["drafting", "archived"] as const) {
      const h = renderToString(createElement(ProductionBriefSection, { data: data({ ...BRIEF, status, title: evil, scopeSummary: evil }), readOnly: false, taskId: "t" }));
      expect(h).not.toContain("<script>");
      expect(h).toContain("&lt;script&gt;");
    }
  });
});

// 화면 점검용 HTML(4폭·2테마 브라우저 점검은 별도 스크립트). PRODUCTION_BRIEF_HARNESS 가 있을 때만 파일을 쓴다
it.runIf(Boolean(process.env.PRODUCTION_BRIEF_HARNESS))("화면 점검용 HTML 쓰기", () => {
  const out = process.env.PRODUCTION_BRIEF_HARNESS!;
  mkdirSync(out, { recursive: true });
  for (const k of Object.keys(STATES)) writeFileSync(join(out, `${k}.html`), render(k));
});
