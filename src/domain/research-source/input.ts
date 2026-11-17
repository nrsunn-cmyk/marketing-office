/**
 * 외부 출처(research_sources) 입력 규칙과 DB 오류 문구. 순수 함수만 둔다.
 * 길이·형식 규칙은 DB 제약(20261117001000_p2_strategy 4절)과 같게 맞춘다. DB가 최종 확인한다.
 *   url: http(s), 2000자 이하 / title: 앞뒤 공백 뺀 1–300자 / publisher: 200자 이하 / 인용: 1000자 이하
 * 화면에서 고르는 확인 시각(retrievedAt)은 미래일 수 없다(시계 차이 5분 허용).
 * retrievedAt 형식: "YYYY-MM-DD"(한국 시각 0시로 읽음) 또는 시간대가 붙은 ISO 시각.
 */
import { z } from "zod";

export const RESEARCH_SOURCE_LIMITS = { url: 2000, title: 300, publisher: 200, excerpt: 1000 } as const;
export const REVIEW_STATUSES = ["unverified", "verified"] as const;
export type ResearchReviewStatus = (typeof REVIEW_STATUSES)[number];

const CLOCK_SKEW_MS = 5 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** 빈 칸은 null 로 */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}은(는) ${max}자까지 입력할 수 있습니다.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

function isHttpUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function researchSourceInputSchema(now: () => Date = () => new Date()) {
  return z.object({
    url: z
      .string()
      .trim()
      .min(1, "주소(URL)를 입력해 주세요.")
      .max(RESEARCH_SOURCE_LIMITS.url, `주소는 ${RESEARCH_SOURCE_LIMITS.url}자까지 입력할 수 있습니다.`)
      .refine(isHttpUrl, "http:// 또는 https:// 로 시작하는 주소만 넣을 수 있습니다."),
    title: z
      .string()
      .trim()
      .min(1, "제목을 입력해 주세요.")
      .max(RESEARCH_SOURCE_LIMITS.title, `제목은 ${RESEARCH_SOURCE_LIMITS.title}자까지 입력할 수 있습니다.`),
    publisher: optionalText(RESEARCH_SOURCE_LIMITS.publisher, "발행처"),
    quotedExcerpt: optionalText(RESEARCH_SOURCE_LIMITS.excerpt, "인용문"),
    retrievedAt: z
      .string()
      .trim()
      .min(1, "확인한 날짜를 입력해 주세요.")
      .transform((v, ctx) => {
        // 날짜만 오면 한국 시각 0시로 읽는다. 시각이 있으면 시간대(Z 또는 +09:00 등)가 있어야 한다.
        // 시간대 없는 시각은 서버 시간대(운영은 UTC)로 읽혀 9시간 어긋나므로 받지 않는다.
        const iso = DATE_ONLY.test(v) ? `${v}T00:00:00+09:00` : WITH_OFFSET.test(v) ? v : null;
        const d = new Date(iso ?? "invalid");
        if (Number.isNaN(d.getTime())) {
          ctx.addIssue({ code: "custom", message: "확인한 날짜 형식이 올바르지 않습니다." });
          return z.NEVER;
        }
        if (d.getTime() > now().getTime() + CLOCK_SKEW_MS) {
          ctx.addIssue({ code: "custom", message: "확인한 날짜는 미래일 수 없습니다." });
          return z.NEVER;
        }
        return d.toISOString();
      }),
  });
}

export type ResearchSourceInput = z.output<ReturnType<typeof researchSourceInputSchema>>;

export const reviewStatusSchema = z.enum(REVIEW_STATUSES, "알 수 없는 검토 상태입니다.");

/** DB(RPC) 오류 → 화면 결과 코드와 문구. 원문은 서버 기록에만 남긴다 */
export function researchSourceErrorFromDb(error: { code?: string; message?: string }): {
  code: "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "ERROR";
  message: string;
} {
  const msg = error.message ?? "";
  if (error.code === "P0002" || msg.startsWith("NOT_FOUND")) return { code: "NOT_FOUND", message: "프로젝트나 출처를 찾을 수 없습니다." };
  if (msg.startsWith("CONFLICT")) return { code: "CONFLICT", message: "다른 곳에서 먼저 수정되었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요." };
  if (error.code === "22023" || error.code === "23514" || msg.startsWith("VALIDATION")) {
    return { code: "VALIDATION", message: "입력값이 규칙에 맞지 않습니다." };
  }
  return { code: "ERROR", message: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
}
