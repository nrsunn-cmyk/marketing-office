/**
 * P3B 기본 4페이지 템플릿(AGY 확정 C:/nadaum/Design/p3-production/P3B-DEFAULT-TEMPLATE.md, DESIGN-P3B-COPY-01).
 * DB 함수 app.web_copy_default_content 와 똑같아야 한다(tests/db/p3b-web-copy.test.ts 가 맞대어 본다). AI 호출 없음.
 * 홈 첫 섹션(home_hero) 헤드라인은 만들 때 제작 브리프 제목으로 바꾼다(제목이 비면 아래 자리 문구).
 * 칸 이름은 판 내용(content jsonb)과 같은 snake_case. id 는 만들 때 서버가 채운다.
 */
export const DEFAULT_WEB_COPY_PAGES = [
  {
    page_key: "home",
    id: null,
    title: "홈",
    slug: "/",
    sort_order: 1,
    sections: [
      {
        section_key: "home_hero",
        id: null,
        section_name: "첫 화면",
        purpose: "방문자에게 핵심 가치와 다음 행동을 안내하는 자리입니다.",
        headline: "[직접 입력: 고객에게 전달할 핵심 한 줄 제목]",
        body: "[직접 입력: 제작 브리프의 핵심 대상과 해결 내용을 2~3문장으로 적어 주세요.]",
        cta_label: "문의하기",
        cta_target: "/contact",
        citation_ids: [],
        sort_order: 1,
        excluded: false,
      },
      {
        section_key: "home_proof",
        id: null,
        section_name: "신뢰 근거",
        purpose: "사실에 근거한 작업 방식이나 확인 가능한 사례를 적는 자리입니다.",
        headline: "[직접 입력: 고객이 안심할 수 있는 진행 기준]",
        body: "[직접 입력: 실제 진행 절차나 확인된 출처가 있는 내용만 적어 주세요. 출처를 연결하면 검수 시 확인하기 쉽습니다.]",
        cta_label: "서비스 자세히 보기",
        cta_target: "/services",
        citation_ids: [],
        sort_order: 2,
        excluded: false,
      },
    ],
  },
  {
    page_key: "about",
    id: null,
    title: "회사 소개",
    slug: "/about",
    sort_order: 2,
    sections: [
      {
        section_key: "about_intro",
        id: null,
        section_name: "회사 소개",
        purpose: "브랜드가 일하는 기준과 역할을 소개하는 자리입니다.",
        headline: "[직접 입력: 우리가 지키는 일의 기준]",
        body: "[직접 입력: 어떤 고객을 돕고 무엇을 중요하게 여기는지 쉬운 말로 적어 주세요.]",
        cta_label: null,
        cta_target: null,
        citation_ids: [],
        sort_order: 1,
        excluded: false,
      },
    ],
  },
  {
    page_key: "services",
    id: null,
    title: "서비스 안내",
    slug: "/services",
    sort_order: 3,
    sections: [
      {
        section_key: "services_list",
        id: null,
        section_name: "제공 서비스",
        purpose: "제공하는 서비스 범위와 진행 순서를 안내하는 자리입니다.",
        headline: "[직접 입력: 제공하는 서비스와 포함 범위]",
        body: "[직접 입력: 포함되는 작업과 제외되는 범위를 구분해 적고, 다음 단계 안내를 덧붙여 주세요.]",
        cta_label: "상담·문의하기",
        cta_target: "/contact",
        citation_ids: [],
        sort_order: 1,
        excluded: false,
      },
    ],
  },
  {
    page_key: "contact",
    id: null,
    title: "문의",
    slug: "/contact",
    sort_order: 4,
    sections: [
      {
        section_key: "contact_form",
        id: null,
        section_name: "문의 안내",
        purpose: "방문자가 상담이나 견적을 남길 수 있게 안내하는 자리입니다.",
        headline: "[직접 입력: 상담·문의 전 확인 안내]",
        body: "[직접 입력: 응답 가능 시간과 문의 시 함께 적어 주면 좋은 내용을 안내해 주세요.]",
        cta_label: "문의 남기기",
        cta_target: "/contact",
        citation_ids: [],
        sort_order: 1,
        excluded: false,
      },
    ],
  },
] as const;
