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

- 로그인 메일은 로컬에서는 실제로 나가지 않는다. http://127.0.0.1:54324 (Mailpit)에서 확인한다.
- `.env.local`의 `ALLOWED_USER_EMAILS`에 본인 이메일만 적는다. 비어 있으면 아무도 로그인할 수 없다.

## 2. 검사

| 명령 | 내용 |
|---|---|
| `npm run verify` | 형식검사·코드 검사·단위·DB 테스트 |
| `npm run build` | 배포용 빌드 |
| `npm run e2e:reset && bash scripts/e2e-check.sh` | 실제 Chrome으로 전체 흐름. **로컬 DB를 비운다** |
| `node scripts/render-pdf-pages.mjs <pdf> <접두어> 1,2` | PDF 쪽을 그림으로 확인 |

## 3. 백업과 복원 (T20)

Supabase DB 백업에는 **자료 파일이 들어 있지 않다.** 그래서 DB 데이터와 파일을 함께 받는 스크립트를 쓴다.

```
npm run backup -- <백업 폴더>                  # data.sql + files/ + manifest.json
npm run backup:verify -- <백업 폴더>           # 현재 상태와 백업 비교 (바꾸지 않음)
RESTORE_DRILL_CONFIRM=local npm run backup:restore-drill -- <백업 폴더>   # 로컬 복원 훈련
```

- 백업 폴더에는 고객 자료가 들어 있다. 암호가 걸린 저장 장치 등 안전한 곳에 두고 공유하지 않는다.
- 복원 훈련은 **로컬 DB를 비우고** 다시 넣은 뒤 검증한다(행 수·외래키 고아 행·파일 체크섬·견적 금액 재계산). 운영 DB에는 쓰지 않는다.
- 운영 백업: `BACKUP_REMOTE=1 npm run backup -- <폴더>` (연결된 Supabase 프로젝트, `supabase link` 필요).
- 운영 복원: 새 Supabase 프로젝트 → 마이그레이션 적용(`supabase db push`) → `public.templates` 비우고 `data.sql` 적용(트리거 끈 상태) → 파일 업로드 → `backup:verify`. 원래 프로젝트를 덮어쓰지 않는다.
- 복원 후 앱 확인: `RESTORE_CHECK=1 npx playwright test tests/e2e/restore-check.spec.ts` (훈련 데이터 기준).

## 4. 운영 배포 전 확인 (사용자 결정 필요 항목 포함)

| 항목 | 내용 |
|---|---|
| 호스팅 (D11) | Vercel Hobby(무료)는 **개인 비상업 용도만** 허용된다. 외주 업무에 쓰려면 유료 플랜 또는 다른 호스팅을 정한다 |
| Supabase 프로젝트 | 운영용을 따로 만든다. 대시보드에서 **공개 가입 끄기**(Authentication → Sign In / Providers → Allow new users to sign up 해제) |
| 메일 발송 | 운영에서는 SMTP(메일 발송 서비스)를 연결해야 로그인 메일이 간다 |
| 환경 변수 | `NEXT_PUBLIC_SITE_URL`(운영 주소), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_USER_EMAILS`. **`SUPABASE_SECRET_KEY`는 운영 서버에 넣지 않는다**(관리자 스크립트 전용) |
| 로그인 주소 허용 | Supabase Auth의 Redirect URLs에 `<운영 주소>/auth/callback` 추가 |
| 견적서 서식 (D07) | 실제 서식을 받으면 PDF 배치를 맞춘다 |
| 백업 주기 | 운영 시작 전 정한다(권장: 매일 DB+파일 백업, 월 1회 복원 훈련) |
