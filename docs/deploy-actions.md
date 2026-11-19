# GitHub Actions로 Vercel 배포하기 (DEPLOY-ACTIONS-01)

- 결정: 주인님 2026-11-19, DEC-PREP-05 (다). 근거 문서: `C:\nadaum\Plan\Claude-Plan-Audit-20261119\DEC-PREP-05.md`
- 보안 검수: Tester QA-DEPLOY-ACTIONS-01·R1(결함 0). 권고 W1·W2·R1~R3은 R1에서, Vercel CLI를 앱 의존성에서 떼어 내는 W3은 R2에서 반영했다.
- 왜: Vercel 무료(Hobby) 요금제는 맨 위 커밋의 작성자가 계정 주인일 때만 Git 자동 배포를 한다. AI 커밋은 그래서 막히고, 지금까지는 주인님이 빈 트리거 커밋을 따로 올렸다.
- 어떻게: 워크플로 `.github/workflows/vercel-deploy.yml`이 **주인님 토큰**으로 Vercel CLI 배포를 한다. 배포 주체가 토큰 주인이 되므로 커밋 작성자와 상관없다(예상, 아래 2절에서 한 번 시험한다).
- 지금 단계: **수동 실행만** 된다. Git 자동 배포는 그대로 켜 두었다. 그래서 트리거 커밋 방식도 계속 쓸 수 있다.

## 1. 주인님이 한 번 하실 일 (AI는 토큰을 보거나 입력하지 않는다)

### 1-1. Vercel 토큰 만들기

1. Vercel 로그인 → Account Settings → Tokens → 새 토큰 만들기
   - 이름 예: `github-actions-marketing-office`
   - 범위: 가능하면 이 프로젝트가 있는 팀(개인 Hobby 팀)으로 한정한다
   - 만료일: 정한다(예: 90일). 만료되면 같은 방법으로 새로 만들어 1-3의 `VERCEL_TOKEN` 값만 바꾼다
2. 만든 토큰 값은 화면에 한 번만 보인다. 바로 1-3에 붙여 넣고, 다른 곳에 저장하지 않는다.

### 1-2. GitHub Environment `production` 준비 (main 브랜치만 Secret을 받게)

워크플로는 실행할 때 고른 브랜치의 파일로 돈다. 그래서 저장소 Secret에 토큰을 두면, 다른 브랜치에서 이 파일을 고쳐 돌리는 것만으로 운영 토큰을 쓸 수 있다. Environment를 만들어 main만 허용하면 이것을 막는다.

- **먼저 볼 것:** GitHub 운영 저장소 → Settings → Environments에 **`Production`이 이미 있는지** 본다. Vercel 연동이 배포 기록용으로 자동으로 만들어 두는 경우가 많다. GitHub의 Environment 이름은 대소문자를 가리지 않는다. 그래서 워크플로의 `environment: production`은 이미 있는 `Production`을 그대로 쓴다.
  - 있으면: 새로 만들지 말고 그 `Production`에 아래 2~4와 1-3을 설정한다.
  - 없으면: 1번부터 새로 만든다.
- 참고: `Preview`라는 Environment가 함께 보여도 이 워크플로는 쓰지 않는다. 미리보기 시험도 같은 `production` Environment를 거친다(토큰이 하나라서).

1. GitHub 운영 저장소 → Settings → Environments → New environment → 이름 `production` (이미 `Production`이 있으면 이 단계는 건너뛴다)
2. Deployment branches and tags → **Selected branches and tags** → 규칙 추가: `main`
3. (선택) Required reviewers에 주인님 계정을 넣으면, 실행할 때마다 주인님이 "승인" 단추를 한 번 더 눌러야 돈다. 미리보기 시험에도 걸린다.
4. 저장한다.

### 1-3. Environment Secrets 3개 넣기

- 위치: Settings → Environments → `production` → Environment secrets → Add secret
- 저장소 전체 Secret(Settings → Secrets and variables → Actions)이 아니라 **이 Environment 안**에 넣는다.

