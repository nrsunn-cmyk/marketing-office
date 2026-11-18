/** 콘텐츠 브리프 상수(zod 없음). 화면이 상수만 가져올 때 zod 가 브라우저 묶음에 실리지 않게 따로 둔다(BUNDLE-D-FRONT-01 ③). 값은 DB 규칙과 같게 둔다 */
export const BRIEF_CHANNELS = { blog: "블로그", instagram: "인스타그램", ad_copy: "광고 카피", linkedin: "LinkedIn", newsletter: "뉴스레터" } as const;
export type BriefChannel = keyof typeof BRIEF_CHANNELS;
export const BRIEF_STATUSES = { drafting: "작성 중", ready: "사용 준비" } as const;
export type BriefStatus = keyof typeof BRIEF_STATUSES;
export const CLAIM_KINDS = { statistic: "수치·통계", capability: "제품 역량", reference: "레퍼런스", other: "기타" } as const;
export type ClaimKind = keyof typeof CLAIM_KINDS;
export const PROFILE_FIELDS = { products: "제품·서비스", audience: "고객층", strengths: "강점", brand_rules: "브랜드 규칙", channel_urls: "채널 주소" } as const;
export type ProfileField = keyof typeof PROFILE_FIELDS;
/** DB copy_origin. 'ai' 는 자동 문구 생성이 결정되기 전까지 없다(ai-contract.ts) */
export const COPY_ORIGINS = ["manual", "template"] as const;

export const BRIEF_LIMITS = {
  title: 200, audience: 500, hook: 300, coreMessage: 1000, cta: 200, copyDraft: 5000, imageGuide: 2000,
  claimText: 500, claimsPerBrief: 30, sourcesPerClaim: 10, sourceNote: 300,
} as const;
