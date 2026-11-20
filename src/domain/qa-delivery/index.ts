/**
 * P3FG-BACKEND-IMPL-01: 검수 체크리스트(P3-f)·납품 묶음(P3-g) 순수 모듈. 한도·기본 검수 항목(AGY)·묶음 번호 꼴·입력 검사·DB 오류 → 안내.
 * 값의 최종 판정은 DB(20261121011000_p3fg_qa_delivery)가 한다. 기본 항목 글은 DB app.qa_default_items 와 같아야 한다(시험이 대조).
 */
import { z } from "zod";
import { charLength } from "@/domain/channel-draft/constants";
import { PPT_CONTROL_RE } from "@/domain/ppt-decks";
import { briefTrim } from "@/domain/production-brief/constants";

export const QA_LIMITS = { roundsPerTarget: 30, itemsMin: 1, itemsMax: 30, itemTitle: 120, memo: 500 } as const;
export const DB_LIMITS = { bundlesMax: 50, itemsPerBundle: 100, logsPerBundle: 50, note: 300 } as const;

export const QA_TARGET_KIND_KEYS = ["web_copy", "design_assets", "video_plan", "ppt_deck"] as const;
export type QaTargetKind = (typeof QA_TARGET_KIND_KEYS)[number];
export const QA_STATUS_KEYS = ["drafting", "fix_requested", "reviewed"] as const;
export type QaStatus = (typeof QA_STATUS_KEYS)[number];
export const QA_VERDICT_KEYS = ["pending", "passed", "needs_fix"] as const;
export type QaVerdict = (typeof QA_VERDICT_KEYS)[number];
export const DB_STATUS_KEYS = ["drafting", "reviewed"] as const;
export type DbStatus = (typeof DB_STATUS_KEYS)[number];
export const DB_METHOD_KEYS = ["email", "cloud_link", "messenger", "in_person"] as const;
export type DbMethod = (typeof DB_METHOD_KEYS)[number];

/** 종류별 기본 필수 검수 항목(AGY P3F-HANDOFF.md 4절 DEFAULT_QA_ITEMS). 회차를 열 때 DB 가 같은 글로 행을 만든다 */
export const DEFAULT_QA_ITEMS: Readonly<Record<QaTargetKind, readonly string[]>> = Object.freeze({
  web_copy: [
    "페이지 제목과 핵심 안내 문구가 공통 제작 브리프와 맞는지 확인",
    "모든 연결 근거 출처가 유효하고 과장·약속 표현이 없는지 확인",
    "이동 경로(/slug)와 행동 유도 문구가 누락 없이 이어지는지 확인",
    "맞춤법과 어색한 번역투 문장이 없는지 확인",
  ],
  design_assets: [
    "자산 파일이 열리고 깨짐이나 누락이 없는지 확인",
    "공통 제작 브리프의 톤과 디자인 토큰 색상 기준에 맞는지 확인",
    "SVG·이미지 파일에 불필요한 외부 연결이나 위험 요소가 없는지 확인",
    "사용처 연결과 파일 설명이 실제 산출물과 맞는지 확인",
  ],
  video_plan: [
    "장면 순서·대사·자막이 공통 제작 브리프 내용과 맞는지 확인",
    "화면 비율과 각 장면 길이(1~600초)가 제작 기준에 맞는지 확인",
    "첨부된 최종 영상 파일이 재생되고 자막 오탈자가 없는지 확인",
    "연결된 디자인 자산이 최신 판이고 보관된 자산이 아닌지 확인",
  ],
  ppt_deck: [
    "표지·목차·본문 슬라이드 구성이 공통 제작 브리프와 맞는지 확인",
    "요점과 발표자 메모에 자리 표시([직접 입력: …])가 남아 있지 않은지 확인",
    "내보낸 .pptx·.md 파일이 정상으로 열리고 글자가 깨지지 않는지 확인",
    "연결된 디자인 자산이 최신 판이고 보관된 자산이 아닌지 확인",
  ],
});

