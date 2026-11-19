import { describe, expect, it } from "vitest";
import type { BriefSourceOptions } from "@/features/brief/server";
import { sourceChoiceGroups } from "./source-choices";

const base: BriefSourceOptions = { profile: null, assets: [], research: [] };
const research = (groups: ReturnType<typeof sourceChoiceGroups>) => groups.find((g) => g.label === "외부 출처")!.choices;

describe("브리프 근거 선택 목록(sourceChoiceGroups)", () => {
  it("이 프로젝트의 외부 출처가 '외부 출처' 묶음의 선택지로 채워진다(SOURCES-UI-01)", () => {
    const groups = sourceChoiceGroups({
      ...base,
      research: [
        { id: "r1", label: "통계청 2026 조사", reviewStatus: "verified" },
        { id: "r2", label: "업계 기사", reviewStatus: "unverified" },
      ],
    });
    expect(research(groups)).toEqual([
      { value: "research:r1", label: "통계청 2026 조사" },
      { value: "research:r2", label: "업계 기사 (확인 전)" },
    ]);
  });

  it("긴 출처 이름은 80자에서 줄이고, 확인 전 표시는 줄인 뒤에 붙는다", () => {
    const label = "가".repeat(120);
    const [c] = research(sourceChoiceGroups({ ...base, research: [{ id: "r", label, reviewStatus: "unverified" }] }));
    expect(c.label).toBe(`${"가".repeat(80)}… (확인 전)`);
  });

  it("출처가 없으면 외부 출처 묶음은 비어 있다(선택 상자에서 빠진다)", () => {
    expect(research(sourceChoiceGroups(base))).toEqual([]);
  });

  it("회사 프로필 항목·자료의 값 형식은 그대로다", () => {
    const groups = sourceChoiceGroups({
      profile: { id: "pv", version: 3, fields: [{ field: "strengths", label: "강점", value: "빠른 납기" }] },
      assets: [{ id: "a1", label: "회사 소개서.pdf", scope: "project" }],
      research: [],
    });
    expect(groups[0]).toEqual({ label: "회사 프로필 3번 버전", choices: [{ value: "profile:pv:strengths", label: "강점: 빠른 납기" }] });
    expect(groups[1].choices).toEqual([{ value: "asset:a1", label: "회사 소개서.pdf" }]);
  });

  it("같은 고객의 공통 자료는 '(고객 공통)'을 붙여 이 프로젝트 자료 뒤에 둔다(DEC-09 B, COPY-DEC09-01)", () => {
    const groups = sourceChoiceGroups({
      ...base,
      assets: [
        { id: "c1", label: "2026 회사 소개서", scope: "client" },
        { id: "p1", label: "프로젝트 기획안", scope: "project" },
        { id: "c2", label: "브랜드 가이드", scope: "client" },
        { id: "p2", label: "인터뷰 메모", scope: "project" },
      ],
    });
    expect(groups[1]).toEqual({
      label: "프로젝트·고객 공통 자료",
      choices: [
        { value: "asset:p1", label: "프로젝트 기획안" },
        { value: "asset:p2", label: "인터뷰 메모" },
        { value: "asset:c1", label: "2026 회사 소개서 (고객 공통)" },
        { value: "asset:c2", label: "브랜드 가이드 (고객 공통)" },
      ],
    });
  });

  it("긴 공통 자료 이름도 80자에서 줄인 뒤 '(고객 공통)'을 붙인다", () => {
    const [c] = sourceChoiceGroups({ ...base, assets: [{ id: "c", label: "나".repeat(100), scope: "client" }] })[1].choices;
    expect(c.label).toBe(`${"나".repeat(80)}… (고객 공통)`);
  });
});
