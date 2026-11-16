/**
 * P2-STRATEGY-APP-01: 저장된 전략 결과(artifact_versions.content)를 화면에 보이기 전에 다시 계산한다(N1).
 * 저장된 sections[].status·questions·자동 미확인은 믿지 않는다. 사실·추정·사용자 미확인만 꺼내
 * 계약 입력으로 다시 세운 뒤 buildStrategyDraft → toStrategyView 로 상태·질문을 새로 만든다.
 * 프로젝트·고객 정보는 저장값이 아니라 서버가 DB에서 읽은 값을 쓴다.
 */
import { STRATEGY_SECTIONS, STRATEGY_TEMPLATE_VERSION, type StrategySection } from "@/contracts/p2-strategy";
import type { PROJECT_KINDS } from "@/contracts";
import { buildStrategyDraft } from "./build";
import { toStrategyView, type StrategyView } from "./view";

type ProjectKind = (typeof PROJECT_KINDS)[number];

export interface StrategyProjectContext {
  projectId: string;
  clientId: string | null;
  projectKind: ProjectKind;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** 저장된 결과에서 계약 입력을 다시 세운다. 형식이 깨졌으면 null */
export function rebuildStrategyInput(content: unknown, project: StrategyProjectContext): Obj | null {
  if (!isObj(content) || !isObj(content.profileRef)) return null;
  const sections: Record<string, { facts: unknown[]; inferences: unknown[] }> = {};
  for (const s of STRATEGY_SECTIONS) sections[s] = { facts: [], inferences: [] };
  for (const f of arr(content.facts)) {
    if (!isObj(f) || !STRATEGY_SECTIONS.includes(f.section as StrategySection)) return null;
    sections[f.section as StrategySection]!.facts.push({ text: f.text, sources: f.sources });
  }
  for (const i of arr(content.inferences)) {
    if (!isObj(i) || !STRATEGY_SECTIONS.includes(i.section as StrategySection)) return null;
    sections[i.section as StrategySection]!.inferences.push(i.rationale == null ? { text: i.text } : { text: i.text, rationale: i.rationale });
  }
  const unknowns = arr(content.unknowns)
    .filter((u): u is Obj => isObj(u) && u.origin === "input")
    .map((u) => (u.question == null ? { topic: u.topic } : { topic: u.topic, question: u.question }));
  return {
    templateVersion: STRATEGY_TEMPLATE_VERSION,
    projectId: project.projectId,
    profile: {
      id: content.profileRef.id,
      version: content.profileRef.version,
      projectId: project.projectId,
      clientId: project.clientId,
      projectKind: project.projectKind,
    },
    sections,
    unknowns,
  };
}

/** 저장 결과 → 화면 값. 다시 세운 입력이 계약을 통과하지 못하면 invalid 화면 값을 돌려준다 */
export function strategyViewFromContent(content: unknown, project: StrategyProjectContext): StrategyView {
  const input = rebuildStrategyInput(content, project);
  if (!input) return { kind: "invalid", fieldErrors: {}, summaryErrors: ["저장된 전략 형식을 읽을 수 없습니다."] };
  return toStrategyView(buildStrategyDraft(input));
}
