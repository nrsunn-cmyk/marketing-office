/**
 * P2F-BACKEND-01: 브리프 카피 자동 생성(LLM) **계약만** 정의한다. 호출 코드·키·네트워크는 없다.
 * 비용·외부 전송은 주인님 결정 사항이다(설계 7절). 넣을 때 필요한 것:
 *   - 주인님 결정: 쓸 모델, 월 비용 상한, 외부로 보내도 되는 범위(고객 프로필·자료 원문 포함 여부)
 *   - migration: content_briefs.copy_origin 에 'ai' 추가, 호출 기록(generation_runs 재사용 검토)
 *   - 서버 전용 키 보관(.env, 커밋 금지), 요청 시간 제한·재시도 규칙
 * 원칙: 근거가 연결된 주장만 보낸다. 응답은 쓴 주장 id 를 밝혀야 하고, 요청에 없는 수치는 거절한다.
 */
import { z } from "zod";

const CHANNELS = ["blog", "instagram", "ad_copy", "linkedin", "newsletter"] as const;

export const briefCopyRequestSchema = z.strictObject({
  channel: z.enum(CHANNELS),
  title: z.string().min(1).max(200),
  audience: z.string().max(500).nullable(),
  hook: z.string().max(300).nullable(),
  coreMessage: z.string().max(1000).nullable(),
  cta: z.string().max(200).nullable(),
  channelSpec: z.record(z.string(), z.unknown()),
  /** 근거가 1개 이상 연결된 주장만. 근거는 이름만 보내고 원문은 보내지 않는다(외부 전송 최소화) */
  claims: z.array(z.strictObject({ id: z.uuid(), text: z.string().min(1).max(500), sourceLabels: z.array(z.string().min(1).max(300)).min(1) })).max(30),
  constraints: z.strictObject({
    language: z.literal("ko"),
    maxChars: z.number().int().min(50).max(5000),
    variants: z.number().int().min(1).max(3),
  }),
});
export type BriefCopyRequest = z.infer<typeof briefCopyRequestSchema>;

export const briefCopyResponseSchema = z.strictObject({
  variants: z.array(z.strictObject({ text: z.string().min(1).max(5000), usedClaimIds: z.array(z.uuid()) })).min(1).max(3),
  model: z.string().min(1).max(100),
  generatedAt: z.iso.datetime(),
});
export type BriefCopyResponse = z.infer<typeof briefCopyResponseSchema>;

/** 생성기 자리(구현 없음). 나중에 서버 전용 모듈이 이 형식을 구현한다 */
export type BriefCopyGenerator = (req: BriefCopyRequest) => Promise<BriefCopyResponse>;

const PERCENT = /\d+(?:[.,]\d+)?\s*%/g;
const norm = (s: string) => s.replace(/\s+/g, "").replace(",", ".");

/**
 * 응답 검사(순수). 통과해야 화면에 보여 준다.
 * 1) 형식 2) 변형 개수 ≤ 요청 3) 글자 수 ≤ maxChars 4) 쓴 주장 id ⊆ 요청 주장 5) 요청 어디에도 없는 백분율 수치가 본문에 있으면 거절
 */
export function checkBriefCopy(req: BriefCopyRequest, raw: unknown): { ok: true; data: BriefCopyResponse } | { ok: false; problems: string[] } {
  const parsed = briefCopyResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: ["응답 형식이 계약과 다릅니다."] };
  const res = parsed.data;
  const problems: string[] = [];
  if (res.variants.length > req.constraints.variants) problems.push("요청보다 많은 변형이 왔습니다.");
  const allowedIds = new Set(req.claims.map((c) => c.id));
  const known = new Set(
    [req.title, req.audience, req.hook, req.coreMessage, req.cta, JSON.stringify(req.channelSpec), ...req.claims.map((c) => c.text)]
      .filter((x): x is string => !!x)
      .flatMap((x) => (x.match(PERCENT) ?? []).map(norm)),
  );
  res.variants.forEach((v, i) => {
    const n = i + 1;
    if (v.text.length > req.constraints.maxChars) problems.push(`${n}번 변형이 글자 수 제한을 넘었습니다.`);
    if (v.usedClaimIds.some((id) => !allowedIds.has(id))) problems.push(`${n}번 변형이 근거 없는 주장을 썼습니다.`);
    const unknown = (v.text.match(PERCENT) ?? []).map(norm).filter((x) => !known.has(x));
    if (unknown.length) problems.push(`${n}번 변형에 근거 없는 수치가 있습니다: ${[...new Set(unknown)].join(", ")}`);
  });
  return problems.length ? { ok: false, problems } : { ok: true, data: res };
}
