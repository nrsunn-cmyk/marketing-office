# 운영 안내 (P1)

쉬운 순서대로 적었다. 명령은 저장소 폴더에서 실행한다.

## 1. 내 PC에서 실행하기

```
supabase start                     # Docker Desktop이 켜져 있어야 한다
copy .env.example .env.local       # 값은 `supabase status` 로 확인
npm ci
node --env-file=.env.local scripts/create-owner.mts <본인 이메일>   # 처음 한 번
npm run dev                        # http://127.0.0.1:3000
```

- 가입 확인·비밀번호 재설정 메일은 로컬에서는 실제로 나가지 않는다. http://127.0.0.1:54324 (Mailpit)에서 확인한다.
- `.env.local`의 `ALLOWED_USER_EMAILS`에 본인 이메일만 적는다. 비어 있으면 아무도 로그인할 수 없다.

## 2. 검사

| 명령 | 내용 |
|---|---|
| `npm run verify` | 형식검사·코드 검사·단위·DB 테스트 |
| `npm run build` | 배포용 빌드 |
| `npm run e2e:reset && bash scripts/e2e-check.sh` | 실제 Chrome으로 전체 흐름. **로컬 DB를 비운다** |
| `node scripts/render-pdf-pages.mjs <pdf> <접두어> 1,2` | PDF 쪽을 그림으로 확인 |

**e2e:reset 안전 확인(RESET-SAFETY-01):** 전용 시험 스택 폴더에서만, 그 스택의 project_id를 명시해 실행한다. 예: `E2E_SUPABASE_PROJECT_ID=<전용 project_id> npm run e2e:reset`. 실행 폴더의 `supabase/config.toml`, 실제 DB·API 컨테이너 포트, `.env.local`의 API 주소가 서로 맞지 않거나, 공유 스택(project_id `marketing-office`, 포트 5432x)·원격 주소이면 아무것도 지우지 않고 멈춘다. 그래서 이 저장소 원본 설정(공유 스택)에서는 초기화되지 않는다. E2E 실행에는 추가로 `E2E_MAILPIT_URL`·`E2E_BASE_URL`이 필요하다(`tests/e2e/stack-guard.ts`).

## 3. 백업과 복원 (T20)

Supabase DB 백업에는 **자료 파일이 들어 있지 않다.** 그래서 DB 데이터와 파일을 함께 받는 스크립트를 쓴다.

```
npm run backup -- <백업 폴더>                  # data.sql + files/ + manifest.json
npm run backup:verify -- <백업 폴더>           # 현재 상태와 백업 비교 (바꾸지 않음)
RESTORE_DRILL_CONFIRM=local npm run backup:restore-drill -- <백업 폴더>   # 로컬 복원 훈련
```

- 백업 폴더에는 고객 자료가 들어 있다. 암호가 걸린 저장 장치 등 안전한 곳에 두고 공유하지 않는다.
- 복원 훈련은 **로컬 DB를 비우고** 다시 넣은 뒤 검증한다(행 수·외래키 고아 행·파일 체크섬·견적 금액 재계산). 운영 DB에는 쓰지 않는다.
- 로컬 복원 훈련 환경에는 `BACKUP_DB_URL`을 넣지 않는다. 원격 DB 주소가 함께 있으면 초기화 전에 중단한다.
- 운영 백업 (BACKUP-OPS-01): `.env.production.local`(운영 API 주소·관리자 키)에 `BACKUP_DB_URL`(운영 DB 연결 주소)을 **함께** 넣고 `node --env-file=.env.production.local scripts/backup/backup.mts <폴더>`.
  - 시작 전에 API 주소의 프로젝트와 DB 연결 주소의 프로젝트(ref)가 같은지 확인하고, 다르거나 하나라도 빠지면 **폴더도 만들지 않고 멈춘다**. DB 내보내기는 그 연결 주소로만 한다(`--remote=<주소>`, `supabase link` 불필요).
  - 로컬 API 주소에 `BACKUP_DB_URL`·`BACKUP_REMOTE`가 섞여 있어도 멈춘다. `BACKUP_REMOTE`는 더 쓰지 않는다.
  - 백업 목록(`manifest.json`)의 `target`에 백업한 곳(`local` 또는 운영 프로젝트 ref)이 남는다(비밀값 없음).
  - DB 연결 주소에는 DB 비밀번호가 들어 있다. 채팅·문서·git에 남기지 말고, 사용자가 환경 파일에 직접 넣는다.
  - '도구 준비'와 '실제 운영 백업 완료'는 다르다. 실제로 `data.sql`·`manifest.json`이 만들어지고 검증까지 통과한 뒤에만 완료로 적는다.
