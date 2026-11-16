/**
 * P2-STRATEGY-CORE-01: 채널 중립 "전략" 입력 계약 (P2 사전 후보, 아직 운영 기능에 연결하지 않음).
 *
 * - 승인된 회사 프로필 버전 참조 {id, version, projectId, clientId, projectKind} 를 명시한다.
 * - 7개 영역(goals·offers·audiences·positioning·problems·opportunities·priorities)마다
 *   사실(facts: 출처 1개 이상 필수)과 추정(inferences: 가설)을 따로 받는다. 미확인(unknowns)은 별도 목록이다.
 *   (AGY PLAN-P2-UI-02 §3·§4.1 의 사실/미확인/추정 분리와 필드 이름에 맞춤)
 * - 점수·진단 숫자 필드는 없다.
 * - 이 계약의 경계 검사(같은 프로젝트·같은 프로필 버전)는 "입력이 서로 맞는지"만 본다.
 *   그 프로필·자료가 실제로 이 사용자 업무실의 것인지, 프로필이 승인됐는지는 DB(RLS·RPC)가 따로 확인해야 한다.
 *   이 계약을 통과했다고 DB 권한이 보장되지 않는다.
 * 기존 TASK_TYPES(logo_brief·quote)·DB 스키마·API 는 바꾸지 않는다.
 */
import { z } from "zod";
import { PROJECT_KINDS } from "./index";

export const STRATEGY_TEMPLATE_VERSION = "strategy-template@1";

export const STRATEGY_SECTIONS = ["goals", "offers", "audiences", "positioning", "problems", "opportunities", "priorities"] as const;
export type StrategySection = (typeof STRATEGY_SECTIONS)[number];

/** 비어 있으면 확인 질문을 만드는 영역(전략의 뼈대). 나머지는 비어 있어도 질문하지 않는다 */
export const STRATEGY_REQUIRED_SECTIONS: readonly StrategySection[] = ["goals", "offers", "audiences", "positioning"];

export const STRATEGY_LIMITS = {
  textMax: 500,
  topicMax: 200,
  questionMax: 300,
  itemsPerKind: 20,
  sourcesPerFact: 10,
  unknownsMax: 30,
} as const;

const text = (max: number) =>
  z.string().trim().min(1, "내용을 입력해 주세요.").max(max, `${max}자 이내로 입력해 주세요.`);

/** 승인된 회사 프로필 버전 참조. 고객 프로젝트만 고객 ID 가 있다(R07, projectInputSchema 와 같은 규칙) */
export const approvedProfileRefSchema = z
  .object({
    id: z.uuid("프로필 ID 형식이 올바르지 않습니다."),
    version: z.number().int("프로필 버전은 정수여야 합니다.").min(1, "프로필 버전은 1 이상이어야 합니다."),
    projectId: z.uuid("프로젝트 ID 형식이 올바르지 않습니다."),
    clientId: z.uuid("고객 ID 형식이 올바르지 않습니다.").nullable(),
    projectKind: z.enum(PROJECT_KINDS),
  })
  .refine((r) => (r.projectKind === "client") === (r.clientId !== null), {
    message: "고객 프로젝트에만 고객 ID 가 있어야 합니다.",
    path: ["clientId"],
  });
export type ApprovedProfileRef = z.infer<typeof approvedProfileRefSchema>;

/** 사실의 출처. 외부 수집은 하지 않으며, 사용자가 적은 출처를 그대로 기록만 한다 */
export const strategySourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("profile"), profileId: z.uuid(), version: z.number().int().min(1) }),
  z.object({ kind: z.literal("asset"), assetId: z.uuid(), projectId: z.uuid() }),
  z.object({ kind: z.literal("url"), url: z.url({ protocol: /^https?$/ }).max(2000) }),
]);
export type StrategySource = z.infer<typeof strategySourceSchema>;

export const strategyFactSchema = z.object({
  text: text(STRATEGY_LIMITS.textMax),
  sources: z
    .array(strategySourceSchema)
    .min(1, "사실에는 출처가 하나 이상 필요합니다. 출처가 없으면 추정으로 적어 주세요.")
    .max(STRATEGY_LIMITS.sourcesPerFact),
});

export const strategyInferenceSchema = z.object({
  text: text(STRATEGY_LIMITS.textMax),
  /** 왜 그렇게 추정했는지(선택). 사실로 바뀌지 않는다 */
  rationale: text(STRATEGY_LIMITS.textMax).optional(),
});

export const strategyUnknownSchema = z.object({
  topic: text(STRATEGY_LIMITS.topicMax),
  question: text(STRATEGY_LIMITS.questionMax).optional(),
});

const sectionSchema = z.object({
  facts: z.array(strategyFactSchema).max(STRATEGY_LIMITS.itemsPerKind).default([]),
  inferences: z.array(strategyInferenceSchema).max(STRATEGY_LIMITS.itemsPerKind).default([]),
});
const emptySection = () => ({ facts: [], inferences: [] });

export const strategyInputSchema = z
  .object({
    templateVersion: z.literal(STRATEGY_TEMPLATE_VERSION, { error: `템플릿 버전은 ${STRATEGY_TEMPLATE_VERSION} 이어야 합니다.` }),
    projectId: z.uuid("프로젝트 ID 형식이 올바르지 않습니다."),
    profile: approvedProfileRefSchema,
    sections: z
      .object(Object.fromEntries(STRATEGY_SECTIONS.map((s) => [s, sectionSchema.default(emptySection)])) as Record<StrategySection, z.ZodDefault<typeof sectionSchema>>)
      .default(() => Object.fromEntries(STRATEGY_SECTIONS.map((s) => [s, emptySection()])) as Record<StrategySection, { facts: []; inferences: [] }>),
    unknowns: z.array(strategyUnknownSchema).max(STRATEGY_LIMITS.unknownsMax).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    // 입력끼리의 경계(같은 프로젝트·같은 프로필 버전). DB 권한 확인을 대신하지 않는다.
    if (v.profile.projectId !== v.projectId) {
      ctx.addIssue({ code: "custom", path: ["profile", "projectId"], message: "다른 프로젝트의 프로필은 참조할 수 없습니다." });
    }
    for (const section of STRATEGY_SECTIONS) {
      v.sections[section].facts.forEach((fact, i) => {
        fact.sources.forEach((src, j) => {
          const path = ["sections", section, "facts", i, "sources", j];
          if (src.kind === "asset" && src.projectId !== v.projectId) {
            ctx.addIssue({ code: "custom", path: [...path, "projectId"], message: "다른 프로젝트의 자료는 출처로 쓸 수 없습니다." });
          }
          if (src.kind === "profile" && (src.profileId !== v.profile.id || src.version !== v.profile.version)) {
            ctx.addIssue({ code: "custom", path, message: "참조한 승인 프로필 버전과 다른 프로필을 출처로 쓸 수 없습니다." });
          }
        });
      });
    }
  });

export type StrategyInput = z.infer<typeof strategyInputSchema>;
