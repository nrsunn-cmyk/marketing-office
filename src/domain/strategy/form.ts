/**
 * P2-STRATEGY-APP-01: 화면 폼 값 ↔ 계약 입력 변환(순수 함수).
 * - 폼 → 계약: 빈 줄을 버리고, 프로필 출처는 서버가 고른 프로필 {id, version}, 자료 출처는 현재 프로젝트로 채운다.
 *   그 뒤 계약(strategyInputSchema)·DB 가 최종 판단한다.
 * - 계약 → 폼: 직접 고치기 화면을 저장된 내용으로 미리 채운다.
 */
import { emptyStrategyForm, type StrategyFormPayload, type StrategyFormSource } from "@/contracts/p2-strategy-form";
import { STRATEGY_SECTIONS, STRATEGY_TEMPLATE_VERSION, type StrategySource } from "@/contracts/p2-strategy";
import type { StrategyProjectContext } from "./rebuild";

export interface SelectedProfile {
  id: string;
  version: number;
}

const filled = (s: string | undefined) => (s ?? "").trim().length > 0;

function toSource(src: StrategyFormSource, profile: SelectedProfile, projectId: string): unknown {
  switch (src.kind) {
    case "profile":
      return { kind: "profile", profileId: profile.id, version: profile.version };
    case "asset":
      return { kind: "asset", assetId: src.assetId, projectId };
    case "url":
      return { kind: "url", url: src.url.trim() };
  }
}

/** 폼 값 → 계약 입력(검증 전 원본). 계약 검사는 호출하는 쪽에서 한다 */
export function formToStrategyInput(form: StrategyFormPayload, profile: SelectedProfile, project: StrategyProjectContext): Record<string, unknown> {
  const sections = Object.fromEntries(
    STRATEGY_SECTIONS.map((s) => {
      const sec = form.sections[s];
      return [
        s,
        {
          facts: sec.facts.filter((f) => filled(f.text)).map((f) => ({ text: f.text, sources: [toSource(f.source, profile, project.projectId)] })),
          inferences: sec.inferences
            .filter((i) => filled(i.text))
            .map((i) => (filled(i.rationale) ? { text: i.text, rationale: i.rationale } : { text: i.text })),
        },
      ];
    }),
  );
  return {
    templateVersion: STRATEGY_TEMPLATE_VERSION,
    projectId: project.projectId,
    profile: { id: profile.id, version: profile.version, projectId: project.projectId, clientId: project.clientId, projectKind: project.projectKind },
    sections,
    unknowns: form.unknowns.filter((u) => filled(u.topic)).map((u) => (filled(u.question) ? { topic: u.topic, question: u.question } : { topic: u.topic })),
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** 계약 입력(다시 세운 것) → 폼 값. 사실의 첫 출처만 폼에 싣는다(폼은 사실당 출처 1개) */
export function strategyInputToForm(input: Obj | null, profileVersionId: string): StrategyFormPayload {
  const form = emptyStrategyForm(profileVersionId);
  if (!input || !isObj(input.sections)) return form;
  for (const s of STRATEGY_SECTIONS) {
    const sec = (input.sections as Obj)[s];
    if (!isObj(sec)) continue;
    for (const f of Array.isArray(sec.facts) ? sec.facts : []) {
      if (!isObj(f)) continue;
      const src = (Array.isArray(f.sources) ? f.sources[0] : null) as StrategySource | null;
      const source: StrategyFormSource =
        src?.kind === "asset" ? { kind: "asset", assetId: src.assetId } : src?.kind === "url" ? { kind: "url", url: src.url } : { kind: "profile" };
      form.sections[s].facts.push({ text: String(f.text ?? ""), source });
    }
    for (const i of Array.isArray(sec.inferences) ? sec.inferences : []) {
      if (!isObj(i)) continue;
      form.sections[s].inferences.push(i.rationale == null ? { text: String(i.text ?? "") } : { text: String(i.text ?? ""), rationale: String(i.rationale) });
    }
  }
  for (const u of Array.isArray(input.unknowns) ? input.unknowns : []) {
    if (!isObj(u)) continue;
    form.unknowns.push(u.question == null ? { topic: String(u.topic ?? "") } : { topic: String(u.topic ?? ""), question: String(u.question) });
  }
  return form;
}
