/**
 * 화면·서버 공통 입력 스키마 (Zod).
 * 형식 검증만 한다. "이 자료가 이 고객 것인가" 같은 업무 관계 검증은 서버·DB에서 따로 한다.
 */
import { z } from "zod";
import { QUOTE_LIMITS } from "@/domain/quote/limits";

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number, message: string) => z.string().trim().min(1, message).max(max);
const optionalText = (max: number) =>
  text(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const tagList = (maxItems: number, maxLen: number) =>
  z
    .array(text(maxLen))
    .max(maxItems)
    .default([])
    .transform((list) => [...new Set(list.filter((v) => v !== ""))]);

const isoDate = z.iso.date();

/** 업무실 처음 설정: 업무실 이름 + 우리 회사(공급자) 정보 */
export const workspaceSetupSchema = z.object({
  name: requiredText(200, "업무실 이름을 입력해 주세요."),
  legalName: requiredText(200, "상호를 입력해 주세요."),
  representative: optionalText(100),
  businessNumber: optionalText(20),
  phone: optionalText(50),
  email: z
    .union([z.literal(""), z.email("이메일 형식이 올바르지 않습니다.")])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  address: optionalText(500),
});
export type WorkspaceSetupInput = z.infer<typeof workspaceSetupSchema>;

export const loginEmailSchema = z.email("이메일 형식이 올바르지 않습니다.").max(320);

/**
 * 비밀번호 규칙(D03 변경, 2026-11-15): 8자 이상, 영문과 숫자를 모두 포함, 72바이트 이하.
 * Supabase 설정(minimum_password_length = 8, password_requirements = "letters_digits")과 같다.
 * 72바이트는 비밀번호 저장 방식(bcrypt)이 읽는 최대 길이다.
 */
export const PASSWORD_HELP = "8자 이상, 영문과 숫자를 모두 넣어 주세요.";
export const newPasswordSchema = z
  .string()
  .min(8, "비밀번호는 8자 이상이어야 합니다.")
  .refine((v) => new TextEncoder().encode(v).length <= 72, "비밀번호가 너무 깁니다(영문 기준 72자 이하).")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "비밀번호에 영문과 숫자를 모두 넣어 주세요.");

/** 새 비밀번호와 확인 칸이 같은지까지 검사 (가입·비밀번호 재설정) */
export const passwordPairSchema = z
  .object({ password: newPasswordSchema, passwordConfirm: z.string() })
  .refine((v) => v.password === v.passwordConfirm, { path: ["passwordConfirm"], message: "비밀번호 확인이 일치하지 않습니다." });

export const signupInputSchema = z
  .object({ email: loginEmailSchema, password: newPasswordSchema, passwordConfirm: z.string() })
  .refine((v) => v.password === v.passwordConfirm, { path: ["passwordConfirm"], message: "비밀번호 확인이 일치하지 않습니다." });

export const loginInputSchema = z.object({
  email: loginEmailSchema,
  password: z.string().min(1, "비밀번호를 입력해 주세요.").max(1000),
});

export const clientInputSchema = z.object({
  name: requiredText(200, "고객명을 입력해 주세요."),
  industry: optionalText(100),
  description: optionalText(2000),
});
export type ClientInput = z.infer<typeof clientInputSchema>;

/** 회사 프로필 버전. 저장할 때마다 새 버전으로 추가하고 과거 버전은 바꾸지 않는다. */
export const companyProfileInputSchema = z.object({
  products: optionalText(4000),
  audience: optionalText(2000),
  strengths: tagList(20, 200),
  brandRules: optionalText(4000),
  channelUrls: z.array(z.url({ protocol: /^https?$/ })).max(20).default([]),
});
export type CompanyProfileInput = z.infer<typeof companyProfileInputSchema>;

export const PROJECT_KINDS = ["client", "internal_brand", "personal"] as const;

const projectBase = {
  title: requiredText(200, "프로젝트 제목을 입력해 주세요."),
  budgetWon: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().default(null),
  dueAt: isoDate.nullable().default(null),
};

/** client 유형은 고객 지정이 필수, 자체 프로젝트는 고객을 지정할 수 없다 (R07). */
export const projectInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("client"), clientId: z.uuid("고객을 선택해 주세요."), ...projectBase }),
  z.object({ kind: z.literal("internal_brand"), clientId: z.null().default(null), ...projectBase }),
  z.object({ kind: z.literal("personal"), clientId: z.null().default(null), ...projectBase }),
]);
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const TASK_TYPES = ["logo_brief", "quote"] as const;

export const taskCreateSchema = z.object({
  projectId: z.uuid(),
  type: z.enum(TASK_TYPES),
  /** 중복 클릭·재전송 방지 키 (T15) */
  idempotencyKey: z.string().min(8).max(100),
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const logoBriefInputSchema = z.object({
  companyName: requiredText(200, "회사명을 입력해 주세요."),
  industry: optionalText(100),
  description: optionalText(2000),
  mainCustomers: optionalText(500),
  strengths: tagList(20, 200),
  preferredStyles: tagList(20, 100),
  colors: tagList(20, 100),
  references: tagList(20, 500),
  forbidden: tagList(20, 200),
  extraNotes: optionalText(2000),
});
export type LogoBriefFormInput = z.infer<typeof logoBriefInputSchema>;

export const quoteItemSchema = z.object({
  id: z.string().min(1),
  name: text(200),
  quantityHundredths: z.number().nullable(),
  unitPriceWon: z.number().nullable(),
  freeItemConfirmed: z.boolean().default(false),
  zeroAmountConfirmed: z.boolean().default(false),
});

/**
 * 견적 입력 형식. 수량·단가의 업무 규칙(빈 단가, 0원 확인, 상한 등)은
 * `calculateQuote`가 판정해 행별 오류로 돌려주므로 여기서는 막지 않는다.
 */
export const quoteInputSchema = z.object({
  taxMode: z.enum(["EXCLUSIVE", "INCLUSIVE", "NO_TAX"]),
  taxRateBasisPoints: z.number(),
  items: z.array(quoteItemSchema).max(QUOTE_LIMITS.maxItems + 1),
  issueDate: z.string().nullable().default(null),
  validUntil: z.string().nullable().default(null),
  paymentTerms: optionalText(2000),
  notes: optionalText(4000),
});
export type QuoteFormInput = z.infer<typeof quoteInputSchema>;