| 이름 | 값 |
|---|---|
| `VERCEL_TOKEN` | 1-1에서 만든 토큰 |
| `VERCEL_ORG_ID` | 원본 폴더 `.vercel/project.json`의 `orgId` 값(비밀은 아니지만 한곳에 모아 둔다) |
| `VERCEL_PROJECT_ID` | 같은 파일의 `projectId` 값 |

## 2. 처음 한 번: 미리보기로 시험

### 2-1. 시험 전에 Vercel Preview 환경 변수부터 본다

- 미리보기(preview)는 Vercel 프로젝트의 **Preview 환경 변수**로 빌드한다. 운영(Production) 환경 변수와 따로 있다.
- 위치: Vercel → 프로젝트 → Settings → Environment Variables. 변수마다 Production·Preview·Development 표시가 있다. 값은 열어 보지 않아도 된다. 어느 환경에 걸려 있는지만 본다.
- **비어 있으면:** Supabase 주소 같은 값이 없어 빌드가 실패한다. 이 시험은 "작성자 차단이 없는지"를 보려는 것이므로, 빌드 실패도 결과를 흐린다.
- **운영과 같은 값이면:** 미리보기 앱이 **운영 DB**에 붙는다. 미리보기 주소에서 로그인·저장을 하면 운영 데이터가 바뀐다. 시험에서는 화면을 열어 보기만 하고 아무것도 저장하지 않는다.
- 어느 쪽인지 Master에게 알려 주시면 시험 방법을 맞춘다.

### 2-2. 실행

1. 이 워크플로 파일이 들어간 커밋이 운영 저장소 main에 올라가 있어야 한다(Master 확인 → 주인님 승인 → push).
2. GitHub 저장소 → Actions → `vercel-deploy` → Run workflow → 브랜치 `main`, 대상 `preview` → 실행
3. 확인할 것:
   - 실행이 초록색으로 끝나는지, 요약(Summary)에 배포 주소가 나오는지
   - Vercel 대시보드에 그 커밋의 Preview 배포가 Ready로 뜨는지
   - **"Deployment was blocked" 같은 작성자 차단 문구가 없는지** (이것이 이번 시험의 핵심)
4. 결과를 Master에게 알린다(Front가 확인을 돕는다).

- 막히면: 워크플로를 고쳐 git 정보를 빼고 올리는 방식(2026-11-15에 성공한 CLI 배포와 같은 방식)으로 바꾼다. Front가 따로 준비한다.
- "Vercel CLI 동작 확인" 단계에서 멈추면: 설치 스크립트 없이 CLI가 뜨지 않는다는 뜻이다(토큰은 쓰지 않은 상태). 실패 로그를 Front에 넘기면, 필요한 패키지만 설치 스크립트를 허용하는 방식으로 고친다.

## 3. 시험이 통과한 뒤: 운영 배포 방법

- 지금까지: 승인 → 주인님 main push → 빈 트리거 커밋 push
- 앞으로: 승인 → 주인님 main push → Actions에서 Run workflow(대상 `production`) 1번
- 그다음 단계(선택, 별도 승인): `vercel.json`에 `"git": { "deploymentEnabled": false }`를 넣어 Git 자동 배포를 끈다. 배포 경로가 하나로 모여 두 번 배포되는 일이 없어진다. 끄기 전까지는 트리거 커밋을 올리면 Git 쪽으로도 배포된다는 점만 기억한다.

## 4. 안전 장치

