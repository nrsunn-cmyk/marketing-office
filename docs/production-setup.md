# 운영 준비 안내서 (Supabase · 로그인 메일 · Vercel Pro)

결정(2026-11-13): 호스팅 **Vercel Pro**, DB·로그인·파일 **Supabase 운영 프로젝트**, 로그인 메일은 **메일 발송 서비스(SMTP)** 연결.
가입·결제·비밀번호·키 입력은 **사용자가 직접** 한다. Claude는 연결·적용·검증을 맡는다.
각 서비스의 메뉴 이름과 요금은 바뀔 수 있으니 가입할 때 화면과 공식 안내를 확인한다.

> 비밀 키(`SUPABASE_SECRET_KEY`, DB 비밀번호, 메일 서비스 API 키)는 **채팅에 붙여 넣지 않는다.** 각 서비스 화면이나 내 PC의 `.env.production.local` 파일에 직접 넣는다.

---

## 1단계. Supabase 운영 프로젝트 (사용자)

1. https://supabase.com 가입 → 새 프로젝트 만들기
   - 지역(Region): **Seoul (Northeast Asia)** 권장
   - DB 비밀번호: 강하게 만들고 비밀번호 관리자에 보관
   - 요금제: 무료 플랜은 오래 쓰지 않으면 프로젝트가 멈추고 자동 백업 조건이 제한적이다. 실제 고객 업무에 쓰려면 유료 플랜을 검토한다.
2. **회원가입·비밀번호 설정 (2026-11-15 로그인 방식 변경):** Authentication → Sign In / Providers
   - "Allow new users to sign up" **켜기**, "Confirm email" **켜기** (가입하면 확인 메일 링크를 눌러야 로그인)
   - Email 공급자 → 비밀번호 최소 길이 **8**, 비밀번호 조건은 **영문과 숫자 포함**(Letters and digits) — 앱 규칙과 같게
   - 가입은 **허용한 이메일만** 된다: 앱 환경 변수 `ALLOWED_USER_EMAILS` + DB 표 `public.signup_allowlist`(DB가 직접 막음). 두 곳 모두에 넣어야 한다
   - **순서 주의:** DB 구조(가입 허용 목록 트리거)를 먼저 적용한 뒤 가입을 켠다. 그래야 켜는 순간부터 허용 안 된 가입이 막힌다
3. **주소 설정:** Authentication → URL Configuration
   - Site URL: 운영 주소 (예: `https://업무실도메인`)
   - Redirect URLs: `https://업무실도메인/auth/callback`
4. **한국어 계정 메일 (SMTP 연결 후에만 바꿀 수 있음):** Authentication → Emails → Templates
   - Confirm sign up: 제목 `[마케팅 업무실] 회원가입 메일 인증`, 내용 `supabase/templates/confirmation.html`
   - Reset password: 제목 `[마케팅 업무실] 비밀번호 재설정`, 내용 `supabase/templates/recovery.html`
   - 두 메일 모두 링크가 `{{ .SiteURL }}/auth/callback?token_hash=…` 형식이라 다른 기기에서 열어도 된다. SMTP 전 기본 메일 링크는 **요청한 브라우저에서 열어야** 한다
   - 메일에 "1시간 동안 한 번만"이라고 적혀 있다. Email의 **Email OTP Expiration이 3600초(1시간)**인지 확인한다
5. Claude에게 알려 줄 것: **프로젝트 주소의 ref**(예: `abcd1234...`)만. 키는 알려 주지 않는다.

## 2단계. 로그인 메일 발송 서비스 (사용자)

Supabase 기본 메일은 시험용이라 보낼 수 있는 양이 매우 적다. 운영에는 메일 발송 서비스를 연결한다.

1. 메일 발송 서비스 가입 (예: Resend — Supabase와 연결 안내가 공식으로 있음)
2. 보낼 주소의 도메인 인증 (DNS에 서비스가 알려 주는 기록 추가)
3. Supabase → Authentication → Emails → SMTP Settings 켜기
   - 보내는 주소·이름: 예) `no-reply@업무실도메인`, `마케팅 업무실`
   - 호스트·포트·사용자·비밀번호: 메일 서비스의 SMTP 안내대로 입력 (비밀번호 = 서비스 API 키)
4. Authentication → Rate Limits에서 시간당 메일 수가 너무 낮지 않은지 확인

## 3단계. DB 구조 적용 (Claude, 사용자는 비밀번호만 입력)

