import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STRATEGY_TEMPLATE_VERSION } from "@/contracts/p2-strategy";
import { buildStrategyDraft, STRATEGY_EVIDENCE_QUESTION, type StrategyOutcome } from "./build";
import { STRATEGY_SAFE_MESSAGES, toStrategyView, type StrategyView } from "./view";

/** P2-STRATEGY-VIEWMODEL-03: 화면 표시용 변환. 실제 fixture 5쌍과 합성 입력만 쓴다. */
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.input.json`), "utf8"));
const view = (raw: unknown) => toStrategyView(buildStrategyDraft(raw));
const draftView = (raw: unknown) => {
  const v = view(raw);
  if (v.kind !== "draft") throw new Error(JSON.stringify(v));
  return v;
};
const invalidView = (raw: unknown) => {
  const v = view(raw);
  if (v.kind !== "invalid") throw new Error("draft");
  return v;
};
/** 결과 안의 모든 문자열을 모은다 */
const strings = (v: StrategyView) => {
  const out: string[] = [];
  JSON.stringify(v, (_k, x) => (typeof x === "string" && out.push(x), x));
  return out;
};

const PROJECT = "00000000-0000-4000-8000-00000000a010";
const PROFILE = "00000000-0000-4000-8000-00000000b010";
const base = () => ({
  templateVersion: STRATEGY_TEMPLATE_VERSION,
  projectId: PROJECT,
  profile: { id: PROFILE, version: 1, projectId: PROJECT, clientId: null, projectKind: "personal" },
});
const fromProfile = { kind: "profile", profileId: PROFILE, version: 1 };

describe("fixture 5쌍", () => {
  it("정상 7영역: 7개 영역 순서·배지, 질문 없음, 입력 미확인 2개(질문 없는 것은 question 속성 없음)", () => {
    const v = draftView(fixture("normal-7-sections"));
    expect(v.profileLabel).toBe("회사 프로필 2번 버전 기준");
    expect(v.sections.map((s) => `${s.key}:${s.badge.tone}`)).toEqual([
      "goals:success", "offers:success", "audiences:success", "positioning:success",
      "problems:success", "opportunities:warning", "priorities:success",
    ]);
    expect(v.questions).toEqual([]);
    expect(v.userUnknowns).toEqual([
      { id: "unknown-1", topic: "경쟁 업체 가격대", question: "비슷한 서비스의 가격은 어느 정도인가요?" },
      { id: "unknown-2", topic: "상담 가능 시간" },
    ]);
    expect(v.sections[0]!.facts[0]!.sources).toEqual([{ kind: "profile", label: "회사 프로필 2번 버전", ref: "00000000-0000-4000-8000-00000000b001" }]);
    expect(v.sections[1]!.facts[0]!.sources[0]).toMatchObject({ kind: "asset", label: "프로젝트 자료" });
    expect(v.sections[3]!.facts[0]!.sources[0]).toEqual({ kind: "url", label: "외부 주소", ref: "https://example.com/synthetic-about" });
  });

  it("필수 누락: 질문은 questions 에만 있고 자동 미확인은 다시 싣지 않음(중복 없음), 필수는 danger·선택은 neutral", () => {
    const v = draftView(fixture("required-missing"));
    expect(v.questions.map((q) => `${q.section}/${q.reason}`)).toEqual(["offers/missing_section", "audiences/missing_section"]);
    expect(v.userUnknowns).toEqual([]);
    const tone = Object.fromEntries(v.sections.map((s) => [s.key, s.badge]));
    expect(tone.offers).toEqual({ label: "확인 필요", tone: "danger" });
    expect(tone.audiences!.tone).toBe("danger");
    for (const k of ["problems", "opportunities", "priorities"]) expect(tone[k]).toEqual({ label: "비어 있음", tone: "neutral" });
    expect(v.sections.find((s) => s.key === "problems")!.status).toBe("missing"); // 의미(status)는 유지
  });

  it("추정만 존재: warning 배지·근거 질문, rationale 없는 추정은 rationale 속성 없음", () => {
    const v = draftView(fixture("inference-only"));
    const goals = v.sections.find((s) => s.key === "goals")!;
    const positioning = v.sections.find((s) => s.key === "positioning")!;
    expect([goals.badge.tone, positioning.badge.tone]).toEqual(["warning", "warning"]);
    expect(goals.inferences).toEqual([{ id: "goals-inference-1", text: "구독자를 늘리는 것이 목표일 것이다", rationale: "개인 채널이라서" }]);
    expect(positioning.inferences[0]).toEqual({ id: "positioning-inference-1", text: "실무자 관점의 쉬운 설명으로 기억될 것이다" });
    expect("rationale" in positioning.inferences[0]!).toBe(false);
  });

  it("다른 프로젝트: profile 은 요약 오류, offers 출처는 영역 오류", () => {
    const v = invalidView(fixture("other-project-rejected"));
    expect(v.summaryErrors).toEqual(["다른 프로젝트의 프로필은 참조할 수 없습니다."]);
    expect(v.fieldErrors).toEqual({ offers: ["다른 프로젝트의 자료는 출처로 쓸 수 없습니다."] });
  });

  it("중첩 오타: 영어 문구·키 이름을 내보내지 않고 한국어 안전 문구로, 영역 이름 오타는 요약 오류", () => {
    const v = invalidView(fixture("nested-typo-rejected"));
    expect(v.fieldErrors).toEqual({ audiences: [STRATEGY_SAFE_MESSAGES.unknownKey] });
    expect(v.summaryErrors).toEqual([STRATEGY_SAFE_MESSAGES.unknownKey]); // sections(positionning)·unknowns.0 → 같은 문구 1번
    const all = strings(v).join(" ");
    expect(all).not.toMatch(/Unrecognized|positionning|rational|questions/);
  });

  it("어떤 fixture 결과에도 'null'·'undefined' 문자열이 없다", () => {
    for (const n of ["normal-7-sections", "required-missing", "inference-only", "other-project-rejected", "nested-typo-rejected"]) {
      for (const s of strings(view(fixture(n)))) expect(s, n).not.toMatch(/^(null|undefined)$/);
    }
  });
});

describe("질문 보존과 중복", () => {
  it("같은 문구의 서로 다른 질문은 합치지 않는다(근거 질문 2개, 같은 질문 문구의 입력 미확인 2개)", () => {
    const v = draftView({
      ...base(),
      sections: {
        goals: { facts: [], inferences: [{ text: "가설 A" }] },
        offers: { facts: [], inferences: [{ text: "가설 B" }] },
        audiences: { facts: [{ text: "고객", sources: [fromProfile] }], inferences: [] },
        positioning: { facts: [{ text: "위치", sources: [fromProfile] }], inferences: [] },
      },
      unknowns: [
        { topic: "가격", question: "확인했나요?" },
        { topic: "지역", question: "확인했나요?" },
      ],
    });
    expect(v.questions.map((q) => [q.id, q.text])).toEqual([
      ["question-goals-evidence", STRATEGY_EVIDENCE_QUESTION],
      ["question-offers-evidence", STRATEGY_EVIDENCE_QUESTION],
    ]);
    expect(v.userUnknowns.map((u) => [u.id, u.topic, u.question])).toEqual([
      ["unknown-1", "가격", "확인했나요?"],
      ["unknown-2", "지역", "확인했나요?"],
    ]);
  });

  it("빈 필수 영역 질문은 questions 에 영역당 1번만 나온다", () => {
    const v = draftView(base());
    expect(v.questions.map((q) => q.id)).toEqual([
      "question-goals-missing", "question-offers-missing", "question-audiences-missing", "question-positioning-missing",
    ]);
    expect(new Set(v.questions.map((q) => q.id)).size).toBe(v.questions.length);
    expect(v.userUnknowns).toEqual([]);
  });
});

describe("텍스트만 반환(HTML 조합·escape 없음)", () => {
  const XSS = `<img src=x onerror="alert(1)">&lt;b&gt;'"`;
  it("악성 HTML 문자열은 바꾸지 않고 그대로 텍스트로 돌려준다(렌더러가 escape 해야 함)", () => {
    const v = draftView({
      ...base(),
      sections: {
        goals: { facts: [{ text: XSS, sources: [fromProfile] }], inferences: [{ text: XSS, rationale: XSS }] },
      },
      unknowns: [{ topic: XSS, question: XSS }],
    });
    const goals = v.sections[0]!;
    expect(goals.facts[0]!.text).toBe(XSS);
    expect(goals.inferences[0]).toEqual({ id: "goals-inference-1", text: XSS, rationale: XSS });
    expect(v.userUnknowns[0]).toEqual({ id: "unknown-1", topic: XSS, question: XSS });
  });

  it("변환이 스스로 만든 문자열(배지·이름·출처 이름·안전 문구)에는 HTML 태그가 없다", () => {
    const own = [
      ...strings(draftView(fixture("normal-7-sections"))),
      ...strings(draftView(fixture("required-missing"))),
      ...strings(invalidView(fixture("nested-typo-rejected"))),
    ];
    for (const s of own) expect(s).not.toMatch(/<[a-z/!]/i);
  });

  it("javascript: 같은 URL 은 계약 단계에서 이미 거절되어 화면 값으로 오지 않는다", () => {
    const v = invalidView({
      ...base(),
      sections: { goals: { facts: [{ text: "x", sources: [{ kind: "url", url: "javascript:alert(1)" }] }], inferences: [] } },
    });
    expect(v.fieldErrors.goals?.length).toBe(1);
  });
});