- 수동 실행(`workflow_dispatch`)만 받는다. PR이나 다른 브랜치 push로는 돌지 않는다. main이 아닌 브랜치를 골라 실행하면 작업을 건너뛴다.
- 대상이 preview든 production이든 job은 늘 Environment `production`을 거친다. 그래서 main 밖의 워크플로는 토큰을 받지 못한다(1-2).
- 저장소 권한은 읽기(`contents: read`)만 쓴다. checkout도 자격 증명을 남기지 않는다.
- 토큰은 Vercel 세 단계(pull·build·deploy)와 첫 확인 단계에만 넘긴다. 의존성 설치(`npm ci`)와 시험(`npm run verify`)에서는 보이지 않는다.
- 토큰은 환경 변수로만 넘긴다. `--token`·`-t` 인자는 쓰지 않는다(로그에 남을 수 있음).
- 배포 전에 `npm run verify`(형식검사·린트·시험)를 다시 돈다. 실패하면 배포하지 않는다.
- 같은 시각에 배포는 하나만 돈다.
- 공급망 고정
  - GitHub 액션은 태그가 아니라 커밋 SHA로 고정했다. 태그는 옮겨질 수 있기 때문이다.
  - Vercel CLI(`vercel` 65.11.0)는 앱 의존성과 떼어 **`tools/vercel-cli/`**의 자기 `package.json`·`package-lock.json`에 둔다. 그래서 앱 설치와 Vercel 자체 빌드(운영 환경 변수가 있는 곳)에는 CLI의 의존성 400여 개, 설치 스크립트(esbuild·koffi), audit 경고가 끼지 않는다.
  - 워크플로는 토큰이 없는 단계에서 `npm ci --prefix tools/vercel-cli --ignore-scripts`로 잠금 파일 그대로 설치한다. 설치 스크립트는 돌리지 않는다. 그다음 토큰 없이 `vercel --version`으로 CLI가 뜨는지 먼저 확인한다. 안 뜨면 토큰 단계로 가기 전에 멈춘다.
  - 부를 때는 `./tools/vercel-cli/node_modules/.bin/vercel`만 쓴다. `npx`나 실행 중 내려받기는 쓰지 않는다.
  - 올릴 때는 워크플로, `tools/vercel-cli/`의 두 파일, 시험(`tests/unit/deploy-workflow.test.ts`)을 함께 고친다. 앱 `package.json`에는 넣지 않는다(시험이 막는다).
- `vercel pull`로 받은 Vercel 환경 값(Supabase 키 등)은 GitHub이 로그에서 가려 주지 않는다. GitHub은 Secrets로 등록한 값만 가린다. 그래서 빌드·배포 단계에서 환경 값을 찍는 코드를 넣지 않는다.
- 이 워크플로 파일을 바꾸는 커밋은 배포 경로를 바꾸는 일이므로 Master 확인 대상이다. 위 장치가 빠지면 단위 시험이 실패한다.

## 5. 되돌리기·사고 대응

- 바로 멈추기: GitHub 저장소 → Actions → `vercel-deploy` → Disable workflow
- 토큰이 샜다고 의심될 때, 이 순서로 한다
  1. Vercel → Account Settings → Tokens → 해당 토큰 삭제(폐기)
  2. GitHub → Settings → Environments → `production` → `VERCEL_TOKEN` Secret도 지우거나, 새 토큰으로 바꾼다. 폐기한 토큰을 그대로 두면 다음 실행이 헷갈리는 오류로 실패한다.
  3. Vercel 대시보드의 배포 목록(Deployments)에서 **모르는 배포**가 있는지 본다. 있으면 Master에게 알리고, 필요하면 직전 정상 배포로 되돌린다.
- 만료로 바꿀 때도 같다: 새 토큰을 만들고 Environment Secret `VERCEL_TOKEN`만 새 값으로 바꾼다.
- 완전히 되돌리기: 워크플로 파일 삭제 커밋, Environment `production`(또는 그 Secrets 3개) 삭제. `deploymentEnabled`를 넣었다면 그 줄도 지운다. 그러면 예전처럼 트리거 커밋 방식만 남는다. `tools/vercel-cli/` 폴더도 함께 지운다(앱과 무관).
- 잘못된 버전이 운영에 올라갔을 때: Vercel 대시보드에서 직전 배포로 되돌린다(Instant Rollback). 이 워크플로와 상관없이 늘 쓸 수 있다.

## 6. 비용·시간

- GitHub Free의 비공개 저장소 Actions는 매달 약 $12 상당(리눅스 약 2,000분)이 무료다. 결제 수단이 없으면 넘쳐도 요금이 나가지 않고 실행이 멈춘다.
- 배포 1회는 설치·시험·빌드를 합쳐 대략 5~10분으로 예상한다.
- Vercel CLI 설치(`tools/vercel-cli`, 패키지 약 410개)는 이 워크플로 안에서만 한 번 더 한다. 앱 설치와 Vercel 자체 빌드 시간은 늘지 않는다.