사용자가 Claude Code 입력창에서 직접 실행 (비밀번호는 프롬프트에만 입력):

```
! supabase link --project-ref <ref>
```

그다음 Claude가 실행·확인:

- `supabase db push` — 저장소의 마이그레이션을 차례로 적용 (현재 최종 후보는 11개). 적용 전후 `supabase migration list`로 실제 목록과 대상 프로젝트를 확인
- 운영 DB에서 RLS·저장소 정책 확인 (로컬에서 한 시험과 같은 방식, 시험 데이터는 남기지 않음)
- `npm run db:types` 결과가 로컬과 같은지 확인

## 4단계. 본인 계정 만들기 (사용자 + Claude)

1. 사용자가 내 PC 저장소 폴더에 `.env.production.local`을 만들고 운영 값 입력 (git에 올라가지 않음):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SECRET_KEY=<운영 Secret key>
   ALLOWED_USER_EMAILS=<본인 이메일>
   ```
2. Claude가 실행: `node --env-file=.env.production.local scripts/create-owner.mts <본인 이메일> --allow-only` — DB 가입 허용 목록에만 넣는다. 그다음 본인이 화면의 **회원가입**으로 가입한다
   - 관리자 키 없이 할 때: Supabase SQL Editor에서 `insert into public.signup_allowlist (email) values ('<본인 이메일 소문자>');`
   - 이미 계정이 있는데(이전 메일 링크 방식에서 만든 계정) 비밀번호가 없으면: 로그인 화면의 **비밀번호를 잊으셨나요?** 로 비밀번호를 정한다
3. 끝나면 `.env.production.local`의 `SUPABASE_SECRET_KEY` 줄은 지워도 된다 (백업할 때 다시 넣는다).

## 5단계. Vercel Pro 배포 (사용자 + Claude)

1. Vercel 가입 → Pro 플랜 → 팀 만들기
2. 코드 올리는 방법 중 하나 고르기
   - **권장:** GitHub에 **비공개** 저장소를 만들고 연결 (사용자가 만든 뒤 주소를 알려 주면 Claude가 `main`만 올린다. `main`은 Codex 검수 후 병합)
   - 또는 Vercel CLI로 직접 배포 (`! vercel login` 후 Claude가 `vercel deploy`)
3. 환경 변수 (Vercel 프로젝트 → Settings → Environment Variables, Production):

   | 이름 | 값 |
   |---|---|
   | `NEXT_PUBLIC_SITE_URL` | 운영 주소 (`https://업무실도메인`) |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase의 Publishable key |
   | `ALLOWED_USER_EMAILS` | 본인 이메일 |

   **`SUPABASE_SECRET_KEY`는 넣지 않는다.** 앱은 관리자 키 없이 동작하도록 만들어져 있다.
4. 서버 지역: 저장소의 `vercel.json`이 서울(`icn1`)로 정해 둔다 (Supabase 서울과 가깝게).
5. 도메인 연결 (선택): Vercel → Domains. 주소가 바뀌면 1단계 3번 주소와 `NEXT_PUBLIC_SITE_URL`도 바꾼다.

## 6단계. 배포 후 확인 (Claude)

| 확인 | 기대 결과 |
|---|---|
| 로그인 화면 열기 | 한국어 화면 |
| 본인 이메일로 링크 요청 | 한국어 메일 도착, 링크로 로그인 → 처음 설정 |
| 허용 안 된 이메일로 요청 | 같은 안내, 메일 안 감 |
| 고객 등록·파일 올리기·내려받기 | 정상 |
| 견적 확정·PDF | 한글 PDF, 금액 일치 |
| 로그아웃 후 `/` 접근 | 로그인 화면으로 |
| 첫 백업 | `BACKUP_REMOTE=1 npm run backup -- <폴더>` 성공, 안전한 곳에 보관 |

시험으로 만든 고객·견적은 운영 DB에 남는다(삭제 기능 없음). 시험은 "시험용" 이름의 고객 하나로만 하고 보관 처리한다.

## 사용자가 할 일 요약

1. Supabase 가입·프로젝트(서울)·공개 가입 끄기·주소·한국어 메일 → ref 알려 주기
2. 메일 발송 서비스 가입·도메인 인증·SMTP 입력
3. `! supabase link --project-ref <ref>` 실행 (비밀번호 입력)
4. `.env.production.local` 만들기
5. Vercel Pro 가입·GitHub 비공개 저장소(또는 CLI 로그인)·환경 변수 입력