- 운영 검증: 백업과 같은 환경(운영 API + 같은 프로젝트의 `BACKUP_DB_URL`)으로 실행한다. 검증 SQL도 같은 대상 규칙을 거치므로, 프로젝트가 다르거나 주소가 없으면 멈춘다(API와 SQL이 서로 다른 DB를 보는 것을 막음).
- 운영 복원: 새 Supabase 프로젝트 → 마이그레이션 적용(`supabase db push`) → `public.templates` 비우고 `data.sql` 적용(트리거 끈 상태) → 파일 업로드 → `backup:verify`. 원래 프로젝트를 덮어쓰지 않는다.
- 복원 후 앱 확인: `RESTORE_CHECK=1 npx playwright test tests/e2e/restore-check.spec.ts` (훈련 데이터 기준).

## 4. 운영 배포 전 확인

가입부터 배포 후 확인까지 단계별 안내: `docs/production-setup.md` (Supabase 운영 프로젝트 + 메일 발송 서비스 + Vercel. 요금제는 아래 표)

| 항목 | 내용 |
|---|---|
| 호스팅 (D11) | **현재: Vercel Hobby(무료)로 운영 중.** 사용자 지시는 "Pro는 나중, 지금은 무료"다(2026-11-13의 "Vercel Pro" 결정은 시기를 미룸). 지금 쓰는 방식이 Vercel 무료 정책에 맞는지는 **미확인**이다(약관을 이 문서에서 판정하지 않음). Pro로 옮기는 시점은 사용자가 정한다 |
| Supabase 프로젝트 | 운영용을 따로 만든다. 가입은 **켜 두고**(메일 인증 필수) 허용한 이메일만 가입되게 한다: 앱 `ALLOWED_USER_EMAILS` + DB `public.signup_allowlist`(2026-11-15 D03 변경. 예전 "공개 가입 끄기"는 메일 링크 로그인 때의 설정이다). 운영 요금제는 **미확인** |
| 메일 발송 | 운영에서는 SMTP(메일 발송 서비스)를 연결해야 가입 확인·비밀번호 재설정 메일이 간다. 현재 연결됨(Resend, 사용자 결정으로 지금 키·보내는 주소 유지) |
| 환경 변수 | `NEXT_PUBLIC_SITE_URL`(운영 주소), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_USER_EMAILS`. **`SUPABASE_SECRET_KEY`는 운영 서버에 넣지 않는다**(관리자 스크립트 전용) |
| 로그인 주소 허용 | Supabase Auth의 Redirect URLs에 `<운영 주소>/auth/callback` 추가 |
| 견적서 서식 (D07) | 표준 견적서 양식으로 PDF 배치를 맞췄다(커밋 `82ecfc5`) |
| 백업 주기 | **미정.** 운영 시작 전 정한다(권장: 매일 DB+파일 백업, 월 1회 복원 훈련). 운영 첫 백업은 아직 실행하지 않았다(도구만 준비됨) |

## 5. 현재 운영 상태 (2026-11-16 기록 기준)

"도구 준비", "작성자 확인", "검수 확인", "미실행"을 나눠 적는다. 기록을 옮긴 것이며 이 문서를 고치면서 다시 시험하지는 않았다.

| 항목 | 상태 | 근거 |
|---|---|---|
| 운영 DB 구조 | 작성자 확인: 마이그레이션 12개 적용 | 점유판 완료 기록(Claude Code, 2026-11-15) |
| 비로그인 차단 | 검수 확인: 보호 화면 7개 → `/login`, 익명 DB 조회 거절 | `Plan/Codex-QA-Plan-20261115/01_순차검수계획_진행현황.md` |
| 가입 확인 메일 | 사용자 수신 확인: 한국어 메일 | 점유판 완료 기록, 사용자 확인(2026-11-15) |
| 비밀번호 재설정 메일 실동작 | 미실행(Codex 검수 남음) | 같은 Codex 문서 6번 |
| 운영 업무 전체 흐름(고객→자료→견적 확정→PDF→재조회) | 미실행 | 같은 Codex 문서 7번 |
| 운영 백업·복원 | 도구 준비만, 실제 백업 미실행 | 같은 Codex 문서 8번 |
| 운영 배포 커밋 | 기록상 `1938b78`(AGY 배포 기록), 직접 대조 안 함 | 점유판 완료 기록(AGY, 2026-11-15 23:40) |
| 배포 방법 | GitHub 연결은 됐지만 Hobby 커밋 작성자 제한으로 자동 배포가 막혀, 커밋 사본을 CLI로 배포 | 점유판 완료 기록(Claude Code, 2026-11-15) |
