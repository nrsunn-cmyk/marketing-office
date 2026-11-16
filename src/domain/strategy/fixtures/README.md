# 전략 초안 fixture와 UI 연결 명세 (P2-STRATEGY-CONTRACT-02)

`buildStrategyDraft`(`src/domain/strategy/build.ts`)의 합성 입력·기대 출력 예시다.
`fixtures.test.ts`가 실제 함수 결과와 바이트 단위로 같은지 확인한다. 운영 기능에는 연결하지 않았다.

- **모든 값은 합성이다.** UUID는 `00000000-0000-4000-8000-…`, URL은 `example.com`. 실고객 데이터 없음.
- **`profile`(승인 프로필 참조)은 입력일 뿐이다.** 이 함수는 그 프로필이 실제로 승인됐는지, 이 업무실 것인지, 자료가 존재하는지를 확인하지 않는다. 저장·조회 단계의 RLS·RPC가 따로 확인해야 한다.

## 사례

| 파일 | 입력 | 기대 결과 |
|---|---|---|
| `normal-7-sections` | 고객 프로젝트, 7영역(opportunities는 추정만), 미확인 2개 | `ok`, 질문 0, opportunities `inference_only`, 미확인 2개 그대로 |
| `required-missing` | 자체 브랜드, offers 빈 영역·audiences 생략, `unknowns: []` | `ok`, offers·audiences에 `missing_section` 질문·미확인 |
| `inference-only` | 개인, goals·positioning 추정만 | `ok`, 두 영역 `inference_only` + 근거 확인 질문 |
| `other-project-rejected` | 다른 프로젝트 프로필 참조 + 다른 프로젝트 자료 출처 | `ok:false`, `profile.projectId`·`…sources.0.projectId` |
| `nested-typo-rejected` | 영역 이름 `positionning`, 추정 `rational`, 미확인 `questions` | `ok:false`, 각 위치에서 모르는 키 거절 |

## 화면 연결 시 필요한 변환 (AGY `Design/P2-strategy` v1.1 읽기 비교)

1. **영역 입력 구조:** 시안은 영역마다 글 상자 1개(자유 글)다. 계약은 영역마다 `facts[]`(문장 + 출처 1개 이상)와 `inferences[]`(문장 + 선택 근거)로 나뉜다. 화면에서 "사실 추가(출처 선택 필수)"·"추정 추가" 항목 단위 입력이 필요하다. 자유 글 하나를 사실로 보내면 출처가 없어 거절된다.
2. **출처 선택:** 시안의 출처는 오른쪽 근거 패널에 전체 공통으로 표시된다. 계약은 사실 하나마다 출처가 붙는다(`profile`·`asset`·`url`). 사실 항목 옆에 출처 선택이 필요하다.
3. **ID 형식:** 시안 예시 `prof_01`·`prj_01`·`asset_intro_pdf`는 UUID가 아니어서 거절된다. 실제 연결 시 DB UUID를 쓴다.
4. **프로젝트 종류:** 시안 `projectKind: "agency"`는 계약 값(`client`·`internal_brand`·`personal`)에 없다. `client`면 `clientId`가 반드시 있어야 한다.
5. **상태 배지 의미:**
   - `filled` = 사실 1개 이상(추정 유무와 무관). 시안 README의 "사실과 추정이 정상적으로 구비"와 다르다.
   - `missing`은 선택 3영역에도 붙지만, 질문은 필수 4영역에만 생긴다. 선택 영역의 `missing`을 빨간 오류로 보이지 않게 해야 한다.
6. **질문 목록:** 출력에는 `questions[]`(영역별 확인 질문)와 `unknowns[]`(입력 미확인 + `origin:"missing_section"`)가 따로 있다. 화면의 "확인 질문" 영역은 `questions`를 쓰고, `unknowns`의 `origin`으로 사용자 입력과 자동 생성을 구분해 보여 줘야 한다. 같은 빈 영역이 두 목록에 모두 나오므로 중복 표시에 주의한다.
7. **선택 필드:** `rationale`·`unknowns[].question`은 없을 수 있다(출력에서 `null`). 시안은 항상 있다고 가정한다.
8. **오류 표시:** `issues[].path`(예: `sections.goals.facts.0.sources`)의 둘째 칸이 영역 이름이므로 `error-<영역>` 자리에 매핑한다. 모르는 키 거절 문구는 Zod 기본 영어 문구(`Unrecognized key: …`)라서 화면용 한국어 문구로 바꿔야 한다. 영역 이름 오타는 경로가 `sections`라서 영역 자리에 매핑되지 않는다.
9. **이 함수 범위 밖:** 이전 프로필 경고(최신 승인 버전 비교), 409 충돌, 승인·수정 요청, 저장 상태는 이 순수 함수에 없다. 저장·RPC 단계에서 따로 만든다.
