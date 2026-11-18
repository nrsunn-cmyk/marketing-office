/**
 * P2-STRATEGY-CORE-01: 채널 중립 전략 초안 만들기(입력 조합형 결정적 함수).
 *
 * - 사용자가 준 입력만 정리한다. 새 사실·숫자·점수를 만들지 않는다.
 * - 사실(출처 있음)·추정(가설)·미확인을 따로 둔다. 추정은 어떤 경우에도 사실로 옮기지 않는다.
 * - 필수 영역(goals·offers·audiences·positioning)이 비어 있으면 고정 문구의 확인 질문과 미확인 항목을 돌려준다.
 * - 같은 입력이면 항상 같은 결과다(시각·난수 없음, ID 는 영역 순서와 위치로 만든다).
 * - 입력 경계 검사는 strategyInputSchema 가 한다. DB 권한(이 프로필·자료가 이 업무실 것인지, 승인됐는지)은
 *   이 함수가 보장하지 않는다. 저장·조회 단계의 RLS·RPC 가 따로 확인해야 한다.
 */
import {
  STRATEGY_REQUIRED_SECTIONS,
  STRATEGY_SECTIONS,
  STRATEGY_TEMPLATE_VERSION,
  strategyInputSchema,
  type StrategySection,
  type StrategySource,
} from "@/contracts/p2-strategy";
import { STRATEGY_SECTION_LABELS } from "./labels";

// 이름표는 labels.ts 에 있다(BUNDLE-D-FRONT-01). 기존 import 경로는 그대로 쓸 수 있다
// 새 이름표·상수는 labels.ts 에 둔다(화면 import 경계는 client-imports.test.ts 가 검사)
export { STRATEGY_SECTION_LABELS };


/** 필수 영역이 비었을 때 묻는 고정 질문(입력 내용을 지어내지 않는다) */
export const STRATEGY_MISSING_QUESTIONS: Record<StrategySection, string> = {
  goals: "이 프로젝트로 이루려는 목표는 무엇인가요?",
  offers: "고객에게 제안할 상품·서비스는 무엇인가요?",
  audiences: "주로 누구에게 알리려고 하나요?",
  positioning: "경쟁 대상과 비교해 어떤 점으로 기억되고 싶나요?",
  problems: "고객이 겪는 문제는 무엇인가요?",
  opportunities: "지금 활용할 수 있는 기회는 무엇인가요?",
  priorities: "가장 먼저 할 일은 무엇인가요?",
};
/** 추정만 있는 필수 영역에 붙이는 고정 질문 */
export const STRATEGY_EVIDENCE_QUESTION = "추정만 있습니다. 확인할 수 있는 근거(출처)가 있나요?";

export type SectionStatus = "filled" | "inference_only" | "missing";

export interface StrategyFactItem {
  id: string;
  section: StrategySection;
  text: string;
  sources: StrategySource[];
}
export interface StrategyInferenceItem {
  id: string;
  section: StrategySection;
  text: string;
  rationale: string | null;
}
export interface StrategyUnknownItem {
  id: string;
  topic: string;
  /** 사용자가 적은 질문. 없으면 null(지어내지 않음) */
  question: string | null;
  origin: "input" | "missing_section";
  section: StrategySection | null;
}
export interface StrategyQuestion {
  id: string;
  section: StrategySection;
  reason: "missing_section" | "inference_only";
  question: string;
}

export interface StrategyDraft {
  templateVersion: typeof STRATEGY_TEMPLATE_VERSION;
  projectId: string;
  profileRef: { id: string; version: number };
  sections: Record<StrategySection, { label: string; status: SectionStatus; factIds: string[]; inferenceIds: string[] }>;
  facts: StrategyFactItem[];
  inferences: StrategyInferenceItem[];
  unknowns: StrategyUnknownItem[];
  questions: StrategyQuestion[];
  generator: { mode: "template"; templateVersion: typeof STRATEGY_TEMPLATE_VERSION };
}

export interface StrategyIssue {
  path: string;
  message: string;
}
export type StrategyOutcome = { ok: true; result: StrategyDraft } | { ok: false; issues: StrategyIssue[] };

/** 입력을 검사하고(실패하면 이유 목록) 전략 초안을 만든다. 입력에 없는 내용은 고정 질문 문구 외에 만들지 않는다. */
export function buildStrategyDraft(raw: unknown): StrategyOutcome {
  const parsed = strategyInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const input = parsed.data;
  const facts: StrategyFactItem[] = [];
  const inferences: StrategyInferenceItem[] = [];
  const unknowns: StrategyUnknownItem[] = input.unknowns.map((u, i) => ({
    id: `unknown-${i + 1}`,
    topic: u.topic,
    question: u.question ?? null,
    origin: "input",
    section: null,
  }));
  const questions: StrategyQuestion[] = [];
  const sections = {} as StrategyDraft["sections"];

  for (const section of STRATEGY_SECTIONS) {
    const { facts: f, inferences: inf } = input.sections[section];
    const factIds = f.map((item, i) => {
      const id = `${section}-fact-${i + 1}`;
      facts.push({ id, section, text: item.text, sources: item.sources });
      return id;
    });
    const inferenceIds = inf.map((item, i) => {
      const id = `${section}-inference-${i + 1}`;
      inferences.push({ id, section, text: item.text, rationale: item.rationale ?? null });
      return id;
    });
    const status: SectionStatus = factIds.length > 0 ? "filled" : inferenceIds.length > 0 ? "inference_only" : "missing";
    sections[section] = { label: STRATEGY_SECTION_LABELS[section], status, factIds, inferenceIds };

    if (!STRATEGY_REQUIRED_SECTIONS.includes(section)) continue;
    if (status === "missing") {
      questions.push({ id: `question-${section}-missing`, section, reason: "missing_section", question: STRATEGY_MISSING_QUESTIONS[section] });
      unknowns.push({
        id: `unknown-${section}`,
        topic: STRATEGY_SECTION_LABELS[section],
        question: STRATEGY_MISSING_QUESTIONS[section],
        origin: "missing_section",
        section,
      });
    } else if (status === "inference_only") {
      questions.push({ id: `question-${section}-evidence`, section, reason: "inference_only", question: STRATEGY_EVIDENCE_QUESTION });
    }
  }

  return {
    ok: true,
    result: {
      templateVersion: STRATEGY_TEMPLATE_VERSION,
      projectId: input.projectId,
      profileRef: { id: input.profile.id, version: input.profile.version },
      sections,
      facts,
      inferences,
      unknowns,
      questions,
      generator: { mode: "template", templateVersion: STRATEGY_TEMPLATE_VERSION },
    },
  };
}
