/**
 * 검수용 예시 데이터의 로고 결과 내용 만들기 (SEED-01).
 * 앱의 '입력 조합형' 생성(src/features/tasks/server.ts generateLogoBrief)과 같은 함수·같은 모양으로 만든다.
 * 예전 시드는 { brief, prompts }만 넣어서 작업 화면이 missingInformation 이 없다며 멈췄다.
 * DB에 접속하지 않는 순수 함수라 시험에서 바로 불러 쓴다.
 */
import type { LogoBriefFormInput } from "../src/contracts/index.ts";
import { buildLogoBrief } from "../src/domain/logo/brief.ts";
import type { LogoContent } from "../src/features/tasks/server.ts";

export function seedLogoContent(input: LogoBriefFormInput): LogoContent {
  const built = buildLogoBrief(input);
  if (!built.ok) throw new Error(`예시 로고 입력이 잘못됐습니다: ${built.message}`);
  return {
    brief: built.result.brief,
    imagePrompt: built.result.imagePrompt,
    constraints: built.result.constraints,
    missingInformation: built.result.missingInformation,
    input,
    generator: built.result.generator,
  };
}

/**
 * 시드가 만드는 로고 결과 3개의 입력. 검수 화면에서 '확인이 필요한 정보'가 있는 경우와 없는 경우를 함께 보이게
 * 일부러 빈 항목을 다르게 둔다(A: 참고 자료·피할 요소 없음, B: 모두 채움, 자체 브랜드: 여러 항목 비움).
 */
export const SEED_LOGO_INPUTS = {
  a: {
    companyName: "가상고객A 카페 온도",
    industry: "카페",
    description: "핸드드립 커피, 계절 디저트",
    mainCustomers: "20~30대 직장인, 주말 가족 손님",
    strengths: ["직접 로스팅", "조용한 좌석"],
    preferredStyles: ["따뜻함", "간결함"],
    colors: ["갈색", "크림색"],
    references: [],
    forbidden: [],
    extraNotes: "기존 로고의 커피잔 모양은 살린다",
  },
  b: {
    companyName: "가상고객B 세무회계 바른숫자",
    industry: "세무회계",
    description: "기장 대행, 종합소득세 신고",
    mainCustomers: "1인 사업자, 프리랜서",
    strengths: ["빠른 답변", "투명한 수수료"],
    preferredStyles: ["신뢰감", "차분함"],
    colors: ["남색", "회색"],
    references: ["숫자를 강조한 워드마크"],
    forbidden: ["과한 장식"],
    extraNotes: null,
  },
  internal: {
    companyName: "마케팅 업무실",
    industry: "마케팅 대행",
    description: null,
    mainCustomers: null,
    strengths: [],
    preferredStyles: ["간결함"],
    colors: [],
    references: [],
    forbidden: [],
    extraNotes: null,
  },
} satisfies Record<string, LogoBriefFormInput>;
