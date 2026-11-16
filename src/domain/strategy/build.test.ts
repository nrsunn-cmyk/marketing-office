import { describe, expect, it } from "vitest";
import { STRATEGY_LIMITS, STRATEGY_SECTIONS, STRATEGY_TEMPLATE_VERSION, strategyInputSchema } from "@/contracts/p2-strategy";
import { logoBriefInputSchema, quoteInputSchema, TASK_TYPES } from "@/contracts";
import { buildLogoBrief } from "@/domain/logo";
import { buildStrategyDraft, STRATEGY_EVIDENCE_QUESTION, STRATEGY_MISSING_QUESTIONS, type StrategyDraft } from "./build";

/**
 * P2-STRATEGY-CORE-01: 채널 중립 전략 초안(입력 조합형 결정적 함수)과 입력 계약.
 * 합성 입력만 쓴다(실고객 데이터·외부 수집 없음).
 */
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const PROFILE = "44444444-4444-4444-8444-444444444444";
const ASSET = "55555555-5555-4555-8555-555555555555";

const profile = { id: PROFILE, version: 3, projectId: PROJECT, clientId: CLIENT, projectKind: "client" as const };
const fromProfile = { kind: "profile" as const, profileId: PROFILE, version: 3 };

/** 매번 깊은 복사본을 돌려준다(시험끼리 공용 상수 profile·fromProfile 을 오염시키지 않게) */
function fullInput() {
  return structuredClone({
    templateVersion: STRATEGY_TEMPLATE_VERSION,
    projectId: PROJECT,
    profile,
    sections: {
      goals: { facts: [{ text: "가을 시즌 예약 문의를 늘린다", sources: [fromProfile] }], inferences: [] },
      offers: { facts: [{ text: "당일 배송 꽃다발", sources: [{ kind: "asset" as const, assetId: ASSET, projectId: PROJECT }] }], inferences: [] },
      audiences: {
        facts: [{ text: "기념일을 챙기는 직장인", sources: [fromProfile] }],
        inferences: [{ text: "점심시간에 주문할 가능성이 높다", rationale: "직장인 대상이라서" }],
      },
      positioning: { facts: [{ text: "제철 꽃만 쓰는 동네 꽃집", sources: [{ kind: "url" as const, url: "https://example.com/about" }] }], inferences: [] },
      problems: { facts: [], inferences: [{ text: "급하게 선물을 준비해야 한다" }] },
      opportunities: { facts: [], inferences: [] },
      priorities: { facts: [], inferences: [] },
    },
    unknowns: [{ topic: "경쟁 꽃집 가격대", question: "주변 꽃집 가격은 얼마인가요?" }, { topic: "배송 가능 지역" }],
  });
}
const ok = (raw: unknown): StrategyDraft => {
  const r = buildStrategyDraft(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.result;
};
const issuesOf = (raw: unknown) => {
  const r = buildStrategyDraft(raw);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.issues;
};

describe("정상 입력", () => {
  it("사실·추정을 영역별로 분리하고, 출처를 그대로 두며, 채워진 필수 영역에는 질문이 없다", () => {
    const d = ok(fullInput());
    expect(d.templateVersion).toBe(STRATEGY_TEMPLATE_VERSION);
    expect(d.projectId).toBe(PROJECT);
    expect(d.profileRef).toEqual({ id: PROFILE, version: 3 });
    expect(d.facts.map((f) => f.id)).toEqual(["goals-fact-1", "offers-fact-1", "audiences-fact-1", "positioning-fact-1"]);
    expect(d.facts[1]!.sources).toEqual([{ kind: "asset", assetId: ASSET, projectId: PROJECT }]);
    expect(d.inferences).toEqual([
      { id: "audiences-inference-1", section: "audiences", text: "점심시간에 주문할 가능성이 높다", rationale: "직장인 대상이라서" },
      { id: "problems-inference-1", section: "problems", text: "급하게 선물을 준비해야 한다", rationale: null },
    ]);
    expect(d.sections.goals).toEqual({ label: "목표", status: "filled", factIds: ["goals-fact-1"], inferenceIds: [] });
    expect(d.sections.problems.status).toBe("inference_only");
    expect(d.sections.opportunities.status).toBe("missing");
    expect(d.questions).toEqual([]); // 필수 4영역이 모두 사실로 채워짐(선택 영역은 비어도 질문 없음)
    expect(d.generator).toEqual({ mode: "template", templateVersion: STRATEGY_TEMPLATE_VERSION });
  });

  it("자체 브랜드 프로젝트는 고객 ID 없이 참조한다", () => {
    const raw = { ...fullInput(), profile: { ...profile, clientId: null, projectKind: "internal_brand" as const } };
    expect(ok(raw).profileRef.version).toBe(3);
  });

  it("영역을 아예 안 보내도 기본값(빈 영역)으로 받고 필수 4개에 질문을 만든다", () => {
    const d = ok({ templateVersion: STRATEGY_TEMPLATE_VERSION, projectId: PROJECT, profile });
    expect(d.questions.map((q) => q.id)).toEqual(["question-goals-missing", "question-offers-missing", "question-audiences-missing", "question-positioning-missing"]);
    expect(Object.values(d.sections).every((s) => s.status === "missing")).toBe(true);
  });
});

describe("미확인 보존", () => {
  it("unknowns 가 빈 배열이고 facts 도 빈 배열이어도 받아들이고, 필수 4영역 질문을 만든다", () => {
    const empty = { facts: [], inferences: [] };
    const d = ok({
      templateVersion: STRATEGY_TEMPLATE_VERSION,
      projectId: PROJECT,
      profile,
      sections: Object.fromEntries(STRATEGY_SECTIONS.map((s) => [s, empty])),
      unknowns: [],
    });
    expect(d.facts).toEqual([]);
    expect(d.questions.filter((q) => q.reason === "missing_section").map((q) => q.section)).toEqual(["goals", "offers", "audiences", "positioning"]);
    expect(d.unknowns.every((u) => u.origin === "missing_section")).toBe(true);
  });

  it("미확인 입력은 사실·추정으로 올라가지 않고, 같은 주제가 있어도 영역 상태를 바꾸지 않는다", () => {
    const raw = fullInput();
    raw.sections.offers = { facts: [], inferences: [] };
    raw.unknowns = [{ topic: "상품·제안", question: "당일 배송 꽃다발이 주력인가요?" }];
    const d = ok(raw);
    expect(d.facts.some((f) => f.text.includes("당일 배송 꽃다발이 주력"))).toBe(false);
    expect(d.inferences.some((i) => i.text.includes("당일 배송 꽃다발이 주력"))).toBe(false);
    expect(d.sections.offers.status).toBe("missing");
    expect(d.unknowns[0]).toEqual({ id: "unknown-1", topic: "상품·제안", question: "당일 배송 꽃다발이 주력인가요?", origin: "input", section: null });
  });

  it("입력 미확인은 순서·문구 그대로, 질문이 없으면 null(지어내지 않음)", () => {
    const d = ok(fullInput());
    expect(d.unknowns).toEqual([
      { id: "unknown-1", topic: "경쟁 꽃집 가격대", question: "주변 꽃집 가격은 얼마인가요?", origin: "input", section: null },
      { id: "unknown-2", topic: "배송 가능 지역", question: null, origin: "input", section: null },
    ]);
  });

  it("빈 필수 영역은 미확인 + 고정 확인 질문으로 돌려준다(점수·실패로 처리하지 않음)", () => {
    const raw = fullInput();
    raw.sections.offers = { facts: [], inferences: [] };
    const d = ok(raw);
    expect(d.sections.offers.status).toBe("missing");
    expect(d.questions).toEqual([{ id: "question-offers-missing", section: "offers", reason: "missing_section", question: STRATEGY_MISSING_QUESTIONS.offers }]);
    expect(d.unknowns.at(-1)).toEqual({ id: "unknown-offers", topic: "상품·제안", question: STRATEGY_MISSING_QUESTIONS.offers, origin: "missing_section", section: "offers" });
  });
});

describe("추정 분리", () => {
  it("추정만 있는 필수 영역은 inference_only 이고 근거 확인 질문을 붙이며, 사실 목록에는 절대 들어가지 않는다", () => {
    const raw = fullInput();
    raw.sections.positioning = { facts: [], inferences: [{ text: "가장 친절한 꽃집으로 보일 것이다" }] } as never;
    const d = ok(raw);
    expect(d.sections.positioning.status).toBe("inference_only");
    expect(d.facts.some((f) => f.text.includes("친절"))).toBe(false);
    expect(d.inferences.find((i) => i.section === "positioning")?.text).toBe("가장 친절한 꽃집으로 보일 것이다");
    expect(d.questions).toEqual([{ id: "question-positioning-evidence", section: "positioning", reason: "inference_only", question: STRATEGY_EVIDENCE_QUESTION }]);
  });

  it("출처 없는 '사실'은 거절한다(추정으로 적어야 함)", () => {
    const raw = fullInput();
    raw.sections.goals.facts[0]!.sources = [];
    expect(issuesOf(raw)).toContainEqual({ path: "sections.goals.facts.0.sources", message: expect.stringContaining("출처가 하나 이상") });
  });
});

describe("결정성과 지어내지 않기", () => {
  it("같은 입력(키 순서가 달라도)이면 결과가 바이트 단위로 같다", () => {
    const a = JSON.stringify(ok(fullInput()));
    const shuffled = JSON.parse(JSON.stringify(fullInput()), (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
    );
    expect(JSON.stringify(ok(shuffled))).toBe(a);
    expect(JSON.stringify(ok(fullInput()))).toBe(a);
  });

  it("결과의 모든 문장은 입력 문장이거나 고정 문구(영역 이름·확인 질문)뿐이다", () => {
    const raw = fullInput();
    raw.sections.offers = { facts: [], inferences: [] };
    const d = ok(raw);
    const inputTexts = new Set<string>();
    JSON.stringify(raw, (_k, v) => (typeof v === "string" && inputTexts.add(v), v));
    const fixed = new Set<string>([...Object.values(STRATEGY_MISSING_QUESTIONS), STRATEGY_EVIDENCE_QUESTION, ...Object.values(d.sections).map((s) => s.label)]);
    const outTexts = [
      ...d.facts.map((f) => f.text),
      ...d.inferences.flatMap((i) => [i.text, i.rationale].filter((x): x is string => !!x)),
      ...d.unknowns.flatMap((u) => [u.topic, u.question].filter((x): x is string => !!x)),
      ...d.questions.map((q) => q.question),
    ];
    for (const t of outTexts) expect(inputTexts.has(t) || fixed.has(t), t).toBe(true);
  });

  it("점수·진단 숫자를 만들지 않는다(결과의 숫자는 입력에 있던 프로필 버전뿐)", () => {
    const numbers: Array<[string, number]> = [];
    JSON.stringify(ok(fullInput()), (k, v) => (typeof v === "number" && numbers.push([k, v]), v));
    // profileRef.version 1번 + 출처로 적은 프로필 버전 2번(goals·audiences). 모두 입력값 그대로
    expect(numbers).toEqual([["version", 3], ["version", 3], ["version", 3]]);
  });
});

describe("프로젝트·버전 경계(입력 정합. DB 권한 보장 아님)", () => {
  it("다른 프로젝트의 프로필 참조 거절", () => {
    const raw = { ...fullInput(), profile: { ...profile, projectId: OTHER_PROJECT } };
    expect(issuesOf(raw)).toContainEqual({ path: "profile.projectId", message: "다른 프로젝트의 프로필은 참조할 수 없습니다." });
  });

  it("다른 프로젝트 자료를 출처로 쓰면 거절", () => {
    const raw = fullInput();
    raw.sections.offers.facts[0]!.sources = [{ kind: "asset", assetId: ASSET, projectId: OTHER_PROJECT }];
    expect(issuesOf(raw)).toContainEqual({ path: "sections.offers.facts.0.sources.0.projectId", message: "다른 프로젝트의 자료는 출처로 쓸 수 없습니다." });
  });

  it.each([
    ["다른 프로필", { kind: "profile", profileId: CLIENT, version: 3 }],
    ["같은 프로필의 다른 버전", { kind: "profile", profileId: PROFILE, version: 2 }],
  ])("출처가 %s 이면 거절", (_n, src) => {
    const raw = fullInput();
    raw.sections.goals.facts[0]!.sources = [src as never];
    expect(issuesOf(raw).some((i) => i.message.includes("다른 프로필을 출처로"))).toBe(true);
  });

  it.each([
    ["프로필 버전 0", { version: 0 }],
    ["프로필 버전 소수", { version: 1.5 }],
    ["프로필 버전 문자열", { version: "3" }],
  ])("잘못된 버전: %s", (_n, patch) => {
    expect(issuesOf({ ...fullInput(), profile: { ...profile, ...patch } }).some((i) => i.path === "profile.version")).toBe(true);
  });

  it("템플릿 버전이 다르면 거절", () => {
    expect(issuesOf({ ...fullInput(), templateVersion: "strategy-template@2" })).toContainEqual(
      expect.objectContaining({ path: "templateVersion" }),
    );
  });

  it.each([
    ["고객 프로젝트인데 고객 ID 없음", { clientId: null }],
    ["자체 프로젝트인데 고객 ID 있음", { projectKind: "personal" }],
  ])("%s → 거절", (_n, patch) => {
    expect(issuesOf({ ...fullInput(), profile: { ...profile, ...patch } }).some((i) => i.path === "profile.clientId")).toBe(true);
  });

  it("모르는 필드(예: 점수)는 거절한다(strict)", () => {
    expect(issuesOf({ ...fullInput(), score: 87 }).some((i) => /score|인식할 수 없|Unrecognized/i.test(i.message))).toBe(true);
  });
});

describe("중첩 위치의 모르는 키·오타는 조용히 버리지 않고 거절한다", () => {
  type Raw = ReturnType<typeof fullInput>;
  const put = (o: object, k: string, v: unknown) => ((o as Record<string, unknown>)[k] = v);
  it.each<[string, string, (r: Raw) => void]>([
    ["profile", "profile", (r) => put(r.profile, "aproved", true)],
    ["sections(영역 이름 오타 goal)", "sections", (r) => put(r.sections, "goal", { facts: [], inferences: [] })],
    ["영역(facts 오타 fact)", "sections.goals", (r) => put(r.sections.goals, "fact", [])],
    ["사실", "sections.goals.facts.0", (r) => put(r.sections.goals.facts[0]!, "confidence", 0.9)],
    ["출처(profile)", "sections.goals.facts.0.sources.0", (r) => put(r.sections.goals.facts[0]!.sources[0]!, "note", "x")],
    ["출처(asset)", "sections.offers.facts.0.sources.0", (r) => put(r.sections.offers.facts[0]!.sources[0]!, "assetID", ASSET)],
    ["출처(url)", "sections.positioning.facts.0.sources.0", (r) => put(r.sections.positioning.facts[0]!.sources[0]!, "title", "소개")],
    ["추정(rationale 오타)", "sections.audiences.inferences.0", (r) => put(r.sections.audiences.inferences[0]!, "rational", "이유")],
    ["미확인(question 오타)", "unknowns.0", (r) => put(r.unknowns[0]!, "questions", "질문")],
  ])("%s", (_n, path, mutate) => {
    const raw = fullInput();
    mutate(raw);
    expect(issuesOf(raw)).toContainEqual(expect.objectContaining({ path }));
  });

  it("영역 이름을 오타 내면 내용이 유실되지 않고 입력 전체가 거절된다(원래 영역이 빈 영역으로 바뀌어 통과하지 않음)", () => {
    const raw = fullInput() as unknown as { sections: Record<string, unknown> };
    raw.sections.positionning = raw.sections.positioning;
    delete raw.sections.positioning;
    expect(buildStrategyDraft(raw).ok).toBe(false);
  });
});

describe("빈 값·길이·개수", () => {
  it.each([
    ["공백뿐인 사실", (r: ReturnType<typeof fullInput>) => (r.sections.goals.facts[0]!.text = "   ")],
    ["너무 긴 추정", (r: ReturnType<typeof fullInput>) => (r.sections.problems.inferences[0]!.text = "가".repeat(STRATEGY_LIMITS.textMax + 1))],
    ["빈 미확인 주제", (r: ReturnType<typeof fullInput>) => (r.unknowns[0]!.topic = "")],
    ["https 아닌 출처 URL", (r: ReturnType<typeof fullInput>) => (r.sections.positioning.facts[0]!.sources = [{ kind: "url", url: "javascript:alert(1)" }] as never)],
    ["잘못된 프로젝트 ID", (r: ReturnType<typeof fullInput>) => ((r as { projectId: string }).projectId = "not-a-uuid")],
  ])("%s → 거절", (_n, mutate) => {
    const raw = fullInput();
    mutate(raw);
    expect(issuesOf(raw).length).toBeGreaterThan(0);
  });

  it("영역당 사실 개수 상한", () => {
    const raw = fullInput();
    raw.sections.goals.facts = Array.from({ length: STRATEGY_LIMITS.itemsPerKind + 1 }, (_, i) => ({ text: `목표 ${i}`, sources: [fromProfile] }));
    expect(issuesOf(raw).some((i) => i.path === "sections.goals.facts")).toBe(true);
  });

  it("앞뒤 공백은 정리되어 저장된다(내용은 바꾸지 않음)", () => {
    const raw = fullInput();
    raw.sections.goals.facts[0]!.text = "  가을 예약 늘리기  ";
    expect(ok(raw).facts[0]!.text).toBe("가을 예약 늘리기");
  });
});

describe("기존 로고·견적 계약 회귀 영향 없음", () => {
  it("작업 유형: 기존 logo_brief·quote 순서를 유지하고 strategy 만 뒤에 더한다(P2-STRATEGY-APP-01, 퍼널 등 하위 유형 없음)", () => {
    expect(TASK_TYPES).toEqual(["logo_brief", "quote", "strategy"]);
  });

  it("로고·견적 입력 계약과 로고 생성은 예전처럼 동작한다", () => {
    expect(logoBriefInputSchema.safeParse({ companyName: "꽃집" }).success).toBe(true);
    expect(buildLogoBrief({ companyName: "꽃집" }).ok).toBe(true);
    expect(typeof quoteInputSchema.safeParse).toBe("function");
  });

  it("전략 계약의 영역 목록은 7개로 고정", () => {
    expect(STRATEGY_SECTIONS).toHaveLength(7);
    expect(strategyInputSchema.safeParse({}).success).toBe(false);
  });
});
