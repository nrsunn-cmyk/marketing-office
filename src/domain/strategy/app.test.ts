import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyStrategyForm, strategyFormPayloadSchema } from "@/contracts/p2-strategy-form";
import { buildStrategyDraft } from "./build";
import { STRATEGY_ERROR_FALLBACK, STRATEGY_ERROR_MESSAGES, strategyErrorFromDb } from "./errors";
import { formToStrategyInput, strategyInputToForm } from "./form";
import { rebuildStrategyInput, strategyViewFromContent, type StrategyProjectContext } from "./rebuild";
import { toStrategyView } from "./view";

/** P2-STRATEGY-APP-01: 화면 연결용 순수 함수(다시 계산·폼 변환·오류 문구). 합성 값만 쓴다 */
const fixture = (n: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", `${n}.input.json`), "utf8"));
const ctxOf = (input: { projectId: string; profile: { clientId: string | null; projectKind: StrategyProjectContext["projectKind"] } }): StrategyProjectContext => ({
  projectId: input.projectId,
  clientId: input.profile.clientId,
  projectKind: input.profile.projectKind,
});
const draftOf = (input: unknown) => {
  const r = buildStrategyDraft(input);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.result;
};

describe("N1 다시 계산: 저장된 상태·질문을 믿지 않는다", () => {
  it.each(["normal-7-sections", "required-missing", "inference-only"])("%s: 저장 결과에서 다시 세운 화면 값 = 원래 입력의 화면 값", (n) => {
    const input = fixture(n);
    const content = draftOf(input);
    expect(strategyViewFromContent(content, ctxOf(input))).toEqual(toStrategyView(buildStrategyDraft(input)));
  });

  it("저장된 status·questions 를 위조해도 화면 값은 사실·추정에서 다시 계산된다", () => {
    const input = fixture("required-missing");
    const content = draftOf(input);
    const forged = {
      ...content,
      sections: Object.fromEntries(Object.entries(content.sections).map(([k, v]) => [k, { ...v, status: "filled" }])),
      questions: [],
      unknowns: [{ id: "x", topic: "위조 자동 미확인", question: null, origin: "missing_section", section: "offers" }],
    };
    const v = strategyViewFromContent(forged, ctxOf(input));
    if (v.kind !== "draft") throw new Error("draft");
    expect(v.sections.find((s) => s.key === "offers")!.status).toBe("missing");
    expect(v.questions.map((q) => q.section)).toEqual(["offers", "audiences"]);
    expect(v.userUnknowns).toEqual([]);
  });

  it("프로젝트·고객은 저장값이 아니라 서버가 준 값으로 세운다", () => {
    const input = fixture("normal-7-sections");
    const rebuilt = rebuildStrategyInput(draftOf(input), ctxOf(input))!;
    expect(rebuilt.projectId).toBe(input.projectId);
    expect((rebuilt.profile as { clientId: string }).clientId).toBe(input.profile.clientId);
  });

  it("형식이 깨진 저장값은 invalid 화면 값(원문 노출 없음)", () => {
    const v = strategyViewFromContent({ facts: "x" }, { projectId: "00000000-0000-4000-8000-00000000a001", clientId: null, projectKind: "personal" });
    expect(v).toEqual({ kind: "invalid", fieldErrors: {}, summaryErrors: ["저장된 전략 형식을 읽을 수 없습니다."] });
  });
});

describe("폼 ↔ 계약 입력", () => {
  const project: StrategyProjectContext = { projectId: "00000000-0000-4000-8000-00000000a001", clientId: "00000000-0000-4000-8000-00000000c001", projectKind: "client" };
  const profile = { id: "00000000-0000-4000-8000-00000000b001", version: 2 };

  it("빈 줄은 버리고, 프로필 출처는 서버가 고른 프로필로, 자료 출처는 현재 프로젝트로 채운다", () => {
    const form = emptyStrategyForm(profile.id);
    form.sections.goals.facts.push({ text: "목표 A", source: { kind: "profile" } }, { text: "   ", source: { kind: "profile" } });
    form.sections.offers.facts.push({ text: "상품 B", source: { kind: "asset", assetId: "00000000-0000-4000-8000-00000000d001" } });
    form.sections.positioning.facts.push({ text: "위치 C", source: { kind: "url", url: " https://example.com/c " } });
    form.sections.audiences.inferences.push({ text: "추정 D", rationale: "" }, { text: "추정 E", rationale: "이유" });
    form.unknowns.push({ topic: "주제", question: "" }, { topic: "" });
    const input = formToStrategyInput(form, profile, project) as { sections: Record<string, { facts: unknown[]; inferences: unknown[] }>; unknowns: unknown[] };
    expect(input.sections.goals!.facts).toEqual([{ text: "목표 A", sources: [{ kind: "profile", profileId: profile.id, version: 2 }] }]);
    expect(input.sections.offers!.facts).toEqual([{ text: "상품 B", sources: [{ kind: "asset", assetId: "00000000-0000-4000-8000-00000000d001", projectId: project.projectId }] }]);
    expect(input.sections.positioning!.facts).toEqual([{ text: "위치 C", sources: [{ kind: "url", url: "https://example.com/c" }] }]);
    expect(input.sections.audiences!.inferences).toEqual([{ text: "추정 D" }, { text: "추정 E", rationale: "이유" }]);
    expect(input.unknowns).toEqual([{ topic: "주제" }]);
    expect(buildStrategyDraft(input).ok).toBe(true);
  });

  it("다시 세운 입력 → 폼 → 입력 왕복이 같은 결과를 만든다(직접 고치기 미리 채움)", () => {
    const input = fixture("normal-7-sections");
    const content = draftOf(input);
    const form = strategyInputToForm(rebuildStrategyInput(content, ctxOf(input)), input.profile.id);
    const again = formToStrategyInput(form, { id: input.profile.id, version: input.profile.version }, ctxOf(input));
    expect(draftOf(again)).toEqual(content);
  });

  it("폼 스키마: 모르는 키·잘못된 프로필 id·한도 초과 개수는 거절", () => {
    const ok = emptyStrategyForm("00000000-0000-4000-8000-00000000b001");
    expect(strategyFormPayloadSchema.safeParse(ok).success).toBe(true);
    expect(strategyFormPayloadSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(strategyFormPayloadSchema.safeParse({ ...ok, profileVersionId: "x" }).success).toBe(false);
    expect(strategyFormPayloadSchema.safeParse({ ...ok, unknowns: Array.from({ length: 31 }, () => ({ topic: "t" })) }).success).toBe(false);
  });
});

describe("오류 코드 → 한국어 안내", () => {
  it.each(Object.keys(STRATEGY_ERROR_MESSAGES))("%s 는 한국어 문구로 바뀌고 DB 원문은 보이지 않는다", (code) => {
    const r = strategyErrorFromDb(`${code}: 내부 설명 sections.offers.facts.0 Unrecognized`);
    expect(r.code).toBe(code);
    expect(r.message).toMatch(/[가-힣]/);
    expect(r.message).not.toMatch(/sections\.|Unrecognized|내부 설명/);
  });
  it("모르는 오류·빈 값은 일반 문구", () => {
    expect(strategyErrorFromDb("duplicate key value violates")).toEqual({ code: "ERROR", message: STRATEGY_ERROR_FALLBACK });
    expect(strategyErrorFromDb(undefined).code).toBe("ERROR");
  });
});

describe("계약 오류 → 사용자 문구", () => {
  it("한국어 계약 문구는 그대로, url·자료 id 영어 오류는 경로별 안내, 그 밖은 일반 문구", async () => {
    const { strategyContractIssueMessage } = await import("./errors");
    expect(strategyContractIssueMessage({ path: ["sections", "goals", "facts", 0, "text"], message: "500자 이내로 입력해 주세요." })).toBe("500자 이내로 입력해 주세요.");
    expect(strategyContractIssueMessage({ path: ["sections", "offers", "facts", 0, "sources", 0, "url"], message: "Invalid URL" })).toMatch(/http/);
    expect(strategyContractIssueMessage({ path: ["sections", "offers", "facts", 0, "sources", 0, "assetId"], message: "Invalid UUID" })).toMatch(/자료나 프로필/);
    expect(strategyContractIssueMessage({ path: ["x"], message: "Unrecognized key: \"포지셔닝\"" })).toBe("입력값이 규칙에 맞지 않습니다.");
    expect(strategyContractIssueMessage(undefined)).toBe("입력값이 규칙에 맞지 않습니다.");
  });
});