describe("한국어·혼합·HTML 키 오타도 키 이름과 영어 원문을 내보내지 않는다(R1)", () => {
  const KEYS = ["포지셔닝", "position포지션", '<b>목표</b><img src=x onerror="alert(1)">'];
  const leaks = (v: StrategyView, key: string) => strings(v).some((s) => s.includes(key) || /Unrecognized/i.test(s));

  it.each(KEYS)("최상위·sections·영역·사실·출처·추정·미확인·profile 에 키 %s", (key) => {
    const raw = {
      ...base(),
      [key]: 1,
      profile: { ...base().profile, [key]: 1 },
      sections: {
        [key]: { facts: [], inferences: [] },
        goals: {
          [key]: [],
          facts: [{ text: "사실", [key]: 1, sources: [{ ...fromProfile, [key]: 1 }] }],
          inferences: [{ text: "추정", [key]: 1 }],
        },
      },
      unknowns: [{ topic: "주제", [key]: 1 }],
    };
    const outcome = buildStrategyDraft(raw);
    expect(outcome.ok).toBe(false);
    // 원문(Zod)에는 실제로 키 이름이 들어 있음을 먼저 확인(시험이 헛돌지 않게)
    expect(!outcome.ok && outcome.issues.some((i) => i.message.includes(key))).toBe(true);
    const v = toStrategyView(outcome);
    if (v.kind !== "invalid") throw new Error("draft");
    expect(leaks(v, key)).toBe(false);
    expect(v.fieldErrors).toEqual({ goals: [STRATEGY_SAFE_MESSAGES.unknownKey] });
    expect(v.summaryErrors).toEqual([STRATEGY_SAFE_MESSAGES.unknownKey]);
  });

  it("정상 계약의 한국어 오류 문구는 그대로 둔다", () => {
    const v = invalidView({
      ...base(),
      profile: { ...base().profile, projectId: "00000000-0000-4000-8000-00000000a999" },
      sections: { goals: { facts: [{ text: "  ", sources: [] }], inferences: [] } },
    });
    expect(v.summaryErrors).toEqual(["다른 프로젝트의 프로필은 참조할 수 없습니다."]);
    expect(v.fieldErrors.goals).toEqual([
      "내용을 입력해 주세요.",
      "사실에는 출처가 하나 이상 필요합니다. 출처가 없으면 추정으로 적어 주세요.",
    ]);
  });
});

describe("오류 분류", () => {
  it("검증된 7개 영역만 영역 오류이고, projectId·templateVersion·unknowns 는 요약 오류(영어 기본 문구는 안전 문구)", () => {
    const v = invalidView({ ...base(), projectId: "not-uuid", templateVersion: "x", unknowns: [{ topic: "" }] });
    expect(v.fieldErrors).toEqual({});
    expect(v.summaryErrors).toContain("내용을 입력해 주세요.");
    for (const m of v.summaryErrors) expect(m).toMatch(/[가-힣]/);
  });

  it("손으로 만든 결과의 이상한 경로(sections.__proto__ 등)도 영역 오류로 가지 않는다", () => {
    const outcome: StrategyOutcome = {
      ok: false,
      issues: [
        { path: "sections.__proto__", message: "Invalid input" },
        { path: "sections.constructor.facts", message: "Invalid input" },
        { path: "", message: "Invalid input" },
      ],
    };
    const v = toStrategyView(outcome);
    expect(v).toEqual({ kind: "invalid", fieldErrors: {}, summaryErrors: [STRATEGY_SAFE_MESSAGES.invalid] });
    expect(Object.getPrototypeOf((v as { fieldErrors: object }).fieldErrors)).toBe(Object.prototype);
  });
});
