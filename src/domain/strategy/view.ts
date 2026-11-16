/**
 * P2-STRATEGY-VIEWMODEL-03: 전략 초안 결과(StrategyOutcome)를 화면 표시용 값으로 바꾸는 순수 함수.
 *
 * - 문자열은 "텍스트"로만 돌려준다. HTML 을 조합하지 않고, 입력 문장을 고치거나 escape 하지도 않는다.
 *   렌더러가 반드시 텍스트로 출력(React 기본 escape)해야 하며 dangerouslySetInnerHTML 등으로 넣으면 안 된다.
 * - 확인 질문은 draft.questions 기준이다. 빈 필수 영역 때문에 자동으로 생긴 미확인(origin "missing_section")은
 *   같은 내용이 questions 에 이미 있으므로 다시 싣지 않는다. 사용자가 입력한 미확인만 따로 싣는다.
 * - 같은 문구라도 id 가 다르면 서로 다른 질문이다(문구로 합치지 않는다).
 * - 상태 의미는 그대로다(filled = 출처 있는 사실 1개 이상). 선택 3영역의 missing 은 오류 색이 아닌 중립으로 표시한다.
 * - 값이 없는 rationale·question 은 속성을 빼서 돌려준다("null" 문자열이 화면에 나오지 않게).
 * - 오류: 검증된 7개 영역 경로만 영역 오류로, 나머지(sections 자체·profile·기타)는 요약 오류로 보낸다.
 *   Zod 기본 영어 문구는 그대로 내보내지 않고 한국어 안전 문구로 바꾼다(입력 키 이름도 싣지 않음).
 */
import { STRATEGY_REQUIRED_SECTIONS, STRATEGY_SECTIONS, type StrategySection, type StrategySource } from "@/contracts/p2-strategy";
import { STRATEGY_SECTION_LABELS as LABELS, type SectionStatus, type StrategyOutcome } from "./build";

export type BadgeTone = "success" | "warning" | "danger" | "neutral";

export interface SourceView {
  kind: StrategySource["kind"];
  /** 화면에 보일 짧은 이름(텍스트) */
  label: string;
  /** 연결할 대상(프로필·자료 ID 또는 URL 텍스트). 링크로 만들 때 렌더러가 http(s)만 허용해야 한다 */
  ref: string;
}
export interface FactView {
  id: string;
  text: string;
  sources: SourceView[];
}
export interface InferenceView {
  id: string;
  text: string;
  rationale?: string;
}
export interface SectionView {
  key: StrategySection;
  label: string;
  required: boolean;
  status: SectionStatus;
  badge: { label: string; tone: BadgeTone };
  facts: FactView[];
  inferences: InferenceView[];
}
export interface QuestionView {
  id: string;
  section: StrategySection;
  sectionLabel: string;
  reason: "missing_section" | "inference_only";
  text: string;
}
export interface UserUnknownView {
  id: string;
  topic: string;
  question?: string;
}

export type StrategyView =
  | {
      kind: "draft";
      templateVersion: string;
      profileLabel: string;
      sections: SectionView[];
      questions: QuestionView[];
      userUnknowns: UserUnknownView[];
    }
  | {
      kind: "invalid";
      /** 7개 영역별 오류 문구(같은 문구는 한 번만) */
      fieldErrors: Partial<Record<StrategySection, string[]>>;
      /** 영역에 매핑되지 않는 오류(sections 자체·profile·projectId·templateVersion·unknowns 등) */
      summaryErrors: string[];
    };

export const STRATEGY_BADGES: Record<"filled" | "inference_only" | "missing_required" | "missing_optional", { label: string; tone: BadgeTone }> = {
  filled: { label: "근거 있음", tone: "success" },
  inference_only: { label: "추정만 있음", tone: "warning" },
  missing_required: { label: "확인 필요", tone: "danger" },
  missing_optional: { label: "비어 있음", tone: "neutral" },
};

export const STRATEGY_SAFE_MESSAGES = {
  unknownKey: "알 수 없는 항목 이름이 있습니다. 항목 이름을 확인해 주세요.",
  invalid: "입력 형식이 올바르지 않습니다.",
} as const;

const HANGUL = /[가-힣]/;
/** 계약의 한국어 문구는 그대로, Zod 기본(영어) 문구는 안전 문구로 바꾼다 */
function safeMessage(message: string): string {
  if (HANGUL.test(message)) return message;
  if (/^Unrecognized key/i.test(message)) return STRATEGY_SAFE_MESSAGES.unknownKey;
  return STRATEGY_SAFE_MESSAGES.invalid;
}

function sourceView(s: StrategySource): SourceView {
  switch (s.kind) {
    case "profile":
      return { kind: "profile", label: `회사 프로필 ${s.version}번 버전`, ref: s.profileId };
    case "asset":
      return { kind: "asset", label: "프로젝트 자료", ref: s.assetId };
    case "url":
      return { kind: "url", label: "외부 주소", ref: s.url };
  }
}

const isSection = (v: string | undefined): v is StrategySection => !!v && (STRATEGY_SECTIONS as readonly string[]).includes(v);

export function toStrategyView(outcome: StrategyOutcome): StrategyView {
  if (!outcome.ok) {
    const fieldErrors: Partial<Record<StrategySection, string[]>> = {};
    const summaryErrors: string[] = [];
    for (const issue of outcome.issues) {
      const [head, section] = issue.path.split(".");
      const message = safeMessage(issue.message);
      if (head === "sections" && isSection(section)) {
        const list = (fieldErrors[section] ??= []);
        if (!list.includes(message)) list.push(message);
      } else if (!summaryErrors.includes(message)) {
        summaryErrors.push(message);
      }
    }
    return { kind: "invalid", fieldErrors, summaryErrors };
  }

  const d = outcome.result;
  const factById = new Map(d.facts.map((f) => [f.id, f]));
  const inferenceById = new Map(d.inferences.map((i) => [i.id, i]));
  const sections: SectionView[] = STRATEGY_SECTIONS.map((key) => {
    const s = d.sections[key];
    const required = STRATEGY_REQUIRED_SECTIONS.includes(key);
    const badge =
      s.status === "missing" ? STRATEGY_BADGES[required ? "missing_required" : "missing_optional"] : STRATEGY_BADGES[s.status];
    return {
      key,
      label: LABELS[key],
      required,
      status: s.status,
      badge: { ...badge },
      facts: s.factIds.map((id) => {
        const f = factById.get(id)!;
        return { id, text: f.text, sources: f.sources.map(sourceView) };
      }),
      inferences: s.inferenceIds.map((id) => {
        const i = inferenceById.get(id)!;
        return i.rationale === null ? { id, text: i.text } : { id, text: i.text, rationale: i.rationale };
      }),
    };
  });

  return {
    kind: "draft",
    templateVersion: d.templateVersion,
    profileLabel: `회사 프로필 ${d.profileRef.version}번 버전 기준`,
    sections,
    questions: d.questions.map((q) => ({ id: q.id, section: q.section, sectionLabel: LABELS[q.section], reason: q.reason, text: q.question })),
    userUnknowns: d.unknowns
      .filter((u) => u.origin === "input")
      .map((u) => (u.question === null ? { id: u.id, topic: u.topic } : { id: u.id, topic: u.topic, question: u.question })),
  };
}
