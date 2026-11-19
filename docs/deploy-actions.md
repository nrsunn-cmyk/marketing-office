# GitHub Actions로 Vercel 배포하기 (DEPLOY-ACTIONS-01)

- 결정: 주인님 2026-11-19, DEC-PREP-05 (다). 근거 문서: `C:\nadaum\Plan\Claude-Plan-Audit-20261119\DEC-PREP-05.md`
- 왜: Vercel 무료(Hobby) 요금제는 맨 위 커밋의 작성자가 계정 주인일 때만 Git 자동 배포를 한다. AI 커밋은 그래서 막히고, 지금까지는 주인님이 빈 트리거 커밋을 따로 올렸다.
- 어떻게: 워크플로 `.github/workflows/vercel-deploy.yml`이 **주인님 토큰**으로 Vercel CLI 배포를 한다. 배포 주체가 토큰 주인이 되므로 커밋 작성자와 상관없다(예상, 아래 2절에서 한 번 시험한다).
- 지금 단계: **수동 실행만** 된다. Git 자동 배포는 그대로 켜 두었다. 그래서 트리거 커밋 방식도 계속 쓸 수 있다.

## 1. 주인님이 한 번 하실 일 (AI는 토큰을 보거나 입력하지 않는다)

1. Vercel 로그인 → Account Settings → Tokens → 새 토큰 만들기
   - 이름 예: `github-actions-marketing-office`
   - 범위: 가능하면 이 프로젝트가 있는 팀(개인 Hobby 팀)으로 한정한다
   - 만료일: 정한다(예: 90일). 만료되면 같은 방법으로 새로 만들어 3번의 값만 바꾼다
2. 만든 토큰 값은 화면에 한 번만 보인다. 바로 다음 단계에 붙여 넣고, 다른 곳에 저장하지 않는다.
3. GitHub 운영 저장소 → Settings → Secrets and variables → Actions → New repository secret, 3개:
   - `VERCEL_TOKEN`: 1번에서 만든 토큰
   - `VERCEL_ORG_ID`: 원본 폴더 `.vercel/project.json`의 `orgId` 값(비밀은 아니지만 한곳에 모아 둔다)
   - `VERCEL_PROJECT_ID`: 같은 파일의 `projectId` 값

## 2. 처음 한 번: 미리보기로 시험

1. 이 워크플로 파일이 들어간 커밋이 운영 저장소 main에 올라가 있어야 한다(Master 확인 → 주인님 승인 → push).
2. GitHub 저장소 → Actions → `vercel-deploy` → Run workflow → 브랜치 `main`, 대상 `preview` → 실행
3. 확인할 것:
   - 실행이 초록색으로 끝나는지, 요약(Summary)에 배포 주소가 나오는지
   - Vercel 대시보드에 그 커밋의 Preview 배포가 Ready로 뜨는지
   - **"Deployment was blocked" 같은 작성자 차단 문구가 없는지** (이것이 이번 시험의 핵심)
4. 결과를 Master에게 알린다(Front가 확인을 돕는다).

- 막히면: 워크플로를 고쳐 git 정보를 빼고 올리는 방식(2026-11-15에 성공한 CLI 배포와 같은 방식)으로 바꾼다. Front가 따로 준비한다.

## 3. 시험이 통과한 뒤: 운영 배포 방법

- 지금까지: 승인 → 주인님 main push → 빈 트리거 커밋 push
- 앞으로: 승인 → 주인님 main push → Actions에서 Run workflow(대상 `production`) 1번
- 그다음 단계(선택, 별도 승인): `vercel.json`에 `"git": { "deploymentEnabled": false }`를 넣어 Git 자동 배포를 끈다. 배포 경로가 하나로 모여 두 번 배포되는 일이 없어진다. 끄기 전까지는 트리거 커밋을 올리면 Git 쪽으로도 배포된다는 점만 기억한다.

## 4. 안전 장치

- 수동 실행(`workflow_dispatch`)만 받는다. PR이나 다른 브랜치 push로는 돌지 않는다. main이 아닌 브랜치를 골라 실행하면 작업을 건너뛴다.
- 저장소 권한은 읽기(`contents: read`)만 쓴다. checkout도 자격 증명을 남기지 않는다.
- 토큰은 환경 변수로만 넘긴다. `--token` 인자는 쓰지 않는다(로그에 남을 수 있음).
- 배포 전에 `npm run verify`(형식검사·린트·시험)를 다시 돈다. 실패하면 배포하지 않는다.
- 같은 시각에 배포는 하나만 돈다.
- Vercel CLI 버전은 고정한다(`vercel@65.11.0`). 올릴 때는 이 파일과 시험(`tests/unit/deploy-workflow.test.ts`)을 함께 고친다.
- 이 워크플로 파일을 바꾸는 커밋은 배포 경로를 바꾸는 일이므로 Master 확인 대상이다.

## 5. 되돌리기

- 바로 멈추기: GitHub 저장소 → Actions → `vercel-deploy` → Disable workflow
- 토큰 폐기: Vercel → Account Settings → Tokens → 해당 토큰 삭제. 새는 것이 의심되면 가장 먼저 한다.
- 완전히 되돌리기: 워크플로 파일 삭제 커밋, Secrets 3개 삭제. `deploymentEnabled`를 넣었다면 그 줄도 지운다. 그러면 예전처럼 트리거 커밋 방식만 남는다.
- 잘못된 버전이 운영에 올라갔을 때: Vercel 대시보드에서 직전 배포로 되돌린다(Instant Rollback). 이 워크플로와 상관없이 늘 쓸 수 있다.

## 6. 비용

- GitHub Free의 비공개 저장소 Actions는 매달 약 $12 상당(리눅스 약 2,000분)이 무료다. 결제 수단이 없으면 넘쳐도 요금이 나가지 않고 실행이 멈춘다.
- 배포 1회는 설치·시험·빌드를 합쳐 대략 5~10분으로 예상한다.