/** 묶음 번호 꼴(Master ④): 1 → v1.0, 2 → v1.1 … */
export const bundleLabel = (bundleNo: number) => `v1.${bundleNo - 1}`;

const clean = (s: string) => briefTrim(s.replace(/\r\n?/g, "\n"));
const text = (max: number, obj: string, topic: string) =>
  z
    .string()
    .transform(clean)
    .pipe(
      z
        .string()
        .min(1, `${obj} 입력해 주세요.`)
        .refine((s) => charLength(s) <= max, `${topic} ${max.toLocaleString("en-US")}자까지입니다.`)
        .refine((s) => !PPT_CONTROL_RE.test(s), `${topic} 쓸 수 없는 제어 문자가 들어 있습니다.`),
    );
const optionalText = (max: number, topic: string) =>
  z
    .string()
    .nullable()
    .transform((s) => (s === null ? null : clean(s) || null))
    .pipe(
      z
        .string()
        .refine((s) => charLength(s) <= max, `${topic} ${max.toLocaleString("en-US")}자까지입니다.`)
        .refine((s) => !PPT_CONTROL_RE.test(s), `${topic} 쓸 수 없는 제어 문자가 들어 있습니다.`)
        .nullable(),
    );

export const qaItemSetSchema = z
  .strictObject({ itemId: z.uuid("검수 항목 id 가 올바르지 않습니다."), verdict: z.enum(QA_VERDICT_KEYS, "알 수 없는 판정입니다."), memo: optionalText(QA_LIMITS.memo, "검수 메모는") })
  .refine((v) => v.verdict !== "needs_fix" || v.memo !== null, { message: "보완 필요로 판정하려면 검수 메모를 적어 주세요.", path: ["memo"] });
export const qaItemAddSchema = z.strictObject({ title: text(QA_LIMITS.itemTitle, "항목 제목을", "항목 제목은"), isRequired: z.boolean() });
export const deliveryLogSchema = z.strictObject({
  method: z.enum(DB_METHOD_KEYS, "알 수 없는 전달 방식입니다."),
  /** ISO 시각(화면이 한국 시각 입력을 바꿔 보낸다) */
  deliveredAt: z.iso.datetime({ offset: true, message: "전달 일시가 올바르지 않습니다." }),
  note: optionalText(DB_LIMITS.note, "전달 메모는"),
});

export type QaDbErrorCode = "VALIDATION" | "CONFLICT" | "NOT_FOUND" | "INVALID_TRANSITION" | "ERROR";
const hangulDetail = (d: string) => (/[가-힣]/.test(d) && d.length <= 200 ? (/[.?!]$/.test(d) ? d : `${d}.`) : null);
/** DB 오류 머리 → 앱 오류(DB 의 한글 문구는 QA_COPY·DB_COPY 와 같은 문장) */
export function qaErrorFromDb(message: string | null | undefined): { code: QaDbErrorCode; message: string } {
  const m = /^\s*([A-Z_]+):\s*(.*)$/s.exec(message ?? "");
  const head = m?.[1] ?? "";
  const detail = m?.[2]?.trim() ?? "";
  switch (head) {
    case "LIMIT_REACHED":
    case "VALIDATION":
      return { code: "VALIDATION", message: hangulDetail(detail) ?? "입력값이 규칙에 맞지 않습니다." };
    case "INVALID_TRANSITION":
    case "FROZEN_COLUMN":
      return { code: "INVALID_TRANSITION", message: hangulDetail(detail) ?? "지금 상태에서는 할 수 없습니다." };
    case "CONFLICT":
      return { code: "CONFLICT", message: "다른 곳에서 먼저 수정되었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요." };
    case "NOT_FOUND":
      return { code: "NOT_FOUND", message: hangulDetail(detail) ?? "찾을 수 없습니다." };
    default:
      return { code: "ERROR", message: "처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
