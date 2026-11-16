import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStrategyDraft } from "./build";

/**
 * P2-STRATEGY-CONTRACT-02: 합성 fixture(입력·기대 출력 JSON)가 실제 buildStrategyDraft 결과와 맞는지 확인한다.
 * 모든 값은 합성이다(UUID 는 00000000-0000-4000-8000-… 형식, URL 은 example.com).
 * fixture 의 approved profile 참조는 입력일 뿐이며, 이 함수가 DB 승인·권한을 확인하지 않는다.
 */
const DIR = join(__dirname, "fixtures");
const read = (name: string) => JSON.parse(readFileSync(join(DIR, name), "utf8"));
const CASES = readdirSync(DIR)
  .filter((n) => n.endsWith(".input.json"))
  .map((n) => n.replace(".input.json", ""))
  .sort();

describe("fixture 목록", () => {
  it("5개 사례가 모두 있고, 각 입력에 기대 출력이 짝지어 있다", () => {
    expect(CASES).toEqual(["inference-only", "nested-typo-rejected", "normal-7-sections", "other-project-rejected", "required-missing"]);
    for (const c of CASES) expect(readdirSync(DIR)).toContain(`${c}.expected.json`);
  });

  it("합성 값만 쓴다(UUID 는 0000 접두, URL 은 example.com)", () => {
    for (const c of CASES) {
      const raw = readFileSync(join(DIR, `${c}.input.json`), "utf8");
      for (const id of raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) {
        expect(id.startsWith("00000000-0000-4000-8000-"), `${c}: ${id}`).toBe(true);
      }
      for (const url of raw.match(/https?:\/\/[^"]+/g) ?? []) expect(new URL(url).hostname, c).toBe("example.com");
    }
  });
});

describe.each(CASES)("fixture %s", (c) => {
  it("실제 함수 결과 = 기대 출력(바이트 단위 JSON 일치)", () => {
    expect(JSON.stringify(buildStrategyDraft(read(`${c}.input.json`)))).toBe(JSON.stringify(read(`${c}.expected.json`)));
  });
});

describe("사례별 의미 확인(기대 출력을 그대로 믿지 않고 핵심을 따로 검사)", () => {
  const draft = (c: string) => {
    const r = buildStrategyDraft(read(`${c}.input.json`));
    if (!r.ok) throw new Error(c);
    return r.result;
  };

  it("정상 7영역: 질문 없음, 추정만 있는 선택 영역은 inference_only, 입력 미확인 2개 보존", () => {
    const d = draft("normal-7-sections");
    expect(d.questions).toEqual([]);
    expect(d.sections.opportunities.status).toBe("inference_only");
    expect(d.unknowns.map((u) => u.origin)).toEqual(["input", "input"]);
  });

  it("필수 누락: offers·audiences 에 missing_section 질문과 미확인", () => {
    const d = draft("required-missing");
    expect(d.questions.map((q) => `${q.section}/${q.reason}`)).toEqual(["offers/missing_section", "audiences/missing_section"]);
    expect(d.unknowns.map((u) => u.section)).toEqual(["offers", "audiences"]);
  });

  it("추정만 존재: goals·positioning 은 inference_only, 사실 목록에 추정 문장이 없음", () => {
    const d = draft("inference-only");
    expect(d.questions.map((q) => `${q.section}/${q.reason}`)).toEqual(["goals/inference_only", "positioning/inference_only"]);
    expect(d.facts.every((f) => f.section === "offers" || f.section === "audiences")).toBe(true);
  });

  it("다른 프로젝트: 프로필·자료 출처 둘 다 거절", () => {
    const r = buildStrategyDraft(read("other-project-rejected.input.json"));
    expect(r.ok ? [] : r.issues.map((i) => i.path)).toEqual(["profile.projectId", "sections.offers.facts.0.sources.0.projectId"]);
  });

  it("중첩 오타: 영역 이름·추정·미확인의 오타 키를 각 위치에서 거절", () => {
    const r = buildStrategyDraft(read("nested-typo-rejected.input.json"));
    expect(r.ok ? [] : r.issues.map((i) => i.path).sort()).toEqual(["sections", "sections.audiences.inferences.0", "unknowns.0"]);
  });
});
